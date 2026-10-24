# Shared helpers

Remove duplication found in the review. No behavior change.

- Move `parseMessage` and the unknown message type warning, now in both
  `mistral.ts` and `deepgram.ts`, into one shared module under `src/providers/`.
- Move the test helpers repeated in `mistral.test.ts` and `deepgram.test.ts`
  (`events`, `settle`, `closeFully` and the fake server setup) into
  `test/providers/helpers.ts`.
- All tests keep passing unchanged in what they check.
