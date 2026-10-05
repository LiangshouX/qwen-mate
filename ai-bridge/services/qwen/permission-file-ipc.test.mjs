import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SAFETY_NET_MS,
  pollPermissionResponse,
  removePermissionFiles,
  resolvePermissionIpcConfig,
  writePermissionRequest,
} from './permission-file-ipc.js';

function makeTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'perm-ipc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const BASE_ENV = {
  QWEN_MATE_PERMISSION_DIR: '',
  QWEN_MATE_SESSION_ID: 'sess-test',
  QWEN_MATE_PERMISSION_SAFETY_NET_MS: '120000',
};

test('resolvePermissionIpcConfig reads dir, session id and safety net from env', () => {
  const config = resolvePermissionIpcConfig({ ...BASE_ENV, QWEN_MATE_PERMISSION_DIR: 'C:/perm' });
  assert.deepEqual(config, { ok: true, dir: 'C:/perm', sessionId: 'sess-test', safetyNetMs: 120000 });
});

test('resolvePermissionIpcConfig rejects a missing dir or an unsafe session id', () => {
  assert.equal(resolvePermissionIpcConfig({ ...BASE_ENV }).ok, false);
  const traversal = resolvePermissionIpcConfig({
    ...BASE_ENV,
    QWEN_MATE_PERMISSION_DIR: 'C:/perm',
    QWEN_MATE_SESSION_ID: '../evil',
  });
  assert.equal(traversal.ok, false);
  assert.match(traversal.reason, /SESSION_ID/);
});

test('resolvePermissionIpcConfig falls back to the default safety net', () => {
  const config = resolvePermissionIpcConfig({
    QWEN_MATE_PERMISSION_DIR: 'C:/perm',
    QWEN_MATE_SESSION_ID: 'sess-test',
    QWEN_MATE_PERMISSION_SAFETY_NET_MS: 'not-a-number',
  });
  assert.equal(config.ok, true);
  assert.equal(config.safetyNetMs, DEFAULT_SAFETY_NET_MS);
});

test('writePermissionRequest writes the contract file atomically with all fields', (t) => {
  const dir = makeTempDir(t);
  const config = { dir, sessionId: 'sess-test', safetyNetMs: 120000 };

  writePermissionRequest(config, 'perm_1_abc', {
    toolName: 'Bash',
    inputs: { command: 'ls' },
    cwd: 'D:/Code',
  });

  const files = readdirSync(dir);
  assert.deepEqual(files, ['request-sess-test-perm_1_abc.json'], 'no temp file may remain');
  const body = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
  assert.deepEqual(body, {
    requestId: 'perm_1_abc',
    toolName: 'Bash',
    inputs: { command: 'ls' },
    cwd: 'D:/Code',
  });
});

test('writePermissionRequest rejects request ids that would escape the IPC dir', (t) => {
  const dir = makeTempDir(t);
  const config = { dir, sessionId: 'sess-test', safetyNetMs: 120000 };
  assert.throws(() => writePermissionRequest(config, '../escape', { toolName: 'Bash' }), /requestId/);
});

test('pollPermissionResponse delivers an explicit allow and consumes the file', async (t) => {
  const dir = makeTempDir(t);
  const config = { dir, sessionId: 'sess-test', safetyNetMs: 120000 };
  const responseFile = join(dir, 'response-sess-test-perm_2.json');

  const result = new Promise((resolve) => {
    pollPermissionResponse(config, 'perm_2', { onResult: resolve, intervalMs: 10 });
  });
  writeFileSync(responseFile, JSON.stringify({ allow: true }), 'utf8');

  assert.equal(await result, true);
  assert.equal(existsSync(responseFile), false, 'response file must be consumed');
});

test('pollPermissionResponse keeps polling through torn payloads until an explicit boolean', async (t) => {
  const dir = makeTempDir(t);
  const config = { dir, sessionId: 'sess-test', safetyNetMs: 120000 };
  const responseFile = join(dir, 'response-sess-test-perm_3.json');

  let delivered = null;
  const poll = pollPermissionResponse(config, 'perm_3', {
    onResult: (allow) => { delivered = allow; },
    intervalMs: 10,
  });
  t.after(() => poll.stop());

  // Half-written JSON and a non-boolean `allow` must never resolve a request.
  writeFileSync(responseFile, '{"all', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(delivered, null, 'torn JSON must not resolve');

  writeFileSync(responseFile, '{"allow":"true"}', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(delivered, null, 'non-boolean allow must not resolve');

  writeFileSync(responseFile, JSON.stringify({ allow: false }), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(delivered, false, 'explicit false resolves as deny');
});

test('removePermissionFiles deletes request and response files and ignores absence', (t) => {
  const dir = makeTempDir(t);
  const config = { dir, sessionId: 'sess-test', safetyNetMs: 120000 };

  writePermissionRequest(config, 'perm_4', { toolName: 'Bash', inputs: {} });
  writeFileSync(join(dir, 'response-sess-test-perm_4.json'), '{"allow":true}', 'utf8');

  removePermissionFiles(config, 'perm_4');
  assert.deepEqual(readdirSync(dir), []);

  assert.doesNotThrow(() => removePermissionFiles(config, 'perm_4'));
});
