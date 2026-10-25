# Utterance in server

Handle the end of an utterance in the server, with one final per finished
utterance, per `architecture.md` (Providers) and `contract-protocol.md` (Client
to server, Server to client).

- Server: per connection, track whether audio came since the last final and
  whether a finish waits for its answer. On `end` or after 5 seconds without
  audio: ask the provider to finish when audio came, send an empty final itself
  when none came, and do nothing while a finish waits.
- Providers: remove their own timers. `finish()` always asks the provider, and
  every answer becomes a final, also with empty text.
- On a provider failure, discard the unfinished text instead of sending it as a
  final.
- Tests for each case, including `end` with no audio, which must not reach the
  provider (Mistral answers it with error 3051).
