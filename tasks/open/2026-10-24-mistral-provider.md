# Mistral provider

Add the `mistral` provider, per `architecture.md` (Providers, Configuration) and
`contract-protocol.md` (Client to server).

- Connect to Mistral's realtime endpoint with `MISTRAL_MODEL` and the API key in
  an `Authorization` header.
- On `session.created`, send `session.update` for 16 kHz `pcm_s16le` audio. The
  stream is then open. An `error` before it, or no `session.created` within 10
  seconds of connecting, fails the open.
- Send each audio frame as `input_audio.append`.
- Each `transcription.text.delta`: an interim with the text since the last
  final, or a final when that text ends a sentence.
- 1 second after the last audio frame: send `input_audio.flush`. On
  `transcription.done`, send the remaining text as a final.
- On a Mistral error or an unexpected close: send pending text as a final, then
  report the error.
- `PROVIDER=mistral` without `MISTRAL_API_KEY`: exit at startup with an error.
- A header comment in the provider with the protocol references and the date it
  was checked against the live API.
- Tests against a fake Mistral WebSocket server, no network.
