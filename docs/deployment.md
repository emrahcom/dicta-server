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

## Docker

The image is in the GitHub registry. Run it with your settings as environment
variables:

```sh
docker run -p 8080:8080 -e PROVIDER=deepgram -e DEEPGRAM_API_KEY=... \
  -e JWT_SECRET=... ghcr.io/emrahcom/dicta-server:latest
```

The settings:
https://github.com/emrahcom/dicta-server/blob/main/docs/settings.md

The image has the server and dicta-js. The label `dicta-js.version` shows which
dicta-js version is in it.

To build the image yourself, give the dicta-js version to put in it, a release
tag. The build gets it from GitHub:

```sh
docker build --build-arg DICTA_JS_VERSION=v0.1.0 -t dicta-server .
```

## Health check

For health checks, use `/dicta/health`. It answers `ok` while the server runs.
It does not check the speech-to-text service.

## Limits

The server limits each connection:

- A connection stays open at most 30 minutes (`MAX_CONNECTION_MINUTES`).
- A client cannot send audio faster than real time.

The server does not limit how many connections one client opens. Limit this in
the reverse proxy, per IP address. An example for nginx:

```nginx
limit_conn_zone $binary_remote_addr zone=dicta_conn:10m;
limit_req_zone $binary_remote_addr zone=dicta_req:10m rate=30r/m;

server {
  # ...

  location /dicta/v1/listen {
    limit_conn dicta_conn 10;
    limit_req zone=dicta_req burst=10 nodelay;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

This allows 10 open connections and 30 new connections per minute from one IP
address. Many users in one office can share one IP address, so do not set the
limits too low.

Limits per user belong in your backend, which makes the tokens. See the token
docs of dicta-js: https://github.com/emrahcom/dicta-js/blob/main/docs/tokens.md

## Scaling

The servers share nothing. You can run as many as you need behind a load
balancer. A user's connection stays on one server.
