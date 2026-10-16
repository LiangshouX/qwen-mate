/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider install-plan builder — a CommonJS port of the Qwen Code CLI's
 * packages/core/src/providers/provider-config.ts (version 0.25.0), plus the
 * protocol-resolution subset of models/modelRegistry.ts.
 *
 * Kept in step with the CLI so a GUI-driven provider install produces the
 * exact same plan the CLI's /auth flow would: same model objects (same key
 * order — providerMetadata.version hashes JSON.stringify output, so insertion
 * order is part of the contract), same ownership rules, same merge strategy.
 */
'use strict';

const { createHash } = require('node:crypto');

// ---------------------------------------------------------------------------
// AuthType (packages/core/src/utils/auth-type.ts) + protocol resolution
// ---------------------------------------------------------------------------

const AuthType = {
  USE_OPENAI: 'openai',
  USE_OPENAI_RESPONSES: 'openai-responses',
  QWEN_OAUTH: 'qwen-oauth',
  USE_GEMINI: 'gemini',
  USE_VERTEX_AI: 'vertex-ai',
  USE_ANTHROPIC: 'anthropic',
};

const KNOWN_AUTH_TYPES = new Set(Object.values(AuthType));

function validateAuthTypeKey(key) {
  return KNOWN_AUTH_TYPES.has(key) ? key : undefined;
}

function resolveProviderProtocol(providerId, providerProtocol) {
  const explicit =
    providerProtocol && Object.hasOwn(providerProtocol, providerId)
      ? providerProtocol[providerId]
      : undefined;
  if (explicit !== undefined) return validateAuthTypeKey(explicit);
  return validateAuthTypeKey(providerId);
}

function resolveModelProtocol(providerId, model, providerProtocol) {
  const protocol = resolveProviderProtocol(providerId, providerProtocol);
  if (!protocol || model.wireApi === undefined) return protocol;
  if (model.wireApi !== 'chat-completions' && model.wireApi !== 'responses') {
    throw new Error(
      `Invalid wireApi "${model.wireApi}" for provider "${providerId}". Expected "chat-completions" or "responses".`,
    );
  }
  if (protocol !== AuthType.USE_OPENAI && protocol !== AuthType.USE_OPENAI_RESPONSES) {
    throw new Error(
      `Provider "${providerId}" uses protocol "${protocol}"; wireApi is only supported for OpenAI-compatible models.`,
    );
  }
  return model.wireApi === 'responses' ? AuthType.USE_OPENAI_RESPONSES : AuthType.USE_OPENAI;
}

function tryResolveModelProtocol(providerId, model, providerProtocol) {
  try {
    return resolveModelProtocol(providerId, model, providerProtocol);
  } catch {
    return undefined;
  }
}

function isImageGenerationCapable(model) {
  return Boolean(model.supportsImageGeneration) || Boolean(model.imageOnly);
}

// ---------------------------------------------------------------------------
// Environment key / naming / ownership
// ---------------------------------------------------------------------------

function resolveEnvKey(config, inputs) {
  const protocol = inputs.protocol ?? config.protocol;
  const key =
    typeof config.envKey === 'function' ? config.envKey(protocol, inputs.baseUrl) : config.envKey;
  return config.id === 'custom-openai-compatible' && inputs.advancedConfig?.purpose
    ? `${key}_${inputs.advancedConfig.purpose.toUpperCase()}`
    : key;
}

function resolveModelNamePrefix(config, baseUrl) {
  return typeof config.modelNamePrefix === 'function'
    ? config.modelNamePrefix(baseUrl)
    : config.modelNamePrefix;
}

function resolveOwnsModel(config) {
  if (config.ownsModel) return config.ownsModel;
  if (typeof config.envKey !== 'string' || typeof config.modelNamePrefix !== 'string') {
    return undefined;
  }
  const envKey = config.envKey;
  const prefix = config.modelNamePrefix;
  if (!prefix) return (model) => model.envKey === envKey;
  const namePrefix = `[${prefix}] `;
  return (model) =>
    model.envKey === envKey &&
    typeof model.name === 'string' &&
    model.name.startsWith(namePrefix);
}

// ---------------------------------------------------------------------------
// Model construction (specToModelConfig / buildModelConfigs / …)
// ---------------------------------------------------------------------------

function buildGenerationConfig(spec, protocol) {
  const parts = {};
  let hasAny = false;
  if (spec.enableThinking) {
    if (protocol === AuthType.USE_OPENAI_RESPONSES) {
      parts.reasoning = { effort: 'medium' };
    } else {
      parts.extra_body = { enable_thinking: true };
    }
    hasAny = true;
  }
  if (spec.thinkingMandatory) {
    parts.thinkingMandatory = true;
    hasAny = true;
  }
  if (spec.contextWindowSize) {
    parts.contextWindowSize = spec.contextWindowSize;
    hasAny = true;
  }
  if (spec.modalities && Object.values(spec.modalities).some(Boolean)) {
    parts.modalities = spec.modalities;
    hasAny = true;
  }
  return hasAny ? parts : undefined;
}

function buildAdvancedGenerationConfig(advCfg, protocol) {
  const cfg = {};
  let hasAny = false;
  if (advCfg?.enableThinking) {
    if (protocol === AuthType.USE_OPENAI_RESPONSES) {
      cfg.reasoning = { effort: 'medium' };
    } else {
      cfg.extra_body = { enable_thinking: true };
    }
    hasAny = true;
  }
  if (advCfg?.multimodal && Object.values(advCfg.multimodal).some(Boolean)) {
    cfg.modalities = advCfg.multimodal;
    hasAny = true;
  }
  if (advCfg?.contextWindowSize && advCfg.contextWindowSize > 0) {
    cfg.contextWindowSize = advCfg.contextWindowSize;
    hasAny = true;
  }
  if (advCfg?.maxTokens && advCfg.maxTokens > 0) {
    cfg.samplingParams = { max_tokens: advCfg.maxTokens };
    hasAny = true;
  }
  return hasAny ? cfg : undefined;
}

function specToModelConfig(spec, prefix, baseUrl, envKey, protocol) {
  const genConfig = buildGenerationConfig(spec, protocol);
  return {
    id: spec.id,
    name: prefix ? `[${prefix}] ${spec.id}` : spec.id,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.capabilities ? { capabilities: spec.capabilities } : {}),
    baseUrl,
    envKey,
    ...(spec.supportsImageGeneration ? { supportsImageGeneration: true } : {}),
    ...(spec.imageOnly ? { imageOnly: true } : {}),
    ...(genConfig ? { generationConfig: genConfig } : {}),
  };
}

function applyProviderCustomHeaders(models, config) {
  if (!config.customHeaders) return models;
  return models.map((model) => {
    const existing = model.generationConfig ?? {};
    return {
      ...model,
      generationConfig: {
        ...existing,
        customHeaders: {
          ...(config.customHeaders ?? {}),
          ...(existing.customHeaders ?? {}),
        },
      },
    };
  });
}

function buildModelConfigs(config, inputs) {
  const envKey = resolveEnvKey(config, inputs);
  const prefix = resolveModelNamePrefix(config, inputs.baseUrl);
  const protocol = resolveModelProtocol(inputs.protocol ?? config.protocol, inputs);

  let models;

  if (config.models && !config.modelsEditable) {
    models = config.models.map((spec) =>
      specToModelConfig(spec, prefix, inputs.baseUrl, envKey, protocol),
    );
  } else if (config.models && config.modelsEditable) {
    const specMap = new Map(config.models.map((s) => [s.id.toLowerCase(), s]));
    models = inputs.modelIds.map((id) => {
      const spec = specMap.get(id.toLowerCase());
      if (spec) {
        return specToModelConfig({ ...spec, id }, prefix, inputs.baseUrl, envKey, protocol);
      }
      const genConfig = buildAdvancedGenerationConfig(inputs.advancedConfig, protocol);
      return {
        id,
        name: prefix ? `[${prefix}] ${id}` : id,
        baseUrl: inputs.baseUrl,
        envKey,
        ...(genConfig ? { generationConfig: genConfig } : {}),
      };
    });
  } else {
    const advCfg = inputs.advancedConfig;
    const displayName = (id) => (prefix ? `[${prefix}] ${id}` : id);
    models = inputs.modelIds.map((id) => {
      const genConfig = buildAdvancedGenerationConfig(advCfg, protocol);
      return {
        id,
        name: displayName(id),
        baseUrl: inputs.baseUrl,
        envKey,
        ...(advCfg?.purpose === 'image'
          ? { supportsImageGeneration: true, imageOnly: true }
          : advCfg?.purpose === 'voice'
            ? { voiceOnly: true }
            : {}),
        ...(genConfig ? { generationConfig: genConfig } : {}),
      };
    });
  }

  return applyProviderCustomHeaders(models, config);
}

// ---------------------------------------------------------------------------
// Version tracking (providerMetadata)
// ---------------------------------------------------------------------------

const PROVIDER_METADATA_NS = 'providerMetadata';

function resolveMetadataKey(config) {
  if (!config.models) return undefined;
  if (config.id.includes('.')) {
    throw new Error(
      `Provider id must not contain '.' (would corrupt providerMetadata.${config.id} dotted writes): ${config.id}`,
    );
  }
  return config.id;
}

function computeModelListVersion(models) {
  return createHash('sha256').update(JSON.stringify(models)).digest('hex');
}

function resolveProviderState(config, baseUrl, models) {
  const key = resolveMetadataKey(config);
  if (key) {
    return {
      [`${PROVIDER_METADATA_NS}.${key}`]: {
        version: computeModelListVersion(models),
        baseUrl,
      },
    };
  }
  return undefined;
}

function retireProviderState(config) {
  const key = resolveMetadataKey(config);
  return key ? { [`${PROVIDER_METADATA_NS}.${key}`]: { version: undefined } } : undefined;
}

// ---------------------------------------------------------------------------
// Base URL helpers
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URLS = {
  [AuthType.USE_OPENAI]: 'https://api.openai.com/v1',
  [AuthType.USE_OPENAI_RESPONSES]: 'https://api.openai.com',
  [AuthType.USE_ANTHROPIC]: 'https://api.anthropic.com/v1',
  [AuthType.USE_GEMINI]: 'https://generativelanguage.googleapis.com',
};

function getDefaultBaseUrlForProtocol(protocol) {
  if (protocol === undefined) return '';
  return DEFAULT_BASE_URLS[protocol] ?? '';
}

function normalizeBaseUrlForMatching(baseUrl) {
  if (baseUrl === undefined) return '';
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end -= 1;
  return end === baseUrl.length ? baseUrl : baseUrl.slice(0, end);
}

function resolveBaseUrl(config, selectedBaseUrl) {
  if (typeof config.baseUrl === 'string') return config.baseUrl;
  if (Array.isArray(config.baseUrl)) {
    const normalized = normalizeBaseUrlForMatching(selectedBaseUrl);
    const match = config.baseUrl.find(
      (opt) => normalizeBaseUrlForMatching(opt.url) === normalized,
    );
    if (match) return match.url;
    return config.baseUrl[0]?.url ?? selectedBaseUrl ?? '';
  }
  return selectedBaseUrl ?? '';
}

function getDefaultModelIds(config) {
  return config.models?.map((s) => s.id) ?? [];
}

// ---------------------------------------------------------------------------
// Protocol-wide model listing (provider-config.ts getModelsForProviderProtocol)
// ---------------------------------------------------------------------------

function isProviderModelConfig(value) {
  return (
    typeof value === 'object' && value !== null && typeof value.id === 'string'
  );
}

function getModelsForProviderProtocol(modelProviders, protocol, providerProtocol) {
  const canonicalProtocol =
    protocol === AuthType.USE_OPENAI_RESPONSES ? AuthType.USE_OPENAI : protocol;
  const result = [];
  for (const [providerId, raw] of Object.entries(modelProviders ?? {})) {
    if (!Array.isArray(raw)) continue;
    for (const model of raw) {
      if (!isProviderModelConfig(model)) continue;
      const effective = tryResolveModelProtocol(providerId, model, providerProtocol);
      if (
        effective !== canonicalProtocol &&
        !(
          canonicalProtocol === AuthType.USE_OPENAI &&
          effective === AuthType.USE_OPENAI_RESPONSES
        )
      ) {
        continue;
      }
      result.push(
        effective === AuthType.USE_OPENAI_RESPONSES
          ? { ...model, wireApi: 'responses' }
          : canonicalProtocol === AuthType.USE_OPENAI && providerId !== canonicalProtocol
            ? { ...model, wireApi: 'chat-completions' }
            : model,
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// buildInstallPlan (provider-config.ts) — the heart of /auth's write intent
// ---------------------------------------------------------------------------

class PlanError extends Error {
  constructor(message, step) {
    super(message);
    this.name = 'PlanError';
    this.step = step || 'plan';
  }
}

function isSameModelIdentity(a, b) {
  return a.id === b.id && (a.baseUrl ?? '') === (b.baseUrl ?? '');
}

/**
 * Build the install plan for `config` + user inputs against the current
 * `modelProviders` map. Mirrors the CLI: env credential slot, patched model
 * bucket, model selection and providerMetadata versioning.
 *
 * @returns {{providerId, authType, env, modelSelection?, modelProviders, providerState?}}
 */
function buildInstallPlan(config, inputs, existingModels = [], selection) {
  const inputProtocol = inputs.protocol ?? config.protocol;
  const protocol = resolveModelProtocol(inputProtocol, inputs);
  const isOpenAI = protocol === AuthType.USE_OPENAI || protocol === AuthType.USE_OPENAI_RESPONSES;
  const savedProtocol = isOpenAI ? AuthType.USE_OPENAI : protocol;
  const wireApi =
    inputs.wireApi ??
    (inputProtocol === AuthType.USE_OPENAI_RESPONSES ? 'responses' : undefined);
  if (inputProtocol === AuthType.USE_OPENAI_RESPONSES) {
    inputs = { ...inputs, protocol: savedProtocol, wireApi };
  }
  let envKey = resolveEnvKey(config, inputs);
  const providerOwns = resolveOwnsModel(config);
  const builtModels = buildModelConfigs(config, inputs);
  const preserveSavedApis = isOpenAI && !config.protocolOptions && wireApi === undefined;
  let models = wireApi
    ? builtModels.map((model) => (model.wireApi === undefined ? { ...model, wireApi } : model))
    : builtModels;

  if (preserveSavedApis && existingModels.length) {
    const responsesModels = buildModelConfigs(config, { ...inputs, wireApi: 'responses' });
    models = builtModels.flatMap((model, index) => {
      if (model.wireApi !== undefined) return [model];
      const saved = existingModels.filter(
        (entry) =>
          providerOwns?.(entry) &&
          entry.id === model.id &&
          entry.baseUrl === model.baseUrl &&
          tryResolveModelProtocol(savedProtocol, entry) !== undefined,
      );
      if (!saved.length) return [model];
      const seen = new Set();
      return saved.flatMap((entry) => {
        const route = resolveModelProtocol(savedProtocol, entry);
        if (seen.has(route)) return [];
        seen.add(route);
        return [
          {
            ...(route === AuthType.USE_OPENAI_RESPONSES ? responsesModels[index] : model),
            ...(entry.wireApi !== undefined ? { wireApi: entry.wireApi } : {}),
          },
        ];
      });
    });
  }

  const providerState = resolveProviderState(config, inputs.baseUrl, models);

  if (
    config.id === 'custom-openai-compatible' &&
    existingModels?.some(
      (entry) =>
        providerOwns?.(entry) &&
        (entry.imageOnly || entry.voiceOnly || entry.realtimeOnly) &&
        models.some((model) => model.id === entry.id) &&
        typeof entry.baseUrl === 'string' &&
        entry.baseUrl !== inputs.baseUrl &&
        resolveEnvKey(config, { ...inputs, baseUrl: entry.baseUrl }) === envKey,
    )
  ) {
    throw new PlanError(
      'A service model already uses this credential endpoint. Reconnect using its exact saved base URL.',
      'modelPurpose',
    );
  }

  if (existingModels?.length && !inputs.advancedConfig?.purpose) {
    models = models.map((model) => {
      const existing = existingModels.find(
        (entry) =>
          (providerOwns?.(entry) || config.mergeModelsByIdentity) &&
          entry.id === model.id &&
          entry.baseUrl === model.baseUrl &&
          tryResolveModelProtocol(savedProtocol, entry) ===
            resolveModelProtocol(savedProtocol, model),
      );
      if (!existing) return model;
      const preservedGeneration = { ...existing.generationConfig };
      const advanced = inputs.advancedConfig;
      if (!config.models && advanced) {
        if (advanced.replaceExisting) {
          delete preservedGeneration.contextWindowSize;
          if (preservedGeneration.samplingParams) {
            preservedGeneration.samplingParams = { ...preservedGeneration.samplingParams };
            delete preservedGeneration.samplingParams.max_tokens;
            if (!Object.keys(preservedGeneration.samplingParams).length) {
              delete preservedGeneration.samplingParams;
            }
          }
        }
        if (advanced.replaceExisting || advanced.multimodal !== undefined) {
          delete preservedGeneration.modalities;
        }
        if (advanced.replaceExisting || advanced.enableThinking !== undefined) {
          if (preservedGeneration.extra_body) {
            preservedGeneration.extra_body = { ...preservedGeneration.extra_body };
            delete preservedGeneration.extra_body['enable_thinking'];
            if (!Object.keys(preservedGeneration.extra_body).length) {
              delete preservedGeneration.extra_body;
            }
          }
          if (protocol === AuthType.USE_OPENAI_RESPONSES) delete preservedGeneration.reasoning;
        }
      }
      const generationConfig =
        Object.keys(preservedGeneration).length || model.generationConfig
          ? {
              ...preservedGeneration,
              ...model.generationConfig,
              ...(preservedGeneration.extra_body || model.generationConfig?.extra_body
                ? {
                    extra_body: {
                      ...preservedGeneration.extra_body,
                      ...model.generationConfig?.extra_body,
                    },
                  }
                : {}),
              ...(preservedGeneration.contextWindowSize !== undefined &&
              inputs.advancedConfig?.contextWindowSize === undefined
                ? { contextWindowSize: preservedGeneration.contextWindowSize }
                : {}),
              ...(preservedGeneration.samplingParams || model.generationConfig?.samplingParams
                ? {
                    samplingParams: {
                      ...preservedGeneration.samplingParams,
                      ...model.generationConfig?.samplingParams,
                    },
                  }
                : {}),
              ...(preservedGeneration.customHeaders || model.generationConfig?.customHeaders
                ? {
                    customHeaders: {
                      ...preservedGeneration.customHeaders,
                      ...model.generationConfig?.customHeaders,
                    },
                  }
                : {}),
            }
          : undefined;
      return {
        ...existing,
        ...model,
        name: existing?.name ?? model.name,
        generationConfig,
        ...(existing?.supportsImageGeneration ? { supportsImageGeneration: true } : {}),
        ...(existing?.imageOnly ? { imageOnly: true } : {}),
        ...(existing?.voiceOnly ? { voiceOnly: true } : {}),
        ...(existing?.realtimeOnly ? { realtimeOnly: true } : {}),
        ...(existing.envKey ? { envKey: existing.envKey } : {}),
      };
    });
  }

  if (models.length > 0) {
    const conversation = models.filter(
      (model) => !model.imageOnly && !model.voiceOnly && !model.realtimeOnly,
    );
    const credentialModels = conversation.length ? conversation : models;
    const keys = new Set(credentialModels.map((model) => model.envKey));
    if (keys.size > 1 && inputs.apiKey) {
      throw new PlanError(
        'Reconnect models with different credential references separately to preserve their independent API keys.',
      );
    }
    if (credentialModels[0]?.envKey) envKey = credentialModels[0].envKey;
  }

  const ownsModel = config.mergeModelsByIdentity ? undefined : resolveOwnsModel(config);
  for (const model of models) {
    const modelProtocol = resolveModelProtocol(savedProtocol, model);
    if (model.voiceOnly && modelProtocol !== AuthType.USE_OPENAI) {
      throw new PlanError(
        'Voice transcription requires the OpenAI Chat Completions API.',
        'modelPurpose',
      );
    }
  }

  const selectedModels =
    preserveSavedApis && selection?.id
      ? models.filter(
          (model) =>
            !model.imageOnly &&
            !model.voiceOnly &&
            !model.realtimeOnly &&
            model.id === selection.id &&
            (!selection.baseUrl || model.baseUrl === selection.baseUrl),
        )
      : [];
  const firstModel =
    selectedModels.find(
      (model) => resolveModelProtocol(savedProtocol, model) === selection?.authType,
    ) ??
    selectedModels[0] ??
    models.find((model) => !model.imageOnly && !model.voiceOnly && !model.realtimeOnly);

  if (models.length === 0) {
    throw new PlanError(
      `No models configured for provider "${config.id}". Check model list or provider configuration.`,
    );
  }

  const firstModelId = firstModel?.id;
  const modelSelection =
    firstModelId === undefined
      ? undefined
      : {
          modelId: firstModelId,
          ...(config.mergeModelsByIdentity && firstModel?.baseUrl
            ? { baseUrl: firstModel.baseUrl }
            : {}),
        };

  return {
    providerId: config.id,
    authType: firstModel ? resolveModelProtocol(savedProtocol, firstModel) : savedProtocol,
    env: { [envKey]: inputs.apiKey },
    ...(modelSelection ? { modelSelection } : {}),
    modelProviders: [
      {
        authType: savedProtocol,
        models,
        mergeStrategy: 'prepend-and-remove-owned',
        ...(ownsModel ? { ownsModel } : {}),
      },
    ],
    providerState:
      models.every((model) => model.wireApi === undefined) && protocol === config.protocol
        ? providerState
        : retireProviderState(config),
  };
}

// ---------------------------------------------------------------------------
// Model-bucket merge (install.ts applyModelProvidersPatch)
// ---------------------------------------------------------------------------

function applyModelProvidersPatch(existingModelProviders, patch, mapping) {
  let currentPatch = patch;
  if (
    patch.authType === AuthType.USE_OPENAI &&
    resolveProviderProtocol(patch.authType, mapping) === AuthType.USE_OPENAI_RESPONSES
  ) {
    currentPatch = {
      ...patch,
      models: patch.models.map((model) => ({
        ...model,
        wireApi: model.wireApi ?? 'chat-completions',
      })),
    };
  }
  const existingModels = existingModelProviders[currentPatch.authType] ?? [];

  let updatedModels;
  if (currentPatch.mergeStrategy === 'append') {
    updatedModels = [...existingModels, ...currentPatch.models];
  } else {
    const owns = currentPatch.ownsModel;
    const preservedModels = existingModels.filter((model) => {
      if (owns) {
        return (
          !owns(model) ||
          !currentPatch.models.some(
            (newModel) =>
              resolveModelProtocol(currentPatch.authType, newModel, mapping) ===
              tryResolveModelProtocol(currentPatch.authType, model, mapping),
          )
        );
      }
      return !currentPatch.models.some(
        (newModel) =>
          isSameModelIdentity(newModel, model) &&
          resolveModelProtocol(currentPatch.authType, newModel, mapping) ===
            tryResolveModelProtocol(currentPatch.authType, model, mapping),
      );
    });

    updatedModels =
      currentPatch.mergeStrategy === 'replace-owned'
        ? [...preservedModels, ...currentPatch.models]
        : [...currentPatch.models, ...preservedModels];
  }

  return { ...existingModelProviders, [currentPatch.authType]: updatedModels };
}

/**
 * Role-change guard from install.ts (modelPurpose checks) over the bucket the
 * patch rewrites: refuse an install that would drop conversation or service
 * models, or swap a model between conversation/service roles.
 */
function assertPurposeSafe(previousBucketModels, patch, preserveSelection) {
  const changesRole = previousBucketModels.some((existing) =>
    patch.models.some(
      (model) =>
        (isSameModelIdentity(existing, model) ||
          (existing.id === model.id &&
            patch.ownsModel?.(existing) &&
            (preserveSelection || patch.mergeStrategy !== 'append'))) &&
        (Boolean(existing.imageOnly) !== Boolean(model.imageOnly) ||
          Boolean(existing.voiceOnly) !== Boolean(model.voiceOnly) ||
          Boolean(existing.realtimeOnly) !== Boolean(model.realtimeOnly) ||
          (isImageGenerationCapable(existing) && !isImageGenerationCapable(model))),
    ),
  );
  const removesConversation =
    preserveSelection &&
    previousBucketModels.some(
      (existing) =>
        !existing.imageOnly &&
        !existing.voiceOnly &&
        !existing.realtimeOnly &&
        (patch.ownsModel?.(existing) ??
          patch.models.some((model) => isSameModelIdentity(model, existing))),
    );
  const removesService =
    !preserveSelection &&
    patch.mergeStrategy !== 'append' &&
    previousBucketModels.some(
      (existing) =>
        (existing.imageOnly || existing.voiceOnly || existing.realtimeOnly) &&
        patch.ownsModel?.(existing) &&
        !patch.models.some((model) => model.id === existing.id),
    );
  if (changesRole || removesConversation || removesService) {
    throw new PlanError(
      removesConversation
        ? 'This install would remove existing conversation models. Include them in the provider selection, or add the service model with Custom Provider.'
        : removesService
          ? 'This install would remove existing service models. Include them in the provider selection, or add the conversation model with Custom Provider.'
          : 'This install would replace a model configured for another purpose. Use a different model ID or endpoint.',
      'modelPurpose',
    );
  }
}

// ---------------------------------------------------------------------------
// Existing-model lookup (findExistingProviderModels)
// ---------------------------------------------------------------------------

function findExistingProviderModels(config, modelProviders, mapping, selection) {
  const ownsModel = resolveOwnsModel(config);
  if (!ownsModel || !modelProviders) return undefined;
  const protocols = config.protocolOptions?.length ? config.protocolOptions : [config.protocol];
  for (const providerProtocol of protocols) {
    const models = getModelsForProviderProtocol(modelProviders, providerProtocol, mapping).filter(
      ownsModel,
    );
    if (!models.length) continue;
    const selectedModels = selection?.id
      ? models.filter(
          (model) =>
            model.id === selection.id &&
            (!selection.baseUrl || model.baseUrl === selection.baseUrl),
        )
      : [];
    const selected =
      selectedModels.find(
        (model) => resolveModelProtocol(providerProtocol, model, mapping) === selection?.authType,
      ) ??
      selectedModels[0] ??
      models[0];
    const protocol = resolveModelProtocol(providerProtocol, selected, mapping);
    return {
      protocol,
      models: models.filter(
        (model) => resolveModelProtocol(providerProtocol, model, mapping) === protocol,
      ),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Steps (shouldShowStep) + credential matching (providerMatchesCredentials)
// ---------------------------------------------------------------------------

function shouldShowStep(config, step, protocol) {
  const proto = protocol ?? config.protocol;
  switch (step) {
    case 'protocol':
      return Array.isArray(config.protocolOptions) && config.protocolOptions.length > 1;
    case 'wireApi':
      return (
        Boolean(config.protocolOptions?.length) &&
        (proto === AuthType.USE_OPENAI || proto === AuthType.USE_OPENAI_RESPONSES)
      );
    case 'baseUrl':
      return config.baseUrl === undefined || Array.isArray(config.baseUrl);
    case 'apiKey':
      return true;
    case 'models':
      return !config.models || config.modelsEditable === true;
    case 'advancedConfig':
      return config.showAdvancedConfig === true;
    default:
      return false;
  }
}

function providerMatchesCredentials(config, baseUrl, envKey) {
  let configEnvKey;
  if (typeof config.envKey === 'string') {
    configEnvKey = config.envKey;
  } else if (typeof config.envKey === 'function' && baseUrl) {
    const protocols = config.protocolOptions?.length ? config.protocolOptions : [config.protocol];
    for (const proto of protocols) {
      try {
        const derived = config.envKey(proto, baseUrl);
        if (
          derived === envKey ||
          (config.id === 'custom-openai-compatible' &&
            (envKey === `${derived}_IMAGE` || envKey === `${derived}_VOICE`))
        ) {
          configEnvKey = envKey;
          break;
        }
      } catch {
        // Programming error in an envKey fn — treat as no match (CLI logs host only).
      }
    }
  }
  if (configEnvKey !== envKey) return false;
  if (typeof config.baseUrl === 'string') return config.baseUrl === baseUrl;
  if (Array.isArray(config.baseUrl)) return config.baseUrl.some((opt) => opt.url === baseUrl);
  if (config.baseUrl === undefined && configEnvKey !== undefined) return Boolean(baseUrl);
  return false;
}

module.exports = {
  AuthType,
  PROVIDER_METADATA_NS,
  PlanError,
  applyModelProvidersPatch,
  assertPurposeSafe,
  buildAdvancedGenerationConfig,
  buildGenerationConfig,
  buildInstallPlan,
  buildModelConfigs,
  computeModelListVersion,
  findExistingProviderModels,
  getDefaultBaseUrlForProtocol,
  getDefaultModelIds,
  getModelsForProviderProtocol,
  isSameModelIdentity,
  providerMatchesCredentials,
  resolveBaseUrl,
  resolveEnvKey,
  resolveMetadataKey,
  resolveModelNamePrefix,
  resolveModelProtocol,
  resolveOwnsModel,
  resolveProviderProtocol,
  shouldShowStep,
  specToModelConfig,
  tryResolveModelProtocol,
  validateAuthTypeKey,
};
