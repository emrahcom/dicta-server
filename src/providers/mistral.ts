// Mistral realtime transcription (Voxtral).
//
// Protocol references:
// - Docs (endpoint, audio format, events):
//   https://docs.mistral.ai/studio/audio/speech_to_text/realtime_transcription.md
// - Client messages (session.update, input_audio.append, input_audio.flush):
//   src/mistralai/client/models/realtimetranscription*.py in
//   https://github.com/mistralai/client-python
//
// Checked against the live API on 2026-10-24: session.created arrives right
// after the connection opens, and text comes as transcription.text.delta
// fragments with their leading spaces ("The", " Bir", "ch", ".").

import WebSocket from "ws";
import { parseMessage, unknownTypeWarning } from "./messages.ts";
import type { OpenStream, ProviderStream } from "./provider.ts";

export const MISTRAL_DEFAULT_MODEL = "voxtral-mini-transcribe-realtime-3";

const MISTRAL_URL = "wss://api.mistral.ai/v1/audio/transcriptions/realtime";
const OPEN_TIMEOUT_MS = 10_000;
const FLUSH_AFTER_MS = 1000;

// A Unicode sentence terminator, optionally followed by closing brackets or
// quotes.
const SENTENCE_END = /\p{Sentence_Terminal}[\p{Pe}\p{Pf}"']*$/u;

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
      let flushTimer: NodeJS.Timeout | undefined;

      const openTimer = setTimeout(
        () => fail(new Error("no session.created within 10 seconds")),
        OPEN_TIMEOUT_MS,
      );

      const sendFinal = () => {
        const text = pending.trim();
        pending = "";
        if (text) {
          onTranscript({ text, final: true });
        }
      };

      // Ends the stream on any failure. Before it is open, it rejects the open.
      // After it, it sends the pending text as a final and reports the error.
      const fail = (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const wasOpen = state === "open";
        if (state === "closed") {
          return;
        }
        state = "closed";
        clearTimeout(openTimer);
        clearTimeout(flushTimer);
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
          ws.send(
            JSON.stringify({
              type: "input_audio.append",
              audio: chunk.toString("base64"),
            }),
          );
          clearTimeout(flushTimer);
          flushTimer = setTimeout(() => {
            try {
              ws.send(JSON.stringify({ type: "input_audio.flush" }));
            } catch (err) {
              fail(err);
            }
          }, FLUSH_AFTER_MS);
        },
        close() {
          state = "closed";
          clearTimeout(openTimer);
          clearTimeout(flushTimer);
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
            pending += message.text ?? "";
            if (SENTENCE_END.test(pending.trim())) {
              sendFinal();
            } else if (pending.trim()) {
              onTranscript({ text: pending.trim(), final: false });
            }
            break;
          case "transcription.done":
            sendFinal();
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

// error.message is a string or an object with details.
function describeError(error: MistralMessage["error"]): string {
  const message =
    typeof error?.message === "string"
      ? error.message
      : JSON.stringify(error?.message);
  return error?.code === undefined ? message : `${error.code} ${message}`;
}

// Mistral takes a two-letter language code; without one it detects the
// language itself.
function mistralLanguage(lang: string | undefined): { language?: string } {
  const code = lang?.split("-")[0];
  return code?.length === 2 ? { language: code.toLowerCase() } : {};
}
