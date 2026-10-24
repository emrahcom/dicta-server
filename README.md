# dicta-server

Server side of dicta, a voice-control layer for web applications.

Early development. Not ready for use.

## Run

Requires Node.js 24 or later.

```sh
npm install
PROVIDER=stub ALLOW_UNAUTHENTICATED=true npm start
```

With Mistral as the speech-to-text provider:

```sh
PROVIDER=mistral MISTRAL_API_KEY=... JWT_SECRET=... npm start
```

Configuration is described in `specs/architecture.md`, the protocol in
`specs/contract-protocol.md`.

## License

Apache-2.0
