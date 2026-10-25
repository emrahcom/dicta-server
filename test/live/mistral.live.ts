// Runs against the real Mistral API, to catch changes on Mistral's side. Not
// part of `npm run test`; run it with `npm run test:live`.

import { test } from "node:test";
import { checkFinals, transcribeUtterances } from "./transcribe.ts";

test(
  "gives one final per utterance with Mistral",
  {
    skip: process.env.MISTRAL_API_KEY ? false : "MISTRAL_API_KEY is not set",
    timeout: 90_000,
  },
  async (t) => {
    // Mistral gets en for en-US.
    checkFinals(await transcribeUtterances(t, "mistral", "en-US"));
  },
);
