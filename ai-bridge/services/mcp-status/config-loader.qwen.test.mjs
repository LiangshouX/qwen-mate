import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect HOME to a temp dir BEFORE the first call to getRealHomeDir().
// path-utils caches the resolved home on first invocation, so we lock in the
// override here and share the same temp HOME across all tests in this file.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHomeRaw = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-mate-qwen-mcp-'));
const tempHome = fs.realpathSync(tempHomeRaw);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { loadMcpServersConfigAsRecord, loadMcpServersConfig, loadAllMcpServersInfo } =
  await import('./config-loader.js');

const qwenSettingsPath = path.join(tempHome, '.qwen', 'settings.json');

function writeQwenSettings(obj) {
  fs.mkdirSync(path.dirname(qwenSettingsPath), { recursive: true });
  fs.writeFileSync(qwenSettingsPath, JSON.stringify(obj));
}

function clearAll() {
  try { fs.unlinkSync(qwenSettingsPath); } catch { /* not present */ }
}

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

test('reads mcpServers from ~/.qwen/settings.json', async () => {
  clearAll();
  writeQwenSettings({
    env: { UNRELATED: 'keep-me' },
    mcpServers: {
      idea: { type: 'stdio', command: 'java', args: ['-version'] },
      web: { type: 'http', url: 'http://localhost:3000' }
    }
  });

  const result = await loadMcpServersConfigAsRecord();
  assert.ok(result, 'expected a non-null record');
  assert.deepEqual(Object.keys(result).sort(), ['idea', 'web']);
  assert.deepEqual(result.idea, { type: 'stdio', command: 'java', args: ['-version'] });
});

test('mcp.excluded disables servers (qwen toggle semantics)', async () => {
  clearAll();
  writeQwenSettings({
    mcpServers: {
      on: { command: 'node', args: ['a.js'] },
      off: { command: 'node', args: ['b.js'] }
    },
    mcp: { excluded: ['off'] }
  });

  const result = await loadMcpServersConfigAsRecord();
  assert.ok(result, 'expected a non-null record');
  assert.deepEqual(Object.keys(result), ['on']);
});

test('mcp.excluded supports wildcard patterns', async () => {
  clearAll();
  writeQwenSettings({
    mcpServers: {
      'team-a': { command: 'node' },
      'team-b': { command: 'node' },
      other: { command: 'node' }
    },
    mcp: { excluded: ['team-*'] }
  });

  const result = await loadMcpServersConfigAsRecord();
  assert.ok(result, 'expected a non-null record');
  assert.deepEqual(Object.keys(result), ['other']);
});

test('legacy disabledMcpServers is still honored in qwen settings', async () => {
  clearAll();
  writeQwenSettings({
    mcpServers: {
      on: { command: 'node' },
      off: { command: 'node' }
    },
    disabledMcpServers: ['off']
  });

  const result = await loadMcpServersConfigAsRecord();
  assert.ok(result, 'expected a non-null record');
  assert.deepEqual(Object.keys(result), ['on']);
});

test('no legacy fallback: corrupt qwen settings degrade to empty', async () => {
  clearAll();
  fs.mkdirSync(path.dirname(qwenSettingsPath), { recursive: true });
  fs.writeFileSync(qwenSettingsPath, '{ this is not valid json');

  assert.equal(await loadMcpServersConfigAsRecord(), null);
  const list = await loadMcpServersConfig();
  assert.equal(list.length, 0);
});

test('no legacy fallback: wrong-shape mcpServers degrades to empty', async () => {
  clearAll();
  writeQwenSettings({ mcpServers: ['not', 'an', 'object'] });

  assert.equal(await loadMcpServersConfigAsRecord(), null);
});

test('degrades to empty when no config source exists', async () => {
  clearAll();
  assert.equal(await loadMcpServersConfigAsRecord(), null);
  const list = await loadMcpServersConfig();
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 0);
});

test('project .qwen/settings.json overrides user entries with the same name', async () => {
  clearAll();
  writeQwenSettings({
    mcpServers: {
      shared: { command: 'user-version' },
      userOnly: { command: 'user-only' }
    }
  });

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-mate-qwen-proj-'));
  try {
    fs.mkdirSync(path.join(projectDir, '.qwen'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.qwen', 'settings.json'), JSON.stringify({
      mcpServers: {
        shared: { command: 'project-version' },
        projectOnly: { command: 'project-only' }
      },
      mcp: { excluded: ['userOnly'] }
    }));

    const result = await loadMcpServersConfigAsRecord(projectDir);
    assert.ok(result, 'expected a non-null record');
    assert.deepEqual(Object.keys(result).sort(), ['projectOnly', 'shared']);
    assert.equal(result.shared.command, 'project-version');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('loadAllMcpServersInfo reports disabled and invalid qwen servers', async () => {
  clearAll();
  writeQwenSettings({
    mcpServers: {
      good: { command: 'node' },
      off: { command: 'node' },
      broken: { foo: 'bar' }
    },
    mcp: { excluded: ['off'] }
  });

  const info = await loadAllMcpServersInfo();
  assert.deepEqual(info.enabled.map(s => s.name), ['good']);
  assert.deepEqual(info.disabled, ['off']);
  assert.deepEqual(info.invalid.map(s => s.name), ['broken']);
});

test('expands ${VAR} from qwen settings env blocks', async () => {
  clearAll();
  writeQwenSettings({
    env: { QWEN_TEST_TOKEN: 'token-123' },
    mcpServers: {
      withEnv: { command: 'node', env: { TOKEN: '${QWEN_TEST_TOKEN}' } }
    }
  });

  const result = await loadMcpServersConfigAsRecord();
  assert.ok(result, 'expected a non-null record');
  assert.equal(result.withEnv.env.TOKEN, 'token-123');
});
