// Shared by the server tests.

import { connect, type AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { SignJWT } from "jose";
import type {
  OpenStream,
  ProviderStream,
  StreamEvents,
  StreamOptions,
  Transcript,
} from "../src/providers/provider.ts";
import { openStubStream } from "../src/providers/stub.ts";
import { createServer, type AuthOptions } from "../src/server.ts";

export const SECRET = "test-secret";

// Starts the server on a free port. `base` is its WebSocket address and
// `http` its HTTP address.
export async function start(
  options: {
    auth?: AuthOptions;
    openStream?: OpenStream;
    jsFolder?: string;
    maxConnectionMs?: number;
  } = {},
): Promise<{ base: string; http: string; shutdown: () => Promise<void> }> {
  const { server, shutdown } = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    openStream: options.openStream ?? openStubStream,
    jsFolder: options.jsFolder,
    maxConnectionMs: options.maxConnectionMs ?? 30 * 60_000,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `ws://localhost:${port}`,
    http: `http://localhost:${port}`,
    shutdown,
  };
}

export function sign(
  options: {
    secret?: string;
    exp?: string | number | null;
    sub?: string;
    aud?: string | string[];
  } = {},
): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: "HS256" });
  if (options.sub !== undefined) {
    jwt.setSubject(options.sub);
  }
  if (options.aud !== undefined) {
    jwt.setAudience(options.aud);
  }
  const exp = options.exp === undefined ? "1h" : options.exp;
  if (exp !== null) {
    jwt.setExpirationTime(exp);
  }
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

// Connects as dicta-js does: the token goes in Sec-WebSocket-Protocol.
export function listen(base: string, token: string | null, query = "") {
  return new WebSocket(
    `${base}/dicta/v1/listen${query}`,
    token === null ? [] : ["dicta", token],
  );
}

export function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.onmessage = resolve;
  });
}

// The next message, parsed as JSON.
export async function nextJson(ws: WebSocket): Promise<any> {
  return JSON.parse((await nextMessage(ws)).data);
}

// Collects every message until the socket closes, then resolves with them and
// the close code.
export function untilClose(
  ws: WebSocket,
): Promise<{ messages: any[]; code: number }> {
  const messages: any[] = [];
  return new Promise((resolve) => {
    ws.onmessage = (event) => messages.push(JSON.parse(event.data));
    ws.onclose = (event) => resolve({ messages, code: event.code });
  });
}

// Waits until console.log, mocked, logged `count` lines; the server logs a
// close only when its side of the close is done.
export async function untilLogged(
  logged: { mock: { callCount(): number } },
  count: number,
) {
  while (logged.mock.callCount() < count) {
    await wait(10);
  }
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Waits one turn of the event loop, without a timer, so it also works while
// timers are mocked.
export function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Makes JSON.stringify throw for a message of `type`. The returned mock is
// restored with `.mock.restore()`.
export function breakStringify(t: TestContext, type: string) {
  const stringify = JSON.stringify;
  return t.mock.method(JSON, "stringify", (value: unknown) => {
    if ((value as { type?: string }).type === type) {
      throw new Error("unexpected");
    }
    return stringify(value);
  });
}

// A provider that records what it receives and lets the test decide when the
// stream opens or fails and what it reports.
export function fakeProvider() {
  let open = () => {};
  let failOpen = (_error: Error) => {};
  const opened = new Promise<void>((resolve, reject) => {
    open = resolve;
    failOpen = reject;
  });
  const fake = {
    chunks: [] as Buffer[],
    closed: false,
    finished: 0,
    sendAudioThrows: false,
    closeThrows: false,
    report: (_transcript: Transcript) => {},
    fail: (_error: Error) => {},
    warn: (_warning: string) => {},
    options: undefined as StreamOptions | undefined,
    open,
    failOpen,
    openStream,
  };

  async function openStream(
    { onTranscript, onError, onWarning }: StreamEvents,
    options: StreamOptions,
  ): Promise<ProviderStream> {
    fake.options = options;
    fake.report = onTranscript;
    fake.fail = onError;
    fake.warn = onWarning;
    await opened;
    return {
      sendAudio: (chunk) => {
        if (fake.sendAudioThrows) {
          throw new Error("send failed with secret details");
        }
        fake.chunks.push(chunk);
      },
      finish: () => {
        fake.finished++;
      },
      close: () => {
        fake.closed = true;
        if (fake.closeThrows) {
          throw new Error("close failed");
        }
      },
    };
  }

  return fake;
}

// Connects with a fake provider that is already open.
export async function openWithFake(
  t: TestContext,
  options: { query?: string; maxConnectionMs?: number } = {},
) {
  const fake = fakeProvider();
  const { base, shutdown } = await start({
    openStream: fake.openStream,
    maxConnectionMs: options.maxConnectionMs,
  });
  t.after(shutdown);
  const ws = listen(base, await sign(), options.query);
  const ready = nextJson(ws);
  fake.open();
  const { sessionId } = await ready;
  return { fake, ws, sessionId: sessionId as string };
}

// Sends an upgrade request for `target` over a raw socket, with the extra
// header lines in `headers`.
export function rawUpgrade(
  base: string,
  target: string,
  options: { headers?: string[]; allowHalfOpen?: boolean } = {},
) {
  const socket = connect({
    port: Number(new URL(base).port),
    host: "localhost",
    allowHalfOpen: options.allowHalfOpen,
  });
  socket.on("error", () => {});
  const headers = (options.headers ?? []).map((line) => `${line}\r\n`);
  socket.write(
    `GET ${target} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      `Sec-WebSocket-Version: 13\r\n${headers.join("")}\r\n`,
  );
  return socket;
}
