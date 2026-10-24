# Heartbeat

Detect dead connections, per `architecture.md` (Connections) and
`contract-protocol.md` (Closing).

- Ping every connection every 30 seconds.
- Terminate a connection that has not answered the previous ping. Its provider
  stream closes with it.
- Stop the timer on shutdown, so it does not keep the process alive.
- Test with mock timers, not real time.
