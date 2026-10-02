import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetQwenModelOptionsCacheForTests,
  parseQwenModelOptions,
  useQwenModelOptions,
} from './useQwenModelOptions';

const sendBridgeEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/bridge', () => ({
  sendBridgeEvent: (...args: unknown[]) => sendBridgeEventMock(...args),
}));

function emitQwenModelOptions(payload: unknown) {
  act(() => {
    window.updateQwenModelOptions?.(
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    );
  });
}

describe('useQwenModelOptions', () => {
  beforeEach(() => {
    sendBridgeEventMock.mockClear();
    __resetQwenModelOptionsCacheForTests();
  });

  afterEach(() => {
    delete window.updateQwenModelOptions;
    __resetQwenModelOptionsCacheForTests();
  });

  it('requests the CLI model options on mount', () => {
    renderHook(() => useQwenModelOptions());
    expect(sendBridgeEventMock).toHaveBeenCalledWith('get_qwen_model_options');
  });

  it('maps the payload (label = name, description = provider) and keeps configuredModel', () => {
    const { result } = renderHook(() => useQwenModelOptions());
    emitQwenModelOptions({
      configuredModel: 'mimo-v2.6-pro',
      models: [
        { id: 'deepseek-v4-pro', name: '[DeepSeek] deepseek-v4-pro', provider: 'deepseek' },
        { id: 'mimo-v2.6-pro', name: '[Xiaomi] mimo-v2.6-pro', provider: 'xiaomi' },
      ],
    });
    expect(result.current).toEqual({
      configuredModel: 'mimo-v2.6-pro',
      models: [
        { id: 'deepseek-v4-pro', label: '[DeepSeek] deepseek-v4-pro', description: 'deepseek' },
        { id: 'mimo-v2.6-pro', label: '[Xiaomi] mimo-v2.6-pro', description: 'xiaomi' },
      ],
    });
    expect(sendBridgeEventMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the payload as an object as well as a JSON string', () => {
    const { result } = renderHook(() => useQwenModelOptions());
    act(() => {
      window.updateQwenModelOptions?.({
        configuredModel: '',
        models: [{ id: 'a', name: 'A', provider: '' }],
      });
    });
    expect(result.current.models).toEqual([{ id: 'a', label: 'A', description: undefined }]);
    expect(result.current.configuredModel).toBe('');
  });

  it('delivers one payload to every mounted consumer', () => {
    const first = renderHook(() => useQwenModelOptions());
    const second = renderHook(() => useQwenModelOptions());
    emitQwenModelOptions({
      configuredModel: 'mimo-v2.6-pro',
      models: [{ id: 'mimo-v2.6-pro', name: '[Xiaomi] mimo-v2.6-pro', provider: 'xiaomi' }],
    });
    expect(first.result.current.configuredModel).toBe('mimo-v2.6-pro');
    expect(second.result.current.configuredModel).toBe('mimo-v2.6-pro');
  });

  it('reuses the module cache on remount so history→chat does not re-fetch', () => {
    const first = renderHook(() => useQwenModelOptions());
    emitQwenModelOptions({
      configuredModel: 'mimo-v2.6-pro',
      models: [{ id: 'mimo-v2.6-pro', name: '[Xiaomi] mimo-v2.6-pro', provider: 'xiaomi' }],
    });
    first.unmount();

    sendBridgeEventMock.mockClear();
    const second = renderHook(() => useQwenModelOptions());
    expect(sendBridgeEventMock).not.toHaveBeenCalled();
    expect(second.result.current.configuredModel).toBe('mimo-v2.6-pro');
  });

  it('ignores malformed payloads and keeps the last good options', () => {
    const { result } = renderHook(() => useQwenModelOptions());
    emitQwenModelOptions({
      configuredModel: 'mimo-v2.6-pro',
      models: [{ id: 'mimo-v2.6-pro', name: '[Xiaomi] mimo-v2.6-pro', provider: 'xiaomi' }],
    });
    emitQwenModelOptions('not json {');
    emitQwenModelOptions({ models: 'nope' });
    expect(result.current.configuredModel).toBe('mimo-v2.6-pro');
    expect(result.current.models).toHaveLength(1);
  });
});

describe('parseQwenModelOptions', () => {
  it('normalizes ids/names and dedupes by id', () => {
    const parsed = parseQwenModelOptions({
      configuredModel: '  mimo-v2.6-pro  ',
      models: [
        { id: ' deepseek-v4-pro ', name: '[DeepSeek] deepseek-v4-pro', provider: 'deepseek' },
        { id: 'deepseek-v4-pro', name: 'duplicate', provider: 'deepseek' },
        { id: '', name: 'no id', provider: 'x' },
        'garbage',
        { id: 'fallback-name', name: '', provider: 'y' },
      ],
    });
    expect(parsed).toEqual({
      configuredModel: 'mimo-v2.6-pro',
      models: [
        { id: 'deepseek-v4-pro', label: '[DeepSeek] deepseek-v4-pro', description: 'deepseek' },
        { id: 'fallback-name', label: 'fallback-name', description: 'y' },
      ],
    });
  });

  it('rejects non-object payloads', () => {
    expect(parseQwenModelOptions('not json')).toBeNull();
    expect(parseQwenModelOptions(null)).toBeNull();
    expect(parseQwenModelOptions(42)).toBeNull();
    expect(parseQwenModelOptions('[]')).toBeNull();
  });
});
