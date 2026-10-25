import assert from "node:assert/strict";
import { once } from "node:events";
import { type TestContext, test } from "node:test";
import { createMistral } from "../../src/providers/mistral.ts";
import {
  closeFully,
  events,
  fakeServer,
  pause,
  sendUntilError,
  settle,
} from "./helpers.ts";

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

  await assert.rejects(opening, /Mistral error: "1234 bad model"/);
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

test("fails the stream when the provider does not keep up", async (t) => {
  const { mistral, recorded, stream } = await open(t);
  await pause(mistral);

  await sendUntilError(stream, recorded);

  assert.match(recorded.errors[0]?.message ?? "", /does not keep up/);
});

test("ignores transcription messages before the stream is open", async (t) => {
  const mistral = await fakeServer(t);
  const recorded = events();
  const opening = createMistral({
    apiKey: "key",
    model: "model",
    url: mistral.url,
  })(recorded, {});
  await mistral.send({ type: "transcription.text.delta", text: "early" });
  await mistral.send({ type: "transcription.done" });
  await mistral.send({ type: "session.created" });
  const stream = await opening;
  t.after(() => closeFully(stream, mistral));
  await settle();

  assert.deepEqual(recorded.transcripts, []);
});

test("flushes at once when the utterance is finished", async (t) => {
  const { mistral, stream } = await open(t);

  stream.sendAudio(Buffer.from([1]));
  await mistral.next(); // input_audio.append
  stream.finish();

  assert.deepEqual(await mistral.next(), { type: "input_audio.flush" });
});

test("sends audio as base64", async (t) => {
  const { mistral, stream } = await open(t);

  stream.sendAudio(Buffer.from([1, 2, 3]));

  assert.deepEqual(await mistral.next(), {
    type: "input_audio.append",
    audio: "AQID",
  });
});

test("reports deltas as interims, also across a period", async (t) => {
  const { mistral, recorded } = await open(t);

  for (const text of ["call", " Dr", ".", " Smith"]) {
    await mistral.send({ type: "transcription.text.delta", text });
  }
  await settle();

  assert.deepEqual(recorded.transcripts, [
    { text: "call", final: false },
    { text: "call Dr", final: false },
    { text: "call Dr.", final: false },
    { text: "call Dr. Smith", final: false },
  ]);
});

test("sends the text since the last final as the final of a flush", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.text.delta", text: "add a note" });
  await mistral.send({ type: "transcription.done" });
  await settle();

  assert.deepEqual(recorded.transcripts.at(-1), {
    text: "add a note",
    final: true,
  });
});

test("sends an empty final for a flush without text", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.done" });
  await settle();

  assert.deepEqual(recorded.transcripts, [{ text: "", final: true }]);
});

test("discards pending text and reports a Mistral error", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.text.delta", text: "add a" });
  await mistral.send({
    type: "error",
    error: { code: 3804, message: { detail: "idle" } },
  });
  await settle();

  assert.deepEqual(recorded.transcripts, [{ text: "add a", final: false }]);
  assert.equal(
    recorded.errors[0]?.message,
    'Mistral error: "3804 {\\"detail\\":\\"idle\\"}"',
  );
});

test("quotes the error description, so it cannot break a log line", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "error", error: { message: "bad\nthing" } });
  await settle();

  assert.equal(recorded.errors[0]?.message, 'Mistral error: "bad\\nthing"');
});

test("discards pending text and reports an unexpected close", async (t) => {
  const { mistral, recorded } = await open(t);

  await mistral.send({ type: "transcription.text.delta", text: "add a" });
  (await mistral.connection).socket.close(1011);
  await once((await mistral.connection).socket, "close");
  await settle();

  assert.deepEqual(recorded.transcripts, [{ text: "add a", final: false }]);
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
