import { act, renderHook } from '@testing-library/react';
import { useMessageSender } from './useMessageSender';
import type { UseMessageSenderOptions } from './useMessageSender';

describe('useMessageSender - /mcp and /skills settings-page commands', () => {
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

  it('/mcp opens the MCP settings tab without forwarding to the CLI', () => {
    const setSettingsInitialTab = vi.fn();
    const setCurrentView = vi.fn();
    const opts = createOptions({ setSettingsInitialTab, setCurrentView });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/mcp');
    });

    expect(setSettingsInitialTab).toHaveBeenCalledWith('mcp');
    expect(setCurrentView).toHaveBeenCalledWith('settings');
    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('/skills opens the Skills settings tab without forwarding to the CLI', () => {
    const setSettingsInitialTab = vi.fn();
    const setCurrentView = vi.fn();
    const opts = createOptions({ setSettingsInitialTab, setCurrentView });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/skills');
    });

    expect(setSettingsInitialTab).toHaveBeenCalledWith('skills');
    expect(setCurrentView).toHaveBeenCalledWith('settings');
    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('matches case-insensitively and ignores extra arguments', () => {
    const setSettingsInitialTab = vi.fn();
    const setCurrentView = vi.fn();
    const opts = createOptions({ setSettingsInitialTab, setCurrentView });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/MCP');
    });
    act(() => {
      result.current.handleSubmit('/Skills something else');
    });

    expect(setSettingsInitialTab).toHaveBeenNthCalledWith(1, 'mcp');
    expect(setSettingsInitialTab).toHaveBeenNthCalledWith(2, 'skills');
    expect(setCurrentView).toHaveBeenCalledTimes(2);
    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('does not intercept commands that only start with /mcp or /skills', () => {
    const setSettingsInitialTab = vi.fn();
    const setCurrentView = vi.fn();
    const opts = createOptions({ setSettingsInitialTab, setCurrentView });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/mcp-status');
    });

    expect(setSettingsInitialTab).not.toHaveBeenCalled();
    expect(setCurrentView).not.toHaveBeenCalled();
    // Falls through to the normal send path (not a local command)
    const calls = (window.sendToJava as any).mock.calls.map((c: any[]) => c[0] as string);
    expect(calls[calls.length - 1]).toMatch(/^send_message:/);
  });
});
