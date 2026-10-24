# Protocol

The contract between `dicta-js` and dicta-server. Both repos follow this file.

## Connection

```
wss://<host>/dicta/v1/listen?token=<jwt>
```

- All server paths start with `/dicta/`, so a reverse proxy can route them with
  one rule and no rewrite.
- `token` is the JWT issued by the application's backend. It is a query
  parameter because browsers cannot set headers on a WebSocket. The server must
  not log it.
- An invalid or expired token: the server closes the socket with code `4001`.

## Client to server

Binary frames only: raw audio, PCM signed 16-bit little-endian, 16 kHz, mono.
Any frame size.

## Server to client

Text frames, one JSON object each, always with a `type` field. Clients ignore
types they do not know.

`ready`, sent once after the token is accepted. The client starts sending audio
after it.

```json
{ "type": "ready", "sessionId": "..." }
```

`transcript`, sent while the user speaks. `final: false` is an interim result:
it replaces the previous interim and may still change. `final: true` is final:
it never changes, and the next transcript starts new text.

```json
{ "type": "transcript", "text": "add a note", "final": false }
```

`error`, sent before the server closes the socket with code `1011`.

```json
{ "type": "error", "message": "..." }
```

## Closing

Either side may close at any time. The client closes when it is done.

Code `1001` from the server means it is shutting down. The client may open a
new connection, which reaches another instance.
