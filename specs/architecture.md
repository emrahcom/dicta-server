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
- The ping in `contract-protocol.md` (Closing) finds a client that vanished
  without closing, so it does not keep a provider stream open.
- The idle close in `contract-protocol.md` (Closing) does the same for a client
  that stays connected but sends nothing, because a provider stream is kept
  open, and may be billed, for as long as the connection is. The 10 minutes are
  longer than a `dicta-js` hands-free session can wait for speech (5 minutes)
  plus its own idle close (1 minute).

## Authentication

- JWT, verified locally with a key from the configuration. No database and no
  call to another service.
- The application's backend holds the signing key and issues the tokens. The key
  never reaches the browser.
- HS256 with a shared secret (`JWT_SECRET`). The `jose` package verifies it.
- `exp` is required and is checked when the connection opens, as the contract
  describes. `sub` is optional and identifies the user.
- The upgrade is accepted before the token is checked, so the client can read
  the `4001` close code.

## Providers

- Each provider is an adapter behind one interface: open a stream, send audio,
  finish an utterance, receive interim and final transcripts, close.
- The server finishes an utterance on `end`, or 5 seconds after the last audio
  frame. The server handles `end` and this timer, not the providers.
- When audio came since the last finish, the server asks the provider to finish
  at once, so the provider cuts at that point in the audio. The provider's
  answer becomes the final, with empty text when nothing was recognized.
  Providers answer finishes in the order they were asked.
- When no audio came since the last finish, the server does not ask the provider
  and sends an empty final itself, after the finals still waiting for answers.
- A provider's own end-of-speech detection never makes a final, so a pause
  shorter than 5 seconds does not split a command.
- The provider and its API key come from the server configuration.
- The provider stream is opened after the token is accepted and closed with the
  connection. `ready` is sent only after it is open, so the server never buffers
  audio.
- The server passes the client's `lang` to the provider. A well-formed tag is a
  language code of 2 or 3 letters, optionally followed by subtags of 1 to 8
  letters or digits, each after a `-`. A malformed value is logged as a warning,
  quoted as in Logging, and not passed on.
- A provider stream can fail while opening (also when the provider does not
  confirm the open within 10 seconds) or after it is open. Either way the server
  logs the details, sends a generic `error` to the client and closes with
  `1011`. Provider details never reach the client. Only that connection is
  affected. Text and finals not yet sent are discarded, so a cut-off command is
  not acted on.
- A provider catches errors in its own event handlers and timers and reports
  them through its error callback. It never lets them escape, because the server
  cannot catch them there.
- A message from a provider that cannot be parsed, or has an unknown type, is
  logged as a warning and skipped; the stream continues.
- When more than 1 MiB of audio waits to be sent to the provider, because the
  provider does not keep up, the provider stream fails. Audio is never buffered
  without limit.

### stub

- For development and tests. It needs no API key and calls no service.
- For each audio frame it sends an interim with the total bytes received so far,
  and when the server finishes an utterance a final with the same text.

### mistral

- Mistral's realtime transcription API (Voxtral) over a WebSocket.
- The stream is open when Mistral confirms the session with `session.created`,
  as Mistral's SDK does.
- Audio is forwarded as it is, since Mistral accepts the same PCM format.
- Mistral takes a two-letter language code: the language code of the tag is sent
  when it has two letters (`de` for `de-DE`), otherwise Mistral detects the
  language itself.
- Each text delta is sent as an interim with the text since the last final. A
  final is the answer to `input_audio.flush`. A sentence end does not make a
  final, because Mistral sends a period as its own delta and "Dr. Smith" or
  "3.50" would be cut.
- Protocol references. The docs give the endpoint, audio format and events:
  https://docs.mistral.ai/studio/audio/speech_to_text/realtime_transcription.md
  The client messages (`session.update`, `input_audio.append`,
  `input_audio.flush`) are defined only in the SDK source,
  `src/mistralai/client/models/realtimetranscription*.py` in
  https://github.com/mistralai/client-python.

### deepgram

- Deepgram's live transcription API over a WebSocket, with smart formatting.
- The stream is open when the WebSocket opens.
- Audio is forwarded as it is.
- The language tag is sent as it is, and without one the language is English.
  When Deepgram refuses a tag that has subtags with HTTP 400, the server opens
  again with its language code (`de` for `de-BE`). A language Deepgram does not
  support at all fails the open.
- Deepgram sends results per segment. Finished segments are collected, and each
  result is sent as an interim with the collected text and the current segment.
- A final is sent only when Deepgram answers a `Finalize`, which the server
  sends when it finishes an utterance.
- A `KeepAlive` every 4 seconds keeps the stream open, since Deepgram closes it
  after 10 seconds without audio.
- Deepgram's `Error` messages are not fatal and are logged as warnings; fatal
  problems close the socket and count as a failure.
- Requests opt out of Deepgram's Model Improvement Program (`mip_opt_out`)
  unless `DEEPGRAM_MIP_OPT_IN` is `true`.
- Protocol references, checked on 2026-10-24:
  https://developers.deepgram.com/reference/speech-to-text-api/listen-streaming
  https://developers.deepgram.com/docs/understand-endpointing-interim-results
  https://developers.deepgram.com/docs/finalize
  https://developers.deepgram.com/docs/audio-keep-alive

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
- Tokens, audio and transcripts are never logged, and neither is the content of
  provider messages, except a provider's own error description.
- The session id is created when a connection starts. Every log line about a
  connection starts with it: `[<sessionId>] <message>`.
- A rejected token is logged with the reason (missing, expired, invalid
  signature, missing `exp`, or invalid for anything else). Neither the token nor
  anything decoded from it is logged.
- An accepted connection is logged once as `connected`, with the token's `sub`
  when it has one as a string. No other claim is logged.
- `sub` is logged in double quotes, escaped like a JSON string, with invisible
  and control characters as `\uXXXX`, so it cannot break or disguise a log line.
  It is cut to 128 characters, followed by `...` when longer:
  `connected sub="user-1"`.

## Shutdown

On `SIGTERM` or `SIGINT` the server stops accepting connections, closes the open
ones with code `1001` and exits. It exits after 5 seconds even if some sockets
have not closed.

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
  without a known one. Values: `stub`, `mistral`, `deepgram`.
- `MISTRAL_API_KEY`: required when `PROVIDER` is `mistral`.
- `MISTRAL_MODEL`: the Mistral model. Default
  `voxtral-mini-transcribe-realtime-3`.
- `DEEPGRAM_API_KEY`: required when `PROVIDER` is `deepgram`.
- `DEEPGRAM_MODEL`: the Deepgram model. Default `nova-3`.
- `DEEPGRAM_MIP_OPT_IN`: `true` lets Deepgram use the audio for its Model
  Improvement Program. Default `false`.
