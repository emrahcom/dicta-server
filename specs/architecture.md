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
- The server pings every connection every 30 seconds. A connection that has not
  answered the previous ping is closed, so a client that vanished without
  closing does not keep a provider stream open.

## Authentication

- JWT, verified locally with a key from the configuration. No database and no
  call to another service.
- The application's backend holds the signing key and issues the tokens. The
  key never reaches the browser.
- HS256 with a shared secret (`JWT_SECRET`). The `jose` package verifies it.
- `exp` is required. `sub` is optional and identifies the user.
- The upgrade is accepted before the token is checked, so the client can read
  the `4001` close code.

## Providers

- Each provider is an adapter behind one interface: open a stream, send audio,
  receive interim and final transcripts, close.
- The provider and its API key come from the server configuration.
- The provider stream is opened after the token is accepted and closed with
  the connection. `ready` is sent only after it is open, so the server never
  buffers audio.
- A provider stream can fail while opening or later. Either way the server
  logs the details, sends a generic `error` to the client and closes with
  `1011`. Provider details never reach the client. Only that connection is
  affected.
- A provider catches errors in its own event handlers and timers and reports
  them through its error callback. It never lets them escape, because the
  server cannot catch them there.
- `stub` is a provider for development and tests. It needs no API key and
  calls no service. For each audio frame it sends an interim with the total
  bytes received so far, and after 1 second without audio a final with the
  same text.

## Unexpected errors

An unexpected error in a connection is logged and closes that connection with
`1011`. The process keeps running. This covers the connection setup and every
event handler of the connection, including the callbacks the server passes to
the provider.

## State

Instances share nothing. All state belongs to an open connection and is gone
when it closes. Any instance can serve any user.

## Logging

- Logs go to the console.
- The session id is created when a connection starts. Every log line about a
  connection starts with it: `[<sessionId>] <message>`.
- A rejected token is logged with the reason (missing, expired, invalid
  signature, missing `exp`, or invalid for anything else). Neither the token
  nor anything decoded from it is logged.
- An accepted connection is logged once as `connected`, with the token's `sub`
  when it has one. No other claim is logged.
- `sub` is logged in double quotes, escaped like a JSON string, with invisible
  and control characters as `\uXXXX`, so it cannot break or disguise a log
  line. It is cut to 128 characters, followed by `...` when longer:
  `connected sub="user-1"`.

## Shutdown

On `SIGTERM` or `SIGINT` the server stops accepting connections, closes the
open ones with code `1001` and exits. It exits after 5 seconds even if some
sockets have not closed.

## Configuration

Environment variables:

- `PORT`: the port the server listens on. Default `8080`.
- `JWT_SECRET`: the shared secret for tokens, at least 32 bytes (RFC 7518).
  Required; the server does not start without it or with a shorter one, unless
  `ALLOW_UNAUTHENTICATED` is `true`.
- `ALLOW_UNAUTHENTICATED`: when `true`, tokens are not checked at all. For
  development only. Default `false`. The server logs a warning at startup when
  it is on.
- `PROVIDER`: the speech-to-text provider. Required; the server does not start
  without a known one. Values: `stub`.
