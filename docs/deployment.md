# Deployment

## TLS

Browsers on HTTPS pages can only connect with `wss://`. So run the server behind
a reverse proxy that handles TLS, such as nginx or Caddy. Pass WebSocket
upgrades to the server.

## Paths

All paths of the server start with `/dicta/`. One proxy rule for `/dicta/` is
enough, and the server can share a domain with other services.

## dicta-js

The server can also serve dicta-js, so pages load it from the same address:

```html
<script
  type="module"
  src="https://dicta.example.com/dicta/js/index.js"
></script>
```

The Docker image has it. To serve it without the image, build dicta-js and copy
its `dist/` folder to `js/` in the server's folder. Then restart the server.

The files work on pages of other domains too. Browsers check for a new version
on each load, so an update reaches users at once.

## Health check

For health checks, use `/dicta/health`. It answers `ok` while the server runs.
It does not check the speech-to-text service.

## Scaling

The servers share nothing. You can run as many as you need behind a load
balancer. A user's connection stays on one server.
