import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QWEN_MODEL_ID,
  normalizeQwenModelId,
  QWEN_MODELS,
} from './types';

describe('normalizeQwenModelId', () => {
  it('falls back to the follow-CLI default for null/undefined input', () => {
    expect(DEFAULT_QWEN_MODEL_ID).toBe('');
    expect(normalizeQwenModelId(null)).toBe(DEFAULT_QWEN_MODEL_ID);
    expect(normalizeQwenModelId(undefined)).toBe(DEFAULT_QWEN_MODEL_ID);
  });

  it('passes the empty id through unchanged (follow CLI config selection)', () => {
    // '' is the explicit "Default (follow CLI config)" selection — it must
    // reach the backend as an empty model so the CLI configuration decides,
    // never be substituted with a concrete model id.
    expect(normalizeQwenModelId('')).toBe('');
    expect(normalizeQwenModelId('')).toBe(DEFAULT_QWEN_MODEL_ID);
  });

  it('keeps the default out of the concrete catalog', () => {
    // The default is the empty "follow CLI config" entry, not a QWEN_MODELS id
    // — deriving a concrete fallback (e.g. QWEN_MODELS[0]) would override the
    // model configured in ~/.qwen/settings.json.
    expect(QWEN_MODELS.some((m) => m.id === DEFAULT_QWEN_MODEL_ID)).toBe(false);
    expect(QWEN_MODELS.every((m) => m.id !== '')).toBe(true);
  });

  it('migrates retired qwen3-coder IDs to qwen3-coder-plus', () => {
    expect(normalizeQwenModelId('qwen3-coder')).toBe('qwen3-coder-plus');
    expect(normalizeQwenModelId('qwen-coder-plus')).toBe('qwen3-coder-plus');
  });

  it('migrates retired qwen3-max-preview to qwen-max', () => {
    expect(normalizeQwenModelId('qwen3-max-preview')).toBe('qwen-max');
  });

  it('leaves current models untouched', () => {
    for (const model of QWEN_MODELS) {
      expect(normalizeQwenModelId(model.id)).toBe(model.id);
    }
  });

  it('leaves unknown custom model IDs untouched', () => {
    expect(normalizeQwenModelId('vendor/custom-model')).toBe('vendor/custom-model');
  });
});
