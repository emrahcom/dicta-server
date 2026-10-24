import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('logs a start line', async () => {
  const { stdout } = await run('node', ['src/index.ts']);
  assert.equal(stdout, 'dicta-server started\n');
});
