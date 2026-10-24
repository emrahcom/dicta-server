# Logging cleanup

Logging fixes and cleanup from the independent review, per `architecture.md`
(Logging, Providers).

- Log `sub` only when it is a string.
- Quote Mistral's error description with `quoteForLog`, as for Deepgram.
- Deepgram: do not send `CloseStream`, and remove the dead `code === undefined`
  check in the language retry.
- Provider headers point to `architecture.md` for the protocol references
  instead of repeating the links.
- Tests for the `sub` and Mistral error cases.
