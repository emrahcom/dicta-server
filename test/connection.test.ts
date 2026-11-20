import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import {
  breakStringify,
  fakeProvider,
  listen,
  nextJson,
  nextMessage,
  openWithFake,
  rawUpgrade,
  sign,
  start,
  tick,
  untilClose,
  untilLogged,
  wait,
} from "./helpers.ts";

const PROVIDER_ERROR = {
  type: "error",
  message: "speech-to-text provider failed",
};

test("logs the close code and the seconds of audio when a connection closes", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = listen(base, await sign());
  const { sessionId } = await nextJson(ws);
  // 2.6 seconds of audio, rounded to 3.
  ws.send(new Uint8Array(64_000));
  ws.send(new Uint8Array(19_200));
  ws.close(1000);
  await untilLogged(logged, 2);

  assert.equal(
    logged.mock.calls[1].arguments[0],
    `[${sessionId}] closed code=1000 audio=3s`,
  );
});

test("sends error and closes with 1011 when the provider cannot open", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = listen(base, await sign());
  const result = untilClose(ws);
  await wait(50);
  fake.failOpen(new Error("open failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
});

test("sends error and closes with 1011 when an open stream fails", async (t) => {
  const { fake, ws } = await openWithFake(t);
  const result = untilClose(ws);
  fake.fail(new Error("stream failed with secret details"));

  assert.deepEqual(await result, { messages: [PROVIDER_ERROR], code: 1011 });
  await wait(50);
  assert.equal(fake.closed, true);
});

const langCases: { name: string; query: string; lang: string | undefined }[] = [
  { name: "a well-formed lang", query: "?lang=de-DE", lang: "de-DE" },
  { name: "a three-letter lang", query: "?lang=ceb", lang: "ceb" },
  { name: "no lang", query: "", lang: undefined },
];

for (const { name, query, lang } of langCases) {
  test(`passes ${name} to the provider`, async (t) => {
    const { fake } = await openWithFake(t, { query });

    assert.deepEqual(fake.options, { lang });
  });
}

test("drops a malformed lang with a warning", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const lang = encodeURIComponent("de_DE\n");
  const { fake, sessionId } = await openWithFake(t, { query: `?lang=${lang}` });

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
  const broken = breakStringify(t, "ready");

  const first = listen(base, await sign());
  const result = await untilClose(first);
  broken.mock.restore();

  assert.deepEqual(result, { messages: [], code: 1011 });
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: unexpected$/,
  );
  const second = listen(base, await sign());
  assert.equal((await nextJson(second)).type, "ready");
});

test("closes with 1011 when sending a transcript throws", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { fake, ws } = await openWithFake(t);
  const result = untilClose(ws);
  const broken = breakStringify(t, "transcript");
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
  await wait(50);

  assert.equal(failing.closed, true);
  assert.match(
    logged.mock.calls[0].arguments[0],
    /^\[[0-9a-f-]+\] unexpected error: close failed$/,
  );
  const second = listen(base, await sign());
  const secondReady = nextJson(second);
  fakes[0].open();
  assert.equal((await secondReady).type, "ready");
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
  await wait(50);
  const second = listen(base, await sign());
  const secondReady = nextMessage(second);
  await wait(50);
  failing.failOpen(new Error("open failed"));
  healthy.open();

  assert.equal((await firstResult).code, 1011);
  await secondReady;
  const transcript = nextJson(second);
  healthy.report({ text: "still here", final: false });
  assert.equal((await transcript).text, "still here");
});

test("sends ready only after the provider stream is open", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = listen(base, await sign());
  let ready = false;
  ws.onmessage = () => (ready = true);
  await wait(50);
  assert.equal(ready, false);

  fake.open();
  await nextMessage(ws);
});

// Waits until the provider received `count` audio frames, without a timer, so
// it also works while timers are mocked.
async function untilChunks(fake: { chunks: Buffer[] }, count: number) {
  while (fake.chunks.length < count) {
    await tick();
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

  const final = nextJson(ws);
  ws.send(JSON.stringify({ type: "end" }));

  assert.deepEqual(await final, {
    type: "transcript",
    text: "",
    final: true,
  });
  assert.equal(fake.finished, 0);
});

test("ignores an empty binary frame", async (t) => {
  const { fake, ws } = await openWithFake(t);

  const final = nextJson(ws);
  ws.send(new Uint8Array(0));
  ws.send(JSON.stringify({ type: "end" }));
  // The binary frame after them shows they were all handled.
  ws.send(new Uint8Array([1]));
  await untilChunks(fake, 1);

  assert.deepEqual(await final, {
    type: "transcript",
    text: "",
    final: true,
  });
  assert.equal(fake.finished, 0);
  assert.deepEqual(fake.chunks, [Buffer.from([1])]);
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
    await tick();
  }

  assert.deepEqual(finals, ["add a note", "make it blue", "", "move it left"]);
});

test("finishes the utterance 5 seconds after the last audio", async (t) => {
  // Before the connection, so every timer of it is mocked.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { fake, ws } = await openWithFake(t);

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
  const transcript = nextJson(ws);
  await wait(50);
  fake.report({ text: "hello", final: true });

  assert.deepEqual(Buffer.concat(fake.chunks), Buffer.from([1, 2, 3]));
  assert.deepEqual(await transcript, {
    type: "transcript",
    text: "hello",
    final: true,
  });
});

test("closes the provider stream when the connection closes", async (t) => {
  const { fake, ws } = await openWithFake(t);

  ws.close();
  await wait(50);

  assert.equal(fake.closed, true);
});

test("closes the provider stream when the client leaves while it opens", async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = listen(base, await sign());
  await wait(50);
  const closed = new Promise((resolve) => (ws.onclose = resolve));
  ws.close();
  await closed;
  // Let the server finish closing too: only then does the check before ready,
  // not the close listener, have to close the stream.
  await wait(50);
  fake.open();
  await wait(50);

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
  await wait(100);

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

async function expectReady(base: string) {
  const ws = listen(base, await sign());
  assert.equal((await nextJson(ws)).type, "ready");
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

  const socket = rawUpgrade(base, "/other", { allowHalfOpen: true });
  // A closed socket only shows when the client keeps writing to it.
  socket.on("data", () => {
    const writing = setInterval(() => socket.write("x"), 50);
    socket.on("close", () => clearInterval(writing));
  });

  // Not events.once(): the EPIPE error comes before close.
  await new Promise((resolve) => socket.once("close", resolve));
});

test("keeps serving when a client resets the socket on another path", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  for (let i = 0; i < 20; i++) {
    rawUpgrade(base, "/other").resetAndDestroy();
  }
  await wait(50);

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
    await wait(50);
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
  const socket = rawUpgrade(base, "/dicta/v1/listen", {
    headers: [`Sec-WebSocket-Protocol: dicta, ${await sign()}`],
  });
  const closed = new Promise((resolve) => socket.on("close", resolve));
  socket.on("data", () => {});
  await wait(50);

  t.mock.timers.tick(30_000);
  await wait(50);
  assert.equal(socket.destroyed, false);

  t.mock.timers.tick(30_000);
  await closed;
  await wait(50);
  assert.equal(fake.closed, true);
});

test("closes a connection with 1000 after 10 minutes without messages", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { fake, ws } = await openWithFake(t);
  const result = untilClose(ws);

  t.mock.timers.tick(10 * 60_000 - 1);
  await tick();
  assert.equal(ws.readyState, WebSocket.OPEN);
  t.mock.timers.tick(1);

  assert.equal((await result).code, 1000);
  // The server closes the provider stream when its side of the close is done.
  while (!fake.closed) {
    await tick();
  }
  t.mock.timers.reset();
});

test("keeps a connection whose client sends messages", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { fake, ws } = await openWithFake(t);

  t.mock.timers.tick(9 * 60_000);
  ws.send(JSON.stringify({ type: "end" }));
  await nextMessage(ws);
  t.mock.timers.tick(9 * 60_000);
  ws.send(new Uint8Array([1]));
  await untilChunks(fake, 1);
  t.mock.timers.tick(9 * 60_000);
  await tick();

  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(fake.closed, false);
  t.mock.timers.reset();
});

test("closes a connection with 1000 after the age limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Shorter than the idle close, so only the age limit can close it.
  const { ws } = await openWithFake(t, { maxConnectionMs: 5 * 60_000 });
  const result = untilClose(ws);

  t.mock.timers.tick(5 * 60_000 - 1);
  await tick();
  assert.equal(ws.readyState, WebSocket.OPEN);
  t.mock.timers.tick(1);

  assert.equal((await result).code, 1000);
  t.mock.timers.reset();
});

test("keeps a connection whose audio is within real time plus 30 seconds", async (t) => {
  const { fake, ws } = await openWithFake(t);
  let closed = false;
  ws.onclose = () => (closed = true);

  // 30 seconds of audio at once, in frames of at most 64 KiB.
  for (let left = 30 * 32_000; left > 0; left -= 64_000) {
    ws.send(new Uint8Array(Math.min(left, 64_000)));
  }
  await untilChunks(fake, 15);
  await wait(50);

  assert.equal(closed, false);
});

test("closes with 1008 when audio runs further ahead of real time", async (t) => {
  const { ws } = await openWithFake(t);
  const result = untilClose(ws);

  for (let i = 0; i < 16; i++) {
    ws.send(new Uint8Array(64_000));
  }

  assert.equal((await result).code, 1008);
});

test("sends no more audio to the provider once the close starts", async (t) => {
  const { fake, ws } = await openWithFake(t);
  const result = untilClose(ws);

  // 80 seconds at once: the 16th frame starts the 1008 close, and the frames
  // after it arrive before the client answers the close.
  for (let i = 0; i < 40; i++) {
    ws.send(new Uint8Array(64_000));
  }

  assert.equal((await result).code, 1008);
  assert.equal(fake.chunks.length, 15);
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
