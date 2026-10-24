# Protocol

The contract between `dicta-js` and dicta-server. Both repos follow this file.

## Connection

```
wss://<host>/dicta/v1/listen?token=<jwt>&lang=<tag>
```

- All server paths start with `/dicta/`, so a reverse proxy can route them with
  one rule and no rewrite.
- `token` is the JWT issued by the application's backend. It is a query
  parameter because browsers cannot set headers on a WebSocket. The server must
  not log it.
- A missing, invalid or expired token: the server closes the socket with code
  `4001`.
- `lang` is optional: the language the user speaks, as a BCP 47 tag such as
  `de`, `de-DE` or `en-US`. Without it, the server's provider uses its default.
  A value that is not a well-formed tag is ignored, and the connection goes on.

## Client to server

Binary frames only: raw audio, PCM signed 16-bit little-endian, 16 kHz, mono.
The client streams audio in small frames while the user speaks, typically every
20 to 100 ms. It sends audio only while it captures speech, for example while
push-to-talk is held, and stops when the user stops speaking. The server sends
the final transcript about 1 second after the audio stops. A single frame is at
most 64 KiB; a larger one closes the connection with code `1009`. Audio buffered
before `ready` is sent in the same small frames, never merged into one.

## Server to client

Text frames, one JSON object each, always with a `type` field. Clients ignore
types they do not know.

`ready`, sent once after the token is accepted and the speech-to-text provider
is connected. The client starts sending audio after it.

```json
{ "type": "ready", "sessionId": "..." }
```

`transcript`, sent while the user speaks. `final: false` is an interim result:
it replaces the previous interim and may still change. `final: true` is final:
it never changes, and the next transcript starts new text.

```json
{ "type": "transcript", "text": "add a note", "final": false }
```

`error`, sent when the speech-to-text provider fails, before the server closes
the socket with code `1011`. It can come before `ready` when the provider cannot
be reached.

```json
{ "type": "error", "message": "..." }
```

## Closing

Either side may close at any time. The client closes when it is done.

The server sends a WebSocket ping every 30 seconds. A client that does not
answer with a pong before the next ping is disconnected. Browsers and common
WebSocket libraries answer pings automatically.

Code `1011` from the server means a server-side failure. It may come without an
`error` message.

Code `1001` from the server means it is shutting down. The client may open a new
connection, which reaches another instance.
