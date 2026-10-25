import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { errors, jwtVerify } from "jose";
import { WebSocketServer, type WebSocket } from "ws";
import { quoteForLog } from "./logging.ts";
import { parseMessage } from "./providers/messages.ts";
import type { OpenStream, ProviderStream } from "./providers/provider.ts";

const LISTEN_PATH = "/dicta/v1/listen";
// The WebSocket protocol name; the JWT follows it in Sec-WebSocket-Protocol.
const PROTOCOL = "dicta";
const MAX_FRAME_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PROVIDER_ERROR_MESSAGE = "speech-to-text provider failed";
// A BCP 47 tag: a language code of 2 or 3 letters, then optional subtags.
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

export type AuthOptions =
  { jwtSecret: string } | { allowUnauthenticated: true };

export function createServer({
  auth,
  openStream,
}: {
  auth: AuthOptions;
  openStream: OpenStream;
}): {
  server: Server;
  shutdown: () => Promise<void>;
} {
  const secret =
    "jwtSecret" in auth ? new TextEncoder().encode(auth.jwtSecret) : null;
  const server = createHttpServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    // A browser fails the connection unless the server answers with a protocol
    // it offered.
    handleProtocols: (protocols) =>
      protocols.has(PROTOCOL) ? PROTOCOL : false,
  });

  // A connection that did not answer the previous ping is terminated, which
  // also closes its provider stream.
  const answered = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!answered.has(ws)) {
        ws.terminate();
        continue;
      }
      answered.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  server.on("upgrade", (req, socket, head) => {
    // Node gives an upgrade socket no error listener, so an error on it, such
    // as a reset by the client, would crash the process.
    const onSocketError = () => socket.destroy();
    socket.on("error", onSocketError);

    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      refuse(socket, "400 Bad Request");
      return;
    }
    if (url.pathname !== LISTEN_PATH) {
      refuse(socket, "404 Not Found");
      return;
    }
    // The upgrade is accepted before the token check, so the client can read
    // the 4001 close code.
    wss.handleUpgrade(req, socket, head, (ws) => {
      // From here on, ws handles errors on the socket.
      socket.removeListener("error", onSocketError);
      const sessionId = randomUUID();
      const tag = `[${sessionId}]`;
      // Without a listener, a protocol error (for example a too large frame)
      // would crash the process. ws closes the connection itself.
      ws.on("error", (err) =>
        console.warn(`${tag} connection error: ${err.message}`),
      );
      answered.add(ws);
      ws.on("pong", () => answered.add(ws));
      const unexpected = (err: unknown) => {
        console.error(`${tag} unexpected error: ${errorMessage(err)}`);
        if (ws.readyState === ws.OPEN) {
          ws.close(1011);
        }
      };
      // ws ignores the callback's return value, so an error left in this
      // promise would crash the process.
      const token = tokenFromProtocols(req.headers["sec-websocket-protocol"]);
      handleConnection(ws, url, token, sessionId, unexpected).catch(unexpected);
    });
  });

  async function handleConnection(
    ws: WebSocket,
    url: URL,
    token: string | null,
    sessionId: string,
    unexpected: (err: unknown) => void,
  ): Promise<void> {
    const tag = `[${sessionId}]`;
    // An error thrown in an event handler or callback would escape to the
    // event loop and crash the process. This keeps it in the connection.
    const guard =
      <A extends unknown[]>(handler: (...args: A) => void) =>
      (...args: A) => {
        try {
          handler(...args);
        } catch (err) {
          unexpected(err);
        }
      };

    let sub: string | undefined;
    if (secret) {
      const check = await checkToken(token, secret);
      if (!check.ok) {
        console.warn(`${tag} token rejected: ${check.reason}`);
        ws.close(4001);
        return;
      }
      sub = check.sub;
    }
    if (ws.readyState !== ws.OPEN) {
      return;
    }
    console.log(
      `${tag} connected${sub === undefined ? "" : ` sub=${quoteForLog(sub)}`}`,
    );

    let lang = url.searchParams.get("lang") ?? undefined;
    if (lang !== undefined && !LANG_TAG.test(lang)) {
      console.warn(`${tag} invalid lang ${quoteForLog(lang)}`);
      lang = undefined;
    }

    // Details stay in the log; the client gets a generic message.
    const fail = (err: unknown) => {
      console.error(`${tag} provider error: ${errorMessage(err)}`);
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({ type: "error", message: PROVIDER_ERROR_MESSAGE }),
        );
        ws.close(1011);
      }
    };

    let stream: ProviderStream;
    try {
      stream = await openStream(
        {
          onTranscript: guard((transcript) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "transcript", ...transcript }));
            }
          }),
          onError: guard(fail),
          onWarning: guard((warning) =>
            console.warn(`${tag} provider: ${warning}`),
          ),
        },
        { lang },
      );
    } catch (err) {
      fail(err);
      return;
    }
    if (ws.readyState !== ws.OPEN) {
      stream.close();
      return;
    }
    ws.on(
      "close",
      guard(() => stream.close()),
    );
    ws.on(
      "message",
      guard((data, isBinary) => {
        try {
          if (isBinary) {
            stream.sendAudio(data as Buffer);
          } else if (isEndMessage(data as Buffer)) {
            stream.finish();
          }
        } catch (err) {
          fail(err);
        }
      }),
    );
    ws.send(JSON.stringify({ type: "ready", sessionId }));
  }

  // Stops accepting connections, closes the open ones with 1001 and resolves
  // when all of them are closed.
  async function shutdown(): Promise<void> {
    clearInterval(heartbeat);
    server.close();
    // Not events.once(): it rejects on an error event, which can come before
    // close.
    const closed = [...wss.clients].map(
      (ws) => new Promise((resolve) => ws.once("close", resolve)),
    );
    for (const ws of wss.clients) {
      ws.close(1001);
    }
    await Promise.all(closed);
  }

  return { server, shutdown };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A text frame {"type":"end"} from the client. Other text frames are ignored.
function isEndMessage(raw: Buffer): boolean {
  return parseMessage<{ type?: unknown }>(raw)?.type === "end";
}

// The JWT is the entry after "dicta" in the Sec-WebSocket-Protocol header.
function tokenFromProtocols(header: string | undefined): string | null {
  const entries = header?.split(",").map((entry) => entry.trim()) ?? [];
  const index = entries.indexOf(PROTOCOL);
  return index === -1 ? null : (entries[index + 1] ?? null);
}

type TokenCheck = { ok: true; sub?: string } | { ok: false; reason: string };

async function checkToken(
  token: string | null,
  secret: Uint8Array,
): Promise<TokenCheck> {
  if (!token) {
    return { ok: false, reason: "missing" };
  }
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
    });
    // jose does not check the type of sub; only a string is logged.
    return {
      ok: true,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  } catch (err) {
    return { ok: false, reason: rejectionReason(err) };
  }
}

// Only fixed strings: nothing from an unverified token reaches the log.
function rejectionReason(err: unknown): string {
  if (err instanceof errors.JWTExpired) {
    return "expired";
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    return "invalid signature";
  }
  if (
    err instanceof errors.JWTClaimValidationFailed &&
    err.claim === "exp" &&
    err.reason === "missing"
  ) {
    return "missing exp";
  }
  return "invalid";
}

// Answers an upgrade request with an HTTP status and closes the socket. A plain
// end() would leave it half open while the client keeps its side open.
function refuse(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\n\r\n`, () => socket.destroy());
}
