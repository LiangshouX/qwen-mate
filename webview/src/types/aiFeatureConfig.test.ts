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
      provider: 'dsh',
      effectiveProvider: 'dsh',
      resolutionSource: 'manual',
      // Partial payload from the backend: only one provider configured,
      // the rest must be filled from defaults by normalize.
      models: { dsh: 'provider/model-a' },
      availability: { qwen: true, dsh: true },
    });
    expect(normalized.provider).toBe('dsh');
    expect(normalized.availability.qwen).toBe(true);
    expect(normalized.availability.dsh).toBe(true);
    expect(normalized.models.dsh).toBe('provider/model-a');
    expect(normalized.models.qwen).toBe(DEFAULT_AI_FEATURE_MODELS.qwen);
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
  it('falls back to qwen before dsh when no preference applies', () => {
    expect(pickAutoAiFeatureProvider({
      qwen: true,
      dsh: true,
    })).toBe('qwen');
    expect(pickAutoAiFeatureProvider({
      qwen: false,
      dsh: true,
    })).toBe('dsh');
    expect(pickAutoAiFeatureProvider({
      qwen: false,
      dsh: false,
    })).toBeNull();
  });

  it('prefers the current chat provider when available (prompt enhancer auto)', () => {
    expect(pickAutoAiFeatureProvider({
      qwen: true,
      dsh: true,
    }, 'dsh')).toBe('dsh');
    // Preferred provider unavailable → falls back to qwen first.
    expect(pickAutoAiFeatureProvider({
      qwen: true,
      dsh: false,
    }, 'dsh')).toBe('qwen');
    // Unknown preferred id is ignored.
    expect(pickAutoAiFeatureProvider({
      qwen: true,
      dsh: true,
    }, 'unknown-cli')).toBe('qwen');
  });
});

describe('normalizePromptEnhancerConfig', () => {
  it('uses prompt enhancer defaults including CLI models', () => {
    const normalized = normalizePromptEnhancerConfig(null);
    expect(normalized.effectiveProvider).toBe(DEFAULT_PROMPT_ENHANCER_CONFIG.effectiveProvider);
    expect(normalized.models).toEqual(DEFAULT_PROMPT_ENHANCER_CONFIG.models);
    expect(normalized.models.qwen).toBe(DEFAULT_AI_FEATURE_MODELS.qwen);
    expect(normalized.models.dsh).toBe(DEFAULT_AI_FEATURE_MODELS.dsh);
  });
});
