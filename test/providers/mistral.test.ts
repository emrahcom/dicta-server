import assert from "node:assert/strict";
import { once } from "node:events";
import { type TestContext, test } from "node:test";
import { createMistral } from "../../src/providers/mistral.ts";
import { closeFully, events, fakeServer, settle } from "./helpers.ts";

// Opens a stream against the fake server and completes the handshake.
async function open(t: TestContext) {
  const mistral = await fakeServer(t);
  const recorded = events();
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(recorded, {});
  await mistral.send({ type: "session.created" });
  const stream = await opening;
  t.after(() => closeFully(stream, mistral));
  await mistral.next(); // session.update
  return { mistral, recorded, stream };
}

test("connects with the model and the API key", async (t) => {
  const mistral = await fakeServer(t);
  void createMistral({ apiKey: "key", model: "a b", url: mistral.url })(
    events(),
    {},
  ).catch(() => {});

  const { request } = await mistral.connection;

  assert.equal(request.url, "/?model=a%20b");
  assert.equal(request.headers.authorization, "Bearer key");
});

test("opens on session.created and then sends the audio format", async (t) => {
  const mistral = await fakeServer(t);
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(events(), {});
  await mistral.send({ type: "session.created" });
  const stream = await opening;
  t.after(() => closeFully(stream, mistral));

  assert.deepEqual(await mistral.next(), {
    type: "session.update",
    session: { audio_format: { encoding: "pcm_s16le", sample_rate: 16000 } },
  });
});

const languageCases: { lang: string; language: string | undefined }[] = [
  { lang: "de-DE", language: "de" },
  { lang: "DE", language: "de" },
  { lang: "en", language: "en" },
  { lang: "ceb", language: undefined },
];

for (const { lang, language } of languageCases) {
  test(`sends language ${String(language)} for lang ${lang}`, async (t) => {
    const mistral = await fakeServer(t);
    const opening = createMistral({
      apiKey: "key",
      model: "model",
      url: mistral.url,
    })(events(), { lang });
    await mistral.send({ type: "session.created" });
    const stream = await opening;
    t.after(() => closeFully(stream, mistral));

    const update = (await mistral.next()) as {
      session: { language?: string };
    };

    assert.equal(update.session.language, language);
  });
}

test("fails the open on an error before session.created", async (t) => {
  const mistral = await fakeServer(t);
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(events(), {});
  await mistral.send({
    type: "error",
    error: { code: 1234, message: "bad model" },
  });

  await assert.rejects(opening, /Mistral error: 1234 bad model/);
});

test("fails the open when Mistral refuses the connection", async (t) => {
  const mistral = await fakeServer(t, { refuse: () => 401 });
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(events(), {});

  await assert.rejects(opening, /HTTP 401/);
});

test("fails the open without session.created within 10 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mistral = await fakeServer(t);
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(events(), {});
  await mistral.connection;

  t.mock.timers.tick(10_000);

  await assert.rejects(opening, /no session.created within 10 seconds/);
});

test("sends audio as base64", async (t) => {
  const { mistral, stream } = await open(t);

  stream.sendAudio(Buffer.from([1, 2, 3]));

  assert.deepEqual(await mistral.next(), {
    type: "input_audio.append",
    audio: "AQID",
  });
});

test("reports deltas as interims and a sentence end as a final", async (t) => {
  const { mistral, recorded } = await open(t);

  for (const text of ["The", " Bir", "ch", ".", " Glue"]) {
    await mistral.send({ type: "transcription.text.delta", text });
  }
  await settle();

  assert.deepEqual(recorded.transcripts, [
    { text: "The", final: false },
    { text: "The Bir", final: false },
    { text: "The Birch", final: false },
    { text: "The Birch.", final: true },
    { text: "Glue", final: false },
  ]);
});

test("flushes 1 second after the last audio and sends the rest as a final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mistral, recorded, stream } = await open(t);

  stream.sendAudio(Buffer.from([1]));
  await mistral.next(); // input_audio.append
  t.mock.timers.tick(999);
  stream.sendAudio(Buffer.from([2]));
  await mistral.next(); // input_audio.append
  t.mock.timers.tick(1000);

  assert.deepEqual(await mistral.next(), { type: "input_audio.flush" });

  await mistral.send({ type: "transcription.text.delta", text: "add a note" });
  await mistral.send({ type: "transcription.done" });
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a note",
    final: true,
  });
});

test("sends pending text as a final, then reports a Mistral error", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.text.delta", text: "add a" });
  await mistral.send({
    type: "error",
    error: { code: 3804, message: { detail: "idle" } },
  });
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a",
    final: true,
  });
  assert.equal(
    recorded.errors[0]?.message,
    'Mistral error: 3804 {"detail":"idle"}',
  );
});

test("sends pending text as a final, then reports an unexpected close", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.text.delta", text: "add a" });
  (await mistral.connection).socket.close(1011);
  await once((await mistral.connection).socket, "close");
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a",
    final: true,
  });
  assert.match(recorded.errors[0]?.message ?? "", /closed the connection/);
});

test("warns about a message it cannot parse, without its content", async (t) => {
  const { mistral, recorded } = await open(t);

  (await mistral.connection).socket.send("secret words");
  (await mistral.connection).socket.send("42");
  await mistral.send({ type: "transcription.text.delta", text: "still on" });
  await settle();

  assert.deepEqual(recorded.warnings, [
    "unparseable message (12 bytes)",
    "unparseable message (2 bytes)",
  ]);
  assert.deepEqual(recorded.errors, []);
  assert.deepEqual(recorded.transcripts, [{ text: "still on", final: false }]);
});

test("warns about an unknown message type with the type only", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.new\nline", text: "secret" });
  await mistral.send({ text: "secret" });
  await mistral.send({ type: "session.updated" });
  await settle();

  assert.deepEqual(recorded.warnings, [
    'unknown message type "transcription.new\\nline"',
    'unknown message type "undefined"',
  ]);
  assert.deepEqual(recorded.errors, []);
});

test("reports nothing after close", async (t) => {
  const { mistral, recorded, stream } = await open(t);

  stream.close();
  await mistral.send({ type: "transcription.text.delta", text: "late" });
  await settle();

  assert.deepEqual(recorded.transcripts, []);
  assert.deepEqual(recorded.errors, []);
});
