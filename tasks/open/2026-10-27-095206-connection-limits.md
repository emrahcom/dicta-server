# Connection limits

Close connections that stay open too long or send audio faster than real time,
per `contract-protocol.md` (Closing) and `architecture.md` (Connections,
Configuration).

- Age limit: `createServer` takes the longest connection time. Each connection
  gets a timer from when it opens that closes it with `1000`. `index.ts` reads
  `MAX_CONNECTION_MINUTES` (default `10`) and exits at startup unless it is a
  positive whole number.
- Real-time limit: each connection counts the bytes of its binary frames and
  closes with `1008` when they are more than 10 seconds of audio (32000 bytes
  per second) ahead of the time since it opened.
- Docs: `docs/settings.md` explains `MAX_CONNECTION_MINUTES`.
- Tests, with mock timers: a connection is closed with `1000` after the age
  limit and not before; audio within real time plus 10 seconds keeps the
  connection open; more audio closes it with `1008`.
