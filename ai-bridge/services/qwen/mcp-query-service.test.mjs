import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect HOME to a temp dir BEFORE importing modules that resolve
// ~/.qwen/settings.json through the cached home-dir helper.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHomeRaw = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-mate-qwen-chan-'));
const tempHome = fs.realpathSync(tempHomeRaw);
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { handleQwenCommand, getQwenCommandList } = await import('../../channels/qwen-channel.js');
const { MCP_STATUS_MARKER, MCP_TOOLS_MARKER } = await import('./mcp-query-service.js');

const qwenSettingsPath = path.join(tempHome, '.qwen', 'settings.json');

function writeQwenSettings(obj) {
  fs.mkdirSync(path.dirname(qwenSettingsPath), { recursive: true });
  fs.writeFileSync(qwenSettingsPath, JSON.stringify(obj));
}

/** Capture console.log output lines while fn runs. */
async function captureConsoleLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

function markerPayload(lines, marker) {
  const line = lines.find(l => l.startsWith(marker));
  assert.ok(line, `expected output line starting with ${marker}, got: ${JSON.stringify(lines)}`);
  return JSON.parse(line.slice(marker.length));
}

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

test('getQwenCommandList exposes the MCP panel commands', () => {
  const commands = getQwenCommandList();
  assert.ok(commands.includes('getMcpServerStatus'));
  assert.ok(commands.includes('getMcpServerTools'));
});

test('getMcpServerStatus emits a [MCP_SERVER_STATUS] marker with a JSON array', async () => {
  // Disabled + invalid servers only: both are reported without spawning/probing
  // any MCP server process.
  writeQwenSettings({
    mcpServers: {
      off: { command: 'node', args: ['s.js'] },
      broken: { foo: 'bar' }
    },
    mcp: { excluded: ['off'] }
  });

  const lines = await captureConsoleLog(async () => {
    await handleQwenCommand('getMcpServerStatus', [], { cwd: null });
  });

  const status = markerPayload(lines, MCP_STATUS_MARKER);
  assert.ok(Array.isArray(status), 'marker payload must be a JSON array');
  const byName = Object.fromEntries(status.map(s => [s.name, s]));
  assert.equal(byName.off.status, 'failed');
  assert.equal(byName.broken.status, 'failed');
  assert.match(byName.broken.error, /Invalid config/);

  // A plain JSON envelope is emitted alongside the marker line.
  const envelope = lines
    .filter(l => l.trim().startsWith('{'))
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .find(o => o && Array.isArray(o.status));
  assert.ok(envelope, 'expected a plain JSON envelope with a status array');
  assert.equal(envelope.status.length, status.length);
});

test('getMcpServerStatus degrades to an empty list when config is corrupt', async () => {
  fs.mkdirSync(path.dirname(qwenSettingsPath), { recursive: true });
  fs.writeFileSync(qwenSettingsPath, '{ not json');

  const lines = await captureConsoleLog(async () => {
    await handleQwenCommand('getMcpServerStatus', [], { cwd: null });
  });

  const status = markerPayload(lines, MCP_STATUS_MARKER);
  assert.deepEqual(status, []);
});

test('getMcpServerTools reports an error payload for an unknown server', async () => {
  writeQwenSettings({ mcpServers: {} });

  const lines = await captureConsoleLog(async () => {
    await handleQwenCommand('getMcpServerTools', [], { serverId: 'no-such-server', cwd: null });
  });

  const payload = markerPayload(lines, MCP_TOOLS_MARKER);
  assert.equal(payload.success, false);
  assert.equal(payload.serverId, 'no-such-server');
  assert.ok(payload.error, 'expected an error message');
  assert.deepEqual(payload.tools, []);
});

test('unknown qwen command emits a structured error instead of throwing', async () => {
  const lines = await captureConsoleLog(async () => {
    await handleQwenCommand('definitelyNotACommand', [], {});
  });

  const payload = JSON.parse(lines.find(l => l.trim().startsWith('{')));
  assert.equal(payload.success, false);
  assert.match(payload.error, /Unknown qwen command/);
});
