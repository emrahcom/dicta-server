import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { createServer, type AuthOptions } from '../src/server.ts';

const SECRET = 'test-secret';
const AUTH: AuthOptions = { jwtSecret: SECRET };

async function start(
  auth: AuthOptions = AUTH,
): Promise<{ base: string; shutdown: () => Promise<void> }> {
  const { server, shutdown } = createServer(auth);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `ws://localhost:${port}`, shutdown };
}

function sign(options: { secret?: string; exp?: string | number | null } = {}): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: 'HS256' });
  const exp = options.exp === undefined ? '1h' : options.exp;
  if (exp !== null) {
    jwt.setExpirationTime(exp);
  }
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.onmessage = resolve;
  });
}

// Resolves with the close code, and fails if a message arrives first.
function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.onclose = (event) => resolve(event.code);
    ws.onmessage = (event) => reject(new Error(`unexpected message: ${event.data}`));
  });
}

test('sends ready with a session id for a valid token', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, 'ready');
  assert.equal(typeof message.sessionId, 'string');
  assert.notEqual(message.sessionId, '');
});

test('closes with 4001 when the token is missing', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  assert.equal(await closeCode(ws), 4001);
});

test('closes with 4001 when the token is signed with another secret', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign({ secret: 'other' })}`);
  assert.equal(await closeCode(ws), 4001);
});

test('closes with 4001 when the token is expired', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const exp = Math.floor(Date.now() / 1000) - 60;
  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign({ exp })}`);
  assert.equal(await closeCode(ws), 4001);
});

test('closes with 4001 when the token has no exp', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign({ exp: null })}`);
  assert.equal(await closeCode(ws), 4001);
});

test('sends ready without a token when unauthenticated is allowed', async (t) => {
  const { base, shutdown } = await start({ allowUnauthenticated: true });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, 'ready');
});

test('accepts a 64 KiB frame', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  let closed = false;
  ws.onclose = () => (closed = true);
  ws.send(new Uint8Array(64 * 1024));
  // The server does not answer audio, so wait briefly for a close that should
  // not come.
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(closed, false);
});

test('closes with 1009 when a frame is larger than 64 KiB', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.onclose = resolve;
  });
  ws.send(new Uint8Array(64 * 1024 + 1));

  assert.equal((await closed).code, 1009);
});

test('rejects other paths', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/other`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error('connection was accepted'));
  });
});

test('shutdown closes open connections with 1001', async () => {
  const { base, shutdown } = await start();

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await nextMessage(ws);
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.onclose = resolve;
  });
  await shutdown();

  assert.equal((await closed).code, 1001);
});

test('shutdown stops accepting connections', async () => {
  const { base, shutdown } = await start();
  await shutdown();

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error('connection was accepted'));
  });
});
