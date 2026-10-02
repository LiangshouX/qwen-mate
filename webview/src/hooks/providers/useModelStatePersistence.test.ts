import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelStatePersistence, type UseModelStatePersistenceOptions } from './useModelStatePersistence';
import { DEFAULT_QWEN_MODEL_ID } from '../../components/ChatInputBox/types';
import type { PermissionMode } from '../../components/ChatInputBox/types';

const sendBridgeEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/bridge', () => ({
  sendBridgeEvent: (...args: unknown[]) => sendBridgeEventMock(...args),
}));

function makeOptions(overrides: Partial<UseModelStatePersistenceOptions> = {}): UseModelStatePersistenceOptions {
  return {
    setCurrentProvider: vi.fn(),
    setSelectedQwenModel: vi.fn(),
    setSelectedDshModel: vi.fn(),
    setQwenPermissionMode: vi.fn(),
    setDshPermissionMode: vi.fn(),
    setPermissionMode: vi.fn(),
    setReasoningEffort: vi.fn(),
    setDshPreset: vi.fn(),
    currentProvider: 'qwen',
    selectedQwenModel: 'qwen3-coder-plus',
    selectedDshModel: 'auto',
    qwenPermissionMode: 'default' as PermissionMode,
    dshPermissionMode: 'default' as PermissionMode,
    reasoningEffort: 'medium',
    dshPreset: '',
    ...overrides,
  };
}

function bridgeEventsFor(name: string): unknown[][] {
  return sendBridgeEventMock.mock.calls.filter((c) => c[0] === name);
}

function setupWindow() {
  (window as unknown as { sendToJava?: unknown }).sendToJava = () => {};
  window.__CCGUI_PAGE_CONTEXT_READY__ = true;
  window.__CCGUI_PAGE_LOAD_KIND__ = 'initial_load';
  window.__CCGUI_RECOVERY_RELOAD__ = false;
}

function teardownWindow() {
  delete (window as unknown as { sendToJava?: unknown }).sendToJava;
  delete window.__CCGUI_PAGE_CONTEXT_READY__;
  delete window.__CCGUI_PAGE_LOAD_KIND__;
  delete window.__CCGUI_RECOVERY_RELOAD__;
  delete window.__CCGUI_RECOVERY_STATE_APPLIED__;
  delete (window as unknown as { __INITIAL_TAB_PROVIDER__?: unknown }).__INITIAL_TAB_PROVIDER__;
  delete (window as unknown as { __INITIAL_TAB_MODEL__?: unknown }).__INITIAL_TAB_MODEL__;
}

describe('useModelStatePersistence — boot sync does not clobber the persisted permission mode', () => {
  beforeEach(() => {
    localStorage.clear();
    sendBridgeEventMock.mockClear();
    setupWindow();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    teardownWindow();
  });

  it('does NOT send set_mode on boot when localStorage was wiped (reinstall)', () => {
    // Reinstall wipes JCEF localStorage → the hook would fall back to 'default'.
    // Pushing that to Java on boot would clobber the app-level PropertiesComponent
    // value (e.g. bypassPermissions) that survives the reinstall — the reported
    // "reinstall forgets Full Auto" bug. Java is the source of truth via get_mode.
    renderHook(() => useModelStatePersistence(makeOptions()));
    vi.advanceTimersByTime(200); // fire the deferred syncToBackend

    expect(bridgeEventsFor('set_mode')).toHaveLength(0);
    // Provider/model are webview-owned and must still sync.
    expect(bridgeEventsFor('set_provider')).toEqual([['set_provider', 'qwen']]);
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', DEFAULT_QWEN_MODEL_ID]]);
    // DSH preset only syncs for the dsh provider.
    expect(bridgeEventsFor('set_dsh_preset')).toHaveLength(0);
  });

  it('migrates a legacy autoEdit mode to auto-edit during restore', () => {
    // Pre-upgrade snapshots stored the mode in the claudePermissionMode slot.
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'claude',
      claudePermissionMode: 'autoEdit',
    }));

    const setQwenPermissionMode = vi.fn();
    const setPermissionMode = vi.fn();
    renderHook(() => useModelStatePersistence(makeOptions({ setQwenPermissionMode, setPermissionMode })));

    expect(setQwenPermissionMode).toHaveBeenCalledWith('auto-edit');
    // Legacy provider migrates to the qwen slice, so the qwen mode becomes active.
    expect(setPermissionMode).toHaveBeenCalledWith('auto-edit');
  });

  it('does NOT send set_mode on boot even when localStorage carries a non-default mode', () => {
    // Even when the webview snapshot has a valid mode, Java is authoritative on
    // boot (it may hold a newer value); the webview seeds itself from Java via
    // get_mode → onModeReceived, so the boot path must never push the mode down.
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      claudePermissionMode: 'bypassPermissions',
    }));

    renderHook(() => useModelStatePersistence(makeOptions()));
    vi.advanceTimersByTime(200);

    expect(bridgeEventsFor('set_mode')).toHaveLength(0);
  });

  it('retries the boot sync until the JCEF bridge is ready, still without set_mode', () => {
    // Bridge not ready yet → the hook retries every 100ms. Mode must never leak
    // into any of the retried sync attempts either.
    delete (window as unknown as { sendToJava?: unknown }).sendToJava;
    renderHook(() => useModelStatePersistence(makeOptions()));

    vi.advanceTimersByTime(200); // first attempt: bridge missing → schedules retry
    expect(sendBridgeEventMock).not.toHaveBeenCalled();

    (window as unknown as { sendToJava?: unknown }).sendToJava = () => {};
    vi.advanceTimersByTime(100); // retry now succeeds

    expect(bridgeEventsFor('set_provider')).toHaveLength(1);
    expect(bridgeEventsFor('set_mode')).toHaveLength(0);
  });

  it('keeps frontend boot synchronization enabled for a pre-ready startup retry', () => {
    window.__CCGUI_PAGE_LOAD_KIND__ = 'startup_retry';
    window.__CCGUI_RECOVERY_RELOAD__ = false;

    renderHook(() => useModelStatePersistence(makeOptions()));
    vi.advanceTimersByTime(200);

    expect(bridgeEventsFor('set_provider')).toHaveLength(1);
    expect(bridgeEventsFor('set_model')).toHaveLength(1);
  });

  it('does not echo the stale HTML provider or model during watchdog recovery', () => {
    window.__CCGUI_RECOVERY_RELOAD__ = true;
    window.__CCGUI_RECOVERY_STATE_APPLIED__ = false;
    (window as unknown as { __INITIAL_TAB_PROVIDER__?: unknown }).__INITIAL_TAB_PROVIDER__ = 'dsh';
    (window as unknown as { __INITIAL_TAB_MODEL__?: unknown }).__INITIAL_TAB_MODEL__ = 'provider/model-a';

    renderHook(() => useModelStatePersistence(makeOptions()));
    vi.advanceTimersByTime(200);

    expect(bridgeEventsFor('set_provider')).toHaveLength(0);
    expect(bridgeEventsFor('set_model')).toHaveLength(0);
    expect(bridgeEventsFor('set_dsh_preset')).toHaveLength(0);
    expect(localStorage.getItem('model-selection-state')).toBeNull();
  });

  it('waits for runtime page context and authoritative recovery state before persisting', () => {
    window.__CCGUI_PAGE_CONTEXT_READY__ = false;
    delete window.__CCGUI_RECOVERY_RELOAD__;

    renderHook(() => useModelStatePersistence(makeOptions()));
    expect(localStorage.getItem('model-selection-state')).toBeNull();

    act(() => vi.advanceTimersByTime(100));
    expect(localStorage.getItem('model-selection-state')).toBeNull();

    window.__CCGUI_PAGE_CONTEXT_READY__ = true;
    window.__CCGUI_RECOVERY_RELOAD__ = true;
    act(() => vi.advanceTimersByTime(100));
    expect(localStorage.getItem('model-selection-state')).toBeNull();

    window.__CCGUI_RECOVERY_STATE_APPLIED__ = true;
    act(() => vi.advanceTimersByTime(100));
    expect(JSON.parse(localStorage.getItem('model-selection-state') || '{}').provider).toBe('qwen');
  });
});

describe('useModelStatePersistence — retired model migration', () => {
  beforeEach(() => {
    localStorage.clear();
    sendBridgeEventMock.mockClear();
    setupWindow();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    teardownWindow();
  });

  it('migrates a saved retired model (qwen3-max-preview) to its replacement instead of the list head', () => {
    // Regression: removing a retired id from QWEN_MODELS must not reset users
    // to the list head — the alias table maps it to its real replacement.
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'qwen3-max-preview',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('qwen-max');
    expect(setSelectedQwenModel).not.toHaveBeenCalledWith('qwen3-coder-plus');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'qwen-max']]);
  });

  it('migrates a backend-supplied retired model via __INITIAL_TAB_MODEL__', () => {
    const setSelectedQwenModel = vi.fn();
    (window as unknown as { __INITIAL_TAB_PROVIDER__?: unknown }).__INITIAL_TAB_PROVIDER__ = 'qwen';
    (window as unknown as { __INITIAL_TAB_MODEL__?: unknown }).__INITIAL_TAB_MODEL__ = 'qwen3-max-preview';
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'qwen3-max-preview',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('qwen-max');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'qwen-max']]);
  });

  it('keeps an unrecognized custom model id verbatim (custom models are user-defined)', () => {
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'vendor/custom-model',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('vendor/custom-model');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'vendor/custom-model']]);
  });

  it('migrates a legacy claudeModel slot to the Qwen default when it is not a Qwen id', () => {
    // Pre-upgrade snapshots stored the Claude model in `claudeModel`. A retired
    // Claude id must not poison the qwen slot — it falls back to the Qwen default.
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'claude',
      claudeModel: 'claude-sonnet-4-5',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith(DEFAULT_QWEN_MODEL_ID);
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', DEFAULT_QWEN_MODEL_ID]]);
  });

  it('keeps a Qwen id restored from the legacy claudeModel slot (with alias migration)', () => {
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'claude',
      claudeModel: 'qwen3-max-preview',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('qwen-max');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'qwen-max']]);
  });

  it('falls back to the default model when the saved model is empty', () => {
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: '   ',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).not.toHaveBeenCalled();
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', DEFAULT_QWEN_MODEL_ID]]);
  });
});

describe('useModelStatePersistence — CLI provider persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sendBridgeEventMock.mockClear();
    setupWindow();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    teardownWindow();
  });

  it('restores a saved CLI provider instead of silently falling back to qwen', () => {
    // Regression: the hydration allowlist must cover every CLI-only provider,
    // so a saved dsh provider is not dropped and syncToBackend does not push
    // set_provider qwen, clobbering the CLI session on restart. The model id
    // only exists in the dynamic DSH catalog and must survive restart as-is.
    const setCurrentProvider = vi.fn();
    const setSelectedDshModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'dsh',
      dshModel: 'provider/model-a',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setCurrentProvider, setSelectedDshModel })));
    vi.advanceTimersByTime(200);

    expect(setCurrentProvider).toHaveBeenCalledWith('dsh');
    expect(setSelectedDshModel).toHaveBeenCalledWith('provider/model-a');
    expect(bridgeEventsFor('set_provider')).toEqual([['set_provider', 'dsh']]);
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'provider/model-a']]);
    expect(bridgeEventsFor('set_dsh_preset')).toEqual([['set_dsh_preset', '']]);
  });

  it('honors a backend-supplied CLI provider via __INITIAL_TAB_PROVIDER__', () => {
    const setCurrentProvider = vi.fn();
    (window as unknown as { __INITIAL_TAB_PROVIDER__?: unknown }).__INITIAL_TAB_PROVIDER__ = 'dsh';
    (window as unknown as { __INITIAL_TAB_MODEL__?: unknown }).__INITIAL_TAB_MODEL__ = 'provider/model-a';

    renderHook(() => useModelStatePersistence(makeOptions({ setCurrentProvider })));
    vi.advanceTimersByTime(200);

    expect(setCurrentProvider).toHaveBeenCalledWith('dsh');
    expect(bridgeEventsFor('set_provider')).toEqual([['set_provider', 'dsh']]);
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'provider/model-a']]);
  });

  it('persists CLI model and permission selections in the snapshot', () => {
    renderHook(() => useModelStatePersistence(makeOptions({
      currentProvider: 'dsh',
      selectedDshModel: 'provider/model-a',
      dshPermissionMode: 'auto-edit',
    })));

    const saved = JSON.parse(localStorage.getItem('model-selection-state') ?? '{}');
    expect(saved.provider).toBe('dsh');
    expect(saved.dshModel).toBe('provider/model-a');
    expect(saved.dshPermissionMode).toBe('auto-edit');
  });
});

describe('useModelStatePersistence — empty qwen model id (follow CLI config)', () => {
  beforeEach(() => {
    localStorage.clear();
    sendBridgeEventMock.mockClear();
    setupWindow();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    teardownWindow();
  });

  it('restores an explicitly saved empty qwenModel and syncs the empty id verbatim', () => {
    // '' is the "Default (follow CLI config)" selection: it must round-trip
    // through persistence and reach the backend as an empty set_model, never
    // substituted with a concrete model id.
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: '',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', '']]);
  });

  it('keeps a concrete saved qwenModel verbatim (legacy users keep their choice)', () => {
    const setSelectedQwenModel = vi.fn();
    localStorage.setItem('model-selection-state', JSON.stringify({
      provider: 'qwen',
      qwenModel: 'qwen3-coder-plus',
    }));

    renderHook(() => useModelStatePersistence(makeOptions({ setSelectedQwenModel })));
    vi.advanceTimersByTime(200);

    expect(setSelectedQwenModel).toHaveBeenCalledWith('qwen3-coder-plus');
    expect(bridgeEventsFor('set_model')).toEqual([['set_model', 'qwen3-coder-plus']]);
  });

  it('persists the empty qwen model selection in the snapshot', () => {
    renderHook(() => useModelStatePersistence(makeOptions({
      selectedQwenModel: '',
    })));

    const saved = JSON.parse(localStorage.getItem('model-selection-state') ?? '{}');
    expect(saved.qwenModel).toBe('');
    expect(saved.qwenModel).toBe(DEFAULT_QWEN_MODEL_ID);
  });

  it('boot-syncs the follow-CLI default (empty set_model) when nothing is saved', () => {
    renderHook(() => useModelStatePersistence(makeOptions()));
    vi.advanceTimersByTime(200);

    expect(bridgeEventsFor('set_model')).toEqual([['set_model', '']]);
  });
});
