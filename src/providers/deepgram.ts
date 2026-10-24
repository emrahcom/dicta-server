// Deepgram live transcription.
//
// Protocol references, checked against the live API on 2026-10-24:
// - https://developers.deepgram.com/reference/speech-to-text-api/listen-streaming
// - https://developers.deepgram.com/docs/understand-endpointing-interim-results
// - https://developers.deepgram.com/docs/finalize
// - https://developers.deepgram.com/docs/audio-keep-alive
//
// Results come per segment: a segment grows in interim results and ends with
// is_final. speech_final, or from_finalize after a Finalize, ends the
// utterance.
// Deepgram closes a stream after 10 seconds without audio or KeepAlive.

import WebSocket from "ws";
import { quoteForLog } from "../logging.ts";
import type { OpenStream, ProviderStream } from "./provider.ts";

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
    endpointing: "500",
    smart_format: "true",
  });
  if (!mipOptIn) {
    params.set("mip_opt_out", "true");
  }

  return ({ onTranscript, onError, onWarning }) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url}?${params}`, {
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

      const stream: ProviderStream = {
        sendAudio(chunk) {
          if (state !== "open") {
            return;
          }
          ws.send(chunk);
          clearTimeout(finalizeTimer);
          finalizeTimer = setTimeout(
            () => send({ type: "Finalize" }),
            FINALIZE_AFTER_MS,
          );
        },
        close() {
          if (state === "open") {
            send({ type: "CloseStream" });
          }
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
        if (
          message.is_final &&
          (message.speech_final || message.from_finalize)
        ) {
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
            onWarning(
              `unknown message type ${quoteForLog(String(message.type))}`,
            );
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
        fail(
          new Error(`Deepgram rejected the connection: HTTP ${res.statusCode}`),
        ),
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
          const message = isBinary ? undefined : parseMessage(raw);
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
}

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
  description?: unknown;
  message?: unknown;
};

// A JSON object, or undefined for anything else.
function parseMessage(raw: Buffer): DeepgramMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    return typeof parsed === "object" && parsed !== null
      ? (parsed as DeepgramMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

// Deepgram's own description of an error, never other message content.
function describeError(message: DeepgramMessage): string {
  const text = [message.description, message.message].find(
    (part) => typeof part === "string",
  );
  return quoteForLog(typeof text === "string" ? text : "no description");
}
