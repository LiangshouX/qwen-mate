import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../types/provider';
import { usePluginModels } from './usePluginModels';

const sendBridgeEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/bridge', () => ({
  sendBridgeEvent: (...args: unknown[]) => sendBridgeEventMock(...args),
}));

describe('usePluginModels', () => {
  beforeEach(() => {
    localStorage.clear();
    sendBridgeEventMock.mockClear();
  });

  it('persists custom pricing locally and syncs it to Java for Qwen models', () => {
    const { result } = renderHook(() => usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS));

    act(() => {
      result.current.updateModels([
        {
          id: 'vendor/custom-model',
          label: 'Custom Model',
          pricing: {
            inputCostPer1M: 0.2,
            outputCostPer1M: 0.8,
            cacheWriteCostPer1M: 0.25,
            cacheReadCostPer1M: 0.02,
          },
        },
      ]);
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.QWEN_CUSTOM_MODELS) || '[]')).toEqual([
      {
        id: 'vendor/custom-model',
        label: 'Custom Model',
        pricing: {
          inputCostPer1M: 0.2,
          outputCostPer1M: 0.8,
          cacheWriteCostPer1M: 0.25,
          cacheReadCostPer1M: 0.02,
        },
      },
    ]);
    expect(sendBridgeEventMock).toHaveBeenLastCalledWith('set_custom_model_pricing', JSON.stringify({
      provider: 'qwen',
      models: [
        {
          id: 'vendor/custom-model',
          label: 'Custom Model',
          pricing: {
            inputCostPer1M: 0.2,
            outputCostPer1M: 0.8,
            cacheWriteCostPer1M: 0.25,
            cacheReadCostPer1M: 0.02,
          },
        },
      ],
    }));
  });

  it('keeps valid context window metadata when reading Qwen custom models', () => {
    // Context window is first-class metadata now: it feeds the usage display,
    // so it must survive the read/validate round-trip.
    localStorage.setItem(STORAGE_KEYS.QWEN_CUSTOM_MODELS, JSON.stringify([{
      id: 'vendor/custom-model',
      label: 'Custom Model',
      contextWindowTokens: 500_000,
    }]));

    const { result } = renderHook(() => usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS));

    expect(result.current.models).toEqual([{
      id: 'vendor/custom-model',
      label: 'Custom Model',
      contextWindowTokens: 500_000,
    }]);
  });

  it('filters invalid entries when reading Qwen custom models', () => {
    localStorage.setItem(STORAGE_KEYS.QWEN_CUSTOM_MODELS, JSON.stringify([
      { id: 'vendor/valid', label: 'Valid' },
      { id: 'vendor/invalid', label: 'Invalid', pricing: { inputCostPer1M: -1 } },
      'garbage',
    ]));

    const { result } = renderHook(() => usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS));

    expect(result.current.models).toEqual([{ id: 'vendor/valid', label: 'Valid' }]);
  });

  it('filters invalid pricing before persisting and syncing Qwen models', () => {
    const { result } = renderHook(() => usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS));

    act(() => {
      result.current.updateModels([
        { id: 'valid-model', label: 'Valid', pricing: { inputCostPer1M: 0.1 } },
        { id: 'invalid-model', label: 'Invalid', pricing: { inputCostPer1M: -1 } },
      ]);
    });

    const expectedModels = [
      { id: 'valid-model', label: 'Valid', pricing: { inputCostPer1M: 0.1 } },
    ];

    expect(result.current.models).toEqual(expectedModels);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.QWEN_CUSTOM_MODELS) || '[]')).toEqual(expectedModels);
    expect(sendBridgeEventMock).toHaveBeenLastCalledWith('set_custom_model_pricing', JSON.stringify({
      provider: 'qwen',
      models: expectedModels,
    }));
  });

  it('persists and syncs a custom context window alongside pricing', () => {
    const { result } = renderHook(() => usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS));

    act(() => {
      result.current.updateModels([{
        id: 'vendor/context-model',
        label: 'Context Model',
        contextWindowTokens: 500_000,
        pricing: { inputCostPer1M: 0.1 },
      }]);
    });

    const expectedModels = [{
      id: 'vendor/context-model',
      label: 'Context Model',
      contextWindowTokens: 500_000,
      pricing: { inputCostPer1M: 0.1 },
    }];

    expect(result.current.models).toEqual(expectedModels);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.QWEN_CUSTOM_MODELS) || '[]')).toEqual(expectedModels);
    expect(sendBridgeEventMock).toHaveBeenLastCalledWith('set_custom_model_pricing', JSON.stringify({
      provider: 'qwen',
      models: expectedModels,
    }));
  });
});
