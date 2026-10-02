import { describe, expect, it } from 'vitest';
import { resolveProviderModels } from './resolveProviderModels';

/** i18next-like stub honoring the inline defaultValue. */
const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>): string =>
  String(options?.defaultValue ?? key);

describe('resolveProviderModels', () => {
  it('returns the DSH runtime catalog for dsh', () => {
    const catalog = [
      { id: 'provider/model-a', label: 'Model A', description: 'provider/model-a' },
      { id: 'auto', label: 'DSH Auto' },
    ];
    expect(
      resolveProviderModels({
        provider: 'dsh',
        cliModels: catalog,
        cliCatalogHasEntries: true,
      }),
    ).toEqual(catalog);
  });

  it('returns the static DSH fallback list when the catalog is empty', () => {
    const fallback = [{ id: 'auto', label: 'DSH Auto' }];
    expect(
      resolveProviderModels({
        provider: 'dsh',
        cliModels: fallback,
        cliCatalogHasEntries: false,
      }),
    ).toEqual(fallback);
  });

  it('ignores cliModels for qwen — its catalog comes from the CLI config and customs', () => {
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [{ id: 'stray', label: 'Stray' }],
      cliCatalogHasEntries: true,
      t,
    });
    expect(result.map((m) => m.id)).toEqual(['']);
  });

  it('puts the follow-CLI default entry first with the localized inline-default label', () => {
    const result = resolveProviderModels({ provider: 'qwen', cliModels: [], t });
    expect(result[0]).toEqual({ id: '', label: '默认（跟随 CLI 配置）', source: 'cli-config' });
    expect(result.map((m) => m.id)).toEqual(['']);
  });

  it('falls back to the inline default label when no translator is provided', () => {
    const result = resolveProviderModels({ provider: 'qwen', cliModels: [] });
    expect(result[0]).toEqual({ id: '', label: '默认（跟随 CLI 配置）', source: 'cli-config' });
  });

  it('appends the CLI-configured model verbatim to the default entry label', () => {
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [],
      qwenModelOptions: { configuredModel: 'mimo-v2.6-pro', models: [] },
      t,
    });
    expect(result[0].id).toBe('');
    expect(result[0].label).toBe('默认（跟随 CLI 配置 · mimo-v2.6-pro）');
  });

  it('merges CLI-configured models after the default entry', () => {
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [],
      qwenModelOptions: {
        configuredModel: 'deepseek-v4-pro',
        models: [
          { id: 'deepseek-v4-pro', label: '[DeepSeek] deepseek-v4-pro' },
          { id: 'deepseek-v4-flash', label: '[DeepSeek] deepseek-v4-flash' },
        ],
      },
      t,
    });
    expect(result.map((m) => m.id)).toEqual([
      '',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
    // The entry matching `model.name` carries the "current" badge; others don't.
    expect(result[1].label).toBe('[DeepSeek] deepseek-v4-pro · 当前');
    expect(result[2].label).toBe('[DeepSeek] deepseek-v4-flash');
  });

  it('does not merge the built-in Qwen catalog', () => {
    // Regression: the dropdown used to append QWEN_MODELS as an
    // "内置模型（可选）" group; only CLI-configured and custom models show now.
    const result = resolveProviderModels({ provider: 'qwen', cliModels: [], t });
    expect(result.some((m) => m.id === 'qwen3-coder-plus')).toBe(false);
    expect(result.some((m) => m.id === 'qwen-max')).toBe(false);
  });

  it('dedupes by id across CLI-config and custom groups (first wins)', () => {
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [],
      qwenModelOptions: {
        configuredModel: '',
        models: [{ id: 'qwen-max', label: '[Custom] renamed max' }],
      },
      qwenCustomModels: [
        { id: 'qwen-max', label: 'Renamed Max' }, // duplicate id with CLI-config entry
        { id: 'my-model', label: 'My Model' },
      ],
      t,
    });
    expect(result.map((m) => m.id)).toEqual([
      '',
      'qwen-max', // CLI-config entry wins over the custom of the same id
      'my-model',
    ]);
    expect(result.find((m) => m.id === 'qwen-max')?.label).toBe('[Custom] renamed max');
  });

  it('tags entries with their catalog source for dropdown grouping', () => {
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [],
      qwenModelOptions: {
        configuredModel: '',
        models: [{ id: 'deepseek-v4-pro', label: '[DeepSeek] deepseek-v4-pro' }],
      },
      qwenCustomModels: [{ id: 'my-model', label: 'My Model' }],
      t,
    });
    expect(result.find((m) => m.id === '')?.source).toBe('cli-config');
    expect(result.find((m) => m.id === 'deepseek-v4-pro')?.source).toBe('cli-config');
    expect(result.find((m) => m.id === 'my-model')?.source).toBe('custom');
  });

  it('collapses duplicate ids and labels when merging qwen customs', () => {
    const customs = [
      { id: 'my-model', label: 'My Model' },
      { id: 'my-model-2', label: 'my model' }, // duplicate label (case-insensitive)
      { id: 'other-model', label: 'Other Model' },
    ];
    const result = resolveProviderModels({
      provider: 'qwen',
      cliModels: [],
      qwenCustomModels: customs,
      t,
    });
    expect(result.filter((m) => m.id === 'my-model')).toHaveLength(1);
    expect(result.filter((m) => m.id === 'other-model')).toHaveLength(1);
    expect(result.some((m) => m.id === 'my-model-2')).toBe(false);
  });

  it('returns only the default entry when nothing else is provided', () => {
    expect(
      resolveProviderModels({
        provider: 'qwen',
        cliModels: [],
      }).map((m) => m.id),
    ).toEqual(['']);
  });
});
