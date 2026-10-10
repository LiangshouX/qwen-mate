import { act, renderHook } from '@testing-library/react';
import { useMessageSender } from './useMessageSender';
import type { UseMessageSenderOptions } from './useMessageSender';

describe('useMessageSender - /effort command', () => {
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
    setReasoningEffort: vi.fn(),
    openContextUsageDialog: vi.fn(),
    closeContextUsageDialog: vi.fn().mockReturnValue(true),
    ...overrides,
  });

  beforeEach(() => {
    window.sendToJava = vi.fn();
    delete (window as any).openEffortSelector;
  });

  afterEach(() => {
    delete (window as any).openEffortSelector;
  });

  it('/effort <tier> applies the tier through setReasoningEffort without forwarding', () => {
    const setReasoningEffort = vi.fn();
    const opts = createOptions({ setReasoningEffort });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/effort xhigh');
    });

    expect(setReasoningEffort).toHaveBeenCalledTimes(1);
    expect(setReasoningEffort).toHaveBeenCalledWith('xhigh');
    // Local-only: the command must never reach the backend as a prompt.
    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('applies the tier case-insensitively (/effort HIGH → high)', () => {
    const setReasoningEffort = vi.fn();
    const opts = createOptions({ setReasoningEffort });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/effort HIGH');
    });

    expect(setReasoningEffort).toHaveBeenCalledWith('high');
  });

  it('accepts every Qwen Code tier, including max', () => {
    const setReasoningEffort = vi.fn();
    const opts = createOptions({ setReasoningEffort });

    const { result } = renderHook(() => useMessageSender(opts));

    for (const tier of ['low', 'medium', 'high', 'xhigh', 'max']) {
      act(() => {
        result.current.handleSubmit(`/effort ${tier}`);
      });
      expect(setReasoningEffort).toHaveBeenLastCalledWith(tier);
    }
  });

  it('rejects an unknown tier with the available list and does not change state', () => {
    const setReasoningEffort = vi.fn();
    const setMessages = vi.fn();
    const opts = createOptions({ setReasoningEffort, setMessages });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/effort turbo');
    });

    expect(setReasoningEffort).not.toHaveBeenCalled();
    expect(window.sendToJava).not.toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledTimes(1);
    const added = setMessages.mock.calls[0][0]([] as any[]);
    expect(added).toHaveLength(2);
    expect(added[1].type).toBe('assistant');
    expect(added[1].content).toContain('turbo');
    expect(added[1].content).toContain('low, medium, high, xhigh, max');
  });

  it('bare /effort opens the reasoning selector instead of printing CLI text', () => {
    const openEffortSelector = vi.fn();
    window.openEffortSelector = openEffortSelector;
    const setReasoningEffort = vi.fn();
    const opts = createOptions({ setReasoningEffort });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/effort');
    });

    expect(openEffortSelector).toHaveBeenCalledTimes(1);
    expect(setReasoningEffort).not.toHaveBeenCalled();
    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('bare /effort is safe when no selector is registered', () => {
    const opts = createOptions();

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/effort');
    });

    expect(window.sendToJava).not.toHaveBeenCalled();
  });
});
