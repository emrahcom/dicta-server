# Deepgram provider

Add the `deepgram` provider, per `architecture.md` (Providers, Configuration,
Logging).

- Connect to `wss://api.deepgram.com/v1/listen` with an `Authorization: Token`
  header and `model`, `encoding=linear16`, `sample_rate=16000`, `channels=1`,
  `interim_results=true`, `endpointing=500` and `smart_format=true`. Add
  `mip_opt_out=true` unless `DEEPGRAM_MIP_OPT_IN` is `true`.
- The stream is open when the WebSocket opens. An HTTP refusal or no open within
  10 seconds fails the open.
- Send each audio frame as a binary frame.
- Collect `is_final` segments. Send each result as an interim with the collected
  text and the current segment. Send a final on `speech_final` or
  `from_finalize`.
- 1 second after the last audio frame: send `Finalize`.
- Send `KeepAlive` every 4 seconds while the stream is open.
- On close: send `CloseStream`, then close the socket.
- On an unexpected close: send collected text as a final, then report the error.
- `Error` messages: a warning with Deepgram's description. `Metadata`,
  `SpeechStarted` and `UtteranceEnd`: skipped. Unparseable messages and unknown
  types: warnings as for Mistral.
- `PROVIDER=deepgram` without `DEEPGRAM_API_KEY`: exit at startup with an error.
- A header comment with the protocol references and the date checked.
- Tests against a fake Deepgram server, and a live test like the Mistral one.
