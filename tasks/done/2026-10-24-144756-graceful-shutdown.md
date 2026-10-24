# Graceful shutdown

Shut down cleanly on `SIGTERM` and `SIGINT`, per `architecture.md` (Shutdown)
and `contract-protocol.md` (Closing).

- Stop accepting new connections.
- Close open WebSockets with code `1001`.
- Exit when they are closed, or after 5 seconds at the latest.
