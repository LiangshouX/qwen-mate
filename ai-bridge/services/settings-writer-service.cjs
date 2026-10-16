/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * QwenMate provider-config service — reads/updates the Qwen Code CLI user
 * settings (~/.qwen/settings.json) for the visual provider management page.
 *
 * Contract with the CLI (bottom lines of the feature spec):
 *  - Same data layout as /auth installs: env.<KEY> credentials, bucket arrays
 *    under modelProviders, security.auth.selectedType, model.name/baseUrl,
 *    providerMetadata versioning — built by provider-plan.cjs (a port of the
 *    CLI's own buildInstallPlan) and written by settings-jsonc.cjs (a port of
 *    the CLI's jsonc-editor + write-with-backup).
 *  - API keys are write-only: snapshots never contain env values, only a
 *    per-key status (set / placeholder / process / unset).
 *  - Every op is validated before a single byte is written; the JSONC engine
 *    re-parses and deep-equals the result before the atomic publish, so a
 *    corrupt settings.json can never be produced (failure leaves the original
 *    file untouched).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./provider-catalog.cjs');
const plan = require('./provider-plan.cjs');
const jsonc = require('./settings-jsonc.cjs');

const { AuthType, PlanError } = plan;

/** install.ts DENY_ENV_KEYS — refuse process/loader-altering env names. */
const DENY_ENV_KEYS = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
]);

const BUILTIN_PROTOCOL_IDS = new Set([
  'openai',
  'openai-responses',
  'anthropic',
  'gemini',
  'vertex-ai',
  'qwen-oauth',
]);

const ENV_KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

class OpError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OpError';
    this.code = code || 'invalid_operation';
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function fail(message, code) {
  throw new OpError(message, code);
}

function assertSafeKeyPath(key) {
  for (const part of String(key).split('.')) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      fail(`Refusing to write settings key with reserved segment: ${key}`, 'reserved_key');
    }
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDeep(obj, dotted) {
  let current = obj;
  for (const part of String(dotted).split('.')) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = current?.[part];
  }
  return current;
}

/** setNestedPropertySafe equivalent: assign at a dotted path.
 *
 * `undefined` means "delete this leaf" — the path (including fresh parents)
 * must still be materialised in the updates tree with an `undefined` value,
 * because the JSONC diff only removes exactly that leaf from it. Writing a
 * bare `{}` parent instead would make the deep-merge treat it as
 * "replace the whole block with nothing" and wipe sibling keys (all env
 * credentials, every model bucket). */
function setDeep(root, dotted, value) {
  assertSafeKeyPath(dotted);
  const parts = String(dotted).split('.');
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function httpUrlOrEmpty(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    fail('Base URL must start with http:// or https://', 'invalid_base_url');
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      fail('Base URL must not embed credentials (userinfo)', 'invalid_base_url');
    }
  } catch {
    fail('Base URL is not a valid URL', 'invalid_base_url');
  }
  return trimmed;
}

function isConversationModel(model) {
  return !model.imageOnly && !model.voiceOnly && !model.realtimeOnly;
}

// ---------------------------------------------------------------------------
// File loading / snapshot (redacted — API key values never leave this process)
// ---------------------------------------------------------------------------

function loadFile(filePath) {
  const exists = fs.existsSync(filePath);
  if (!exists) {
    return { path: filePath, exists: false, tree: {}, parseError: null };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const tree = jsonc.parseJsoncObject(raw);
    return { path: filePath, exists: true, tree, parseError: null };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      tree: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function serializeCatalog() {
  return catalog.ALL_PROVIDERS.map((provider) => {
    const baseUrl =
      typeof provider.baseUrl === 'string'
        ? provider.baseUrl
        : Array.isArray(provider.baseUrl)
          ? provider.baseUrl.map((option) => ({
              id: option.id,
              label: option.label,
              url: option.url,
              ...(option.documentationUrl ? { documentationUrl: option.documentationUrl } : {}),
              ...(option.apiKeyUrl ? { apiKeyUrl: option.apiKeyUrl } : {}),
            }))
          : null;
    const steps = [
      'protocol',
      'wireApi',
      'baseUrl',
      'apiKey',
      'models',
      'advancedConfig',
    ].filter((step) => plan.shouldShowStep(provider, step));
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description ?? '',
      uiGroup: provider.uiGroup,
      protocol: provider.protocol,
      protocolOptions: provider.protocolOptions ?? null,
      baseUrl,
      envKey: typeof provider.envKey === 'string' ? provider.envKey : null,
      envKeyGenerated: typeof provider.envKey === 'function',
      modelNamePrefix: typeof provider.modelNamePrefix === 'string' ? provider.modelNamePrefix : null,
      models: provider.models ?? null,
      modelsEditable: provider.modelsEditable === true,
      supportsModelDiscovery: provider.supportsModelDiscovery === true,
      showAdvancedConfig: provider.showAdvancedConfig === true,
      apiKeyPlaceholder: provider.apiKeyPlaceholder ?? 'sk-...',
      hasKeyValidator: typeof provider.validateApiKey === 'function',
      documentationUrl: provider.documentationUrl ?? null,
      customHeaders: provider.customHeaders ?? null,
      uiLabels: provider.uiLabels ?? null,
      steps,
    };
  });
}

function collectEnvKeyNames(tree) {
  const names = new Set();
  for (const provider of catalog.ALL_PROVIDERS) {
    if (typeof provider.envKey === 'string') names.add(provider.envKey);
  }
  const providers = tree?.modelProviders;
  if (isPlainObject(providers)) {
    for (const entries of Object.values(providers)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (isPlainObject(entry) && typeof entry.envKey === 'string' && entry.envKey) {
          names.add(entry.envKey);
        }
      }
    }
  }
  if (isPlainObject(tree?.env)) {
    for (const key of Object.keys(tree.env)) names.add(key);
  }
  return names;
}

function envStatus(tree, key, processEnv) {
  const raw = isPlainObject(tree?.env) ? tree.env[key] : undefined;
  if (typeof raw === 'string' && raw.length > 0) {
    const isPlaceholder = /^\$\{[^}]+\}$/.test(raw.trim()) || /^\$[A-Za-z_][A-Za-z0-9_]*/.test(raw.trim());
    return { status: isPlaceholder ? 'placeholder' : 'set', source: 'settings' };
  }
  if (raw !== undefined) return { status: 'unset', source: null };
  const fromProcess = processEnv?.[key];
  if (typeof fromProcess === 'string' && fromProcess.length > 0) {
    return { status: 'process', source: 'process' };
  }
  return { status: 'unset', source: null };
}

function buildSnapshot(file, projectFile, processEnv) {
  const tree = file.tree ?? {};
  const buckets = isPlainObject(tree.modelProviders) ? tree.modelProviders : {};
  const providerProtocol = isPlainObject(tree.providerProtocol) ? tree.providerProtocol : {};

  // Group every model entry under the preset that owns it (or "unassigned").
  const providers = catalog.ALL_PROVIDERS.map((provider) => {
    const owns = plan.resolveOwnsModel(provider);
    const owned = [];
    if (owns) {
      for (const [bucketId, entries] of Object.entries(buckets)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (isPlainObject(entry) && owns(entry)) {
            owned.push({ bucketId, id: entry.id, baseUrl: entry.baseUrl ?? '' });
          }
        }
      }
    }
    const metadataKey = plan.resolveMetadataKey(provider);
    const metadata = metadataKey && isPlainObject(tree.providerMetadata)
      ? tree.providerMetadata[metadataKey]
      : undefined;
    const endpoint =
      (isPlainObject(metadata) ? metadata.baseUrl : undefined) ??
      (owned[0]?.baseUrl || plan.resolveBaseUrl(provider, undefined));
    const envKeyName =
      typeof provider.envKey === 'string'
        ? provider.envKey
        : typeof provider.envKey === 'function'
          ? provider.envKey(provider.protocol, endpoint || '')
          : null;
    return {
      kind: 'preset',
      id: provider.id,
      uiGroup: provider.uiGroup,
      configured: owned.length > 0,
      owned,
      endpoint: owned.length > 0 || provider.baseUrl !== undefined ? endpoint : '',
      envKeyName,
      keyStatus: envKeyName
        ? envStatus(tree, envKeyName, processEnv).status
        : 'unset',
      modelCount: owned.length,
      hasMetadata: Boolean(metadata),
      metadataVersion: isPlainObject(metadata) && typeof metadata.version === 'string'
        ? metadata.version
        : null,
    };
  });

  // Custom-id buckets (hand-written or GUI-created with a providerProtocol map).
  const customBuckets = [];
  const unassigned = {};
  const presetOwnedIds = new Set();
  for (const p of providers) {
    for (const owned of p.owned) presetOwnedIds.add(`${owned.bucketId}\u0000${owned.id}\u0000${owned.baseUrl}`);
  }
  for (const [bucketId, entries] of Object.entries(buckets)) {
    if (!Array.isArray(entries)) continue;
    if (BUILTIN_PROTOCOL_IDS.has(bucketId)) {
      const leftovers = entries.filter(
        (entry) =>
          isPlainObject(entry) &&
          !presetOwnedIds.has(`${bucketId}\u0000${entry.id}\u0000${entry.baseUrl ?? ''}`),
      );
      if (leftovers.length > 0) unassigned[bucketId] = leftovers;
    } else {
      const protocol =
        plan.resolveProviderProtocol(bucketId, providerProtocol) ?? null;
      const envKeys = new Set();
      for (const entry of entries) {
        if (isPlainObject(entry) && typeof entry.envKey === 'string') envKeys.add(entry.envKey);
      }
      customBuckets.push({
        kind: 'custom-bucket',
        bucketId,
        protocol,
        mapped: protocol !== null,
        modelCount: entries.filter(isPlainObject).length,
        envKeyNames: [...envKeys],
        keyStatuses: Object.fromEntries(
          [...envKeys].map((key) => [key, envStatus(tree, key, processEnv).status]),
        ),
      });
    }
  }

  const env = {};
  for (const key of collectEnvKeyNames(tree)) {
    env[key] = envStatus(tree, key, processEnv);
  }

  const selection = {
    name: getDeep(tree, 'model.name') ?? '',
    baseUrl: getDeep(tree, 'model.baseUrl') ?? '',
    selectedType: getDeep(tree, 'security.auth.selectedType') ?? '',
  };
  const aux = {};
  for (const key of [
    'voiceModel',
    'fastModel',
    'visionModel',
    'compactionModel',
    'imageModel',
    'advisorModel',
    'modelFallbacks',
  ]) {
    const value = tree[key];
    aux[key] = typeof value === 'string' ? value : '';
  }

  return {
    settingsPath: file.path,
    settingsExists: file.exists,
    parseError: file.parseError,
    catalog: serializeCatalog(),
    buckets,
    providerProtocol,
    providers,
    customBuckets,
    unassigned,
    env,
    selection,
    aux,
    providerMetadata: isPlainObject(tree.providerMetadata) ? tree.providerMetadata : {},
    projectOverride: projectFile
      ? {
          path: projectFile.path,
          exists: projectFile.exists,
          ownsModelProviders:
            projectFile.tree !== null &&
            projectFile.tree !== undefined &&
            isPlainObject(projectFile.tree.modelProviders) &&
            Object.keys(projectFile.tree.modelProviders).length > 0,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Shared write plumbing
// ---------------------------------------------------------------------------

function requireParseable(file) {
  if (file.parseError) {
    fail(
      `settings.json 无法解析，已拒绝写入以避免破坏文件：${file.parseError}`,
      'parse_error',
    );
  }
  return file.tree;
}

function denyEnvKey(key) {
  if (DENY_ENV_KEYS.has(String(key).toUpperCase())) {
    fail(`Install plan must not set reserved environment variable: ${key}`, 'reserved_env_key');
  }
  if (!ENV_KEY_NAME_RE.test(String(key))) {
    fail(`Invalid environment variable name: ${key}`, 'invalid_env_key');
  }
}

function bucketOf(tree, bucketId) {
  const entries = getDeep(tree, 'modelProviders')?.[bucketId];
  return Array.isArray(entries) ? entries : [];
}

function findPresetConfig(presetId) {
  const provider = catalog.ALL_PROVIDERS.find((p) => p.id === presetId);
  if (!provider) fail(`Unsupported provider: ${presetId}`, 'unsupported_provider');
  return provider;
}

/** Find the preset (if any) whose ownership rule claims this model entry. */
function findOwningPreset(entry) {
  for (const provider of catalog.ALL_PROVIDERS) {
    const owns = plan.resolveOwnsModel(provider);
    if (owns && owns(entry)) return provider;
  }
  return null;
}

/**
 * Retire providerMetadata.<presetId>.version (CLI's retireProviderState) so
 * the CLI's update check cannot silently re-template over a manual edit
 * (a missing version makes findAllPendingUpdates skip the provider).
 */
function retireMetadataVersion(updates, entry) {
  const owner = findOwningPreset(entry);
  if (!owner) return;
  const key = plan.resolveMetadataKey(owner);
  if (!key) return;
  setDeep(updates, `providerMetadata.${key}.version`, undefined);
}

// ---------------------------------------------------------------------------
// Selection cascade (workspace-models.ts delete path, user-scope subset)
// ---------------------------------------------------------------------------

function parseAuxSelector(value) {
  const separator = value.indexOf('\0');
  const head = separator < 0 ? value : value.slice(0, separator);
  const endpoint = separator < 0 ? undefined : value.slice(separator + 1);
  for (const authType of [
    'openai-responses',
    'openai',
    'anthropic',
    'gemini',
    'vertex-ai',
    'qwen-oauth',
  ]) {
    if (head.startsWith(`${authType}:`)) {
      return { authType, modelId: head.slice(authType.length + 1), endpoint };
    }
  }
  return { authType: undefined, modelId: head, endpoint };
}

function isActiveModelSelection(activeName, activeBaseUrl, target, activeAuthType) {
  if (activeAuthType && activeAuthType !== target.authType) return false;
  if (!activeName || activeName !== target.modelId) return false;
  if (!activeBaseUrl) return true;
  if (!target.baseUrl) return false;
  return activeBaseUrl === target.baseUrl;
}

function openaiFamily(authType) {
  return authType === AuthType.USE_OPENAI || authType === AuthType.USE_OPENAI_RESPONSES;
}

/**
 * Apply the deletion cascade for one removed model entry onto `updates`:
 * clears model.name/baseUrl when the active selection lost its route, and
 * scrubs auxiliary model selectors / modelFallbacks when nothing configures
 * the id anymore.
 */
function applyDeleteCascade(tree, updates, removedEntry, remainingTree) {
  const providers = remainingTree.modelProviders ?? {};
  const providerProtocol = remainingTree.providerProtocol;
  const removedId = removedEntry.id;
  const removedBaseUrl = removedEntry.baseUrl;

  const stillConfigured = Object.values(providers).some(
    (entries) => Array.isArray(entries) && entries.some((m) => isPlainObject(m) && m.id === removedId),
  );

  let removedAuthType;
  try {
    for (const [bucketId, entries] of Object.entries(providers)) {
      if (!Array.isArray(entries)) continue;
      for (const model of entries) {
        if (isPlainObject(model) && model.id === removedId) {
          removedAuthType = plan.tryResolveModelProtocol(bucketId, model, providerProtocol) ?? bucketId;
          break;
        }
      }
      if (removedAuthType) break;
    }
  } catch {
    removedAuthType = undefined;
  }
  removedAuthType = removedAuthType ?? 'openai';

  const target = {
    authType: removedAuthType,
    modelId: removedId,
    ...(removedBaseUrl ? { baseUrl: removedBaseUrl } : {}),
  };

  const activeName = getDeep(tree, 'model.name') ?? '';
  const activeBaseUrl = getDeep(tree, 'model.baseUrl') ?? '';
  const selectedType = getDeep(tree, 'security.auth.selectedType') ?? '';
  const activeAuthType = openaiFamily(selectedType) ? undefined : selectedType || undefined;

  // Survivor of the same route (still available for the current selection)?
  const survivor = Object.entries(providers)
    .flatMap(([bucketId, entries]) =>
      Array.isArray(entries)
        ? entries.map((model) => ({ bucketId, model }))
        : [],
    )
    .find(
      ({ bucketId, model }) =>
        isPlainObject(model) &&
        model.id === activeName &&
        (plan.tryResolveModelProtocol(bucketId, model, providerProtocol) ?? bucketId) ===
          (activeAuthType ?? removedAuthType) &&
        (activeBaseUrl ? (model.baseUrl ?? '') === activeBaseUrl : true),
    )?.model;
  const selectionAffected = !survivor || !isConversationModel(survivor);

  if (
    selectionAffected &&
    isActiveModelSelection(activeName, activeBaseUrl, target, activeAuthType)
  ) {
    setDeep(updates, 'model.name', '');
    setDeep(updates, 'model.baseUrl', '');
  }

  if (!stillConfigured) {
    if (typeof tree.voiceModel === 'string' && tree.voiceModel.trim() === removedId) {
      setDeep(updates, 'voiceModel', '');
    }
    for (const key of [
      'imageModel',
      'advisorModel',
      'visionModel',
      'fastModel',
      'compactionModel',
    ]) {
      const value = tree[key];
      if (typeof value !== 'string' || !value) continue;
      const selector = parseAuxSelector(value);
      if (
        selector.modelId === removedId &&
        (!selector.authType || selector.authType === removedAuthType) &&
        (selector.endpoint === undefined ||
          selector.endpoint === (removedBaseUrl ?? ''))
      ) {
        setDeep(updates, key, '');
      }
    }
    if (typeof tree.modelFallbacks === 'string' && tree.modelFallbacks.length > 0) {
      const original = tree.modelFallbacks.split(',').map((s) => s.trim()).filter(Boolean);
      const kept = original.filter((id) => id !== removedId);
      if (kept.length !== original.length) {
        setDeep(updates, 'modelFallbacks', kept.join(','));
      }
    }
  }
}

/** Remove env.<key> for keys no remaining model entry references. */
function cleanupOrphanEnvKeys(updates, removedEntries, treeAfter, removeEnvKeys) {
  if (!removeEnvKeys) return;
  const removedKeys = new Set(
    removedEntries
      .map((entry) => (isPlainObject(entry) ? entry.envKey : undefined))
      .filter((key) => typeof key === 'string' && key),
  );
  if (removedKeys.size === 0) return;
  const referenced = new Set();
  for (const entries of Object.values(treeAfter.modelProviders ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (isPlainObject(entry) && typeof entry.envKey === 'string') referenced.add(entry.envKey);
    }
  }
  for (const key of removedKeys) {
    if (!referenced.has(key)) {
      denyEnvKey(key);
      setDeep(updates, `env.${key}`, undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

function opSnapshot(state) {
  return buildSnapshot(state.file, state.projectFile, state.processEnv);
}

function opSaveProvider(state, payload) {
  const tree = requireParseable(state.file);
  const updates = {};

  const mode = payload.mode ?? 'preset';
  let config;
  let inputs;

  if (mode === 'preset') {
    config = findPresetConfig(payload.presetId);
    if (config.protocol !== AuthType.USE_OPENAI) {
      fail(`Preset provider protocol not supported: ${config.protocol}`, 'unsupported_provider');
    }
    const stripTrailingSlashes = (url) => (url ?? '').replace(/\/+$/, '');
    let selectedUrl;
    if (typeof config.baseUrl === 'string') {
      const wanted = String(payload.baseUrl ?? '').trim();
      if (wanted && stripTrailingSlashes(wanted) !== stripTrailingSlashes(config.baseUrl)) {
        fail('该供应商仅支持固定端点，所选 Base URL 与预置不符。', 'invalid_base_url');
      }
      selectedUrl = config.baseUrl;
    } else if (Array.isArray(config.baseUrl)) {
      const wanted = String(payload.baseUrl ?? '').trim();
      const match = config.baseUrl.find((option) => option.url === wanted);
      if (!match) {
        fail('请选择一个受支持的端点（Base URL）。', 'invalid_base_url');
      }
      selectedUrl = match.url;
    } else {
      selectedUrl = String(payload.baseUrl ?? '').trim();
    }
    inputs = {
      baseUrl: plan.resolveBaseUrl(config, selectedUrl || undefined),
      modelIds: normalizeModelIds(payload.modelIds),
      ...(payload.apiKey ? { apiKey: String(payload.apiKey) } : {}),
      ...(payload.advanced ? { advancedConfig: normalizeAdvanced(payload.advanced) } : {}),
    };
  } else if (mode === 'custom') {
    config = catalog.customProvider;
    const protocol = payload.protocol ?? AuthType.USE_OPENAI;
    if (!config.protocolOptions.includes(protocol)) {
      fail(`Unsupported protocol for Custom Provider: ${protocol}`, 'unsupported_protocol');
    }
    const wireApi = payload.wireApi;
    if (wireApi !== undefined && wireApi !== 'chat-completions' && wireApi !== 'responses') {
      fail('wireApi must be "chat-completions" or "responses".', 'invalid_wire_api');
    }
    if (wireApi !== undefined && protocol !== AuthType.USE_OPENAI) {
      fail('wireApi is only supported for OpenAI-compatible models.', 'invalid_wire_api');
    }
    inputs = {
      protocol,
      ...(wireApi ? { wireApi } : {}),
      baseUrl: httpUrlOrEmpty(
        payload.baseUrl || plan.getDefaultBaseUrlForProtocol(protocol),
      ),
      modelIds: normalizeModelIds(payload.modelIds),
      ...(payload.apiKey ? { apiKey: String(payload.apiKey) } : {}),
      ...(payload.advanced ? { advancedConfig: normalizeAdvanced(payload.advanced) } : {}),
    };
    if (!inputs.baseUrl) fail('Base URL cannot be empty.', 'invalid_base_url');
  } else {
    fail(`Unknown saveProvider mode: ${mode}`, 'invalid_operation');
  }

  if (inputs.modelIds.length === 0) {
    fail('至少需要选择或输入一个模型 ID。', 'no_models');
  }

  // API key: keep-existing / clear / set — mirroring CLI's required input with
  // the added ability to leave the stored key untouched on reconnect. The CLI
  // reads credentials from process.env first, then settings.env, so a key
  // supplied by the user's shell counts as "already configured" too.
  const resolvedEnvKey = plan.resolveEnvKey(config, inputs);
  const existingKeyRaw = isPlainObject(tree.env) ? tree.env[resolvedEnvKey] : undefined;
  const processKeyRaw = state.processEnv?.[resolvedEnvKey];
  const hasExistingKey =
    (typeof existingKeyRaw === 'string' && existingKeyRaw.length > 0) ||
    (typeof processKeyRaw === 'string' && processKeyRaw.length > 0);
  if (payload.clearKey !== true && !inputs.apiKey && !hasExistingKey) {
    fail('API key cannot be empty.', 'api_key_required');
  }
  if (inputs.apiKey) {
    const trimmed = inputs.apiKey.trim();
    inputs.apiKey = trimmed;
    if (typeof config.validateApiKey === 'function') {
      const error = config.validateApiKey(trimmed, inputs.baseUrl);
      if (error) fail(error, 'invalid_api_key');
    }
  } else if (!hasExistingKey) {
    fail('API key cannot be empty.', 'api_key_required');
  }

  const selection = {
    authType: getDeep(tree, 'security.auth.selectedType') || undefined,
    id: getDeep(tree, 'model.name') || undefined,
    baseUrl: getDeep(tree, 'model.baseUrl') || undefined,
  };
  const mapping = isPlainObject(tree.providerProtocol) ? tree.providerProtocol : undefined;
  const existing = plan.findExistingProviderModels(config, tree.modelProviders, mapping, selection);

  const installPlan = plan.buildInstallPlan(
    config,
    inputs,
    existing?.models ?? [],
    selection,
  );

  const serviceOnly = (installPlan.modelProviders ?? []).flatMap((patch) => patch.models);
  const preserveSelection =
    serviceOnly.length > 0 &&
    serviceOnly.every((model) => model.imageOnly || model.voiceOnly || model.realtimeOnly);

  for (const patch of installPlan.modelProviders ?? []) {
    const previousBucket = bucketOf(tree, patch.authType);
    plan.assertPurposeSafe(previousBucket, patch, preserveSelection);
  }

  // 1. Credentials (env.<KEY>) — plaintext like the CLI, `${VAR}` passthrough.
  const envEntries = Object.entries(installPlan.env ?? {});
  for (const [key] of envEntries) {
    denyEnvKey(key);
    if (typeof inputs.apiKey === 'string' && inputs.apiKey.length > 0) {
      setDeep(updates, `env.${key}`, inputs.apiKey);
    } else if (payload.clearKey === true) {
      setDeep(updates, `env.${key}`, undefined);
    } else if (!hasExistingKey) {
      fail('API key cannot be empty.', 'api_key_required');
    }
  }

  // 2. Model bucket merge (prepend-and-remove-owned) + legacy bucket cleanup.
  let workingProviders = { ...(tree.modelProviders ?? {}) };
  for (const patch of installPlan.modelProviders ?? []) {
    workingProviders = plan.applyModelProvidersPatch(workingProviders, patch, mapping);
    setDeep(updates, `modelProviders.${patch.authType}`, workingProviders[patch.authType] ?? []);

    if (patch.authType !== AuthType.USE_OPENAI) continue;
    for (const [providerId, models] of Object.entries(workingProviders)) {
      if (providerId === patch.authType || !Array.isArray(models)) continue;
      if (providerId.includes('.')) continue;
      let route;
      try {
        route = plan.resolveProviderProtocol(providerId, mapping);
      } catch {
        route = undefined;
      }
      if (route !== AuthType.USE_OPENAI_RESPONSES) continue;
      const remaining = models.filter(
        (existingModel) =>
          !patch.models.some(
            (newModel) =>
              plan.isSameModelIdentity(newModel, existingModel) &&
              plan.tryResolveModelProtocol(providerId, existingModel, mapping) ===
                plan.resolveModelProtocol(patch.authType, newModel, mapping),
          ),
      );
      if (remaining.length !== models.length) {
        setDeep(updates, `modelProviders.${providerId}`, remaining);
        workingProviders[providerId] = remaining;
      }
    }
  }

  // 3. Auth selection.
  if (!preserveSelection) {
    setDeep(updates, 'security.auth.selectedType', installPlan.authType);
  }

  // 4. Model selection: keep the user's current model when the plan still
  //    offers it, otherwise adopt the plan's first conversation model.
  if (!preserveSelection && installPlan.modelSelection?.modelId) {
    const currentName = getDeep(tree, 'model.name') ?? '';
    const currentBaseUrl = getDeep(tree, 'model.baseUrl') ?? '';
    const planOffersCurrentModel =
      typeof currentName === 'string' &&
      currentName.length > 0 &&
      (installPlan.modelProviders ?? []).some((patch) =>
        patch.models.some((model) => {
          let route;
          try {
            route = plan.resolveModelProtocol(patch.authType, model, mapping);
          } catch {
            return false;
          }
          if (route !== installPlan.authType) return false;
          return currentBaseUrl === '' || currentBaseUrl === undefined
            ? model.id === currentName
            : plan.isSameModelIdentity({ id: currentName, baseUrl: currentBaseUrl }, model);
        }),
      );
    if (!planOffersCurrentModel) {
      setDeep(updates, 'model.name', installPlan.modelSelection.modelId);
      if (installPlan.modelSelection.baseUrl) {
        setDeep(updates, 'model.baseUrl', installPlan.modelSelection.baseUrl);
      } else {
        setDeep(updates, 'model.baseUrl', '');
      }
    }
  }

  // 5. providerMetadata version/baseUrl (static-list presets only).
  for (const [key, entries] of Object.entries(installPlan.providerState ?? {})) {
    for (const [field, value] of Object.entries(entries)) {
      setDeep(updates, `${key}.${field}`, value);
    }
  }

  jsonc.persistSettingsUpdates(state.file.path, updates);
  return null;
}

function opDeleteProvider(state, payload) {
  const tree = requireParseable(state.file);
  const updates = {};
  const mode = payload.mode ?? 'preset';
  const removeEnvKeys = payload.removeEnvKeys !== false;
  const mapping = isPlainObject(tree.providerProtocol) ? tree.providerProtocol : undefined;

  let removedEntries = [];
  const nextProviders = { ...(tree.modelProviders ?? {}) };

  if (mode === 'preset') {
    const config = findPresetConfig(payload.presetId);
    const owns = plan.resolveOwnsModel(config);
    if (!owns) fail(`Provider has no ownership rule: ${config.id}`, 'invalid_operation');
    for (const [bucketId, entries] of Object.entries(nextProviders)) {
      if (!Array.isArray(entries)) continue;
      const kept = entries.filter((entry) => !(isPlainObject(entry) && owns(entry)));
      if (kept.length !== entries.length) {
        removedEntries = removedEntries.concat(entries.filter((e) => isPlainObject(e) && owns(e)));
        nextProviders[bucketId] = kept;
        setDeep(updates, `modelProviders.${bucketId}`, kept);
      }
    }
    if (removedEntries.length === 0) {
      fail('该供应商尚无已配置的模型。', 'not_configured');
    }
    const metadataKey = plan.resolveMetadataKey(config);
    if (metadataKey) {
      setDeep(updates, `providerMetadata.${metadataKey}`, undefined);
    }
  } else if (mode === 'bucket') {
    const bucketId = String(payload.bucketId ?? '');
    if (!bucketId) fail('bucketId is required', 'invalid_operation');
    if (BUILTIN_PROTOCOL_IDS.has(bucketId)) {
      fail(
        '内置协议桶不能整体删除；请逐个删除其中的模型，或仅删除自定义 provider。',
        'builtin_bucket',
      );
    }
    const entries = bucketOf(tree, bucketId);
    if (entries.length === 0) fail('该供应商尚无已配置的模型。', 'not_configured');
    removedEntries = entries.filter(isPlainObject);
    delete nextProviders[bucketId];
    setDeep(updates, `modelProviders.${bucketId}`, undefined);
    if (isPlainObject(tree.providerProtocol) && Object.hasOwn(tree.providerProtocol, bucketId)) {
      setDeep(updates, `providerProtocol.${bucketId}`, undefined);
    }
    if (isPlainObject(tree.providerMetadata) && Object.hasOwn(tree.providerMetadata, bucketId)) {
      setDeep(updates, `providerMetadata.${bucketId}`, undefined);
    }
  } else {
    fail(`Unknown deleteProvider mode: ${mode}`, 'invalid_operation');
  }

  // Selection cascade for every removed entry.
  for (const entry of removedEntries) {
    const treeAfter = { ...tree, modelProviders: nextProviders };
    applyDeleteCascade(tree, updates, entry, treeAfter);
  }

  cleanupOrphanEnvKeys(updates, removedEntries, { ...tree, modelProviders: nextProviders }, removeEnvKeys);

  jsonc.persistSettingsUpdates(state.file.path, updates);
  return null;
}

function opSaveModel(state, payload) {
  const tree = requireParseable(state.file);
  const updates = {};
  const bucketId = String(payload.bucketId ?? '');
  if (!bucketId) fail('bucketId is required', 'invalid_operation');
  if (bucketId.includes('.')) {
    fail(`Provider id must not contain '.': ${bucketId}`, 'invalid_bucket');
  }
  const mapping = isPlainObject(tree.providerProtocol) ? tree.providerProtocol : undefined;
  const bucket = bucketOf(tree, bucketId);
  if (!Array.isArray(getDeep(tree, 'modelProviders')?.[bucketId])) {
    fail(`模型桶不存在：${bucketId}`, 'bucket_not_found');
  }

  const model = normalizeModelEntry(payload.model);
  const original = payload.originalId
    ? { id: String(payload.originalId), baseUrl: payload.originalBaseUrl ?? undefined }
    : null;

  // Protocol/wireApi validation against the bucket's routed protocol.
  let bucketProtocol;
  try {
    bucketProtocol = plan.resolveProviderProtocol(bucketId, mapping);
  } catch {
    bucketProtocol = undefined;
  }
  if (!bucketProtocol) {
    fail(
      `自定义桶 "${bucketId}" 缺少 providerProtocol 映射，CLI 无法路由其模型。`,
      'unrouted_bucket',
    );
  }
  if (model.wireApi !== undefined) {
    if (model.wireApi !== 'chat-completions' && model.wireApi !== 'responses') {
      fail('wireApi must be "chat-completions" or "responses".', 'invalid_wire_api');
    }
    try {
      plan.resolveModelProtocol(bucketId, model, mapping);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 'invalid_wire_api');
    }
  }

  const flagsRequireHttps = model.imageOnly || model.realtimeOnly || model.supportsImageGeneration;
  if (flagsRequireHttps) {
    if (!model.baseUrl || !/^https:\/\//i.test(model.baseUrl)) {
      fail('图像/实时语音路由必须声明明确的 https baseUrl。', 'invalid_base_url');
    }
    if (!model.envKey) {
      fail('图像/实时语音路由必须声明非空 envKey。', 'env_key_required');
    }
  }
  if (model.voiceOnly) {
    let route;
    try {
      route = plan.resolveModelProtocol(bucketId, model, mapping);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 'invalid_wire_api');
    }
    if (route !== AuthType.USE_OPENAI) {
      fail('Voice transcription requires the OpenAI Chat Completions API.', 'invalid_model_role');
    }
  }
  if (model.envKey) denyEnvKey(model.envKey);

  // Uniqueness: (resolved protocol, id, baseUrl) — first wins in the CLI; the
  // GUI refuses duplicates outright instead of silently shadowing.
  const identityKey = (entry) =>
    `${plan.tryResolveModelProtocol(bucketId, entry, mapping) ?? bucketId}\u0000${entry.id}\u0000${entry.baseUrl ?? ''}`;
  const newIdentity = identityKey(model);
  for (const [otherBucket, entries] of Object.entries(tree.modelProviders ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;
      const isOriginal =
        original &&
        otherBucket === bucketId &&
        entry.id === original.id &&
        (entry.baseUrl ?? '') === (original.baseUrl ?? '');
      if (isOriginal) continue;
      const otherIdentity = `${plan.tryResolveModelProtocol(otherBucket, entry, mapping) ?? otherBucket}\u0000${entry.id}\u0000${entry.baseUrl ?? ''}`;
      if (otherIdentity === newIdentity) {
        fail(
          `模型已存在（${model.id}${model.baseUrl ? ` @ ${model.baseUrl}` : ''}），协议/ID/端点三元组必须唯一。`,
          'duplicate_model',
        );
      }
    }
  }

  // Locate the target entry for in-place edit (position preserved).
  let index = -1;
  if (original) {
    index = bucket.findIndex(
      (entry) =>
        isPlainObject(entry) &&
        entry.id === original.id &&
        (entry.baseUrl ?? '') === (original.baseUrl ?? ''),
    );
    if (index < 0) fail('要编辑的模型不存在（可能已被外部修改）。', 'model_not_found');
  } else {
    const dupInBucket = bucket.findIndex(
      (entry) => isPlainObject(entry) && identityKey(entry) === newIdentity,
    );
    if (dupInBucket >= 0) {
      fail('模型已存在（同一桶内）。', 'duplicate_model');
    }
  }

  const nextBucket = [...bucket];
  if (index >= 0) nextBucket[index] = model;
  else nextBucket.push(model);
  setDeep(updates, `modelProviders.${bucketId}`, nextBucket);

  // Keep the active selection consistent across edits (rename/endpoint change).
  if (original) {
    const activeName = getDeep(tree, 'model.name') ?? '';
    const activeBaseUrl = getDeep(tree, 'model.baseUrl') ?? '';
    const target = {
      authType: plan.tryResolveModelProtocol(bucketId, original, mapping) ?? bucketId,
      modelId: original.id,
      ...(original.baseUrl ? { baseUrl: original.baseUrl } : {}),
    };
    const selectedType = getDeep(tree, 'security.auth.selectedType') ?? '';
    const activeAuthType = openaiFamily(selectedType) ? undefined : selectedType || undefined;
    if (
      isActiveModelSelection(activeName, activeBaseUrl, target, activeAuthType) &&
      (activeName !== model.id || activeBaseUrl !== (model.baseUrl ?? ''))
    ) {
      setDeep(updates, 'model.name', model.id);
      setDeep(updates, 'model.baseUrl', model.baseUrl ?? '');
    }
  }

  // On a rename, rewrite every id-based reference so selectors keep pointing
  // at this model (CLI has no rename path; its delete cascade clears instead,
  // but a rename preserves user intent — endpoint-pinned aux selectors whose
  // endpoint no longer matches are cleared rather than left dangling).
  if (original && original.id !== model.id) {
    const newBaseUrl = model.baseUrl ?? '';
    if (typeof tree.voiceModel === 'string' && tree.voiceModel.trim() === original.id) {
      setDeep(updates, 'voiceModel', model.id);
    }
    for (const key of [
      'imageModel',
      'advisorModel',
      'visionModel',
      'fastModel',
      'compactionModel',
    ]) {
      const value = tree[key];
      if (typeof value !== 'string' || !value) continue;
      const selector = parseAuxSelector(value);
      if (selector.modelId !== original.id) continue;
      if (selector.endpoint !== undefined && selector.endpoint !== newBaseUrl) {
        setDeep(updates, key, '');
        continue;
      }
      const head = (selector.authType ? `${selector.authType}:` : '') + model.id;
      setDeep(
        updates,
        key,
        selector.endpoint !== undefined ? head + String.fromCharCode(0) + selector.endpoint : head,
      );
    }
    if (typeof tree.modelFallbacks === 'string' && tree.modelFallbacks.length > 0) {
      const ids = tree.modelFallbacks.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.includes(original.id)) {
        setDeep(
          updates,
          'modelFallbacks',
          ids.map((id) => (id === original.id ? model.id : id)).join(','),
        );
      }
    }
  }

  // Retire the owning preset's version so CLI update checks can't re-template
  // over the edit (missing version ⇒ findAllPendingUpdates skips the provider).
  retireMetadataVersion(updates, original ? bucket[index] : model);

  jsonc.persistSettingsUpdates(state.file.path, updates);
  return null;
}

function opDeleteModel(state, payload) {
  const tree = requireParseable(state.file);
  const updates = {};
  const bucketId = String(payload.bucketId ?? '');
  const modelId = String(payload.id ?? '');
  if (!bucketId || !modelId) fail('bucketId and id are required', 'invalid_operation');
  const bucket = bucketOf(tree, bucketId);
  const targetBaseUrl = payload.baseUrl;
  let index = bucket.findIndex(
    (entry) =>
      isPlainObject(entry) &&
      entry.id === modelId &&
      (targetBaseUrl === undefined ||
        targetBaseUrl === null ||
        (entry.baseUrl ?? '') === targetBaseUrl),
  );
  if (index < 0) {
    index = bucket.findIndex((entry) => isPlainObject(entry) && entry.id === modelId);
  }
  if (index < 0) fail('要删除的模型不存在（可能已被外部修改）。', 'model_not_found');

  const removed = bucket[index];
  const nextBucket = bucket.filter((_, i) => i !== index);
  // Keep the (possibly empty) provider key — CLI parity (buildRemoval).
  setDeep(updates, `modelProviders.${bucketId}`, nextBucket);

  const nextProviders = { ...(tree.modelProviders ?? {}), [bucketId]: nextBucket };
  applyDeleteCascade(tree, updates, removed, { ...tree, modelProviders: nextProviders });

  retireMetadataVersion(updates, removed);
  cleanupOrphanEnvKeys(updates, [removed], { ...tree, modelProviders: nextProviders }, payload.removeEnvKeys !== false);

  jsonc.persistSettingsUpdates(state.file.path, updates);
  return null;
}

function opSetEnvKey(state, payload) {
  const tree = requireParseable(state.file);
  const updates = {};
  const key = String(payload.key ?? '');
  denyEnvKey(key);
  if (payload.value === null || payload.value === undefined) {
    setDeep(updates, `env.${key}`, undefined);
  } else {
    const value = String(payload.value);
    if (!value.trim()) fail('API key cannot be empty.', 'api_key_required');
    setDeep(updates, `env.${key}`, value);
  }
  jsonc.persistSettingsUpdates(state.file.path, updates);
  return null;
}

function normalizeModelIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    result.push(id);
  }
  return result;
}

function normalizeAdvanced(raw) {
  if (!isPlainObject(raw)) return undefined;
  const advanced = {};
  if (raw.enableThinking !== undefined) advanced.enableThinking = Boolean(raw.enableThinking);
  if (isPlainObject(raw.multimodal)) {
    const multimodal = {};
    for (const key of ['image', 'video', 'audio', 'pdf']) {
      if (raw.multimodal[key] !== undefined) multimodal[key] = Boolean(raw.multimodal[key]);
    }
    if (Object.keys(multimodal).length > 0) advanced.multimodal = multimodal;
  }
  if (raw.contextWindowSize !== undefined) {
    const size = Number(raw.contextWindowSize);
    if (!Number.isInteger(size) || size < 0) fail('Context window must be a non-negative integer.', 'invalid_advanced');
    advanced.contextWindowSize = size;
  }
  if (raw.maxTokens !== undefined) {
    const tokens = Number(raw.maxTokens);
    if (!Number.isInteger(tokens) || tokens < 0) fail('maxTokens must be a non-negative integer.', 'invalid_advanced');
    advanced.maxTokens = tokens;
  }
  if (raw.replaceExisting !== undefined) advanced.replaceExisting = Boolean(raw.replaceExisting);
  if (Object.keys(advanced).length === 0) return undefined;
  return advanced;
}

const MODEL_FLAG_KEYS = [
  'imageOnly',
  'voiceOnly',
  'realtimeOnly',
  'visionOnly',
  'fastOnly',
  'supportsImageGeneration',
];

function normalizeModelEntry(raw) {
  if (!isPlainObject(raw)) fail('model payload must be an object', 'invalid_model');
  const id = String(raw.id ?? '').trim();
  if (!id) fail('模型 ID 不能为空。', 'invalid_model');
  const model = { id };

  if (raw.wireApi !== undefined && raw.wireApi !== null && raw.wireApi !== '') {
    model.wireApi = String(raw.wireApi);
  }
  model.name = raw.name !== undefined && String(raw.name).trim() ? String(raw.name) : id;
  if (raw.description !== undefined && String(raw.description).trim()) {
    model.description = String(raw.description);
  }
  if (isPlainObject(raw.capabilities)) {
    model.capabilities = sanitizeJsonBranch(raw.capabilities, 'capabilities');
  }
  const baseUrl = httpUrlOrEmpty(raw.baseUrl);
  model.baseUrl = baseUrl;
  if (raw.envKey !== undefined && String(raw.envKey).trim()) {
    const envKey = String(raw.envKey).trim();
    if (!ENV_KEY_NAME_RE.test(envKey)) {
      fail(`Invalid environment variable name: ${envKey}`, 'invalid_env_key');
    }
    model.envKey = envKey;
  } else if (raw.envKey !== undefined && raw.envKey !== null && raw.envKey !== '') {
    fail('envKey 不能为空字符串。', 'invalid_model');
  }
  for (const flag of MODEL_FLAG_KEYS) {
    if (raw[flag] === true) model[flag] = true;
  }
  if (isPlainObject(raw.generationConfig)) {
    const generationConfig = sanitizeGenerationConfig(raw.generationConfig);
    if (Object.keys(generationConfig).length > 0) model.generationConfig = generationConfig;
  }
  return model;
}

const GENERATION_CONFIG_KEYS = new Set([
  'samplingParams',
  'timeout',
  'streamIdleTimeoutMs',
  'maxRetries',
  'retryInitialDelayMs',
  'retryMaxDelayMs',
  'retryErrorCodes',
  'enableCacheControl',
  'schemaCompliance',
  'reasoning',
  'customHeaders',
  'extra_body',
  'thinkingMandatory',
  'contextWindowSize',
  'modalities',
]);

function sanitizeGenerationConfig(raw) {
  const out = {};
  if (isPlainObject(raw.samplingParams)) {
    const sampling = {};
    for (const key of ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty', 'top_k']) {
      if (raw.samplingParams[key] === undefined || raw.samplingParams[key] === null || raw.samplingParams[key] === '') continue;
      const num = Number(raw.samplingParams[key]);
      if (!Number.isFinite(num)) fail(`samplingParams.${key} must be a number`, 'invalid_model');
      sampling[key] = num;
    }
    if (Object.keys(sampling).length > 0) out.samplingParams = sampling;
  }
  for (const key of ['timeout', 'streamIdleTimeoutMs', 'maxRetries', 'retryInitialDelayMs', 'retryMaxDelayMs']) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    const num = Number(raw[key]);
    if (!Number.isInteger(num) || num < 0) fail(`${key} must be a non-negative integer`, 'invalid_model');
    out[key] = num;
  }
  if (Array.isArray(raw.retryErrorCodes)) {
    out.retryErrorCodes = raw.retryErrorCodes.map((code) => Number(code)).filter((n) => Number.isFinite(n));
  }
  if (raw.enableCacheControl !== undefined) out.enableCacheControl = Boolean(raw.enableCacheControl);
  if (typeof raw.schemaCompliance === 'string' && raw.schemaCompliance) {
    out.schemaCompliance = raw.schemaCompliance;
  }
  if (isPlainObject(raw.reasoning)) out.reasoning = sanitizeJsonBranch(raw.reasoning, 'reasoning');
  if (isPlainObject(raw.customHeaders)) {
    const headers = {};
    for (const [header, value] of Object.entries(raw.customHeaders)) {
      if (value === null || value === undefined) continue;
      headers[header] = String(value);
    }
    if (Object.keys(headers).length > 0) out.customHeaders = headers;
  }
  if (isPlainObject(raw.extra_body)) out.extra_body = sanitizeJsonBranch(raw.extra_body, 'extra_body');
  if (raw.thinkingMandatory !== undefined) out.thinkingMandatory = Boolean(raw.thinkingMandatory);
  if (raw.contextWindowSize !== undefined && raw.contextWindowSize !== null && raw.contextWindowSize !== '') {
    const size = Number(raw.contextWindowSize);
    if (!Number.isInteger(size) || size <= 0) fail('contextWindowSize must be a positive integer', 'invalid_model');
    out.contextWindowSize = size;
  }
  if (isPlainObject(raw.modalities)) {
    const modalities = {};
    for (const key of ['image', 'video', 'audio', 'pdf']) {
      if (raw.modalities[key] !== undefined) modalities[key] = Boolean(raw.modalities[key]);
    }
    if (Object.keys(modalities).length > 0) out.modalities = modalities;
  }
  return out;
}

function sanitizeJsonBranch(raw, field) {
  const cloned = JSON.parse(JSON.stringify(raw));
  assertNoPrototypePollution(cloned, field);
  return cloned;
}

function assertNoPrototypePollution(value, field) {
  if (Array.isArray(value)) {
    for (const item of value) if (isPlainObject(item) || Array.isArray(item)) assertNoPrototypePollution(item, field);
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail(`Reserved segment in ${field}: ${key}`, 'reserved_key');
      }
      assertNoPrototypePollution(value[key], field);
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher / entry points
// ---------------------------------------------------------------------------

const OPS = {
  snapshot: opSnapshot,
  saveProvider: opSaveProvider,
  deleteProvider: opDeleteProvider,
  saveModel: opSaveModel,
  deleteModel: opDeleteModel,
  setEnvKey: opSetEnvKey,
};

/**
 * Run one provider-config operation.
 *
 * @param {string} settingsPath absolute path of the user settings.json
 * @param {string} projectSettingsPath absolute path of the project settings.json (may be '')
 * @param {string} payloadJson  JSON {op, ...}
 * @returns {{ok:true, snapshot:object} | {ok:false, code:string, message:string}}
 */
function runProviderConfigOp(settingsPath, projectSettingsPath, payloadJson) {
  let payload;
  try {
    payload = JSON.parse(payloadJson || '{}');
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_payload',
      message: `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const op = OPS[payload?.op];
  if (!op) {
    return { ok: false, code: 'unknown_op', message: `Unknown op: ${payload?.op}` };
  }
  try {
    const file = loadFile(settingsPath);
    const projectFile = projectSettingsPath
      ? loadFile(projectSettingsPath)
      : null;
    const state = {
      file,
      projectFile,
      processEnv: process.env,
      settingsPath,
    };
    const detail = op(state, payload);
    if (detail !== null && detail !== undefined && detail.ok === false) return detail;
    const fresh = loadFile(settingsPath);
    const freshProject = projectSettingsPath ? loadFile(projectSettingsPath) : null;
    return {
      ok: true,
      op: payload.op,
      snapshot: buildSnapshot(fresh, freshProject, process.env),
    };
  } catch (error) {
    if (error instanceof OpError || error instanceof PlanError || error instanceof jsonc.SettingsWriteError) {
      return {
        ok: false,
        code: error instanceof OpError ? error.code : error.name === 'PlanError' ? error.step || 'plan' : error.code || 'write_failed',
        message: error.message,
      };
    }
    return {
      ok: false,
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  runProviderConfigOp,
  // Exported for tests.
  _internals: {
    buildSnapshot,
    loadFile,
    normalizeAdvanced,
    normalizeModelEntry,
    normalizeModelIds,
  },
};
