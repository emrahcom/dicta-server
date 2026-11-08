# Settings

Set them as environment variables.

- `PORT`: the port to listen on. The default is `8740`.
- `PROVIDER`: the speech-to-text service: `stub`, `mistral` or `deepgram`.
  Required. `stub` needs no key and sends back the number of audio bytes as
  text, for tests.
- `MISTRAL_API_KEY`: your Mistral key. Required with `mistral`.
- `MISTRAL_MODEL`: the Mistral model. The default is
  `voxtral-mini-transcribe-realtime-3`.
- `DEEPGRAM_API_KEY`: your Deepgram key. Required with `deepgram`.
- `DEEPGRAM_MODEL`: the Deepgram model. The default is `nova-3`.
- `DEEPGRAM_MIP_OPT_IN`: `true` lets Deepgram use the audio to improve its
  models. The default is `false`.
- `JWT_SECRET`: the secret for the tokens, at least 32 bytes. Your backend signs
  the tokens with it. Required.
- `JWT_AUDIENCE`: optional. When you set it, a token must have this value in its
  `aud` claim, or the server does not accept it. Use it when other servers share
  `JWT_SECRET`, such as
  [dicta-action-server](https://github.com/emrahcom/dicta-action-server): give
  each server its own value, so a token for one does not work on the other. It
  also lets you use tokens from a backend that already sets `aud`. When it is
  not set, `aud` is not checked.
- `MAX_CONNECTION_MINUTES`: the longest time one connection may stay open, in
  minutes, from `1` to `1440` (one day). The default is `30`. It limits what one
  token can cost. If a user still speaks when the time is up, the words they are
  saying are lost and [dicta-js](https://github.com/emrahcom/dicta-js) shows
  that voice failed. The next press opens a new connection. Raise it if your
  users dictate for a long time without a break.
- `ALLOW_UNAUTHENTICATED`: `true` turns tokens off. Use it only for development.
  Then `JWT_SECRET` is not needed.

## Examples

With Mistral or Deepgram as the speech-to-text service:

```sh
PROVIDER=mistral MISTRAL_API_KEY=... JWT_SECRET=... npm start
PROVIDER=deepgram DEEPGRAM_API_KEY=... JWT_SECRET=... npm start
```
