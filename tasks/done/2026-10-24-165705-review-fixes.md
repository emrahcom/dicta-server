# Review fixes

Fixes from the review before the Mistral provider, per `architecture.md`
(Configuration, Providers).

- Exit at startup when `JWT_SECRET` is shorter than 32 bytes, unless
  `ALLOW_UNAUTHENTICATED` is `true`.
- Test that the provider stream is closed when the client leaves while it is
  still opening.
