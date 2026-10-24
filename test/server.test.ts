import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createServer } from '../src/server.ts';

const server = createServer();
let base: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `ws://localhost:${port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('sends ready with a session id on connect', async () => {
  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const event = await new Promise<MessageEvent>((resolve) => {
    ws.onmessage = resolve;
  });
  ws.close();

  const message = JSON.parse(event.data);
  assert.equal(message.type, 'ready');
  assert.equal(typeof message.sessionId, 'string');
  assert.notEqual(message.sessionId, '');
});

test('rejects other paths', async () => {
  const ws = new WebSocket(`${base}/other`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error('connection was accepted'));
  });
});
