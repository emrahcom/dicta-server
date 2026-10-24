# Mistral flush finals

Finals only on flush for Mistral, and live tests that catch late failures, per
`architecture.md` (Providers, mistral).

- Mistral: no final at a sentence end. Deltas stay interims until the flush
  answer (`transcription.done`) sends them as a final. Remove the sentence end
  rule.
- Live tests: record `error` messages and the close code after `ready`, and fail
  when there is an error or a close the client did not start.
