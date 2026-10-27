# Ignore client messages after a close starts

Once the server starts to close a connection, ignore what the client still
sends, per `architecture.md` (Connections).

- The message handlers (audio forwarding, `end`, the audio count and the idle
  timer restart) do nothing unless the connection is open.
- Test: a raw client that never answers the close sends audio faster than real
  time; after the `1008` close frame, the provider receives no more audio.
