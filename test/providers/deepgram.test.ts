import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { type TestContext, test } from "node:test";
import { createDeepgram } from "../../src/providers/deepgram.ts";
import {
  closeFully,
  events,
  type FakeServer,
  fakeServer,
  settle,
} from "./helpers.ts";

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
  const deepgram = await fakeServer(t);
  const recorded = events();
  const stream = await createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: deepgram.url,
  })(recorded, {});
  t.after(() => closeFully(stream, deepgram));
  return { deepgram, recorded, stream };
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
  const deepgram = await fakeServer(t);
  const stream = await createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: true,
    url: deepgram.url,
  })(events(), {});
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
  const deepgram = await fakeServer(t, { refuse: () => 401 });
  const opening = createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: deepgram.url,
  })(events(), {});

  await assert.rejects(opening, /HTTP 401/);
});

// The language parameter of each request the fake server received.
function languages(deepgram: { requests: string[] }) {
  return deepgram.requests.map((url) =>
    new URL(url, "ws://localhost").searchParams.get("language"),
  );
}

function openWithLang(
  deepgram: FakeServer,
  recorded: ReturnType<typeof events>,
  lang: string,
) {
  return createDeepgram({
    apiKey: "key",
    model: "model",
    mipOptIn: false,
    url: deepgram.url,
  })(recorded, { lang });
}

test("sends lang as the language", async (t) => {
  const deepgram = await fakeServer(t);
  const stream = await openWithLang(deepgram, events(), "en-GB");
  t.after(() => closeFully(stream, deepgram));

  assert.deepEqual(languages(deepgram), ["en-GB"]);
});

test("retries with the language code when Deepgram refuses the tag", async (t) => {
  const deepgram = await fakeServer(t, {
    refuse: (url) => (url.includes("language=en-XY") ? 400 : undefined),
  });
  const recorded = events();
  const stream = await openWithLang(deepgram, recorded, "en-XY");
  t.after(() => closeFully(stream, deepgram));

  assert.deepEqual(languages(deepgram), ["en-XY", "en"]);
  assert.deepEqual(recorded.warnings, [
    'Deepgram refused lang "en-XY", using "en"',
  ]);
});

test("does not retry a refused language code", async (t) => {
  const deepgram = await fakeServer(t, { refuse: () => 400 });

  await assert.rejects(openWithLang(deepgram, events(), "xx"), /HTTP 400/);
  assert.deepEqual(languages(deepgram), ["xx"]);
});

test("fails when the language code is refused too", async (t) => {
  const deepgram = await fakeServer(t, { refuse: () => 400 });

  await assert.rejects(openWithLang(deepgram, events(), "xx-YY"), /HTTP 400/);
  assert.deepEqual(languages(deepgram), ["xx-YY", "xx"]);
});

test("does not retry a refusal other than 400", async (t) => {
  const deepgram = await fakeServer(t, { refuse: () => 401 });

  await assert.rejects(openWithLang(deepgram, events(), "en-GB"), /HTTP 401/);
  assert.deepEqual(languages(deepgram), ["en-GB"]);
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
  })(events(), {});
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

test("closes the socket on close", async (t) => {
  const { deepgram, stream } = await open(t);
  const { socket } = await deepgram.connection;
  const closed = new Promise((resolve) => socket.once("close", resolve));

  stream.close();

  await closed;
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
