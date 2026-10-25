import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transcript } from "../../src/providers/provider.ts";
import { openStubStream } from "../../src/providers/stub.ts";

async function open() {
  const transcripts: Transcript[] = [];
  const stream = await openStubStream(
    {
      onTranscript: (transcript) => transcripts.push(transcript),
      onError: () => {},
      onWarning: () => {},
    },
    {},
  );
  return { stream, transcripts };
}

test("reports the total bytes as interims, then a final on finish", async () => {
  const { stream, transcripts } = await open();

  stream.sendAudio(Buffer.alloc(100));
  stream.sendAudio(Buffer.alloc(50));
  stream.finish();

  assert.deepEqual(transcripts, [
    { text: "100 bytes", final: false },
    { text: "150 bytes", final: false },
    { text: "150 bytes", final: true },
  ]);
});

test("sends an empty final when finished without audio", async () => {
  const { stream, transcripts } = await open();

  stream.finish();

  assert.deepEqual(transcripts, [{ text: "", final: true }]);
});
