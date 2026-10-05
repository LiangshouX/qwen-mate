import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCliModelsCacheForTests, useCliModels } from './useCliModels';

const sendBridgeEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/bridge', () => ({
  sendBridgeEvent: (...args: unknown[]) => sendBridgeEventMock(...args),
}));

function emitCliModels(payload: unknown) {
  act(() => {
    window.setCliModels?.(JSON.stringify(payload));
  });
}

describe('useCliModels', () => {
  beforeEach(() => {
    sendBridgeEventMock.mockClear();
    __resetCliModelsCacheForTests();
  });

  afterEach(() => {
    delete window.setCliModels;
    __resetCliModelsCacheForTests();
    vi.useRealTimers();
  });

  it('does not fetch for qwen — its catalog is static', () => {
    renderHook(() => useCliModels('qwen'));
    expect(sendBridgeEventMock).not.toHaveBeenCalled();
  });

  it('stores the catalog and defaultModel from the backend payload', () => {
    const { result } = renderHook(() => useCliModels('qwen'));
    emitCliModels({
      success: true,
      provider: 'qwen',
      defaultModel: 'provider/model-a',
      models: [{ id: 'provider/model-a', label: 'Model A', description: 'provider/model-a' }],
    });
    expect(result.current.cliModels).toEqual([
      { id: 'provider/model-a', label: 'Model A', description: 'provider/model-a' },
    ]);
    expect(result.current.cliDefaultModel).toBe('provider/model-a');
    expect(result.current.cliModelsLoading).toBe(false);
    expect(result.current.cliModelsError).toBeNull();
  });

  it('records backend errors from the backend payload', () => {
    const { result } = renderHook(() => useCliModels('qwen'));
    emitCliModels({ success: false, provider: 'qwen', error: 'node missing', models: [] });
    expect(result.current.cliModelsError).toBe('node missing');
    expect(result.current.cliModels).toEqual([]);
  });

  it('reuses the module cache on remount so history→chat keeps the catalog', () => {
    const first = renderHook(() => useCliModels('qwen'));
    emitCliModels({
      success: true,
      provider: 'qwen',
      defaultModel: 'provider/model-a',
      models: [
        { id: 'auto', label: 'Auto' },
        { id: 'provider/model-a', label: 'Model A' },
      ],
    });
    expect(first.result.current.cliModels.map((m) => m.id)).toEqual([
      'auto',
      'provider/model-a',
    ]);
    first.unmount();

    sendBridgeEventMock.mockClear();
    const second = renderHook(() => useCliModels('qwen'));
    // Cache already has entries — no bridge round-trip on remount.
    expect(sendBridgeEventMock).not.toHaveBeenCalled();
    expect(second.result.current.cliModels.map((m) => m.id)).toEqual([
      'auto',
      'provider/model-a',
    ]);
    expect(second.result.current.cliCatalogHasEntries).toBe(true);
    expect(second.result.current.cliDefaultModel).toBe('provider/model-a');
    expect(second.result.current.cliModelsLoading).toBe(false);
  });
});
