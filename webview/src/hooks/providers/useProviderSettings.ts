import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { sendBridgeEvent } from '../../utils/bridge';
import type { ReasoningEffort, SelectedAgent } from '../../components/ChatInputBox/types';

export interface UseProviderSettingsOptions {
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  t: TFunction;
}

/**
 * Cross-cutting provider settings: streaming, send shortcut, auto-open file,
 * selected agent, and the always-thinking toggle. Each setting handler pushes
 * the change to the backend via bridge event and (where applicable) toasts the
 * user-visible state change. Loads the previously-selected agent on mount,
 * retrying until the JCEF bridge is ready.
 */
export function useProviderSettings({ addToast, t }: UseProviderSettingsOptions) {
  const [streamingEnabledSetting, setStreamingEnabledSetting] = useState(true);
  const [sendShortcut, setSendShortcut] = useState<'enter' | 'cmdEnter'>('enter');
  const [autoOpenFileEnabled, setAutoOpenFileEnabled] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null);
  const [alwaysThinkingEnabled, setAlwaysThinkingEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');

  // Load previously-selected agent on mount, retrying until JCEF bridge is ready.
  useEffect(() => {
    let retryCount = 0;
    const MAX_RETRIES = 10;
    let timeoutId: number | undefined;

    const loadSelectedAgent = () => {
      if (window.sendToJava) {
        sendBridgeEvent('get_selected_agent');
      } else {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          timeoutId = window.setTimeout(loadSelectedAgent, 100);
        }
      }
    };

    timeoutId = window.setTimeout(loadSelectedAgent, 200);
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  const handleAgentSelect = useCallback((agent: SelectedAgent | null) => {
    setSelectedAgent(agent);
    if (agent) {
      sendBridgeEvent('set_selected_agent', JSON.stringify({
        id: agent.id,
        name: agent.name,
        prompt: agent.prompt,
      }));
    } else {
      sendBridgeEvent('set_selected_agent', '');
    }
  }, []);

  const handleStreamingEnabledChange = useCallback((enabled: boolean) => {
    setStreamingEnabledSetting(enabled);
    sendBridgeEvent('set_streaming_enabled', JSON.stringify({ streamingEnabled: enabled }));
    addToast(
      enabled ? t('settings.basic.streaming.enabled') : t('settings.basic.streaming.disabled'),
      'success',
    );
  }, [t, addToast]);

  const handleSendShortcutChange = useCallback((shortcut: 'enter' | 'cmdEnter') => {
    setSendShortcut(shortcut);
    sendBridgeEvent('set_send_shortcut', JSON.stringify({ sendShortcut: shortcut }));
  }, []);

  const handleAutoOpenFileEnabledChange = useCallback((enabled: boolean) => {
    setAutoOpenFileEnabled(enabled);
    sendBridgeEvent('set_auto_open_file_enabled', JSON.stringify({ autoOpenFileEnabled: enabled }));
    addToast(
      enabled ? t('settings.basic.autoOpenFile.enabled') : t('settings.basic.autoOpenFile.disabled'),
      'success',
    );
  }, [t, addToast]);

  return {
    streamingEnabledSetting,
    setStreamingEnabledSetting,
    sendShortcut,
    setSendShortcut,
    autoOpenFileEnabled,
    setAutoOpenFileEnabled,
    selectedAgent,
    setSelectedAgent,
    alwaysThinkingEnabled,
    setAlwaysThinkingEnabled,
    reasoningEffort,
    setReasoningEffort,
    handleAgentSelect,
    handleStreamingEnabledChange,
    handleSendShortcutChange,
    handleAutoOpenFileEnabledChange,
  };
}

export type UseProviderSettingsReturn = ReturnType<typeof useProviderSettings>;
