import assert from "node:assert/strict";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { type TestContext, test } from "node:test";
import { type WebSocket, WebSocketServer } from "ws";
import { createDeepgram } from "../../src/providers/deepgram.ts";
import type { Transcript } from "../../src/providers/provider.ts";

// A Deepgram server inside the test. It records what the provider sends, JSON
// as objects and audio as Buffers, and lets the test decide what to answer.
async function fakeDeepgram(t: TestContext, options: { status?: number } = {}) {
  const wss = new WebSocketServer({
    port: 0,
    verifyClient:
      options.status === undefined
        ? undefined
        : (_info, done) => done(false, options.status),
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

function events() {
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

// A Results message as Deepgram sends it.
function results(
  transcript: string,
  flags: {
    is_final?: boolean;
    speech_final?: boolean;
    from_finalize?: boolean;
  },
) {
  return {
    type: "Results",
    is_final: false,
    speech_final: false,
    from_finalize: false,
    ...flags,
    channel: { alternatives: [{ transcript }] },
  };
}

// Opens a stream against the fake server.
async function open(t: TestContext) {
  const deepgram = await fakeDeepgram(t);
  const recorded = events();
  const stream = await createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: deepgram.url,
  })(recorded);
  t.after(() => closeFully(stream, deepgram));
  return { deepgram, recorded, stream };
}

// Closes the stream and waits until the socket is closed on both ends, so no
// close timer of ws is left running when the next test mocks the timers.
async function closeFully(
  stream: { close: () => void },
  deepgram: Awaited<ReturnType<typeof fakeDeepgram>>,
) {
  const { socket } = await deepgram.connection;
  const closed =
    socket.readyState === socket.CLOSED
      ? Promise.resolve()
      : once(socket, "close");
  stream.close();
  await closed;
  await settle();
}

// Waits until the provider has handled what the server sent before.
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("connects with the parameters and the API key", async (t) => {
  const { deepgram } = await open(t);

  const { request } = await deepgram.connection;
  const params = new URL(request.url ?? "", "ws://localhost").searchParams;

  assert.equal(request.headers.authorization, "Token key");
  assert.deepEqual(Object.fromEntries(params), {
    model: "model",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    endpointing: "500",
    smart_format: "true",
    mip_opt_out: "true",
  });
});

test("does not opt out of the Model Improvement Program when opted in", async (t) => {
  const deepgram = await fakeDeepgram(t);
  const stream = await createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: true,
    url: deepgram.url,
  })(events());
  t.after(() => closeFully(stream, deepgram));

  const { request } = await deepgram.connection;

  assert.equal(
    new URL(request.url ?? "", "ws://localhost").searchParams.has(
      "mip_opt_out",
    ),
    false,
  );
});

test("fails the open when Deepgram refuses the connection", async (t) => {
  const deepgram = await fakeDeepgram(t, { status: 401 });
  const opening = createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: deepgram.url,
  })(events());

  await assert.rejects(opening, /HTTP 401/);
});

test("fails the open when it does not open within 10 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Accepts the TCP connection but never answers the upgrade.
  const silent = createServer(() => {});
  silent.listen(0);
  await once(silent, "listening");
  t.after(() => {
    silent.close();
  });
  const connected = once(silent, "connection");
  const { port } = silent.address() as AddressInfo;
  const opening = createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: `ws://localhost:${port}`,
  })(events());
  const [socket] = (await connected) as [{ destroy: () => void }];
  t.after(() => socket.destroy());

  t.mock.timers.tick(10_000);

  await assert.rejects(opening, /not open within 10 seconds/);
});

test("sends audio as binary frames", async (t) => {
  const { deepgram, stream } = await open(t);

  stream.sendAudio(Buffer.from([1, 2, 3]));

  assert.deepEqual(await deepgram.next(), Buffer.from([1, 2, 3]));
});

test("collects segments into interims and sends a final at the end of speech", async (t) => {
  const { deepgram, recorded } = await open(t);

  await deepgram.send(results("Composed upon", {}));
  await deepgram.send(
    results("Composed upon Westminster Bridge,", { is_final: true }),
  );
  await deepgram.send(results("by William", {}));
  await deepgram.send(
    results("by William Wordsworth.", { is_final: true, speech_final: true }),
  );
  await deepgram.send(results("Read", {}));
  await settle();

  assert.deepEqual(recorded.transcripts, [
    { text: "Composed upon", final: false },
    { text: "Composed upon Westminster Bridge,", final: false },
    { text: "Composed upon Westminster Bridge, by William", final: false },
    {
      text: "Composed upon Westminster Bridge, by William Wordsworth.",
      final: true,
    },
    { text: "Read", final: false },
  ]);
});

test("finalizes 1 second after the last audio", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { deepgram, recorded, stream } = await open(t);

  stream.sendAudio(Buffer.from([1]));
  await deepgram.next();
  t.mock.timers.tick(999);
  stream.sendAudio(Buffer.from([2]));
  await deepgram.next();
  t.mock.timers.tick(1000);

  assert.deepEqual(await deepgram.next(), { type: "Finalize" });

  await deepgram.send(results("add a note", { is_final: true }));
  await deepgram.send(results("", { is_final: true, from_finalize: true }));
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a note",
    final: true,
  });
});

test("sends KeepAlive every 4 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { deepgram } = await open(t);

  t.mock.timers.tick(4000);
  assert.deepEqual(await deepgram.next(), { type: "KeepAlive" });
  t.mock.timers.tick(4000);
  assert.deepEqual(await deepgram.next(), { type: "KeepAlive" });
});

test("sends CloseStream on close", async (t) => {
  const { deepgram, stream } = await open(t);

  stream.close();

  assert.deepEqual(await deepgram.next(), { type: "CloseStream" });
});

test("sends collected text as a final, then reports an unexpected close", async (t) => {
  const { deepgram, recorded } = await open(t);

  await deepgram.send(results("add a note", { is_final: true }));
  (await deepgram.connection).socket.close(1011, "timeout");
  await once((await deepgram.connection).socket, "close");
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a note",
    final: true,
  });
  assert.equal(
    recorded.errors[0]?.message,
    'Deepgram closed the connection: 1011 "timeout"',
  );
});

test("warns about an Error message with its description and continues", async (t) => {
  const { deepgram, recorded } = await open(t);

  await deepgram.send({ type: "Error", description: "bad\nthing" });
  await deepgram.send(results("still on", {}));
  await settle();

  assert.deepEqual(recorded.warnings, ['Deepgram error: "bad\\nthing"']);
  assert.deepEqual(recorded.errors, []);
  assert.deepEqual(recorded.transcripts, [{ text: "still on", final: false }]);
});

test("skips known messages and warns about others without their content", async (t) => {
  const { deepgram, recorded } = await open(t);

  await deepgram.send({ type: "Metadata", request_id: "x" });
  await deepgram.send({ type: "SpeechStarted" });
  await deepgram.send({ type: "UtteranceEnd" });
  await deepgram.send({ type: "Results.v2", transcript: "secret" });
  (await deepgram.connection).socket.send("secret words");
  await settle();

  assert.deepEqual(recorded.warnings, [
    'unknown message type "Results.v2"',
    "unparseable message (12 bytes)",
  ]);
  assert.deepEqual(recorded.errors, []);
});

test("reports nothing after close", async (t) => {
  const { deepgram, recorded, stream } = await open(t);

  stream.close();
  await deepgram.send(results("late", { is_final: true, speech_final: true }));
  await settle();

  assert.deepEqual(recorded.transcripts, []);
  assert.deepEqual(recorded.errors, []);
});
