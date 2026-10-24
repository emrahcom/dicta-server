import { createServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);

createServer().listen(port, () => {
  console.log(`dicta-server listening on port ${port}`);
});
