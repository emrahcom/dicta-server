import { createServer } from './server.ts';

const SHUTDOWN_TIMEOUT_MS = 5000;

const port = Number(process.env.PORT ?? 8080);
const { server, shutdown } = createServer();

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
