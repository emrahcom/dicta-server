import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer, type Server } from 'node:http';
import { jwtVerify } from 'jose';
import { WebSocketServer } from 'ws';

const LISTEN_PATH = '/dicta/v1/listen';

export type AuthOptions = { jwtSecret: string } | { allowUnauthenticated: true };

export function createServer(auth: AuthOptions): {
  server: Server;
  shutdown: () => Promise<void>;
} {
  const secret = 'jwtSecret' in auth ? new TextEncoder().encode(auth.jwtSecret) : null;
  const server = createHttpServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== LISTEN_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    // The upgrade is accepted before the token check, so the client can read
    // the 4001 close code.
    wss.handleUpgrade(req, socket, head, async (ws) => {
      if (secret && !(await isValidToken(url.searchParams.get('token'), secret))) {
        ws.close(4001);
        return;
      }
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      ws.send(JSON.stringify({ type: 'ready', sessionId: randomUUID() }));
    });
  });

  // Stops accepting connections, closes the open ones with 1001 and resolves
  // when all of them are closed.
  async function shutdown(): Promise<void> {
    server.close();
    const closed = [...wss.clients].map((ws) => once(ws, 'close'));
    for (const ws of wss.clients) {
      ws.close(1001);
    }
    await Promise.all(closed);
  }

  return { server, shutdown };
}

async function isValidToken(token: string | null, secret: Uint8Array): Promise<boolean> {
  if (!token) {
    return false;
  }
  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'], requiredClaims: ['exp'] });
    return true;
  } catch {
    return false;
  }
}
