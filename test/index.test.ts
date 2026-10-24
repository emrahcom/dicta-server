import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

function startIndex(env: Record<string, string>) {
  const { JWT_SECRET, ALLOW_UNAUTHENTICATED, ...rest } = process.env;
  return spawn('node', ['src/index.ts'], { env: { ...rest, PORT: '0', ...env } });
}

test('exits at startup without JWT_SECRET', async () => {
  const child = startIndex({});
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));

  const [code] = await once(child, 'exit');

  assert.equal(code, 1);
  assert.match(stderr, /JWT_SECRET is required/);
});

test('warns at startup when unauthenticated is allowed', async () => {
  const child = startIndex({ ALLOW_UNAUTHENTICATED: 'true' });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));

  await once(child.stdout, 'data');
  child.kill('SIGTERM');
  await once(child, 'exit');

  assert.match(stderr, /ALLOW_UNAUTHENTICATED is on/);
});
