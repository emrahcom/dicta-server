# dicta-server

Server side of dicta. Users tell a web application what they want, by typing or
by speaking. This server turns the speech into text.

Browsers connect to it with dicta-js: https://github.com/emrahcom/dicta-js

Version 0.x. Settings may still change. The release notes tell you when you must
change your setup.

## Quick start

Requires Node.js 24 or later.

```sh
npm install
PROVIDER=stub ALLOW_UNAUTHENTICATED=true npm start
```

This runs the server on port 8080, without tokens and with a test service
instead of real speech-to-text.

## Documents

- Settings: https://github.com/emrahcom/dicta-server/blob/main/docs/settings.md
- Deployment:
  https://github.com/emrahcom/dicta-server/blob/main/docs/deployment.md

The protocol and the design are in `specs/`, for developers of dicta.

## License

Apache-2.0
