/**
 * AI feature providers used by Prompt Enhancer / Commit AI settings.
 * Mirrors the main chat CLI selector (`AVAILABLE_PROVIDERS`).
 */
export const AI_FEATURE_PROVIDERS = [
  'qwen',
] as const;

export type AiFeatureProvider = (typeof AI_FEATURE_PROVIDERS)[number];
export type AiFeatureResolutionSource = 'manual' | 'auto' | 'unavailable';

/**
 * Default model id per provider — keep in sync with ChatInputBox/types defaults.
 * The empty qwen id means "follow the CLI configuration" (`~/.qwen/settings.json`)
 * and must never be replaced with a concrete model id by the frontend.
 */
export const DEFAULT_AI_FEATURE_MODELS: Record<AiFeatureProvider, string> = {
  qwen: '',
};

export type AiFeatureModels = Record<AiFeatureProvider, string>;
export type AiFeatureAvailability = Record<AiFeatureProvider, boolean>;

export interface AiFeatureConfig {
  provider: AiFeatureProvider | null;
  effectiveProvider: AiFeatureProvider | null;
  resolutionSource: AiFeatureResolutionSource;
  models: AiFeatureModels;
  availability: AiFeatureAvailability;
}

export type CommitAiProvider = AiFeatureProvider;
export type CommitAiResolutionSource = AiFeatureResolutionSource;
export type CommitAiConfig = AiFeatureConfig;

/**
 * Backend/partial payload shape accepted by normalizeAiFeatureConfig: models
 * and availability may carry only a subset of providers — the normalize step
 * fills the rest from defaults. The full AiFeatureConfig shape (all providers
 * required) is what consumers receive after normalization.
 */
export interface AiFeatureConfigInput {
  provider?: AiFeatureProvider | null;
  effectiveProvider?: AiFeatureProvider | null;
  resolutionSource?: AiFeatureResolutionSource;
  models?: Partial<AiFeatureModels> | null;
  availability?: Partial<AiFeatureAvailability> | null;
}

function emptyAvailability(value = false): AiFeatureAvailability {
  return {
    qwen: value,
  };
}

export const DEFAULT_COMMIT_AI_CONFIG: CommitAiConfig = {
  provider: null,
  effectiveProvider: 'qwen',
  resolutionSource: 'auto',
  models: { ...DEFAULT_AI_FEATURE_MODELS },
  availability: emptyAvailability(false),
};

export function isAiFeatureProvider(value: unknown): value is AiFeatureProvider {
  return typeof value === 'string'
    && (AI_FEATURE_PROVIDERS as readonly string[]).includes(value);
}

function isResolutionSource(value: unknown): value is AiFeatureResolutionSource {
  return value === 'manual' || value === 'auto' || value === 'unavailable';
}

function normalizeModels(
  raw: Partial<Record<string, unknown>> | null | undefined,
  defaults: AiFeatureModels,
): AiFeatureModels {
  const models = { ...defaults };
  if (!raw || typeof raw !== 'object') {
    return models;
  }
  for (const provider of AI_FEATURE_PROVIDERS) {
    const value = raw[provider];
    if (typeof value === 'string') {
      // The empty string is meaningful ("follow the CLI configuration") — an
      // explicit empty value must survive normalization untouched; only values
      // that are not strings fall back to the default.
      models[provider] = value.trim();
    }
  }
  return models;
}

function normalizeAvailability(
  raw: Partial<Record<string, unknown>> | null | undefined,
  defaults: AiFeatureAvailability,
): AiFeatureAvailability {
  const availability = { ...defaults };
  if (!raw || typeof raw !== 'object') {
    return availability;
  }
  for (const provider of AI_FEATURE_PROVIDERS) {
    if (provider in raw) {
      availability[provider] = Boolean(raw[provider]);
    }
  }
  return availability;
}

/**
 * Normalize backend/partial payloads so the settings selects always get a
 * complete controlled-component state (never missing availability/models).
 */
export function normalizeAiFeatureConfig(
  raw: AiFeatureConfigInput | null | undefined,
  defaults: AiFeatureConfig = DEFAULT_COMMIT_AI_CONFIG,
): AiFeatureConfig {
  if (raw == null) {
    return {
      ...defaults,
      models: { ...defaults.models },
      availability: { ...defaults.availability },
    };
  }

  return {
    // Explicit null from backend means auto mode; invalid values fall back to null.
    provider: raw.provider === null
      ? null
      : (isAiFeatureProvider(raw.provider) ? raw.provider : null),
    effectiveProvider: raw.effectiveProvider === null
      ? null
      : (isAiFeatureProvider(raw.effectiveProvider)
        ? raw.effectiveProvider
        : (raw.effectiveProvider === undefined ? defaults.effectiveProvider : null)),
    resolutionSource: isResolutionSource(raw.resolutionSource)
      ? raw.resolutionSource
      : defaults.resolutionSource,
    models: normalizeModels(raw.models, defaults.models),
    availability: normalizeAvailability(raw.availability, defaults.availability),
  };
}

/**
 * Resolve auto-mode provider.
 * Prefers `preferredProvider` when available (e.g. current chat CLI for prompt
 * enhancer and commit AI), then Qwen.
 */
export function pickAutoAiFeatureProvider(
  availability: AiFeatureAvailability,
  preferredProvider?: AiFeatureProvider | string | null,
): AiFeatureProvider | null {
  if (
    preferredProvider
    && isAiFeatureProvider(preferredProvider)
    && availability[preferredProvider]
  ) {
    return preferredProvider;
  }
  if (availability.qwen) return 'qwen';
  return null;
}
