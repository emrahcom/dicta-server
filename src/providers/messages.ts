// Helpers for the JSON messages of WebSocket providers.

import { quoteForLog } from "../logging.ts";

// A JSON object, or undefined for anything else.
export function parseMessage<T extends object>(raw: Buffer): T | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    return typeof parsed === "object" && parsed !== null
      ? (parsed as T)
      : undefined;
  } catch {
    return undefined;
  }
}

// The warning for a message of an unknown type: its type only, never its
// content (architecture.md, Logging).
export function unknownTypeWarning(type: unknown): string {
  return `unknown message type ${quoteForLog(String(type))}`;
}

// A text frame as a JSON object. Anything else is reported as a warning and
// gives undefined (architecture.md, Providers).
export function parseOrWarn<T extends object>(
  raw: Buffer,
  isBinary: boolean,
  onWarning: (warning: string) => void,
): T | undefined {
  const message = isBinary ? undefined : parseMessage<T>(raw);
  if (message === undefined) {
    onWarning(`unparseable message (${raw.length} bytes)`);
  }
  return message;
}
