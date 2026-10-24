// Shared by the provider tests.

import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { type WebSocket, WebSocketServer } from "ws";
import type { Transcript } from "../../src/providers/provider.ts";

export type FakeServer = Awaited<ReturnType<typeof fakeServer>>;

// A provider's server inside the test. It records what the provider sends,
// JSON as objects and binary frames as Buffers, and lets the test decide what
// to answer. `refuse` returns an HTTP status to refuse a request with, given its
// URL.
export async function fakeServer(
  t: TestContext,
  options: { refuse?: (url: string) => number | undefined } = {},
) {
  const requests: string[] = [];
  const wss = new WebSocketServer({
    port: 0,
    verifyClient: (info, done) => {
      const url = info.req.url ?? "";
      requests.push(url);
      const status = options.refuse?.(url);
      if (status === undefined) {
        done(true);
      } else {
        done(false, status);
      }
    },
  });
  await once(wss, "listening");
  t.after(
    () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close(() => resolve());
      }),
  );

  const received: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  const connection = new Promise<{
    socket: WebSocket;
    request: IncomingMessage;
  }>((resolve) => {
    wss.on("connection", (socket, request) => {
      socket.on("message", (data, isBinary) => {
        const raw = data as Buffer;
        const message: unknown = isBinary ? raw : JSON.parse(raw.toString());
        const next = waiting.shift();
        if (next) {
          next(message);
        } else {
          received.push(message);
        }
      });
      resolve({ socket, request });
    });
  });

  const { port } = wss.address() as AddressInfo;
  return {
    url: `ws://localhost:${port}`,
    requests,
    connection,
    // The next message the provider sent.
    next: () =>
      received.length > 0
        ? Promise.resolve(received.shift())
        : new Promise<unknown>((resolve) => waiting.push(resolve)),
    send: async (message: object) =>
      (await connection).socket.send(JSON.stringify(message)),
  };
}

// Records what a provider reports.
export function events() {
  const recorded = {
    transcripts: [] as Transcript[],
    errors: [] as Error[],
    warnings: [] as string[],
    onTranscript: (transcript: Transcript) =>
      recorded.transcripts.push(transcript),
    onError: (error: Error) => recorded.errors.push(error),
    onWarning: (warning: string) => recorded.warnings.push(warning),
  };
  return recorded;
}

// Closes the stream and waits until the socket is closed on both ends, so no
// close timer of ws is left running when the next test mocks the timers.
export async function closeFully(
  stream: { close: () => void },
  server: FakeServer,
) {
  const { socket } = await server.connection;
  const closed =
    socket.readyState === socket.CLOSED
      ? Promise.resolve()
      : once(socket, "close");
  stream.close();
  await closed;
  await settle();
}

// Waits until the provider has handled what the server sent before.
export async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// Stops the fake server from reading, as a provider that does not keep up.
export async function pause(server: FakeServer) {
  (await server.connection).request.socket.pause();
}

// Sends audio until the provider reports an error, or gives up after 64 MiB.
export async function sendUntilError(
  stream: { sendAudio: (chunk: Buffer) => void },
  recorded: { errors: Error[] },
) {
  const chunk = Buffer.alloc(64 * 1024);
  for (let i = 0; i < 1024 && recorded.errors.length === 0; i++) {
    stream.sendAudio(chunk);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
