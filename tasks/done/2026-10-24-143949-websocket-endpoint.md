# WebSocket endpoint

Accept client connections, per `contract-protocol.md` (Connection, `ready`) and
`architecture.md` (Connections, Configuration).

- An HTTP server on `PORT`, with the `ws` package for WebSocket.
- Accept upgrades on `/dicta/v1/listen` only. Reject any other path.
- On connect, create a session id and send `ready` with it.
- Ignore incoming audio for now. No token check yet.
- Replace the start line in `src/index.ts` and its test.
