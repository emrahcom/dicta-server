# Mistral skip messages

Skip unparseable and unknown Mistral messages, per `architecture.md` (Providers,
Logging).

- Give providers a warning callback. The server logs it with the session id:
  `[<sessionId>] provider: <warning>`.
- An unparseable message: log a warning with its size, not its content, and
  continue.
- A message of unknown type: log a warning with the type, quoted with
  `quoteForLog`, and continue. `session.updated` is known and skipped without a
  warning.
