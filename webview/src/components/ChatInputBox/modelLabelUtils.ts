import { AVAILABLE_MODELS, DEFAULT_QWEN_MODEL_ID } from './types';
import type { ModelInfo } from './types';

type Translate = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => string;

/**
 * Inline-default label for the empty-id entry ("follow CLI config"). Locale
 * files may override the key; the configuredModel interpolation travels as the
 * `model` option so a future translation can use `{{model}}`.
 */
export const FOLLOW_CLI_MODEL_LABEL_KEY = 'models.qwen.followCliDefault.label';
export const FOLLOW_CLI_MODEL_LABEL_WITH_MODEL_KEY = 'models.qwen.followCliDefault.labelWithModel';
export const FOLLOW_CLI_MODEL_LABEL = '默认（跟随 CLI 配置）';

/**
 * Label for the "Default (follow CLI config)" entry. When the CLI has a
 * configured model (`~/.qwen/settings.json` → `model.name`), it is appended
 * verbatim: "默认（跟随 CLI 配置 · mimo-v2.6-pro）".
 */
export function resolveFollowCliDefaultLabel(t: Translate, configuredModel?: string): string {
  const configured = configuredModel?.trim();
  if (configured) {
    return t(FOLLOW_CLI_MODEL_LABEL_WITH_MODEL_KEY, {
      defaultValue: `默认（跟随 CLI 配置 · ${configured}）`,
      model: configured,
    });
  }
  return t(FOLLOW_CLI_MODEL_LABEL_KEY, {
    defaultValue: FOLLOW_CLI_MODEL_LABEL,
  });
}

/** The empty-id ModelInfo shown as the first model-selector entry. */
export function buildFollowCliDefaultModel(t: Translate, configuredModel?: string): ModelInfo {
  return {
    id: DEFAULT_QWEN_MODEL_ID,
    label: resolveFollowCliDefaultLabel(t, configuredModel),
  };
}

const DEFAULT_MODEL_MAP: Record<string, ModelInfo> = AVAILABLE_MODELS.reduce(
  (acc, model) => {
    acc[model.id] = model;
    return acc;
  },
  {} as Record<string, ModelInfo>,
);

export const MODEL_LABEL_KEYS: Record<string, string> = {
  'qwen3-coder-plus': 'models.qwen.coderPlus.label',
  'qwen3-coder-flash': 'models.qwen.coderFlash.label',
  'qwen-max': 'models.qwen.max.label',
  'qwen-plus': 'models.qwen.plus.label',
  'qwen-turbo': 'models.qwen.turbo.label',
};

export const MODEL_DESCRIPTION_KEYS: Record<string, string> = {
  'qwen3-coder-plus': 'models.qwen.coderPlus.description',
  'qwen3-coder-flash': 'models.qwen.coderFlash.description',
  'qwen-max': 'models.qwen.max.description',
  'qwen-plus': 'models.qwen.plus.description',
  'qwen-turbo': 'models.qwen.turbo.description',
};

/**
 * Resolve the display model name for icon matching.
 */
export const resolveModelIdForIcon = (
  modelId: string,
  _modelMapping: Record<string, string | undefined> = {},
): string => modelId;

export function resolveModelDisplayLabel(
  model: ModelInfo,
  options: {
    t: Translate;
    currentProvider?: string;
  },
): string {
  const { t } = options;

  // Empty id = "Default (follow CLI config)". The list entry built by
  // resolveProviderModels already carries the configured-model suffix; a bare
  // synthesized entry falls back to the localized inline-default text so no
  // surface ever renders a blank model name.
  if (model.id === DEFAULT_QWEN_MODEL_ID) {
    return model.label?.trim() ? model.label : resolveFollowCliDefaultLabel(t);
  }

  const defaultModel = DEFAULT_MODEL_MAP[model.id];
  const labelKey = MODEL_LABEL_KEYS[model.id];
  const hasCustomLabel = defaultModel && model.label && model.label !== defaultModel.label;

  if (hasCustomLabel) {
    return model.label ?? '';
  }

  if (labelKey) {
    return t(labelKey);
  }

  return model.label ?? '';
}

export function resolveModelDescription(model: ModelInfo, t: Translate): string | undefined {
  const descriptionKey = MODEL_DESCRIPTION_KEYS[model.id];
  if (descriptionKey) {
    return t(descriptionKey);
  }
  return model.description;
}
