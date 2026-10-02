import { act, renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheKeys, ServerToolsState } from '../types';
import { useToolsUpdate } from './useToolsUpdate';

const cacheKeys: CacheKeys = {
  SERVERS: 'test.servers',
  STATUS: 'test.status',
  TOOLS: 'test.tools',
  LAST_SERVER_ID: 'test.lastServerId',
};

function renderToolsHook(isCodexMode: boolean) {
  const setServerTools = vi.fn() as unknown as Dispatch<SetStateAction<ServerToolsState>>;
  const onLog = vi.fn();
  return renderHook(() => useToolsUpdate({
    isCodexMode,
    cacheKeys,
    setServerTools,
    onLog,
  }));
}

afterEach(() => {
  delete window.updateMcpServerTools;
});

describe('useToolsUpdate provider callback isolation', () => {
  it('registers the shared MCP tools callback and unregisters it on unmount', () => {
    const hook = renderToolsHook(false);
    const callback = window.updateMcpServerTools;

    expect(callback).toBeTypeOf('function');

    hook.unmount();
    expect(window.updateMcpServerTools).toBeUndefined();
  });

  it('keeps a single shared callback surface regardless of provider mode', () => {
    // The lightweight edition has one MCP channel: the legacy per-provider
    // callback is gone and the mode flag must not fork the surface.
    const hook = renderToolsHook(true);

    expect(window.updateMcpServerTools).toBeTypeOf('function');
    hook.unmount();
  });

  it('does not clear a callback replaced by a newer owner', () => {
    const firstHook = renderToolsHook(false);
    const replacement = vi.fn();
    window.updateMcpServerTools = replacement;

    firstHook.unmount();

    expect(window.updateMcpServerTools).toBe(replacement);
  });
});

describe('useToolsUpdate empty tool result', () => {
  it('logs a connected server with no tools as a warning', () => {
    const setServerTools = vi.fn() as unknown as Dispatch<SetStateAction<ServerToolsState>>;
    const onLog = vi.fn();
    const hook = renderHook(() => useToolsUpdate({
      isCodexMode: false,
      cacheKeys,
      setServerTools,
      onLog,
    }));

    act(() => {
      window.updateMcpServerTools?.(JSON.stringify({
        serverId: 'empty-server',
        serverName: 'Empty server',
        tools: [],
        error: null,
      }));
    });

    expect(onLog).toHaveBeenCalledWith(
      expect.any(String),
      'warning',
      undefined,
      'Empty server',
    );
    hook.unmount();
  });
});
