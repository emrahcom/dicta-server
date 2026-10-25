# One final per utterance

Send one final per utterance for Deepgram too, per `architecture.md` (Providers,
deepgram) and `contract-protocol.md` (Server to client).

- Deepgram: send a final only on the answer to `Finalize` (`from_finalize`).
  `speech_final` no longer ends the utterance; its segments stay collected and
  are sent as interims.
- Tests: a result with `speech_final` gives an interim, not a final, and the
  collected text comes as one final after `Finalize`.
