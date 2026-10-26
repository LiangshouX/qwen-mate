import { act, renderHook, waitFor } from '@testing-library/react';
import { useMessageSender } from './useMessageSender';
import type { UseMessageSenderOptions } from './useMessageSender';
import { __resetDefaultModelBridgeForTests } from '../utils/defaultModel';

describe('useMessageSender - /model command', () => {
  // Mirrors the real translator: interpolate {{name}} from options.
  const t = ((key: string, opts?: any) => {
    const template = String(opts?.defaultValue ?? key);
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(opts?.[name] ?? ''));
  }) as any;

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
    handleModelSelect: vi.fn(),
    openModelSelectDialog: vi.fn(),
    openContextUsageDialog: vi.fn(),
    closeContextUsageDialog: vi.fn().mockReturnValue(true),
    ...overrides,
  });

  beforeEach(() => {
    window.sendToJava = vi.fn();
  });

  afterEach(() => {
    __resetDefaultModelBridgeForTests();
    delete (window as any).sendToJava;
  });

  const forwardedAsMessage = () => (window.sendToJava as any).mock.calls.some(
    ([payload]: [string]) => payload.startsWith('send_message'),
  );

  it('bare /model opens the global default picker instead of forwarding', () => {
    const openModelSelectDialog = vi.fn();
    const setMessages = vi.fn();
    const { result } = renderHook(() => useMessageSender(
      createOptions({ openModelSelectDialog, setMessages }),
    ));

    act(() => {
      result.current.handleSubmit('/model');
    });

    expect(openModelSelectDialog).toHaveBeenCalledTimes(1);
    expect(forwardedAsMessage()).toBe(false);
    const added = setMessages.mock.calls[0][0]([] as any[]);
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe('/model');
  });

  it('/model <id> switches the current session only, never forwarding', () => {
    const handleModelSelect = vi.fn();
    const addToast = vi.fn();
    const { result } = renderHook(() => useMessageSender(
      createOptions({ handleModelSelect, addToast }),
    ));

    act(() => {
      result.current.handleSubmit('/model mimo-v2.6-flash');
    });

    expect(handleModelSelect).toHaveBeenCalledWith('mimo-v2.6-flash');
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('mimo-v2.6-flash'),
      'success',
    );
    expect(forwardedAsMessage()).toBe(false);
  });

  it('/model --global <id> persists the default through the bridge', async () => {
    const addToast = vi.fn();
    const { result } = renderHook(() => useMessageSender(createOptions({ addToast })));

    act(() => {
      result.current.handleSubmit('/model --global mimo-v2.6-pro');
    });

    const bridgeCall = (window.sendToJava as any).mock.calls.find(
      ([payload]: [string]) => payload.startsWith('set_qwen_default_model:'),
    );
    expect(bridgeCall).toBeTruthy();
    expect(JSON.parse(bridgeCall[0].slice('set_qwen_default_model:'.length))).toEqual({
      modelId: 'mimo-v2.6-pro',
    });
    expect(forwardedAsMessage()).toBe(false);

    act(() => {
      window.onQwenDefaultModelResult?.('{"success":true,"modelId":"mimo-v2.6-pro"}');
    });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('mimo-v2.6-pro'),
      'success',
    ));
  });

  it('/model --global without an id explains the usage instead of forwarding', () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() => useMessageSender(createOptions({ setMessages })));

    act(() => {
      result.current.handleSubmit('/model --global');
    });

    const added = setMessages.mock.calls[0][0]([] as any[]);
    expect(added).toHaveLength(2);
    expect(added[1].type).toBe('assistant');
    expect(added[1].content).toContain('/model <model-id>');
    expect(forwardedAsMessage()).toBe(false);
  });

  it('rejects --fast and --project locally with a hint', () => {
    for (const flag of ['--fast', '--project']) {
      const setMessages = vi.fn();
      const { result } = renderHook(() => useMessageSender(createOptions({ setMessages })));

      act(() => {
        result.current.handleSubmit(`/model ${flag} some-model`);
      });

      const added = setMessages.mock.calls[0][0]([] as any[]);
      expect(added).toHaveLength(2);
      expect(added[1].type).toBe('assistant');
      expect(added[1].content).toContain(flag === '--fast' ? 'fast' : 'Project');
      expect(forwardedAsMessage()).toBe(false);
    }
  });

  it('rejects unknown flags with the usage hint', () => {
    const setMessages = vi.fn();
    const { result } = renderHook(() => useMessageSender(createOptions({ setMessages })));

    act(() => {
      result.current.handleSubmit('/model --turbo');
    });

    const added = setMessages.mock.calls[0][0]([] as any[]);
    expect(added).toHaveLength(2);
    expect(added[1].content).toContain('/model <model-id>');
    expect(forwardedAsMessage()).toBe(false);
  });

  it('matches the command case-insensitively', () => {
    const openModelSelectDialog = vi.fn();
    const { result } = renderHook(() => useMessageSender(createOptions({ openModelSelectDialog })));

    act(() => {
      result.current.handleSubmit('/MODEL');
    });

    expect(openModelSelectDialog).toHaveBeenCalledTimes(1);
    expect(forwardedAsMessage()).toBe(false);
  });

  it('surfaces writer failures instead of a success toast', async () => {
    const addToast = vi.fn();
    const { result } = renderHook(() => useMessageSender(createOptions({ addToast })));

    act(() => {
      result.current.handleSubmit('/model --global ghost');
    });

    act(() => {
      window.onQwenDefaultModelResult?.(
        '{"success":false,"modelId":"ghost","code":"model_not_found","error":"模型不存在：ghost"}',
      );
    });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('模型不存在：ghost'),
      'error',
    ));
  });
});
