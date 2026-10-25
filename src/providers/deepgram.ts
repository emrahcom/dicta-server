// Deepgram live transcription.
//
// Protocol references: specs/architecture.md (Providers, deepgram). Checked
// against the live API on 2026-10-24.
//
// Results come per segment: a segment grows in interim results and ends with
// is_final. The utterance ends with from_finalize, after a Finalize.
// Deepgram closes a stream after 10 seconds without audio or KeepAlive.

import WebSocket from "ws";
import { quoteForLog } from "../logging.ts";
import { parseMessage, unknownTypeWarning } from "./messages.ts";
import {
  MAX_PROVIDER_BUFFER_BYTES,
  type OpenStream,
  type ProviderStream,
  type StreamEvents,
} from "./provider.ts";

export const DEEPGRAM_DEFAULT_MODEL = "nova-3";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const OPEN_TIMEOUT_MS = 10_000;
const FINALIZE_AFTER_MS = 1000;
const KEEPALIVE_INTERVAL_MS = 4000;

export function createDeepgram({
  apiKey,
  model,
  mipOptIn,
  url = DEEPGRAM_URL,
}: {
  apiKey: string;
  model: string;
  mipOptIn: boolean;
  url?: string;
}): OpenStream {
  const params = new URLSearchParams({
    model,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
  });
  if (!mipOptIn) {
    params.set("mip_opt_out", "true");
  }

  const connect = (
    { onTranscript, onError, onWarning }: StreamEvents,
    language: string | undefined,
  ): Promise<ProviderStream> =>
    new Promise((resolve, reject) => {
      const query = new URLSearchParams(params);
      if (language !== undefined) {
        query.set("language", language);
      }
      const ws = new WebSocket(`${url}?${query}`, {
        headers: { Authorization: `Token ${apiKey}` },
      });
      let state: "opening" | "open" | "closed" = "opening";
      // Finished segments of the current utterance.
      let segments: string[] = [];
      let finalizeTimer: NodeJS.Timeout | undefined;
      let keepAlive: NodeJS.Timeout | undefined;

      const openTimer = setTimeout(
        () => fail(new Error("not open within 10 seconds")),
        OPEN_TIMEOUT_MS,
      );

      const send = (message: object) => {
        try {
          ws.send(JSON.stringify(message));
        } catch (err) {
          fail(err);
        }
      };

      const sendFinal = () => {
        const text = segments.join(" ");
        segments = [];
        if (text) {
          onTranscript({ text, final: true });
        }
      };

      const stopTimers = () => {
        clearTimeout(openTimer);
        clearTimeout(finalizeTimer);
        clearInterval(keepAlive);
      };

      // Ends the stream on any failure. Before it is open, it rejects the open.
      // After it, it sends the collected text as a final and reports the error.
      const fail = (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const wasOpen = state === "open";
        if (state === "closed") {
          return;
        }
        state = "closed";
        stopTimers();
        ws.terminate();
        if (wasOpen) {
          sendFinal();
          onError(error);
        } else {
          reject(error);
        }
      };

      // Asks Deepgram to finalize: the collected text comes as a final with
      // from_finalize.
      const finish = () => {
        if (state !== "open") {
          return;
        }
        clearTimeout(finalizeTimer);
        send({ type: "Finalize" });
      };

      const stream: ProviderStream = {
        sendAudio(chunk) {
          if (state !== "open") {
            return;
          }
          if (ws.bufferedAmount > MAX_PROVIDER_BUFFER_BYTES) {
            fail(new Error("provider does not keep up"));
            return;
          }
          ws.send(chunk);
          clearTimeout(finalizeTimer);
          finalizeTimer = setTimeout(finish, FINALIZE_AFTER_MS);
        },
        finish,
        close() {
          state = "closed";
          stopTimers();
          ws.close();
        },
      };

      const handleResults = (message: DeepgramMessage) => {
        const transcript = message.channel?.alternatives?.[0]?.transcript ?? "";
        if (message.is_final && transcript) {
          segments.push(transcript);
        }
        // Only the answer to Finalize ends the utterance. speech_final does
        // not, so a pause inside a command does not split it.
        if (message.is_final && message.from_finalize) {
          sendFinal();
          return;
        }
        const text = [...segments, message.is_final ? "" : transcript]
          .filter((part) => part)
          .join(" ");
        if (text) {
          onTranscript({ text, final: false });
        }
      };

      const handleMessage = (message: DeepgramMessage) => {
        switch (message.type) {
          case "Results":
            handleResults(message);
            break;
          case "Error":
            onWarning(`Deepgram error: ${describeError(message)}`);
            break;
          case "Metadata":
          case "SpeechStarted":
          case "UtteranceEnd":
            break;
          default:
            onWarning(unknownTypeWarning(message.type));
        }
      };

      ws.on("open", () => {
        if (state !== "opening") {
          return;
        }
        state = "open";
        clearTimeout(openTimer);
        keepAlive = setInterval(
          () => send({ type: "KeepAlive" }),
          KEEPALIVE_INTERVAL_MS,
        );
        resolve(stream);
      });
      ws.on("unexpected-response", (_req, res) =>
        fail(new RefusedError(res.statusCode ?? 0)),
      );
      ws.on("error", fail);
      ws.on("close", (code, reason) =>
        fail(
          new Error(
            `Deepgram closed the connection: ${code} ${quoteForLog(reason.toString())}`,
          ),
        ),
      );
      // A provider catches errors in its own handlers (architecture.md).
      ws.on("message", (data, isBinary) => {
        if (state === "closed") {
          return;
        }
        try {
          const raw = data as Buffer;
          const message = isBinary
            ? undefined
            : parseMessage<DeepgramMessage>(raw);
          if (message === undefined) {
            onWarning(`unparseable message (${raw.length} bytes)`);
            return;
          }
          handleMessage(message);
        } catch (err) {
          fail(err);
        }
      });
    });

  // A tag with a region or script that Deepgram refuses is retried with its
  // language code (de-BE as de).
  return async (events, { lang }) => {
    try {
      return await connect(events, lang);
    } catch (err) {
      if (
        !(err instanceof RefusedError && err.status === 400) ||
        lang === undefined
      ) {
        throw err;
      }
      const code = lang.split("-")[0];
      if (code === lang) {
        throw err;
      }
      events.onWarning(
        `Deepgram refused lang ${quoteForLog(lang)}, using ${quoteForLog(code)}`,
      );
      return connect(events, code);
    }
  };
}

// Deepgram refused the WebSocket upgrade with an HTTP status.
class RefusedError extends Error {
  status: number;

  constructor(status: number) {
    super(`Deepgram rejected the connection: HTTP ${status}`);
    this.status = status;
  }
}

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
  description?: unknown;
  message?: unknown;
};

// Deepgram's own description of an error, never other message content.
function describeError(message: DeepgramMessage): string {
  const text = [message.description, message.message].find(
    (part) => typeof part === "string",
  );
  return quoteForLog(typeof text === "string" ? text : "no description");
}
