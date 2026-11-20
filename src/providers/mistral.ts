// Mistral realtime transcription (Voxtral).
//
// Protocol references: specs/architecture.md (Providers, mistral).
//
// Checked against the live API on 2026-10-24: session.created arrives right
// after the connection opens, and text comes as transcription.text.delta
// fragments with their leading spaces ("The", " Bir", "ch", ".").

import WebSocket from "ws";
import { quoteForLog } from "../logging.ts";
import { parseOrWarn, unknownTypeWarning } from "./messages.ts";
import {
  keepsUp,
  OPEN_TIMEOUT_MS,
  type OpenStream,
  type ProviderStream,
  type StreamEvents,
} from "./provider.ts";

export const MISTRAL_DEFAULT_MODEL = "voxtral-mini-transcribe-realtime-3";

const MISTRAL_URL = "wss://api.mistral.ai/v1/audio/transcriptions/realtime";

export function createMistral({
  apiKey,
  model,
  url = MISTRAL_URL,
}: {
  apiKey: string;
  model: string;
  url?: string;
}): OpenStream {
  return (events, { lang }) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      let state: "opening" | "open" | "closed" = "opening";
      const utterance: Utterance = { pending: "" };

      const openTimer = setTimeout(
        () =>
          fail(
            new Error(
              `no session.created within ${OPEN_TIMEOUT_MS / 1000} seconds`,
            ),
          ),
        OPEN_TIMEOUT_MS,
      );

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
          events.onError(error);
        } else {
          reject(error);
        }
      };

      const stream: ProviderStream = {
        sendAudio(chunk) {
          if (state !== "open" || !keepsUp(ws, fail)) {
            return;
          }
          ws.send(
            JSON.stringify({
              type: "input_audio.append",
              audio: chunk.toString("base64"),
            }),
          );
        },
        // Asks Mistral to flush: the text of the utterance comes as a final
        // with transcription.done.
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

      const openSession = () => {
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
      // Mistral sends text frames only; every frame is read as JSON.
      ws.on("message", (data) => {
        if (state === "closed") {
          return;
        }
        try {
          const message = parseOrWarn<MistralMessage>(
            data as Buffer,
            false,
            events.onWarning,
          );
          if (message?.type === "session.created") {
            if (state === "opening") {
              openSession();
            }
          } else if (message !== undefined) {
            handleMessage(message, state === "open", utterance, events, fail);
          }
        } catch (err) {
          fail(err);
        }
      });
    });
}

// pending: the text received since the last final.
type Utterance = { pending: string };

// Every message but session.created, which opens the stream. open: whether
// the stream is open.
function handleMessage(
  message: MistralMessage,
  open: boolean,
  utterance: Utterance,
  { onTranscript, onWarning }: StreamEvents,
  fail: (err: unknown) => void,
) {
  switch (message.type) {
    case "transcription.text.delta":
      // Nothing reaches the client before the stream is open.
      if (!open) {
        break;
      }
      // A final comes only from the flush. A sentence end is no sign of one,
      // since a period arrives as its own delta ("Dr. Smith").
      utterance.pending += message.text ?? "";
      if (utterance.pending.trim()) {
        onTranscript({ text: utterance.pending.trim(), final: false });
      }
      break;
    case "transcription.done":
      // The answer to a flush is the final of the utterance, also when empty.
      if (open) {
        const text = utterance.pending.trim();
        utterance.pending = "";
        onTranscript({ text, final: true });
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
}

type MistralMessage = {
  type?: string;
  text?: string;
  error?: { code?: number | string; message?: unknown };
};

// Mistral's own description of an error, quoted for the log. error.message is
// a string or an object with details.
function describeError(error: MistralMessage["error"]): string {
  let message: string;
  if (typeof error?.message === "string") {
    message = error.message;
  } else if (error?.message === undefined) {
    message = "no description";
  } else {
    message = JSON.stringify(error.message);
  }
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
