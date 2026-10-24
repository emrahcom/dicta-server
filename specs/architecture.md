# Architecture

## Flow

```
dicta-js (browser) --WebSocket--> dicta-server --> speech-to-text provider
                   <-transcripts-              <--
```

1. The application's own backend signs a short-lived JWT for its user.
2. `dicta-js` opens a WebSocket to dicta-server with that token.
3. dicta-server verifies the token, opens a stream to the provider and forwards
   the audio.
4. Transcripts from the provider go back over the same WebSocket.
5. When either side closes, everything for that connection is closed.

Message formats are in `contract-protocol.md`.

## Connections

- One WebSocket is one user and one audio stream, with one provider stream
  behind it.
- The server creates the session id. It never takes one from the client.
- No session resume. After a disconnect the client opens a new connection.

## Authentication

- JWT, verified locally with a key from the configuration. No database and no
  call to another service.
- The application's backend holds the signing key and issues the tokens. The
  key never reaches the browser.

## Providers

- Each provider is an adapter behind one interface: open a stream, send audio,
  receive interim and final transcripts, close.
- The provider and its API key come from the server configuration.

## State

Instances share nothing. All state belongs to an open connection and is gone
when it closes. Any instance can serve any user.

## Configuration

Environment variables:

- `PORT`: the port the server listens on. Default `8080`.
