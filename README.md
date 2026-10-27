# dicta-server

Server side of dicta. Users tell a web application what they want, by typing or
by speaking. This server turns the speech into text.

Browsers connect to it with dicta-js: https://github.com/emrahcom/dicta-js

Early development. Not ready for use.

## Run

Requires Node.js 24 or later.

```sh
npm install
PROVIDER=stub ALLOW_UNAUTHENTICATED=true npm start
```

With Mistral or Deepgram as the speech-to-text provider:

```sh
PROVIDER=mistral MISTRAL_API_KEY=... JWT_SECRET=... npm start
PROVIDER=deepgram DEEPGRAM_API_KEY=... JWT_SECRET=... npm start
```

## Settings

Set them as environment variables.

- `PORT`: the port to listen on. The default is `8080`.
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
- `ALLOW_UNAUTHENTICATED`: `true` turns tokens off. Use it only for development.
  Then `JWT_SECRET` is not needed.

## Deploy

Browsers on HTTPS pages can only connect with `wss://`. So run the server behind
a reverse proxy that handles TLS, such as nginx or Caddy. Pass WebSocket
upgrades to the server.

All paths of the server start with `/dicta/`. One proxy rule for `/dicta/` is
enough, and the server can share a domain with other services.

For health checks, use `/dicta/health`. It answers `ok` while the server runs.
It does not check the speech-to-text service.

## More

The protocol is in `specs/contract-protocol.md`, and the design in
`specs/architecture.md`.

## License

Apache-2.0
