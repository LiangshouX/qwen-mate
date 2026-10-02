import type { ModelInfo } from './types';
import { buildFollowCliDefaultModel } from './modelLabelUtils';

type Translate = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => string;

/**
 * CLI-config-aware Qwen model catalog delivered by
 * `get_qwen_model_options` → `window.updateQwenModelOptions`: the
 * `modelProviders` directory of `~/.qwen/settings.json` plus the currently
 * configured `model.name`.
 */
export interface QwenModelOptions {
  /** `model.name` from `~/.qwen/settings.json`; empty when not configured. */
  configuredModel: string;
  /** `modelProviders` entries (label = `name`, description = `provider`). */
  models: ModelInfo[];
}

export const EMPTY_QWEN_MODEL_OPTIONS: QwenModelOptions = { configuredModel: '', models: [] };

export interface ResolveProviderModelsInput {
  provider: string;
  /** Dynamic catalog from useCliModels (may be static fallback when empty). */
  cliModels: ModelInfo[];
  /**
   * True only when the backend returned real catalog entries.
   * When false, cliModels is the static fallback.
   */
  cliCatalogHasEntries?: boolean;
  qwenCustomModels?: ModelInfo[];
  /** Models the user configured in the Qwen CLI settings. */
  qwenModelOptions?: QwenModelOptions;
  /** Translator for the follow-CLI entry and the "current" badge (inline defaults). */
  t?: Translate;
}

/** Mirrors `t(key, { defaultValue })` so callers without i18n still get real text. */
const fallbackTranslate: Translate = (_key, options) => String(options?.defaultValue ?? '');

/**
 * Single source of truth for the model picker list — used by:
 *  - main chat toolbar (ButtonArea)
 *  - Prompt Enhancer settings
 *  - Commit AI settings
 *
 * Keep all three UIs in lockstep so users never see divergent catalogs.
 */
export function resolveProviderModels({
  provider,
  cliModels,
  qwenCustomModels = [],
  qwenModelOptions = EMPTY_QWEN_MODEL_OPTIONS,
  t = fallbackTranslate,
}: ResolveProviderModelsInput): ModelInfo[] {
  if (provider === 'dsh') {
    // Runtime catalog from the DSH host (static fallback list when offline).
    return cliModels;
  }

  // Qwen (default), in order:
  //   1. "Default (follow CLI config)" — empty id, never overrides the CLI
  //   2. models configured in ~/.qwen/settings.json (modelProviders)
  //   3. custom models configured in Settings
  // The built-in catalog is intentionally not merged: the CLI config is the
  // single source of truth for selectable Qwen models.
  // The entry whose id equals the CLI-configured `model.name` carries a
  // "current" badge. Duplicates collapse across groups by id first, then by
  // label (case-insensitive); the first occurrence wins.
  const configuredModel = qwenModelOptions.configuredModel?.trim() ?? '';
  const currentBadge = t('models.qwen.currentConfigured.badge', { defaultValue: '当前' });
  const cliConfiguredModels = qwenModelOptions.models.map((model) => ({
    ...model,
    source: 'cli-config' as const,
    ...(configuredModel && model.id === configuredModel
      ? { label: `${model.label} · ${currentBadge}` }
      : {}),
  }));

  const merged = [
    { ...buildFollowCliDefaultModel(t, configuredModel), source: 'cli-config' as const },
    ...cliConfiguredModels,
    ...qwenCustomModels.map((model) => ({ ...model, source: 'custom' as const })),
  ];
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  return merged.filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    const key = m.label.trim().toLowerCase();
    if (key && seenLabels.has(key)) return false;
    if (key) seenLabels.add(key);
    return true;
  });
}
