// Runs against the real Mistral API, to catch changes on Mistral's side. Not
// part of `npm run test`; run it with `npm run test:live`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_WORDS, transcribeFixture } from "./transcribe.ts";

test(
  "transcribes speech with Mistral",
  {
    skip: process.env.MISTRAL_API_KEY ? false : "MISTRAL_API_KEY is not set",
    timeout: 30_000,
  },
  async (t) => {
    const text = await transcribeFixture(t, "mistral");
    for (const word of FIXTURE_WORDS) {
      assert.ok(text.includes(word), `"${word}" missing in: ${text}`);
    }
  },
);
