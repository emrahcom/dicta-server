import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer } from '../src/server.ts';

async function start(): Promise<{ base: string; shutdown: () => Promise<void> }> {
  const { server, shutdown } = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `ws://localhost:${port}`, shutdown };
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.onmessage = resolve;
  });
}

test('sends ready with a session id on connect', async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const message = JSON.parse((await nextMessage(ws)).data);

  assert.equal(message.type, 'ready');
  assert.equal(typeof message.sessionId, 'string');
  assert.notEqual(message.sessionId, '');
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

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
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

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => resolve();
    ws.onopen = () => reject(new Error('connection was accepted'));
  });
});
