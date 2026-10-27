# Protocol

The contract between `dicta-js` and dicta-server. Both repos follow this file.

## Connection

```
wss://<host>/dicta/v1/listen?lang=<tag>
Sec-WebSocket-Protocol: dicta, <jwt>
```

In a browser: `new WebSocket(url, ["dicta", jwt])`.

- All server paths start with `/dicta/`, so a reverse proxy can route them with
  one rule and no rewrite.
- The JWT issued by the application's backend goes in the
  `Sec-WebSocket-Protocol` header, after the protocol name `dicta`. It is the
  only header a browser can set on a WebSocket, and unlike the URL it is not in
  the default access logs of reverse proxies. The server answers with
  `Sec-WebSocket-Protocol: dicta`.
- The token is checked only when the connection opens. An open connection stays
  open after the token expires; a new token is needed only for a new connection.
- A missing, invalid or expired token: the server closes the socket with code
  `4001`.
- The WebSocket opens before the token is checked. Only `ready` means the
  connection is accepted; a close such as `4001` can follow `open`.
- `lang` is optional: the language the user speaks, as a BCP 47 tag such as
  `de`, `de-DE` or `en-US`. Without it, the server's provider uses its default.
  A value that is not a well-formed tag is ignored, and the connection goes on.

## Client to server

Binary frames carry the audio: raw PCM signed 16-bit little-endian, 16 kHz,
mono. The client streams audio in small frames while the user speaks, typically
every 20 to 100 ms. It sends audio only while it captures speech, for example
while push-to-talk is held. A single frame is at most 64 KiB; a larger one
closes the connection with code `1009`.

When the user stops speaking, the client sends one text frame:

```json
{ "type": "end" }
```

The connection stays open, and the client sends audio again for the next
utterance, also before the previous final arrives.

The server ignores empty binary frames and other text frames. It also ignores
audio or `end` that arrives before `ready`.

## Server to client

Text frames, one JSON object each, always with a `type` field. Clients ignore
types they do not know.

`ready`, sent once after the token is accepted and the speech-to-text provider
is connected. The client starts sending audio after it. A client that buffers
audio until then sends it in the same small frames, never merged into one.

```json
{ "type": "ready", "sessionId": "..." }
```

`transcript`, the text of the current utterance. `final: false` is an interim
result: it replaces the previous interim and may still change. `final: true` is
final: it never changes, and the next transcript starts new text. Interims can
also arrive after `end`, until the final.

```json
{ "type": "transcript", "text": "add a note", "final": false }
```

`error`, sent when the speech-to-text provider fails, before the server closes
the socket with code `1011`. It can come before `ready` when the provider cannot
be reached or refuses the session, for example for an unsupported language.

```json
{ "type": "error", "message": "..." }
```

## Utterances

Each `end` finishes an utterance. If no `end` comes within 5 seconds after the
last audio frame, the server finishes the utterance itself; an `end` after that
finishes an utterance without audio. While the connection is open, each finished
utterance gets exactly one final, and finals arrive in the order the utterances
were finished. A final's text is empty when no audio came since the previous
finish or no speech was recognized, so the client always knows when an utterance
is over. A client that wants the last final waits for it before closing.

## Closing

Either side may close at any time. The client closes when it is done. After a
close, no more transcripts arrive: an utterance whose final has not arrived gets
none, also when the client already sent `end`.

The server sends a WebSocket ping every 30 seconds. A client that does not
answer with a pong before the next ping is disconnected. Browsers and common
WebSocket libraries answer pings automatically.

The server closes a connection with code `1000` when the client has sent no
message for 10 minutes. Pongs do not count. It is not a failure: the client
opens a new connection when it needs one. A client that waits longer than that
for speech, for example in a hands-free session, sends nothing meanwhile and
gets this close.

The server also closes a connection with code `1000` when it has been open for a
configured time, 10 minutes by default, also during an utterance. The client
opens a new connection when it needs one.

The server closes a connection with code `1008` when the client sends audio
faster than real time: when the audio received is more than 10 seconds longer
than the time since the connection opened. A client that captures speech from
the microphone never gets this close.

Code `1011` from the server means a server-side failure. It may come without an
`error` message. The client may open a new connection, waiting longer after each
failure in a row.

Code `4001` means the token was missing, invalid or expired. The client gets a
new token from the application's backend before it connects again.

Code `1001` from the server means it is shutting down. The client may open a new
connection.

Any other close, such as `1006` after a network loss or a missed pong, is
handled like `1011`.
