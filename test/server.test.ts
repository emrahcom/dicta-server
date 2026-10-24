import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import type { OpenStream, Transcript } from '../src/providers/provider.ts';
import { openStubStream } from '../src/providers/stub.ts';
import { createServer, type AuthOptions } from '../src/server.ts';

const SECRET = 'test-secret';

async function start(
  options: { auth?: AuthOptions; openStream?: OpenStream } = {},
): Promise<{ base: string; shutdown: () => Promise<void> }> {
  const { server, shutdown } = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    openStream: options.openStream ?? openStubStream,
  });
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
  const { base, shutdown } = await start({ auth: { allowUnauthenticated: true } });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, 'ready');
});

// A provider that records what it receives and lets the test report
// transcripts and decide when the stream is open.
function fakeProvider() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  const fake = {
    chunks: [] as Buffer[],
    closed: false,
    report: (_transcript: Transcript) => {},
    open,
    openStream: (async (onTranscript) => {
      fake.report = onTranscript;
      await opened;
      return {
        sendAudio: (chunk) => fake.chunks.push(chunk),
        close: () => (fake.closed = true),
      };
    }) as OpenStream,
  };
  return fake;
}

test('sends ready only after the provider stream is open', async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  let ready = false;
  ws.onmessage = () => (ready = true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ready, false);

  fake.open();
  await nextMessage(ws);
});

test('forwards audio to the provider and transcripts to the client', async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;

  ws.send(new Uint8Array([1, 2, 3]));
  const transcript = nextMessage(ws);
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.report({ text: 'hello', final: true });

  assert.deepEqual([...Buffer.concat(fake.chunks)], [1, 2, 3]);
  assert.deepEqual(JSON.parse((await transcript).data), {
    type: 'transcript',
    text: 'hello',
    final: true,
  });
});

test('closes the provider stream when the connection closes', async (t) => {
  const fake = fakeProvider();
  const { base, shutdown } = await start({ openStream: fake.openStream });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen?token=${await sign()}`);
  const ready = nextMessage(ws);
  fake.open();
  await ready;

  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(fake.closed, true);
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
