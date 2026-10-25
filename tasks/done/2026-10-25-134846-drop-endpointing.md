# Drop endpointing

Stop sending `endpointing` to Deepgram, per `architecture.md` (Providers,
deepgram).

- Remove `endpointing=500` from the Deepgram connection parameters and from the
  test that checks them.
