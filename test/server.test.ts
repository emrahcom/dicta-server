import assert from "node:assert/strict";
import { connect, type AddressInfo } from "node:net";
import { test } from "node:test";
import { SignJWT } from "jose";
import type {
  OpenStream,
  ProviderStream,
  StreamEvents,
  Transcript,
} from "../src/providers/provider.ts";
import { openStubStream } from "../src/providers/stub.ts";
import { createServer, type AuthOptions } from "../src/server.ts";

const SECRET = "test-secret";

async function start(
  options: { auth?: AuthOptions; openStream?: OpenStream } = {},
): Promise<{ base: string; shutdown: () => Promise<void> }> {
  const { server, shutdown } = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    openStream: options.openStream ?? openStubStream,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `ws://localhost:${port}`, shutdown };
}

function sign(
  options: { secret?: string; exp?: string | number | null; sub?: string } = {},
): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: "HS256" });
  if (options.sub !== undefined) {
    jwt.setSubject(options.sub);
  }
  const exp = options.exp === undefined ? "1h" : options.exp;
  if (exp !== null) {
    jwt.setExpirationTime(exp);
  }
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.onmessage = resolve;
  });
}

// Resolves with the close code, and fails if a message arrives first.
function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.onclose = (event) => resolve(event.code);
    ws.onmessage = (event) =>
      reject(new Error(`unexpected message: ${event.data}`));
  });
}

test("sends ready with a session id for a valid token", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, "ready");
  assert.equal(typeof message.sessionId, "string");
  assert.notEqual(message.sessionId, "");
});

const rejections: {
  name: string;
  token: () => Promise<string | null>;
  reason: string;
}[] = [
  { name: "missing", token: async () => null, reason: "missing" },
  {
    name: "signed with another secret",
    token: () => sign({ secret: "other" }),
    reason: "invalid signature",
  },
  {
    name: "expired",
    token: () => sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
    reason: "expired",
  },
  {
    name: "without exp",
    token: () => sign({ exp: null }),
    reason: "missing exp",
  },
  { name: "malformed", token: async () => "not-a-jwt", reason: "invalid" },
];

for (const { name, token, reason } of rejections) {
  test(`closes with 4001 and logs the reason when the token is ${name}`, async (t) => {
    const { base, shutdown } = await start();
    t.after(shutdown);
    const warned = t.mock.method(console, "warn", () => {});

    const value = await token();
    const query = value === null ? "" : `?token=${value}`;
    const ws = new WebSocket(`${base}/dicta/v1/listen${query}`);

    assert.equal(await closeCode(ws), 4001);
    assert.match(
      warned.mock.calls[0].arguments[0],
      new RegExp(`^\\[[0-9a-f-]+\\] token rejected: ${reason}$`),
    );
  });
}

test("logs connected with the sub of the token", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = new WebSocket(
    `${base}/dicta/v1/listen?token=${await sign({ sub: "user-1" })}`,
  );
  const { sessionId } = JSON.parse((await nextMessage(ws)).data);

  assert.equal(
    logged.mock.calls[0].arguments[0],
    `[${sessionId}] connected sub="user-1"`,
  );
});

test("logs connected without sub when the token has none", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const { sessionId } = JSON.parse((await nextMessage(ws)).data);

  assert.equal(logged.mock.calls[0].arguments[0], `[${sessionId}] connected`);
});

test("sends ready without a token when unauthenticated is allowed", async (t) => {
  const { base, shutdown } = await start({
    auth: { allowUnauthenticated: true },
  });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, "ready");
});

// A provider that records what it receives and lets the test decide when the
// stream opens or fails and what it reports.
function fakeProvider() {
  let open = () => {};
  let failOpen = (_error: Error) => {};
  const opened = new Promise<void>((resolve, reject) => {
    open = resolve;
    failOpen = reject;
  });
  const fake = {
    chunks: [] as Buffer[],
    closed: false,
    sendAudioThrows: false,
    closeThrows: false,
    report: (_transcript: Transcript) => {},
    fail: (_error: Error) => {},
    open,
    failOpen,
    openStream,
  };

  async function openStream({
    onTranscript,
    onError,
  }: StreamEvents): Promise<ProviderStream> {
    fake.report = onTranscript;
    fake.fail = onError;
    await opened;
    return {
      sendAudio: (chunk) => {
        if (fake.sendAudioThrows) {
          throw new Error("send failed with secret details");
        }
        fake.chunks.push(chunk);
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

// Collects every message until the socket closes, then resolves with them and
// the close code.
function untilClose(ws: WebSocket): Promise<{ messages: any[]; code: number }> {
  const messages: any[] = [];
  return new Promise((resolve) => {
    ws.onmessage = (event) => messages.push(JSON.parse(event.data));
    ws.onclose = (event) => resolve({ messages, code: event.code });
  });
}

const PROVIDER_ERROR = {
  type: "error",
  message: "speech-to-text provider failed",
};

test("sends error and closes with 1011 when the provider cannot open", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const result = untilClose(ws);
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.failOpen(new Error("open failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
});

test("sends error and closes with 1011 when an open stream fails", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;
  const result = untilClose(ws);
  fake.fail(new Error("stream failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fake.closed, true);
});

test("prefixes connection logs with the session id from ready", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);
  const logged = t.mock.method(console, "error", () => {});

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  const { sessionId } = JSON.parse((await ready).data);
  const result = untilClose(ws);
  fake.fail(new Error("stream failed"));
  await result;

  assert.equal(
    logged.mock.calls[0].arguments[0],
    `[${sessionId}] provider error: stream failed`,
  );
});

test("sends error and closes with 1011 when sending audio throws", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;
  const result = untilClose(ws);
  fake.sendAudioThrows = true;
  ws.send(new Uint8Array(10));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
});

test("closes with 1011 and keeps serving after an unexpected error", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "error", () => {});
  const stringify = JSON.stringify;
  const broken = t.mock.method(JSON, "stringify", (value: unknown) => {
    if ((value as { type?: string }).type === "ready") {
      throw new Error("unexpected");
    }
    return stringify(value);
  });

  const first = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const result = await untilClose(first);
  broken.mock.restore();

  assert.deepEqual(result, { messages: [], code: 1011 });
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: unexpected$/,
  );
  const second = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  assert.equal(JSON.parse((await nextMessage(second)).data).type, "ready");
});

test("closes with 1011 when sending a transcript throws", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);
  const logged = t.mock.method(console, "error", () => {});

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;
  const result = untilClose(ws);
  const stringify = JSON.stringify;
  const broken = t.mock.method(JSON, "stringify", (value: unknown) => {
    if ((value as { type?: string }).type === "transcript") {
      throw new Error("unexpected");
    }
    return stringify(value);
  });
  fake.report({ text: "hello", final: true });
  broken.mock.restore();

  assert.deepEqual(await result, { messages: [], code: 1011 });
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: unexpected$/,
  );
});

test("keeps serving when closing the provider stream throws", async (t) => {
  const failing = fakeProvider();
  failing.closeThrows = true;
  const fakes = [failing, fakeProvider()];
  const { base, shutdown } = await start({
    openStream: (events) => fakes.shift()!.openStream(events),
  });
  t.after(shutdown);
  const logged = t.mock.method(console, "error", () => {});

  const first = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(first);
  failing.open();
  await ready;
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(failing.closed, true);
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: close failed$/,
  );
  const second = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const secondReady = nextMessage(second);
  fakes[0].open();
  assert.equal(JSON.parse((await secondReady).data).type, "ready");
});

test("a failing connection does not affect another one", async (t) => {
  const failing = fakeProvider();
  const healthy = fakeProvider();
  const fakes = [failing, healthy];
  const { base, shutdown } = await start({
    openStream: (events) => fakes.shift()!.openStream(events),
  });
  t.after(shutdown);

  const first = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const firstResult = untilClose(first);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const secondReady = nextMessage(second);
  await new Promise((resolve) => setTimeout(resolve, 50));
  failing.failOpen(new Error("open failed"));
  healthy.open();

  assert.equal((await firstResult).code, 1011);
  await secondReady;
  const transcript = nextMessage(second);
  healthy.report({ text: "still here", final: false });
  assert.equal(JSON.parse((await transcript).data).text, "still here");
});

test("sends ready only after the provider stream is open", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  let ready = false;
  ws.onmessage = () => (ready = true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ready, false);

  fake.open();
  await nextMessage(ws);
});

test("forwards audio to the provider and transcripts to the client", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;

  ws.send(new Uint8Array([1, 2, 3]));
  const transcript = nextMessage(ws);
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.report({ text: "hello", final: true });

  assert.deepEqual(Buffer.concat(fake.chunks), Buffer.from([1, 2, 3]));
  assert.deepEqual(JSON.parse((await transcript).data), {
    type: "transcript",
    text: "hello",
    final: true,
  });
});

test("closes the provider stream when the connection closes", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;

  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(fake.closed, true);
});

test("closes the provider stream when the client leaves while it opens", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const closed = new Promise((resolve) => (ws.onclose = resolve));
  ws.close();
  await closed;
  fake.open();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(fake.closed, true);
});

test("accepts a 64 KiB frame", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  let closed = false;
  ws.onclose = () => (closed = true);
  ws.send(new Uint8Array(64 * 1024));
  // The server does not answer audio, so wait briefly for a close that should
  // not come.
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(closed, false);
});

test("closes with 1009 when a frame is larger than 64 KiB", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.onclose = resolve;
  });
  ws.send(new Uint8Array(64 * 1024 + 1));

  assert.equal((await closed).code, 1009);
});

test("rejects other paths", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/other`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error("connection was accepted"));
  });
});

test("keeps a connection that answers pings", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(30_000);
    // Real time for the pong to come back.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(fake.closed, false);
});

test("terminates a connection that does not answer pings", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);
  fake.open();

  // A raw socket completes the upgrade but never answers a ping.
  const { port } = new URL(base);
  const socket = connect(Number(port), "localhost");
  socket.write(
    `GET /dicta/v1/listen?token=${await sign()} HTTP/1.1\r\n` +
      "Host: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );
  const closed = new Promise((resolve) => socket.on("close", resolve));
  socket.on("data", () => {});
  await new Promise((resolve) => setTimeout(resolve, 50));

  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(socket.destroyed, false);

  t.mock.timers.tick(30_000);
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fake.closed, true);
});

test("shutdown closes open connections with 1001", async () => {
  const { base, shutdown } = await start();

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.onclose = resolve;
  });
  await shutdown();

  assert.equal((await closed).code, 1001);
});

test("shutdown stops accepting connections", async () => {
  const { base, shutdown } = await start();
  await shutdown();

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error("connection was accepted"));
  });
});
