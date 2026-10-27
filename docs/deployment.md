# Deployment

## TLS

Browsers on HTTPS pages can only connect with `wss://`. So run the server behind
a reverse proxy that handles TLS, such as nginx or Caddy. Pass WebSocket
upgrades to the server.

## Paths

All paths of the server start with `/dicta/`. One proxy rule for `/dicta/` is
enough, and the server can share a domain with other services.

## Health check

For health checks, use `/dicta/health`. It answers `ok` while the server runs.
It does not check the speech-to-text service.

## Scaling

The servers share nothing. You can run as many as you need behind a load
balancer. A user's connection stays on one server.
