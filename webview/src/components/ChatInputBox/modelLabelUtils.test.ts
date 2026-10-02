import { describe, expect, it } from 'vitest';
import {
  buildFollowCliDefaultModel,
  FOLLOW_CLI_MODEL_LABEL,
  resolveFollowCliDefaultLabel,
  resolveModelDisplayLabel,
} from './modelLabelUtils';

/** i18next-like stub honoring the inline defaultValue. */
const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>): string =>
  String(options?.defaultValue ?? key);

describe('resolveFollowCliDefaultLabel', () => {
  it('renders the localized inline-default text without a configured model', () => {
    expect(resolveFollowCliDefaultLabel(t)).toBe('默认（跟随 CLI 配置）');
    expect(resolveFollowCliDefaultLabel(t, '')).toBe('默认（跟随 CLI 配置）');
    expect(resolveFollowCliDefaultLabel(t, '   ')).toBe('默认（跟随 CLI 配置）');
    expect(resolveFollowCliDefaultLabel(t)).toBe(FOLLOW_CLI_MODEL_LABEL);
  });

  it('appends the configured model verbatim', () => {
    expect(resolveFollowCliDefaultLabel(t, 'mimo-v2.6-pro')).toBe('默认（跟随 CLI 配置 · mimo-v2.6-pro）');
  });

  it('passes the configured model as the interpolation option', () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const spy = (key: string, options?: { defaultValue?: string } & Record<string, unknown>): string => {
      seen.push(options);
      return String(options?.defaultValue ?? key);
    };
    resolveFollowCliDefaultLabel(spy, 'mimo-v2.6-pro');
    expect(seen[0]?.model).toBe('mimo-v2.6-pro');
  });
});

describe('buildFollowCliDefaultModel', () => {
  it('builds the empty-id entry carrying the configured-model label', () => {
    expect(buildFollowCliDefaultModel(t)).toEqual({
      id: '',
      label: '默认（跟随 CLI 配置）',
    });
    expect(buildFollowCliDefaultModel(t, 'mimo-v2.6-pro')).toEqual({
      id: '',
      label: '默认（跟随 CLI 配置 · mimo-v2.6-pro）',
    });
  });
});

describe('resolveModelDisplayLabel', () => {
  // Built-in model ids resolve through i18n label keys — stub those keys.
  const labels: Record<string, string> = {
    'models.qwen.coderPlus.label': 'Qwen3-Coder-Plus',
  };
  const tWithLabels = (key: string, options?: { defaultValue?: string } & Record<string, unknown>): string =>
    labels[key] ?? String(options?.defaultValue ?? key);

  it('renders the follow-CLI label for a bare empty-id entry', () => {
    expect(resolveModelDisplayLabel({ id: '', label: '' }, { t: tWithLabels })).toBe('默认（跟随 CLI 配置）');
    expect(resolveModelDisplayLabel({ id: '', label: '  ' }, { t: tWithLabels })).toBe('默认（跟随 CLI 配置）');
  });

  it('keeps a built empty-id entry label verbatim (configured model suffix)', () => {
    const entry = buildFollowCliDefaultModel(t, 'mimo-v2.6-pro');
    expect(resolveModelDisplayLabel(entry, { t: tWithLabels })).toBe('默认（跟随 CLI 配置 · mimo-v2.6-pro）');
  });

  it('still resolves built-in and custom model labels unchanged', () => {
    expect(
      resolveModelDisplayLabel({ id: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus' }, { t: tWithLabels }),
    ).toBe('Qwen3-Coder-Plus');
    expect(
      resolveModelDisplayLabel({ id: 'vendor/custom-model', label: 'Custom Model' }, { t: tWithLabels }),
    ).toBe('Custom Model');
  });
});
