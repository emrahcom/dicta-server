# Handler errors

Contain errors thrown in event handlers, per `architecture.md` (Providers,
Unexpected errors).

- Catch errors in every connection event handler (`close`, `message`) and in the
  `onTranscript` and `onError` callbacks given to the provider. Handle them as
  unexpected errors: log with the session id, close with `1011`.
- Make sure the stub provider lets no error escape from its timer.
