# Session logging

Tag connection logs with the session id, per `architecture.md` (Logging).

- Create the session id when the connection starts and use the same id in
  `ready`.
- Prefix every log line about a connection with `[<sessionId>]`.
