import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCliModelsCacheForTests, useCliModels } from './useCliModels';
import { DSH_MODELS } from '../../components/ChatInputBox/types';

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

  it('fetches the dsh catalog when the dsh provider is active', () => {
    renderHook(() => useCliModels('dsh'));
    expect(sendBridgeEventMock).toHaveBeenCalledWith('get_cli_models', 'dsh');
  });

  it('does not fetch for qwen — its catalog is static', () => {
    renderHook(() => useCliModels('qwen'));
    expect(sendBridgeEventMock).not.toHaveBeenCalled();
  });

  it('falls back to the static DSH_MODELS list before the catalog arrives', () => {
    const { result } = renderHook(() => useCliModels('dsh'));
    expect(result.current.cliModels).toEqual(DSH_MODELS);
    expect(result.current.cliModelsLoading).toBe(true);
  });

  it('stores the dsh catalog and defaultModel from the backend payload', () => {
    const { result } = renderHook(() => useCliModels('dsh'));
    emitCliModels({
      success: true,
      provider: 'dsh',
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

  it('falls back to DSH_MODELS when the payload has no models', () => {
    const { result } = renderHook(() => useCliModels('dsh'));
    emitCliModels({
      success: true,
      provider: 'dsh',
      defaultModel: 'provider/model-a',
      models: [],
    });
    expect(result.current.cliModels).toEqual(DSH_MODELS);
    expect(result.current.cliDefaultModel).toBe('provider/model-a');
    expect(result.current.cliCatalogHasEntries).toBe(false);
  });

  it('records backend errors and supports manual retry for dsh', () => {
    const { result } = renderHook(() => useCliModels('dsh'));
    emitCliModels({ success: false, provider: 'dsh', error: 'node missing', models: [] });
    expect(result.current.cliModelsError).toBe('node missing');
    expect(result.current.cliModels).toEqual(DSH_MODELS);

    sendBridgeEventMock.mockClear();
    act(() => {
      result.current.refreshCliModels('dsh');
    });
    expect(sendBridgeEventMock).toHaveBeenCalledWith('get_cli_models', 'dsh');
  });

  it('times out into an error state and falls back to static models', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCliModels('dsh'));
    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(result.current.cliModelsLoading).toBe(false);
    expect(result.current.cliModelsError).toBe('timeout');
    expect(result.current.cliModels).toEqual(DSH_MODELS);
  });

  it('reuses the module cache on remount so history→chat does not re-fetch', () => {
    const first = renderHook(() => useCliModels('dsh'));
    emitCliModels({
      success: true,
      provider: 'dsh',
      defaultModel: 'provider/model-a',
      models: [
        { id: 'auto', label: 'DSH Auto' },
        { id: 'provider/model-a', label: 'Model A' },
      ],
    });
    expect(first.result.current.cliModels.map((m) => m.id)).toEqual([
      'auto',
      'provider/model-a',
    ]);
    first.unmount();

    sendBridgeEventMock.mockClear();
    const second = renderHook(() => useCliModels('dsh'));
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
