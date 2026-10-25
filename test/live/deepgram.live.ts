// Runs against the real Deepgram API, to catch changes on Deepgram's side. Not
// part of `npm run test`; run it with `npm run test:live`.

import { test } from "node:test";
import { checkFinals, transcribeUtterances } from "./transcribe.ts";

test(
  "gives one final per utterance with Deepgram",
  {
    skip: process.env.DEEPGRAM_API_KEY ? false : "DEEPGRAM_API_KEY is not set",
    timeout: 90_000,
  },
  async (t) => {
    // Deepgram refuses en-XY, so this also checks the fallback to en.
    checkFinals(await transcribeUtterances(t, "deepgram", "en-XY"));
  },
);
