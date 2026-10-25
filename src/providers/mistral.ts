// Mistral realtime transcription (Voxtral).
//
// Protocol references: specs/architecture.md (Providers, mistral).
//
// Checked against the live API on 2026-10-24: session.created arrives right
// after the connection opens, and text comes as transcription.text.delta
// fragments with their leading spaces ("The", " Bir", "ch", ".").

import WebSocket from "ws";
import { quoteForLog } from "../logging.ts";
import { parseMessage, unknownTypeWarning } from "./messages.ts";
import {
  MAX_PROVIDER_BUFFER_BYTES,
  type OpenStream,
  type ProviderStream,
} from "./provider.ts";

export const MISTRAL_DEFAULT_MODEL = "voxtral-mini-transcribe-realtime-3";

const MISTRAL_URL = "wss://api.mistral.ai/v1/audio/transcriptions/realtime";
const OPEN_TIMEOUT_MS = 10_000;

export function createMistral({
  apiKey,
  model,
  url = MISTRAL_URL,
}: {
  apiKey: string;
  model: string;
  url?: string;
}): OpenStream {
  return ({ onTranscript, onError, onWarning }, { lang }) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      let state: "opening" | "open" | "closed" = "opening";
      // Text received since the last final.
      let pending = "";

      const openTimer = setTimeout(
        () => fail(new Error("no session.created within 10 seconds")),
        OPEN_TIMEOUT_MS,
      );

      // The answer to a flush is the final of the utterance, also when empty.
      const sendFinal = () => {
        const text = pending.trim();
        pending = "";
        onTranscript({ text, final: true });
      };

      // Ends the stream on any failure. Before it is open, it rejects the open.
      // After it, it reports the error.
      const fail = (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const wasOpen = state === "open";
        if (state === "closed") {
          return;
        }
        state = "closed";
        clearTimeout(openTimer);
        ws.terminate();
        // The unfinished utterance is discarded, never sent as a final.
        if (wasOpen) {
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
          if (ws.bufferedAmount > MAX_PROVIDER_BUFFER_BYTES) {
            fail(new Error("provider does not keep up"));
            return;
          }
          ws.send(
            JSON.stringify({
              type: "input_audio.append",
              audio: chunk.toString("base64"),
            }),
          );
        },
        // Asks Mistral to flush: the text of the utterance comes as a final with
        // transcription.done.
        finish() {
          if (state !== "open") {
            return;
          }
          try {
            ws.send(JSON.stringify({ type: "input_audio.flush" }));
          } catch (err) {
            fail(err);
          }
        },
        close() {
          state = "closed";
          clearTimeout(openTimer);
          ws.close();
        },
      };

      const handleMessage = (message: MistralMessage) => {
        switch (message.type) {
          case "session.created":
            if (state === "opening") {
              ws.send(
                JSON.stringify({
                  type: "session.update",
                  session: {
                    audio_format: { encoding: "pcm_s16le", sample_rate: 16000 },
                    ...mistralLanguage(lang),
                  },
                }),
              );
              state = "open";
              clearTimeout(openTimer);
              resolve(stream);
            }
            break;
          case "transcription.text.delta":
            // Nothing reaches the client before the stream is open.
            if (state !== "open") {
              break;
            }
            // A final comes only from the flush. A sentence end is no sign of
            // one, since a period arrives as its own delta ("Dr. Smith").
            pending += message.text ?? "";
            if (pending.trim()) {
              onTranscript({ text: pending.trim(), final: false });
            }
            break;
          case "transcription.done":
            if (state === "open") {
              sendFinal();
            }
            break;
          case "error":
            fail(new Error(`Mistral error: ${describeError(message.error)}`));
            break;
          case "session.updated":
            break;
          default:
            onWarning(unknownTypeWarning(message.type));
        }
      };

      ws.on("unexpected-response", (_req, res) =>
        fail(
          new Error(`Mistral rejected the connection: HTTP ${res.statusCode}`),
        ),
      );
      ws.on("error", fail);
      ws.on("close", (code) =>
        fail(new Error(`Mistral closed the connection: ${code}`)),
      );
      // A provider catches errors in its own handlers (architecture.md).
      ws.on("message", (data) => {
        if (state === "closed") {
          return;
        }
        try {
          const raw = data as Buffer;
          const message = parseMessage<MistralMessage>(raw);
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

type MistralMessage = {
  type?: string;
  text?: string;
  error?: { code?: number | string; message?: unknown };
};

// Mistral's own description of an error, quoted for the log. error.message is
// a string or an object with details.
function describeError(error: MistralMessage["error"]): string {
  const message =
    typeof error?.message === "string"
      ? error.message
      : error?.message === undefined
        ? "no description"
        : JSON.stringify(error.message);
  return quoteForLog(
    error?.code === undefined ? message : `${error.code} ${message}`,
  );
}

// Mistral takes a two-letter language code; without one it detects the
// language itself.
function mistralLanguage(lang: string | undefined): { language?: string } {
  const code = lang?.split("-")[0];
  return code?.length === 2 ? { language: code.toLowerCase() } : {};
}
