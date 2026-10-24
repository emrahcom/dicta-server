import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';

const LISTEN_PATH = '/dicta/v1/listen';

export function createServer(): Server {
  const server = createHttpServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname !== LISTEN_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'ready', sessionId: randomUUID() }));
    });
  });

  return server;
}
