import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANAGED_MEMORY_FILE_NAME,
  MANAGED_MEMORY_OVERRIDES_FILE_NAME,
  managedMemoryQueryEnv,
} from './managed-memory-env.js';

function makeTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'managed-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeToggle(dir, value) {
  writeFileSync(
    join(dir, MANAGED_MEMORY_FILE_NAME),
    JSON.stringify({ managedMemoryEnabled: value }),
    'utf8'
  );
}

test('missing projection reads as OFF: injects the memory-off overrides', (t) => {
  const dir = makeTempDir(t);

  const env = managedMemoryQueryEnv(dir);

  assert.deepEqual(env, {
    QWEN_CODE_SYSTEM_DEFAULTS_PATH: join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME),
  });
  const overrides = JSON.parse(readFileSync(join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME), 'utf8'));
  assert.deepEqual(overrides, {
    memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false },
  });
});

test('toggle OFF injects; toggle ON injects nothing (follow CLI config)', (t) => {
  const dir = makeTempDir(t);

  writeToggle(dir, false);
  assert.ok(managedMemoryQueryEnv(dir), 'OFF must inject');

  writeToggle(dir, true);
  assert.equal(managedMemoryQueryEnv(dir), undefined, 'ON must not inject');
});

test('projection change is picked up without restart (mtime cache)', (t) => {
  const dir = makeTempDir(t);

  writeToggle(dir, false);
  assert.ok(managedMemoryQueryEnv(dir));

  writeToggle(dir, true);
  assert.equal(managedMemoryQueryEnv(dir), undefined);

  writeToggle(dir, false);
  assert.ok(managedMemoryQueryEnv(dir));
});

test('corrupt projection reads as OFF', (t) => {
  const dir = makeTempDir(t);
  writeFileSync(join(dir, MANAGED_MEMORY_FILE_NAME), '{"managedMemoryEnabled": tru', 'utf8');

  assert.ok(managedMemoryQueryEnv(dir));
});

test('corrupt overrides are rewritten to the memory-off fragment', (t) => {
  const dir = makeTempDir(t);
  writeToggle(dir, false);
  writeFileSync(join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME), 'not json', 'utf8');

  managedMemoryQueryEnv(dir);

  const overrides = JSON.parse(readFileSync(join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME), 'utf8'));
  assert.deepEqual(overrides, {
    memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false },
  });
});

test('repeated calls with stable state do not rewrite the overrides file', (t) => {
  const dir = makeTempDir(t);
  writeToggle(dir, false);

  managedMemoryQueryEnv(dir);
  const overridesPath = join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME);
  const first = readFileSync(overridesPath, 'utf8');
  const mtimeMs = statSync(overridesPath).mtimeMs;

  managedMemoryQueryEnv(dir);
  assert.equal(readFileSync(overridesPath, 'utf8'), first);
  assert.equal(statSync(overridesPath).mtimeMs, mtimeMs);
});
