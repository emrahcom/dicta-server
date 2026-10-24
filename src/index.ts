import { getProvider, providerNames } from './providers/index.ts';
import { createServer, type AuthOptions } from './server.ts';

const SHUTDOWN_TIMEOUT_MS = 5000;

const port = Number(process.env.PORT ?? 8080);

let auth: AuthOptions;
if (process.env.ALLOW_UNAUTHENTICATED === 'true') {
  console.warn('WARNING: ALLOW_UNAUTHENTICATED is on, tokens are not checked');
  auth = { allowUnauthenticated: true };
} else if (process.env.JWT_SECRET) {
  auth = { jwtSecret: process.env.JWT_SECRET };
} else {
  console.error('JWT_SECRET is required unless ALLOW_UNAUTHENTICATED=true');
  process.exit(1);
}

const openStream = getProvider(process.env.PROVIDER);
if (!openStream) {
  console.error(`PROVIDER must be one of: ${providerNames.join(', ')}`);
  process.exit(1);
}

const { server, shutdown } = createServer({ auth, openStream });

server.listen(port, () => {
  console.log(`dicta-server listening on port ${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    void shutdown();
  });
}
