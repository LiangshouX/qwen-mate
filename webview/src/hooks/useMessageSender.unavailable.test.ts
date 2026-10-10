import { act, renderHook } from '@testing-library/react';
import { useMessageSender } from './useMessageSender';
import type { UseMessageSenderOptions } from './useMessageSender';
import {
  isCommandSendable,
  resetSlashCommandsState,
  setupSlashCommandsCallback,
} from '../components/ChatInputBox/providers/slashCommandProvider';

/**
 * The headless CLI rejects interactive-only commands (/rename, /theme, …) with
 * "not supported in this mode". Once the runtime list is known the send path
 * must drop them locally instead of paying a turn respawn for a known reply.
 */
describe('useMessageSender - unavailable slash commands', () => {
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

  const applyRuntime = (names: string[]) => {
    setupSlashCommandsCallback();
    window.updateRuntimeSlashCommands?.(JSON.stringify(names));
  };

  beforeEach(() => {
    window.sendToJava = vi.fn();
    resetSlashCommandsState();
  });

  afterEach(() => {
    resetSlashCommandsState();
  });

  describe('isCommandSendable', () => {
    it('allows everything before the first turn delivers the runtime list', () => {
      expect(isCommandSendable('/rename')).toBe(true);
      expect(isCommandSendable('/rename now')).toBe(true);
    });

    it('keeps GUI-handled commands sendable even when the CLI omits them', () => {
      applyRuntime(['compress']);
      expect(isCommandSendable('/context')).toBe(true);
      expect(isCommandSendable('/effort')).toBe(true);
      expect(isCommandSendable('/mcp')).toBe(true);
    });

    it('rejects commands the runtime list does not contain, ignoring arguments', () => {
      applyRuntime(['compress']);
      expect(isCommandSendable('/compress')).toBe(true);
      expect(isCommandSendable('/rename')).toBe(false);
      expect(isCommandSendable('/theme dark')).toBe(false);
      expect(isCommandSendable('/not-a-command')).toBe(false);
    });
  });

  it('blocks a rejected command locally instead of forwarding it', () => {
    applyRuntime(['compress']);
    const setMessages = vi.fn();
    const opts = createOptions({ setMessages });

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/rename');
    });

    // Never reaches the CLI: no bridge traffic, no error bubble from Java.
    expect(window.sendToJava).not.toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledTimes(1);
    const added = setMessages.mock.calls[0][0]([] as any[]);
    expect(added).toHaveLength(2);
    expect(added[0].type).toBe('user');
    expect(added[0].content).toBe('/rename');
    expect(added[1].type).toBe('assistant');
    expect(added[1].content).toContain('/rename');
    expect(added[1].content).toContain('not available in this mode');
  });

  it('still forwards commands the runtime list contains', () => {
    applyRuntime(['compress']);
    const opts = createOptions();

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/compress please');
    });

    const calls = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as string);
    expect(calls.some((c) => c.startsWith('send_message:'))).toBe(true);
  });

  it('forwards everything while the runtime list is still unknown', () => {
    // No runtime list yet (before the first turn) — same as the old behaviour.
    const opts = createOptions();

    const { result } = renderHook(() => useMessageSender(opts));

    act(() => {
      result.current.handleSubmit('/rename');
    });

    const calls = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as string);
    expect(calls.some((c) => c.startsWith('send_message:'))).toBe(true);
  });
});
