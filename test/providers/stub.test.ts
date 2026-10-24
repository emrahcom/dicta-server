import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transcript } from "../../src/providers/provider.ts";
import { openStubStream } from "../../src/providers/stub.ts";

test("reports the total bytes as interims, then a final after 1 second", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transcripts: Transcript[] = [];
  const stream = await openStubStream({
    onTranscript: (transcript) => transcripts.push(transcript),
    onError: () => {},
    onWarning: () => {},
  });

  stream.sendAudio(Buffer.alloc(100));
  stream.sendAudio(Buffer.alloc(50));
  t.mock.timers.tick(999);
  assert.deepEqual(transcripts, [
    { text: "100 bytes", final: false },
    { text: "150 bytes", final: false },
  ]);

  t.mock.timers.tick(1);
  assert.deepEqual(transcripts.at(-1), { text: "150 bytes", final: true });
});

test("sends no final after close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transcripts: Transcript[] = [];
  const stream = await openStubStream({
    onTranscript: (transcript) => transcripts.push(transcript),
    onError: () => {},
    onWarning: () => {},
  });

  stream.sendAudio(Buffer.alloc(10));
  stream.close();
  t.mock.timers.tick(1000);

  assert.deepEqual(transcripts, [{ text: "10 bytes", final: false }]);
});

test("reports an error thrown while sending the final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: Error[] = [];
  const stream = await openStubStream({
    onTranscript: (transcript) => {
      if (transcript.final) {
        throw new Error("final failed");
      }
    },
    onError: (error) => errors.push(error),
    onWarning: () => {},
  });

  stream.sendAudio(Buffer.alloc(10));
  t.mock.timers.tick(1000);

  assert.deepEqual(
    errors.map((error) => error.message),
    ["final failed"],
  );
});
