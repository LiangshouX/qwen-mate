import { act, renderHook } from '@testing-library/react';
import { useMessageSender } from './useMessageSender';
import type { UseMessageSenderOptions } from './useMessageSender';

describe('useMessageSender - /context command', () => {
  const t = ((key: string, opts?: any) => opts?.defaultValue ?? key) as any;

  const createOptions = (overrides: Partial<UseMessageSenderOptions> = {}): UseMessageSenderOptions => ({
    t,
    addToast: vi.fn(),
    currentProvider: 'qwen',
    selectedModel: 'qwen3-coder-plus',
    permissionMode: 'default',
    reasoningEffort: 'high',
    selectedAgent: null,
    sdkStatusLoading: false,
    currentSdkInstalled: true,
    sentAttachmentsRef: { current: new Map() },
    chatInputRef: { current: null },
    messagesContainerRef: { current: null },
    isUserAtBottomRef: { current: true },
    userPausedRef: { current: false },
    isStreamingRef: { current: false },
    setMessages: vi.fn(),
    setLoading: vi.fn(),
    setLoadingStartTime: vi.fn(),
    setStreamingActive: vi.fn(),
    setSettingsInitialTab: vi.fn(),
    setCurrentView: vi.fn(),
    forceCreateNewSession: vi.fn(),
    handleModeSelect: vi.fn(),
    openContextUsageDialog: vi.fn(),
    closeContextUsageDialog: vi.fn().mockReturnValue(true),
    ...overrides,
  });

  beforeEach(() => {
    window.sendToJava = vi.fn();
  });

  it('sends get_context_usage with the current model', () => {
    const opts = createOptions({
      selectedModel: 'qwen3-coder-plus',
    });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/context');
    });

    expect(window.sendToJava).toHaveBeenCalledTimes(1);
    const call = (window.sendToJava as any).mock.calls[0][0] as string;
    expect(call).toMatch(/^get_context_usage:/);

    const payload = JSON.parse(call.substring('get_context_usage:'.length));
    expect(payload.model).toBe('qwen3-coder-plus');
    expect(payload.requestId).toBeTruthy();
  });

  it('passes the empty model id through verbatim (follow CLI config)', () => {
    // '' means "Default (follow CLI config)" — the send path must forward the
    // empty id to the backend and never substitute a concrete model id.
    const opts = createOptions({
      selectedModel: '',
    });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/context');
    });

    expect(window.sendToJava).toHaveBeenCalledTimes(1);
    const call = (window.sendToJava as any).mock.calls[0][0] as string;
    expect(call).toMatch(/^get_context_usage:/);

    const payload = JSON.parse(call.substring('get_context_usage:'.length));
    expect(payload.model).toBe('');
  });

  it('opens dialog with loading state before sending bridge event', () => {
    const openContextUsageDialog = vi.fn();
    const opts = createOptions({ openContextUsageDialog });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/context');
    });

    expect(openContextUsageDialog).toHaveBeenCalledTimes(1);
    expect(openContextUsageDialog).toHaveBeenCalledWith(
      expect.any(String),
      true, // loading = true
    );
    // Dialog opened BEFORE bridge event sent
    expect(openContextUsageDialog.mock.invocationCallOrder[0]).toBeLessThan(
      (window.sendToJava as any).mock.invocationCallOrder[0],
    );
  });

  it('shows warning toast and does not send bridge event for the dsh provider', () => {
    const addToast = vi.fn();
    const opts = createOptions({
      currentProvider: 'dsh',
      addToast,
    });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/context');
    });

    expect(window.sendToJava).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Qwen'),
      'warning',
    );
  });

  it('closes dialog with error toast when bridge is unavailable', () => {
    // Don't set window.sendToJava → bridge unavailable
    delete (window as any).sendToJava;

    const addToast = vi.fn();
    const closeContextUsageDialog = vi.fn().mockReturnValue(true);
    const opts = createOptions({ addToast, closeContextUsageDialog });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/context');
    });

    expect(closeContextUsageDialog).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.any(String),
      'error',
    );
  });
});
