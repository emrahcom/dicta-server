# Provider backpressure

Fixes from the second independent review, per `architecture.md` (Providers,
Configuration) and `contract-protocol.md` (Client to server, Server to client).

- Mistral and Deepgram: when more than 1 MiB waits in the provider socket's send
  buffer, fail the stream instead of sending more audio.
- Mistral: ignore transcription messages until the stream is open.
- `PORT`: an empty value means the default `8080`.
- Tests: a paused fake provider makes the stream fail for both providers, and a
  text frame from the client never reaches the provider.
