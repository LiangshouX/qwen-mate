import { describe, expect, it } from 'vitest';
import {
  AI_FEATURE_PROVIDERS,
  DEFAULT_AI_FEATURE_MODELS,
  DEFAULT_COMMIT_AI_CONFIG,
  normalizeAiFeatureConfig,
  pickAutoAiFeatureProvider,
} from './aiFeatureConfig';
import {
  DEFAULT_PROMPT_ENHANCER_CONFIG,
  normalizePromptEnhancerConfig,
} from './promptEnhancer';

describe('normalizeAiFeatureConfig', () => {
  it('fills missing availability/models for all CLI providers', () => {
    const normalized = normalizeAiFeatureConfig({}, DEFAULT_COMMIT_AI_CONFIG);
    for (const provider of AI_FEATURE_PROVIDERS) {
      expect(normalized.availability[provider]).toBe(false);
      expect(normalized.models[provider]).toBe(DEFAULT_AI_FEATURE_MODELS[provider]);
    }
    expect(normalized.provider).toBeNull();
  });

  it('preserves valid provider and availability flags', () => {
    const normalized = normalizeAiFeatureConfig({
      provider: 'qwen',
      effectiveProvider: 'qwen',
      resolutionSource: 'manual',
      models: { qwen: 'qwen3.5-plus' },
      availability: { qwen: true },
    });
    expect(normalized.provider).toBe('qwen');
    expect(normalized.effectiveProvider).toBe('qwen');
    expect(normalized.availability.qwen).toBe(true);
    expect(normalized.models.qwen).toBe('qwen3.5-plus');
  });

  it('rejects unknown provider ids', () => {
    const normalized = normalizeAiFeatureConfig({
      provider: 'gemini' as never,
      effectiveProvider: 'gemini' as never,
    });
    expect(normalized.provider).toBeNull();
    expect(normalized.effectiveProvider).toBeNull();
  });

  it('defaults the qwen model to the follow-CLI empty id', () => {
    // '' = "follow the CLI configuration" — the AI features never default to a
    // concrete model id that would override ~/.qwen/settings.json.
    expect(DEFAULT_AI_FEATURE_MODELS.qwen).toBe('');
    const normalized = normalizeAiFeatureConfig({}, DEFAULT_COMMIT_AI_CONFIG);
    expect(normalized.models.qwen).toBe('');
  });

  it('keeps an explicit empty model id instead of substituting a concrete id', () => {
    const normalized = normalizeAiFeatureConfig({
      models: { qwen: '' },
    }, DEFAULT_COMMIT_AI_CONFIG);
    expect(normalized.models.qwen).toBe('');

    // Whitespace-only values normalize to the same follow-CLI empty id.
    const whitespace = normalizeAiFeatureConfig({
      models: { qwen: '   ' },
    }, DEFAULT_COMMIT_AI_CONFIG);
    expect(whitespace.models.qwen).toBe('');
  });
});

describe('pickAutoAiFeatureProvider', () => {
  it('returns qwen when available and null when not', () => {
    expect(pickAutoAiFeatureProvider({
      qwen: true,
    })).toBe('qwen');
    expect(pickAutoAiFeatureProvider({
      qwen: false,
    })).toBeNull();
  });

  it('prefers the current chat provider when available (prompt enhancer auto)', () => {
    expect(pickAutoAiFeatureProvider({
      qwen: true,
    }, 'qwen')).toBe('qwen');
    // Unknown preferred id is ignored.
    expect(pickAutoAiFeatureProvider({
      qwen: true,
    }, 'unknown-cli')).toBe('qwen');
  });
});

describe('normalizePromptEnhancerConfig', () => {
  it('uses prompt enhancer defaults including CLI models', () => {
    const normalized = normalizePromptEnhancerConfig(null);
    expect(normalized.effectiveProvider).toBe(DEFAULT_PROMPT_ENHANCER_CONFIG.effectiveProvider);
    expect(normalized.models).toEqual(DEFAULT_PROMPT_ENHANCER_CONFIG.models);
    expect(normalized.models.qwen).toBe(DEFAULT_AI_FEATURE_MODELS.qwen);
  });
});
