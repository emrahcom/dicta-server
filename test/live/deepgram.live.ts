// Runs against the real Deepgram API, to catch changes on Deepgram's side. Not
// part of `npm run test`; run it with `npm run test:live`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_WORDS, transcribeFixture } from "./transcribe.ts";

test(
  "transcribes speech with Deepgram",
  {
    skip: process.env.DEEPGRAM_API_KEY ? false : "DEEPGRAM_API_KEY is not set",
    timeout: 30_000,
  },
  async (t) => {
    // Deepgram refuses en-XY, so this also checks the fallback to en.
    const text = await transcribeFixture(t, "deepgram", "en-XY");
    for (const word of FIXTURE_WORDS) {
      assert.ok(text.includes(word), `"${word}" missing in: ${text}`);
    }
  },
);
