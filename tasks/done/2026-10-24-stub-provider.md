# Stub provider

Forward audio to a provider and send its transcripts back, with the `stub`
provider only, per `architecture.md` (Providers, Configuration) and
`contract-protocol.md` (`ready`, `transcript`).

- A provider interface: open a stream, send audio, receive interim and final
  transcripts, close.
- The `stub` provider behind it.
- `PROVIDER` from the environment. A missing or unknown value: exit at startup
  with an error.
- After the token is accepted, open the provider stream, then send `ready`.
- Forward binary frames to the provider. Send each transcript to the client as a
  `transcript` message.
- Close the provider stream when the connection closes.
- Provider errors are out of scope; they are the next task.
