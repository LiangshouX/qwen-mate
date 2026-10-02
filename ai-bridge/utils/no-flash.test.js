import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './no-flash.cjs';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');
const isWin = process.platform === 'win32';

test('no-flash marks child_process as patched on win32', () => {
  if (!isWin) return;
  assert.equal(cp.__qwenMateNoFlash, true);
});

test('no-flash forces windowsHide and neutralizes detached', () => {
  if (!isWin) return;
  const opts = { detached: true, stdio: 'ignore' };
  const child = cp.spawn(process.execPath, ['-e', ''], opts);
  try {
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.detached, false);
  } finally {
    child.on('error', () => {});
  }
});

test('spawnSync still executes through the guard', () => {
  const opts = {};
  const result = cp.spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
    ...opts,
    encoding: 'utf8',
  });
  assert.equal(result.status, 7);
  if (isWin) {
    assert.equal(opts.windowsHide, undefined); // spread copy is not patched
    assert.match(process.env.NODE_OPTIONS || '', /no-flash\.cjs/);
  }
});

test('guard leaves POSIX spawn options untouched', () => {
  if (isWin) return;
  assert.equal(cp.__qwenMateNoFlash, undefined);
  const opts = { detached: true, stdio: 'ignore' };
  const child = cp.spawn(process.execPath, ['-e', ''], opts);
  try {
    assert.equal(opts.detached, true);
  } finally {
    child.on('error', () => {});
  }
});
