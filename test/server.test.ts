import assert from "node:assert/strict";
import { connect, type AddressInfo } from "node:net";
import { once } from "node:events";
import { type TestContext, test } from "node:test";
import { type JWTPayload, SignJWT } from "jose";
import type {
  OpenStream,
  ProviderStream,
  StreamEvents,
  StreamOptions,
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

// Connects as dicta-js does: the token goes in Sec-WebSocket-Protocol.
function listen(base: string, token: string | null, query = "") {
  return new WebSocket(
    `${base}/dicta/v1/listen${query}`,
    token === null ? [] : ["dicta", token],
  );
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.onmessage = resolve;
  });
}

test("answers with the dicta protocol", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign());
  await nextMessage(ws);

  assert.equal(ws.protocol, "dicta");
});

test("does not accept a token in the URL", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const warned = t.mock.method(console, "warn", () => {});

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);

  assert.deepEqual(await untilClose(ws), { messages: [], code: 4001 });
  assert.match(warned.mock.calls[0].arguments[0], /token rejected: missing$/);
});

test("sends ready with a session id for a valid token", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign());
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
    const ws = listen(base, value);

    assert.deepEqual(await untilClose(ws), { messages: [], code: 4001 });
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

  const ws = listen(base, await sign({ sub: "user-1" }));
  const { sessionId } = JSON.parse((await nextMessage(ws)).data);

  assert.equal(
    logged.mock.calls[0].arguments[0],
    `[${sessionId}] connected sub="user-1"`,
  );
});

test("does not log a sub that is not a string", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  // jose types sub as a string, but accepts any JSON value at runtime.
  const payload = { sub: { email: "a@example.com" } } as unknown as JWTPayload;
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  const ws = listen(base, token);
  const { sessionId } = JSON.parse((await nextMessage(ws)).data);

  assert.equal(logged.mock.calls[0].arguments[0], `[${sessionId}] connected`);
});

test("logs connected without sub when the token has none", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = listen(base, await sign());
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
async function openWithFake(t: TestContext, query = "") {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);
  const ws = listen(base, await sign(), query);
  const ready = nextMessage(ws);
  fake.open();
  const { sessionId } = JSON.parse((await ready).data);
  return { fake, ws, sessionId: sessionId as string };
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

  const ws = listen(base, await sign());
  const result = untilClose(ws);
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.failOpen(new Error("open failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
});

test("sends error and closes with 1011 when an open stream fails", async (t) => {
  const { fake, ws } = await openWithFake(t);
  const result = untilClose(ws);
  fake.fail(new Error("stream failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fake.closed, true);
});

const langCases: { name: string; query: string; lang: string | undefined }[] = [
  { name: "a well-formed lang", query: "?lang=de-DE", lang: "de-DE" },
  { name: "a three-letter lang", query: "?lang=ceb", lang: "ceb" },
  { name: "no lang", query: "", lang: undefined },
];

for (const { name, query, lang } of langCases) {
  test(`passes ${name} to the provider`, async (t) => {
    const { fake } = await openWithFake(t, query);

    assert.deepEqual(fake.options, { lang });
  });
}

test("drops a malformed lang with a warning", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const lang = encodeURIComponent("de_DE\n");
  const { fake, sessionId } = await openWithFake(t, `?lang=${lang}`);

  assert.deepEqual(fake.options, { lang: undefined });
  assert.equal(
    warned.mock.calls[0].arguments[0],
    `[${sessionId}] invalid lang "de_DE\\n"`,
  );
});

test("logs provider warnings with the session id and keeps the connection", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const { fake, ws, sessionId } = await openWithFake(t);
  fake.warn("something odd");

  assert.equal(
    warned.mock.calls[0].arguments[0],
    `[${sessionId}] provider: something odd`,
  );
  assert.equal(ws.readyState, WebSocket.OPEN);
});

test("prefixes connection logs with the session id from ready", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { fake, ws, sessionId } = await openWithFake(t);
  const result = untilClose(ws);
  fake.fail(new Error("stream failed"));
  await result;

  assert.equal(
    logged.mock.calls[0].arguments[0],
    `[${sessionId}] provider error: stream failed`,
  );
});

test("sends error and closes with 1011 when sending audio throws", async (t) => {
  const { fake, ws } = await openWithFake(t);
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

  const first = listen(base, await sign());
  const result = await untilClose(first);
  broken.mock.restore();

  assert.deepEqual(result, { messages: [], code: 1011 });
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: unexpected$/,
  );
  const second = listen(base, await sign());
  assert.equal(JSON.parse((await nextMessage(second)).data).type, "ready");
});

test("closes with 1011 when sending a transcript throws", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { fake, ws } = await openWithFake(t);
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
    openStream: (events, options) => fakes.shift()!.openStream(events, options),
  });
  t.after(shutdown);
  const logged = t.mock.method(console, "error", () => {});

  const first = listen(base, await sign());
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
  const second = listen(base, await sign());
  const secondReady = nextMessage(second);
  fakes[0].open();
  assert.equal(JSON.parse((await secondReady).data).type, "ready");
});

test("a failing connection does not affect another one", async (t) => {
  const failing = fakeProvider();
  const healthy = fakeProvider();
  const fakes = [failing, healthy];
  const { base, shutdown } = await start({
    openStream: (events, options) => fakes.shift()!.openStream(events, options),
  });
  t.after(shutdown);

  const first = listen(base, await sign());
  const firstResult = untilClose(first);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = listen(base, await sign());
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

  const ws = listen(base, await sign());
  let ready = false;
  ws.onmessage = () => (ready = true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ready, false);

  fake.open();
  await nextMessage(ws);
});

// Waits until the provider received `count` audio frames, without a timer, so
// it also works while timers are mocked.
async function untilChunks(fake: { chunks: Buffer[] }, count: number) {
  while (fake.chunks.length < count) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("finishes the utterance on end and ignores other text frames", async (t) => {
  const { fake, ws } = await openWithFake(t);

  ws.send(new Uint8Array([1]));
  ws.send("not json");
  ws.send(JSON.stringify({ type: "other" }));
  ws.send(JSON.stringify({ type: "end" }));
  // The binary frame after the text frames shows they were all handled.
  ws.send(new Uint8Array([2]));
  await untilChunks(fake, 2);

  assert.equal(fake.finished, 1);
  assert.deepEqual(Buffer.concat(fake.chunks), Buffer.from([1, 2]));
});

test("sends an empty final on end without audio, without asking the provider", async (t) => {
  const { fake, ws } = await openWithFake(t);

  const final = nextMessage(ws);
  ws.send(JSON.stringify({ type: "end" }));

  assert.deepEqual(JSON.parse((await final).data), {
    type: "transcript",
    text: "",
    final: true,
  });
  assert.equal(fake.finished, 0);
});

test("keeps finals in order when utterances end before earlier finals", async (t) => {
  const { fake, ws } = await openWithFake(t);
  const finals: string[] = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as {
      text?: string;
      final?: boolean;
    };
    if (message.final) {
      finals.push(message.text ?? "");
    }
  };

  // Utterances A, B, an end without audio, and C, all before any answer.
  ws.send(new Uint8Array([1]));
  ws.send(JSON.stringify({ type: "end" }));
  ws.send(new Uint8Array([2]));
  ws.send(JSON.stringify({ type: "end" }));
  ws.send(JSON.stringify({ type: "end" }));
  ws.send(new Uint8Array([3]));
  ws.send(JSON.stringify({ type: "end" }));
  // The next utterance's first frame shows all of the above were handled.
  ws.send(new Uint8Array([4]));
  await untilChunks(fake, 4);
  // The provider was asked at once for A, B and C; nothing was sent yet.
  assert.equal(fake.finished, 3);
  assert.deepEqual(finals, []);

  fake.report({ text: "add a note", final: true });
  fake.report({ text: "make it blue", final: true });
  fake.report({ text: "move it left", final: true });
  while (finals.length < 4) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(finals, ["add a note", "make it blue", "", "move it left"]);
});

test("finishes the utterance 5 seconds after the last audio", async (t) => {
  const { fake, ws } = await openWithFake(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });

  ws.send(new Uint8Array([1]));
  await untilChunks(fake, 1);
  t.mock.timers.tick(4999);
  ws.send(new Uint8Array([2]));
  await untilChunks(fake, 2);
  t.mock.timers.tick(4999);
  assert.equal(fake.finished, 0);
  t.mock.timers.tick(1);
  assert.equal(fake.finished, 1);

  // Real timers again before the sockets close.
  t.mock.timers.reset();
});

test("forwards audio to the provider and transcripts to the client", async (t) => {
  const { fake, ws } = await openWithFake(t);

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
  const { fake, ws } = await openWithFake(t);

  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(fake.closed, true);
});

test("closes the provider stream when the client leaves while it opens", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = listen(base, await sign());
  await new Promise((resolve) => setTimeout(resolve, 50));
  const closed = new Promise((resolve) => (ws.onclose = resolve));
  ws.close();
  await closed;
  // Let the server finish closing too: only then does the check before ready,
  // not the close listener, have to close the stream.
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.open();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(fake.closed, true);
});

test("accepts a 64 KiB frame", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign());
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

  const ws = listen(base, await sign());
  await nextMessage(ws);
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.onclose = resolve;
  });
  ws.send(new Uint8Array(64 * 1024 + 1));

  assert.equal((await closed).code, 1009);
});

// Sends an upgrade request for `target` over a raw socket.
function rawUpgrade(base: string, target: string) {
  const socket = connect(Number(new URL(base).port), "localhost");
  socket.on("error", () => {});
  socket.write(
    `GET ${target} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );
  return socket;
}

async function expectReady(base: string) {
  const ws = listen(base, await sign());
  assert.equal(JSON.parse((await nextMessage(ws)).data).type, "ready");
  ws.close();
}

test("answers 400 to a URL it cannot parse and keeps serving", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const socket = rawUpgrade(base, "http://[");
  const [response] = (await once(socket, "data")) as [Buffer];

  assert.match(response.toString(), /^HTTP\/1\.1 400 /);
  await expectReady(base);
});

test("closes a refused socket even when the client keeps its side open", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const socket = connect({
    port: Number(new URL(base).port),
    host: "localhost",
    allowHalfOpen: true,
  });
  socket.on("error", () => {});
  // A closed socket only shows when the client keeps writing to it.
  socket.on("data", () => {
    const writing = setInterval(() => socket.write("x"), 50);
    socket.on("close", () => clearInterval(writing));
  });
  socket.write(
    "GET /other HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n" +
      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );

  // Not events.once(): the EPIPE error comes before close.
  await new Promise((resolve) => socket.once("close", resolve));
});

test("keeps serving when a client resets the socket on another path", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  for (let i = 0; i < 20; i++) {
    rawUpgrade(base, "/other").resetAndDestroy();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  await expectReady(base);
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
  const { fake, ws } = await openWithFake(t);
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
    "GET /dicta/v1/listen HTTP/1.1\r\n" +
      `Sec-WebSocket-Protocol: dicta, ${await sign()}\r\n` +
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

  const ws = listen(base, await sign());
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

  const ws = listen(base, await sign());
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error("connection was accepted"));
  });
});
