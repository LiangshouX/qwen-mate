/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for settings-writer-service.cjs — the feature's three bottom lines:
 *  1. parity: preset installs produce the CLI's exact file layout (env key,
 *     bucket entries, selection, providerMetadata version hash);
 *  2. integrity: invalid operations never touch the file, valid ones keep
 *     JSONC comments/formatting, deletions cascade like the CLI's serve API;
 *  3. secrets: snapshots never contain API key values (write-only keys).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const service = require('./settings-writer-service.cjs');
const { parseJsoncObject } = require('./settings-jsonc.cjs');

let tmpDir;
let settingsPath;

const writeSettings = (content) => fs.writeFileSync(settingsPath, content, 'utf8');
const readRaw = () => fs.readFileSync(settingsPath, 'utf8');
const readJson = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const op = (payload) => service.runProviderConfigOp(settingsPath, '', JSON.stringify(payload));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwm-settings-test-'));
  settingsPath = path.join(tmpDir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DEEPSEEK_INSTALL = {
  op: 'saveProvider',
  mode: 'preset',
  presetId: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test-1234567890',
  modelIds: ['deepseek-v4-pro', 'deepseek-flash'],
};

describe('snapshot', () => {
  test('handles missing file and exposes the preset provider catalog', () => {
    const result = op({ op: 'snapshot' });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.settingsExists, false);
    assert.equal(result.snapshot.catalog.length, 14);
    assert.equal(result.snapshot.providers.length, 14);
    const deepseek = result.snapshot.catalog.find((p) => p.id === 'deepseek');
    assert.equal(deepseek.envKey, 'DEEPSEEK_API_KEY');
    assert.deepEqual(deepseek.steps, ['apiKey', 'models']);
    const custom = result.snapshot.catalog.find((p) => p.id === 'custom-openai-compatible');
    assert.deepEqual(custom.steps, ['protocol', 'wireApi', 'baseUrl', 'apiKey', 'models', 'advancedConfig']);
  });

  test('never emits API key values - status only', () => {
    writeSettings(
      JSON.stringify({
        env: { DEEPSEEK_API_KEY: 'sk-super-secret-value', OTHER_KEY: '${MY_VAR}' },
        modelProviders: {
          openai: [{ id: 'm1', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' }],
        },
      }),
    );
    const result = op({ op: 'snapshot' });
    assert.equal(result.ok, true);
    const text = JSON.stringify(result.snapshot);
    assert.ok(!text.includes('sk-super-secret-value'), 'snapshot must not contain key values');
    assert.ok(!text.includes('${MY_VAR}'), 'snapshot must not contain placeholder values');
    assert.equal(result.snapshot.env.DEEPSEEK_API_KEY?.status, 'set');
    assert.equal(result.snapshot.env.DEEPSEEK_API_KEY?.source, 'settings');
    assert.equal(result.snapshot.env.OTHER_KEY?.status, 'placeholder');
    assert.equal(result.snapshot.env.CUSTOM_UNKNOWN?.status, undefined);
  });

  test('reports process-env keys as status process', () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'from-shell';
    try {
      // Key referenced by a model entry but absent from settings.env → shell wins.
      writeSettings(
        JSON.stringify({
          modelProviders: { openai: [{ id: 'm1', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' }] },
        }),
      );
      const result = op({ op: 'snapshot' });
      assert.equal(result.snapshot.env.DEEPSEEK_API_KEY?.status, 'process');
      // An (empty) settings.env entry reports unset regardless of the shell.
      writeSettings(JSON.stringify({ env: { DEEPSEEK_API_KEY: '' } }));
      const result2 = op({ op: 'snapshot' });
      assert.equal(result2.snapshot.env.DEEPSEEK_API_KEY?.status, 'unset');
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = saved;
    }
  });

  test('reports parse errors instead of throwing', () => {
    writeSettings('{ broken json');
    const result = op({ op: 'snapshot' });
    assert.equal(result.ok, true);
    assert.ok(result.snapshot.parseError);
  });
});

describe('preset provider install (parity)', () => {
  test('writes env key, bucket entries, selection and providerMetadata version', () => {
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, true, JSON.stringify(result));

    const settings = readJson();
    assert.equal(settings.env.DEEPSEEK_API_KEY, 'sk-test-1234567890');
    assert.equal(settings.security.auth.selectedType, 'openai');
    assert.equal(settings.model.name, 'deepseek-v4-pro');
    assert.equal(settings.model.baseUrl, '');

    const bucket = settings.modelProviders.openai;
    assert.equal(bucket.length, 2);
    assert.deepEqual(
      bucket.map((m) => m.id),
      ['deepseek-v4-pro', 'deepseek-flash'],
    );
    assert.equal(bucket[0].name, '[DeepSeek] deepseek-v4-pro');
    assert.equal(bucket[0].envKey, 'DEEPSEEK_API_KEY');
    assert.equal(bucket[0].baseUrl, 'https://api.deepseek.com');
    assert.equal(bucket[0].generationConfig.contextWindowSize, 1_000_000);
    assert.equal(bucket[1].generationConfig.contextWindowSize, 1_000_000);

    const expectedVersion = createHash('sha256').update(JSON.stringify(bucket)).digest('hex');
    assert.equal(settings.providerMetadata.deepseek.version, expectedVersion);
    assert.equal(settings.providerMetadata.deepseek.baseUrl, 'https://api.deepseek.com');

    const provider = result.snapshot.providers.find((p) => p.id === 'deepseek');
    assert.equal(provider.configured, true);
    assert.equal(provider.modelCount, 2);
    assert.equal(provider.keyStatus, 'set');
  });

  test('re-install replaces owned models but keeps unrelated entries', () => {
    writeSettings(
      JSON.stringify({
        env: { OTHER_API_KEY: 'keep-me' },
        modelProviders: {
          openai: [
            { id: 'gpt-x', name: 'GPT-X', envKey: 'OTHER_API_KEY', baseUrl: 'https://other.example/v1' },
            { id: 'deepseek-v3.2', name: '[DeepSeek] deepseek-v3.2', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
          ],
        },
        model: { name: 'gpt-x', baseUrl: '' },
        security: { auth: { selectedType: 'openai' } },
      }),
    );
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, true, JSON.stringify(result));

    const settings = readJson();
    const ids = settings.modelProviders.openai.map((m) => m.id);
    assert.deepEqual(ids, ['deepseek-v4-pro', 'deepseek-flash', 'gpt-x']);
    // gpt-x is not offered by the plan → selection adopts the plan's first model.
    assert.equal(settings.model.name, 'deepseek-v4-pro');
    assert.equal(settings.env.OTHER_API_KEY, 'keep-me');
  });

  test('keeps the current model when the plan still offers it', () => {
    writeSettings(
      JSON.stringify({
        modelProviders: {
          openai: [{ id: 'deepseek-v4-flash', name: '[DeepSeek] deepseek-v4-flash', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' }],
        },
        model: { name: 'deepseek-v4-flash', baseUrl: '' },
        security: { auth: { selectedType: 'openai' } },
      }),
    );
    const result = op({ ...DEEPSEEK_INSTALL, modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readJson().model.name, 'deepseek-v4-flash');
  });

  test('refuses a Coding Plan key without the sk-sp- prefix', () => {
    const result = op({
      op: 'saveProvider',
      mode: 'preset',
      presetId: 'coding-plan',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      apiKey: 'sk-invalid-key',
      modelIds: ['qwen3-coder-plus'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_api_key');
    assert.ok(!fs.existsSync(settingsPath), 'no file must be written on failure');
  });

  test('refuses an endpoint outside the preset list', () => {
    const result = op({ ...DEEPSEEK_INSTALL, baseUrl: 'https://evil.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');
    assert.ok(!fs.existsSync(settingsPath));
  });

  test('refuses creating without a key when none is stored', () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const result = op({ ...DEEPSEEK_INSTALL, apiKey: undefined });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'api_key_required');
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
    }
  });

  test('role guard: refuses an install that would drop an owned service model', () => {
    writeSettings(
      JSON.stringify({
        modelProviders: {
          openai: [
            { id: 'svc-voice', name: '[DeepSeek] svc-voice', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', voiceOnly: true },
          ],
        },
      }),
    );
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'modelPurpose');
    assert.equal(JSON.parse(readRaw()).modelProviders.openai.length, 1, 'file untouched');
  });
});

describe('API key handling', () => {
  test('reconnect keeps the stored key when no new key is entered', () => {
    writeSettings(JSON.stringify({ env: { DEEPSEEK_API_KEY: 'stored-key-value' } }));
    const result = op({ ...DEEPSEEK_INSTALL, apiKey: undefined });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readJson().env.DEEPSEEK_API_KEY, 'stored-key-value');
  });

  test('clearKey removes only the targeted key', () => {
    writeSettings(
      JSON.stringify({
        env: { DEEPSEEK_API_KEY: 'stored-key-value', OTHER_API_KEY: 'keep-me' },
        modelProviders: { openai: [{ id: 'deepseek-v4-pro', name: '[DeepSeek] deepseek-v4-pro', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' }] },
      }),
    );
    const result = op({ ...DEEPSEEK_INSTALL, apiKey: undefined, clearKey: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.env.DEEPSEEK_API_KEY, undefined);
    assert.equal(settings.env.OTHER_API_KEY, 'keep-me', 'sibling env keys must never be wiped');
    assert.deepEqual(settings.modelProviders.openai.map((m) => m.id), ['deepseek-v4-pro', 'deepseek-flash'], 'owned models replaced by reinstall');
  });

  test('setEnvKey writes ${VAR} placeholders literally and reports them as placeholder', () => {
    writeSettings(JSON.stringify({ env: { MY_TOKEN: 'old' } }));
    const result = op({ op: 'setEnvKey', key: 'MY_TOKEN', value: '${SOME_ENV_VAR}' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readJson().env.MY_TOKEN, '${SOME_ENV_VAR}');
    assert.equal(result.snapshot.env.MY_TOKEN.status, 'placeholder');
  });

  test('setEnvKey null deletes; reserved names are refused', () => {
    writeSettings(JSON.stringify({ env: { MY_TOKEN: 'old', KEEP: 'x' } }));
    let result = op({ op: 'setEnvKey', key: 'MY_TOKEN', value: null });
    assert.equal(result.ok, true);
    assert.deepEqual(readJson().env, { KEEP: 'x' });

    result = op({ op: 'setEnvKey', key: 'PATH', value: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'reserved_env_key');

    result = op({ op: 'setEnvKey', key: '__proto__', value: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'reserved_key');

    result = op({ op: 'setEnvKey', key: 'MY_TOKEN', value: '  ' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_key_required');
  });
});

describe('custom provider install', () => {
  test('openai + wireApi responses stamps wireApi and selectedType, writes no providerProtocol', () => {
    const result = op({
      op: 'saveProvider',
      mode: 'custom',
      protocol: 'openai',
      wireApi: 'responses',
      baseUrl: 'https://gw.example.com',
      apiKey: 'k-123',
      modelIds: ['my-model'],
      advanced: { enableThinking: true, contextWindowSize: 128000 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.providerProtocol, undefined, 'builtin bucket needs no mapping');
    assert.equal(settings.security.auth.selectedType, 'openai-responses');
    const entry = settings.modelProviders.openai[0];
    assert.equal(entry.id, 'my-model');
    assert.equal(entry.wireApi, 'responses');
    assert.equal(entry.baseUrl, 'https://gw.example.com');
    assert.equal(entry.envKey.startsWith('QWEN_CUSTOM_API_KEY_'), true);
    assert.deepEqual(entry.generationConfig.reasoning, { effort: 'medium' });
    assert.deepEqual(entry.generationConfig.contextWindowSize, 128000);
    assert.equal(settings.model.name, 'my-model');
    assert.equal(settings.model.baseUrl, 'https://gw.example.com');
    const envKey = Object.keys(settings.env)[0];
    assert.match(envKey, /^QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_GW_EXAMPLE_COM_[0-9A-F]{12}$/);
  });

  test('anthropic protocol routes into the anthropic bucket', () => {
    const result = op({
      op: 'saveProvider',
      mode: 'custom',
      protocol: 'anthropic',
      baseUrl: 'https://anth.example.com/v1',
      apiKey: 'k-456',
      modelIds: ['claude-x'],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.modelProviders.anthropic.length, 1);
    assert.equal(settings.modelProviders.openai, undefined);
    assert.equal(settings.security.auth.selectedType, 'anthropic');
  });

  test('rejects invalid protocol / wireApi combinations and bad base urls', () => {
    const base = { op: 'saveProvider', mode: 'custom', apiKey: 'k', modelIds: ['m'] };
    let result = op({ ...base, protocol: 'vertex-ai', baseUrl: 'https://x.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported_protocol');

    result = op({ ...base, protocol: 'openai', wireApi: 'bogus', baseUrl: 'https://x.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_wire_api');

    result = op({ ...base, protocol: 'anthropic', wireApi: 'responses', baseUrl: 'https://x.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_wire_api');

    result = op({ ...base, protocol: 'openai', baseUrl: 'ftp://x' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');

    result = op({ ...base, protocol: 'openai', baseUrl: 'https://user:pass@x.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');
  });
});

describe('MiMo Token Plan provider (multi-protocol, tier keys)', () => {
  const install = (extra) => ({
    op: 'saveProvider',
    mode: 'preset',
    presetId: 'mimo-token-plan',
    modelIds: ['mimo-v2.6-pro'],
    apiKey: 'mimo-key-1',
    ...extra,
  });

  test('personal + OpenAI writes the personal key into the openai bucket with spec details', () => {
    const result = op(install({ protocol: 'openai', endpointId: 'personal-openai' }));
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.env.MIMO_TP_PERSONAL_API_KEY, 'mimo-key-1');
    assert.equal(settings.env.MIMO_TP_TEAM_API_KEY, undefined);
    assert.equal(settings.security.auth.selectedType, 'openai');
    const entry = settings.modelProviders.openai[0];
    assert.equal(entry.id, 'mimo-v2.6-pro');
    assert.equal(entry.name, '[MiMo Token Plan] mimo-v2.6-pro');
    assert.equal(entry.baseUrl, 'https://token-plan-cn.xiaomimimo.com/v1');
    assert.equal(entry.envKey, 'MIMO_TP_PERSONAL_API_KEY');
    assert.deepEqual(entry.generationConfig.modalities, { image: true, video: true, audio: true });
    assert.equal(entry.generationConfig.contextWindowSize, 1_000_000);
    assert.deepEqual(entry.generationConfig.samplingParams, { max_tokens: 131072 });
  });

  test('team + Anthropic writes the team key into the anthropic bucket', () => {
    const result = op(
      install({
        protocol: 'anthropic',
        endpointId: 'team-anthropic',
        modelIds: ['mimo-v2.5-tts'],
        apiKey: 'team-key-2',
      }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.env.MIMO_TP_TEAM_API_KEY, 'team-key-2');
    assert.equal(settings.env.MIMO_TP_PERSONAL_API_KEY, undefined);
    assert.equal(settings.security.auth.selectedType, 'anthropic');
    const bucket = settings.modelProviders.anthropic;
    assert.equal(bucket.length, 1);
    assert.equal(bucket[0].baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic');
    assert.equal(bucket[0].envKey, 'MIMO_TP_TEAM_API_KEY');
    assert.equal(bucket[0].generationConfig.contextWindowSize, 8192);
    assert.deepEqual(bucket[0].generationConfig.samplingParams, { max_tokens: 8192 });
    assert.equal(settings.model.name, 'mimo-v2.5-tts');
  });

  test('protocol/endpoint mismatches and shared-URL without endpointId are refused', () => {
    // Endpoint tagged for the other protocol.
    let result = op(install({ protocol: 'openai', endpointId: 'team-anthropic' }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');
    // Protocol outside the provider's protocolOptions.
    result = op(install({ protocol: 'gemini', endpointId: 'personal-openai' }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported_protocol');
    // personal/team share one URL → url alone cannot disambiguate the tier key.
    result = op(install({ baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');
    assert.ok(!fs.existsSync(settingsPath), 'no file written on refusal');
  });

  test('snapshot exposes both tier keys as status-only entries (never values)', () => {
    const first = op(install({ protocol: 'openai', endpointId: 'personal-openai' }));
    assert.equal(first.ok, true, JSON.stringify(first));
    const snap = first.snapshot;
    const mimo = snap.catalog.find((p) => p.id === 'mimo-token-plan');
    assert.deepEqual(mimo.optionEnvKeys, [
      'MIMO_TP_PERSONAL_API_KEY',
      'MIMO_TP_TEAM_API_KEY',
    ]);
    const state = snap.providers.find((p) => p.id === 'mimo-token-plan');
    assert.deepEqual(state.envKeyNames, [
      'MIMO_TP_PERSONAL_API_KEY',
      'MIMO_TP_TEAM_API_KEY',
    ]);
    assert.equal(snap.env.MIMO_TP_PERSONAL_API_KEY?.status, 'set');
    assert.equal(snap.env.MIMO_TP_TEAM_API_KEY?.status, 'unset');
    assert.ok(!JSON.stringify(snap).includes('mimo-key-1'), 'no key values in snapshot');
  });

  test('reconnect keeps the stored tier key when none is entered', () => {
    writeSettings(JSON.stringify({ env: { MIMO_TP_TEAM_API_KEY: 'stored-team' } }));
    const result = op(
      install({ protocol: 'anthropic', endpointId: 'team-anthropic', apiKey: undefined }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readJson().env.MIMO_TP_TEAM_API_KEY, 'stored-team');
  });
});

describe('model CRUD', () => {
  const bucketFixture = () =>
    JSON.stringify({
      env: { GATE_KEY: 'g-1' },
      modelProviders: {
        openai: [
          { id: 'alpha', name: 'Alpha', envKey: 'GATE_KEY', baseUrl: 'https://a.example/v1' },
          { id: 'beta', name: 'Beta', envKey: 'GATE_KEY', baseUrl: 'https://b.example/v1' },
        ],
      },
      model: { name: 'alpha', baseUrl: 'https://a.example/v1' },
      security: { auth: { selectedType: 'openai' } },
      voiceModel: 'alpha',
      fastModel: 'openai:alpha' + String.fromCharCode(0) + 'https://a.example/v1',
      modelFallbacks: 'alpha,beta',
    });
  test('adds a model at the end of the bucket', () => {
    writeSettings(bucketFixture());
    const result = op({
      op: 'saveModel',
      bucketId: 'openai',
      model: { id: 'gamma', baseUrl: 'https://c.example/v1', envKey: 'GATE_KEY', generationConfig: { contextWindowSize: 32000 } },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const bucket = readJson().modelProviders.openai;
    assert.deepEqual(bucket.map((m) => m.id), ['alpha', 'beta', 'gamma']);
    assert.equal(bucket[2].generationConfig.contextWindowSize, 32000);
  });

  test('refuses duplicate (protocol, id, baseUrl) identities', () => {
    writeSettings(bucketFixture());
    const before = readRaw();
    const result = op({
      op: 'saveModel',
      bucketId: 'openai',
      model: { id: 'alpha', baseUrl: 'https://a.example/v1', envKey: 'GATE_KEY' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'duplicate_model');
    assert.equal(readRaw(), before, 'file must be byte-identical after refusal');
  });

  test('edit keeps position and follows the active selection on rename', () => {
    writeSettings(bucketFixture());
    const result = op({
      op: 'saveModel',
      bucketId: 'openai',
      originalId: 'alpha',
      originalBaseUrl: 'https://a.example/v1',
      model: { id: 'alpha-renamed', baseUrl: 'https://a.example/v1', envKey: 'GATE_KEY' },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.deepEqual(settings.modelProviders.openai.map((m) => m.id), ['alpha-renamed', 'beta']);
    assert.equal(settings.model.name, 'alpha-renamed');
    assert.equal(settings.voiceModel, 'alpha-renamed', 'bare-id selectors follow the rename');
    assert.equal(settings.fastModel, 'openai:alpha-renamed' + String.fromCharCode(0) + 'https://a.example/v1');
    assert.equal(settings.modelFallbacks, 'alpha-renamed,beta');
  });

  test('voiceOnly requires the OpenAI Chat route', () => {
    writeSettings(bucketFixture());
    const result = op({
      op: 'saveModel',
      bucketId: 'openai',
      model: { id: 'voice-1', wireApi: 'responses', baseUrl: 'https://a.example/v1', envKey: 'GATE_KEY', voiceOnly: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_model_role');
  });

  test('image routes require https baseUrl and envKey', () => {
    writeSettings(bucketFixture());
    let result = op({ op: 'saveModel', bucketId: 'openai', model: { id: 'img-1', baseUrl: 'http://a.example/v1', envKey: 'GATE_KEY', imageOnly: true } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_base_url');
    result = op({ op: 'saveModel', bucketId: 'openai', model: { id: 'img-1', baseUrl: 'https://a.example/v1', imageOnly: true } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'env_key_required');
  });

  test('deleting the active model cascades selection / aux / fallbacks like the CLI', () => {
    writeSettings(bucketFixture());
    const result = op({ op: 'deleteModel', bucketId: 'openai', id: 'alpha', baseUrl: 'https://a.example/v1' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.deepEqual(settings.modelProviders.openai.map((m) => m.id), ['beta'], 'bucket key kept, entry removed');
    assert.equal(settings.model.name, '');
    assert.equal(settings.model.baseUrl, '');
    assert.equal(settings.voiceModel, '');
    assert.equal(settings.fastModel, '');
    assert.equal(settings.modelFallbacks, 'beta');
    assert.equal(settings.env.GATE_KEY, 'g-1', 'credentials untouched');
  });

  test('aux selectors survive when the id is still configured elsewhere', () => {
    writeSettings(
      JSON.stringify({
        modelProviders: {
          openai: [{ id: 'alpha', name: 'Alpha', envKey: 'K', baseUrl: 'https://a.example/v1' }],
          anthropic: [{ id: 'alpha', name: 'Alpha (anth)', envKey: 'K2', baseUrl: 'https://anth.example/v1' }],
        },
        model: { name: 'alpha', baseUrl: 'https://a.example/v1' },
        voiceModel: 'alpha',
      }),
    );
    const result = op({ op: 'deleteModel', bucketId: 'openai', id: 'alpha' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.voiceModel, 'alpha', 'still configured in anthropic bucket');
    assert.equal(settings.model.name, '', 'pinned endpoint route was deleted → selection cleared (CLI parity)');
    assert.equal(settings.model.baseUrl, '');
  });

  test('deleteModel on missing entry fails without touching the file', () => {
    writeSettings(bucketFixture());
    const before = readRaw();
    const result = op({ op: 'deleteModel', bucketId: 'openai', id: 'nope' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'model_not_found');
    assert.equal(readRaw(), before);
  });

  test('preset delete removes only owned models, its key and its metadata', () => {
    writeSettings(
      JSON.stringify({
        env: { DEEPSEEK_API_KEY: 'd-key', OTHER_API_KEY: 'o-key' },
        modelProviders: {
          openai: [
            { id: 'deepseek-v4-pro', name: '[DeepSeek] deepseek-v4-pro', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
            { id: 'deepseek-v4-flash', name: '[DeepSeek] deepseek-v4-flash', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
            { id: 'gpt-x', name: 'GPT-X', envKey: 'OTHER_API_KEY', baseUrl: 'https://other.example/v1' },
          ],
        },
        providerMetadata: { deepseek: { version: 'abc', baseUrl: 'https://api.deepseek.com' }, grok: { version: 'zzz' } },
        model: { name: 'deepseek-v4-pro', baseUrl: '' },
        security: { auth: { selectedType: 'openai' } },
        fastModel: 'openai:deepseek-v4-pro' + String.fromCharCode(0) + 'https://api.deepseek.com',
      }),
    );
    const result = op({ op: 'deleteProvider', mode: 'preset', presetId: 'deepseek' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.deepEqual(settings.modelProviders.openai.map((m) => m.id), ['gpt-x']);
    assert.equal(settings.env.DEEPSEEK_API_KEY, undefined, 'orphaned key removed');
    assert.equal(settings.env.OTHER_API_KEY, 'o-key');
    assert.equal(settings.providerMetadata.deepseek, undefined);
    assert.equal(settings.providerMetadata.grok.version, 'zzz', 'unrelated metadata kept');
    assert.equal(settings.model.name, '', 'active selection cleared');
    assert.equal(settings.fastModel, '');
    const provider = result.snapshot.providers.find((p) => p.id === 'deepseek');
    assert.equal(provider.configured, false);
  });

  test('keeps the env key while a hand-written entry still references it', () => {
    writeSettings(
      JSON.stringify({
        env: { DEEPSEEK_API_KEY: 'd-key' },
        modelProviders: {
          openai: [
            { id: 'deepseek-v4-pro', name: '[DeepSeek] deepseek-v4-pro', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
            { id: 'hand-kept', name: 'Hand kept', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
          ],
        },
      }),
    );
    const result = op({ op: 'deleteProvider', mode: 'preset', presetId: 'deepseek' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readJson().env.DEEPSEEK_API_KEY, 'd-key', 'still referenced → key kept');
    assert.deepEqual(readJson().modelProviders.openai.map((m) => m.id), ['hand-kept']);
  });

  test('preset delete with nothing owned reports not_configured', () => {
    writeSettings(JSON.stringify({ env: { DEEPSEEK_API_KEY: 'd-key' }, modelProviders: { openai: [] } }));
    const before = readRaw();
    const result = op({ op: 'deleteProvider', mode: 'preset', presetId: 'deepseek' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_configured');
    assert.equal(readRaw(), before);
  });

  test('bucket delete removes the bucket, its mapping and only orphaned keys', () => {
    writeSettings(
      JSON.stringify({
        env: { MYGW_KEY: 'm-key', OTHER: 'keep' },
        modelProviders: {
          mygw: [{ id: 'm1', envKey: 'MYGW_KEY', baseUrl: 'https://gw.example/v1' }],
          openai: [{ id: 'g1', envKey: 'OTHER', baseUrl: 'https://o.example/v1' }],
        },
        providerProtocol: { mygw: 'openai', other: 'gemini' },
      }),
    );
    const result = op({ op: 'deleteProvider', mode: 'bucket', bucketId: 'mygw' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.equal(settings.modelProviders.mygw, undefined);
    assert.deepEqual(settings.modelProviders.openai.map((m) => m.id), ['g1']);
    assert.equal(settings.providerProtocol.mygw, undefined);
    assert.equal(settings.providerProtocol.other, 'gemini');
    assert.equal(settings.env.MYGW_KEY, undefined);
    assert.equal(settings.env.OTHER, 'keep');
  });

  test('builtin protocol buckets cannot be deleted wholesale', () => {
    writeSettings(JSON.stringify({ modelProviders: { openai: [{ id: 'g1' }] } }));
    const result = op({ op: 'deleteProvider', mode: 'bucket', bucketId: 'openai' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'builtin_bucket');
  });

  test('deleting without an env block never wipes sibling keys (setDeep regression)', () => {
    writeSettings(
      JSON.stringify({
        otherTopLevel: { keep: true },
        modelProviders: {
          openai: [
            { id: 'deepseek-v4-pro', name: '[DeepSeek] deepseek-v4-pro', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
          ],
        },
      }),
    );
    const result = op({ op: 'deleteProvider', mode: 'preset', presetId: 'deepseek' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const settings = readJson();
    assert.deepEqual(settings.otherTopLevel, { keep: true });
    assert.deepEqual(settings.modelProviders.openai, []);
  });

});

describe('integrity guarantees', () => {
  test('preserves comments, indent style, BOM and CRLF on write', () => {
    const bom = String.fromCharCode(0xfeff);
    const fixture =
      bom +
      '{\r\n    // user comment: my gateway\r\n    "env": {\r\n        "KEEP_ME": "v" // inline note\r\n    },\r\n    "modelProviders": {}\r\n}\r\n';
    writeSettings(fixture);
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, true, JSON.stringify(result));
    const raw = readRaw();
    assert.ok(raw.charCodeAt(0) === 0xfeff, 'BOM preserved');
    assert.ok(raw.includes('// user comment: my gateway'), 'block comment preserved');
    assert.ok(raw.includes('// inline note'), 'inline comment preserved');
    assert.ok(raw.includes('\r\n'), 'CRLF preserved');
    assert.match(raw, /\r\n {4}"env"/, '4-space indent preserved');
    const parsed = parseJsoncObject(raw);
    assert.equal(parsed.env.KEEP_ME, 'v');
    assert.equal(parsed.env.DEEPSEEK_API_KEY, 'sk-test-1234567890');
  });

  test('refuses to write an unparseable file', () => {
    const broken = '{ "env": { "A": "1", ';
    writeSettings(broken);
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'parse_error');
    assert.equal(readRaw(), broken);
  });

  test('creates the file on first write when missing', () => {
    const result = op(DEEPSEEK_INSTALL);
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(settingsPath));
    assert.equal(readJson().env.DEEPSEEK_API_KEY, 'sk-test-1234567890');
  });

  test('unknown op is rejected', () => {
    const result = op({ op: 'selfDestruct' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unknown_op');
    assert.ok(!fs.existsSync(settingsPath));
  });

  test('invalid JSON payload is rejected', () => {
    const result = service.runProviderConfigOp(settingsPath, '', '{oops');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_payload');
  });

  test('saveModel fails clearly on an unmapped custom bucket', () => {
    writeSettings(JSON.stringify({ modelProviders: { mygw: [{ id: 'm1' }] } }));
    const before = readRaw();
    const result = op({ op: 'saveModel', bucketId: 'mygw', model: { id: 'm1', baseUrl: 'https://x.example/v1' } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unrouted_bucket');
    assert.equal(readRaw(), before);
  });

  test('dotted bucket ids are refused (would corrupt dotted path writes)', () => {
    writeSettings(JSON.stringify({ modelProviders: {} }));
    const result = op({ op: 'saveModel', bucketId: 'a.b', model: { id: 'm1' } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_bucket');
  });
});
