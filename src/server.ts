import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer, type Server } from 'node:http';
import { jwtVerify } from 'jose';
import { WebSocketServer } from 'ws';
import type { OpenStream, ProviderStream } from './providers/provider.ts';

const LISTEN_PATH = '/dicta/v1/listen';
const MAX_FRAME_BYTES = 64 * 1024;
const PROVIDER_ERROR_MESSAGE = 'speech-to-text provider failed';

export type AuthOptions = { jwtSecret: string } | { allowUnauthenticated: true };

export function createServer({ auth, openStream }: { auth: AuthOptions; openStream: OpenStream }): {
  server: Server;
  shutdown: () => Promise<void>;
} {
  const secret = 'jwtSecret' in auth ? new TextEncoder().encode(auth.jwtSecret) : null;
  const server = createHttpServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== LISTEN_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    // The upgrade is accepted before the token check, so the client can read
    // the 4001 close code.
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const sessionId = randomUUID();
      const tag = `[${sessionId}]`;
      // Without a listener, a protocol error (for example a too large frame)
      // would crash the process. ws closes the connection itself.
      ws.on('error', (err) => console.warn(`${tag} connection error: ${err.message}`));
      if (secret && !(await isValidToken(url.searchParams.get('token'), secret))) {
        ws.close(4001);
        return;
      }
      if (ws.readyState !== ws.OPEN) {
        return;
      }

      // Details stay in the log; the client gets a generic message.
      const fail = (err: unknown) => {
        console.error(`${tag} provider error: ${err instanceof Error ? err.message : String(err)}`);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: PROVIDER_ERROR_MESSAGE }));
          ws.close(1011);
        }
      };

      let stream: ProviderStream;
      try {
        stream = await openStream({
          onTranscript: (transcript) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'transcript', ...transcript }));
            }
          },
          onError: fail,
        });
      } catch (err) {
        fail(err);
        return;
      }
      if (ws.readyState !== ws.OPEN) {
        stream.close();
        return;
      }
      ws.on('close', () => stream.close());
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          return;
        }
        try {
          stream.sendAudio(data as Buffer);
        } catch (err) {
          fail(err);
        }
      });
      ws.send(JSON.stringify({ type: 'ready', sessionId }));
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
