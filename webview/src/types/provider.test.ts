import { describe, expect, it } from 'vitest';
import {
  isValidCustomModel,
  isValidModelPricing,
  validateCustomModels,
} from './provider';

describe('custom model validation', () => {
  it('accepts optional non-negative per-million-token pricing fields', () => {
    expect(isValidModelPricing({
      inputCostPer1M: 1.25,
      outputCostPer1M: 3,
      cacheWriteCostPer1M: 0,
      cacheReadCostPer1M: 0.1,
    })).toBe(true);

    expect(isValidCustomModel({
      id: 'vendor/custom-model',
      label: 'Custom Model',
      pricing: {
        inputCostPer1M: 0.2,
        outputCostPer1M: 0.8,
      },
    })).toBe(true);
  });

  it('accepts an optional context window in whole-K token increments', () => {
    expect(isValidCustomModel({
      id: 'vendor/custom-model',
      label: 'Custom Model',
      contextWindowTokens: 500_000,
    })).toBe(true);

    expect(isValidCustomModel({
      id: 'vendor/custom-model',
      label: 'Custom Model',
    })).toBe(true);
  });

  it('rejects invalid custom context windows', () => {
    expect(isValidCustomModel({
      id: 'zero-context',
      label: 'Zero',
      contextWindowTokens: 0,
    })).toBe(false);
    expect(isValidCustomModel({
      id: 'fractional-context',
      label: 'Fractional',
      contextWindowTokens: 500_000.5,
    })).toBe(false);
    expect(isValidCustomModel({
      id: 'sub-k-context',
      label: 'Sub K',
      contextWindowTokens: 500,
    })).toBe(false);
    expect(isValidCustomModel({
      id: 'partial-k-context',
      label: 'Partial K',
      contextWindowTokens: 500_500,
    })).toBe(false);
    expect(isValidCustomModel({
      id: 'oversized-context',
      label: 'Oversized',
      contextWindowTokens: 2_147_483_648,
    })).toBe(false);
  });

  it('rejects invalid custom pricing values', () => {
    expect(isValidModelPricing({ inputCostPer1M: -1 })).toBe(false);
    expect(isValidModelPricing({ outputCostPer1M: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidModelPricing({ cacheReadCostPer1M: '0.1' })).toBe(false);

    expect(validateCustomModels([
      { id: 'valid-model', label: 'Valid', pricing: { inputCostPer1M: 0.1 } },
      { id: 'invalid-model', label: 'Invalid', pricing: { outputCostPer1M: -2 } },
    ])).toEqual([
      { id: 'valid-model', label: 'Valid', pricing: { inputCostPer1M: 0.1 } },
    ]);
  });
});
