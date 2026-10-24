import { getProvider, providerNames } from "./providers/index.ts";
import type { OpenStream } from "./providers/provider.ts";
import { createServer, type AuthOptions } from "./server.ts";

const SHUTDOWN_TIMEOUT_MS = 5000;
// RFC 7518: an HS256 key must be at least as long as the hash output.
const MIN_SECRET_BYTES = 32;

const port = Number(process.env.PORT || 8080);

let auth: AuthOptions;
if (process.env.ALLOW_UNAUTHENTICATED === "true") {
  console.warn("WARNING: ALLOW_UNAUTHENTICATED is on, tokens are not checked");
  auth = { allowUnauthenticated: true };
} else if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required unless ALLOW_UNAUTHENTICATED=true");
  process.exit(1);
} else if (Buffer.byteLength(process.env.JWT_SECRET) < MIN_SECRET_BYTES) {
  console.error(`JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  process.exit(1);
} else {
  auth = { jwtSecret: process.env.JWT_SECRET };
}

const createProvider = getProvider(process.env.PROVIDER);
if (!createProvider) {
  console.error(`PROVIDER must be one of: ${providerNames.join(", ")}`);
  process.exit(1);
}
let openStream: OpenStream;
try {
  openStream = createProvider(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { server, shutdown } = createServer({ auth, openStream });

server.listen(port, () => {
  console.log(`dicta-server listening on port ${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    void shutdown();
  });
}
