import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { sendBridgeEvent } from '../utils/bridge';
import { isValidDshPreset, isValidPermissionMode } from '../components/ChatInputBox/types';
import type { PermissionMode, ReasoningEffort } from '../components/ChatInputBox/types';
import { isCliOnlyProvider } from './providers/cliProviders';
import { useQwenProvider } from './providers/useQwenProvider';
import { useDshProvider } from './providers/useDshProvider';
import { useUsageTracking } from './providers/useUsageTracking';
import { useProviderSettings } from './providers/useProviderSettings';
import { useModelStatePersistence } from './providers/useModelStatePersistence';
import {
  applyCliModeSelect,
  applyModelSelect,
  resolveProviderModel,
  resolveProviderPermissionMode,
  selectedModelForProvider,
} from './modelProviderStateHelpers';

export type ViewMode = 'chat' | 'history' | 'settings';

export interface UseModelProviderStateOptions {
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  t: TFunction;
}

/**
 * Orchestrates provider/model/permission state. Composes the provider slices
 * (Qwen / DSH) plus usage tracking and provider settings, then wires the
 * cross-slice state (currentProvider + permissionMode) and the cross-provider
 * handlers (mode/model/provider switch, thinking toggle).
 *
 * The flat return shape is preserved as the public API: callers (App,
 * ChatScreen, AppDialogs, useMessageSender) destructure individual fields.
 *
 * `currentProviderRef` is exposed for window callbacks registered with stable
 * identity that must read the current provider when fired by the JCEF bridge.
 * The ref is mirrored inside useEffect so no ref access happens during render.
 */
export function useModelProviderState({ addToast, t }: UseModelProviderStateOptions) {
  // ── Cross-slice state owned by the orchestrator ──
  const [currentProvider, setCurrentProvider] = useState('qwen');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');

  // External-facing ref so window callbacks can read the latest provider
  // without re-binding. Mirrored in an effect (bridge callbacks fire async,
  // after commit) so render stays free of ref writes.
  const currentProviderRef = useRef(currentProvider);
  useEffect(() => {
    currentProviderRef.current = currentProvider;
  }, [currentProvider]);

  // ── Provider-specific sub-hooks ──
  const qwen = useQwenProvider();
  const dsh = useDshProvider();
  const { isSdkInstalled, isSdkStatusKnown, sdkStatus, ...usage } = useUsageTracking();
  const settings = useProviderSettings({ addToast, t });

  const {
    selectedQwenModel, setSelectedQwenModel,
    qwenPermissionMode, setQwenPermissionMode,
  } = qwen;
  const {
    selectedDshModel, setSelectedDshModel,
    dshPermissionMode, setDshPermissionMode,
    dshPreset, setDshPreset,
  } = dsh;

  // ── Persistence: load on mount + save on change ──
  useModelStatePersistence({
    setCurrentProvider,
    setSelectedQwenModel,
    setSelectedDshModel,
    setQwenPermissionMode,
    setDshPermissionMode,
    setPermissionMode,
    setReasoningEffort: settings.setReasoningEffort,
    setDshPreset,
    currentProvider,
    selectedQwenModel,
    selectedDshModel,
    qwenPermissionMode,
    dshPermissionMode,
    reasoningEffort: settings.reasoningEffort,
    dshPreset,
  });

  // ── Computed values ──
  const selectedModel = selectedModelForProvider(currentProvider, {
    qwen: selectedQwenModel,
    dsh: selectedDshModel,
  });
  const currentSdkInstalled = useMemo(
    () => isSdkInstalled(currentProvider),
    [isSdkInstalled, currentProvider],
  );
  const currentSdkStatusError = useMemo(
    () => usage.sdkStatusError !== null && !isSdkStatusKnown(currentProvider)
      ? usage.sdkStatusError
      : null,
    [currentProvider, isSdkStatusKnown, usage.sdkStatusError],
  );

  const handleModeSelect = useCallback((mode: PermissionMode) => {
    if (isCliOnlyProvider(currentProvider)) {
      applyCliModeSelect(currentProvider, mode, {
        setPermissionMode,
        setQwenPermissionMode,
        setDshPermissionMode,
      });
      return;
    }
    setPermissionMode(mode);
    setQwenPermissionMode(mode);
    sendBridgeEvent('set_mode', mode);
  }, [currentProvider, setQwenPermissionMode, setDshPermissionMode]);

  const handleModelSelect = useCallback((modelId: string) => {
    applyModelSelect(currentProvider, modelId, {
      setSelectedQwenModel,
      setSelectedDshModel,
    });
  }, [currentProvider, setSelectedQwenModel, setSelectedDshModel]);

  const handleProviderSelect = useCallback((providerId: string) => {
    setCurrentProvider(providerId);
    sendBridgeEvent('set_provider', providerId);

    const modeToSet = resolveProviderPermissionMode(providerId, {
      qwen: qwenPermissionMode,
      dsh: dshPermissionMode,
    });
    setPermissionMode(modeToSet);
    if (isValidPermissionMode(modeToSet)) {
      sendBridgeEvent('set_mode', modeToSet);
    }

    const newModel = resolveProviderModel(providerId, {
      qwen: selectedQwenModel,
      dsh: selectedDshModel,
    });
    sendBridgeEvent('set_model', newModel);
    if (providerId === 'dsh') {
      sendBridgeEvent('set_dsh_preset', dshPreset);
    }
  }, [
    qwenPermissionMode,
    dshPermissionMode,
    selectedQwenModel,
    selectedDshModel,
    dshPreset,
  ]);

  const handleDshPresetChange = useCallback((preset: string) => {
    if (!isValidDshPreset(preset)) return;
    setDshPreset(preset);
    if (currentProvider === 'dsh') {
      sendBridgeEvent('set_dsh_preset', preset);
    }
  }, [currentProvider, setDshPreset]);

  const handleReasoningChange = useCallback((effort: ReasoningEffort) => {
    settings.setReasoningEffort(effort);
    sendBridgeEvent('set_reasoning_effort', effort);
  }, [settings]);

  const handleToggleThinking = useCallback((enabled: boolean) => {
    settings.setAlwaysThinkingEnabled(enabled);
    sendBridgeEvent('set_thinking_enabled', JSON.stringify({ enabled }));
    addToast(enabled ? t('toast.thinkingEnabled') : t('toast.thinkingDisabled'), 'success');
  }, [settings, addToast, t]);

  return {
    ...qwen,
    ...dsh,
    ...usage,
    ...settings,
    sdkStatus,
    sdkStatusError: currentSdkStatusError,
    currentProvider, setCurrentProvider,
    permissionMode, setPermissionMode,
    selectedModel,
    currentSdkInstalled,
    currentProviderRef,
    handleModeSelect,
    handleModelSelect,
    handleProviderSelect,
    handleDshPresetChange,
    handleReasoningChange,
    handleToggleThinking,
  };
}
