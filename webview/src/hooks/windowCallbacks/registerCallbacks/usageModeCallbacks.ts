/**
 * usageModeCallbacks.ts
 *
 * Registers window bridge callbacks for usage statistics, permission modes, and
 * model/provider updates: onUsageUpdate, onModeChanged, onModeReceived,
 * onModelChanged, onModelConfirmed, updateThinkingEnabled,
 * updateStreamingEnabled, updateSendShortcut, updateAutoOpenFileEnabled.
 */

import type { UseWindowCallbacksOptions } from '../../useWindowCallbacks';
import type { PermissionMode, ReasoningEffort } from '../../../components/ChatInputBox/types';
import { isValidPermissionMode } from '../../../components/ChatInputBox/types';
import { drainPendingSettings, startInitialSettingsRequest } from '../settingsBootstrap';
import { clampPermissionDialogTimeoutSeconds } from '../../../utils/permissionDialogTimeout';
import { isCliOnlyProvider, normalizeCliPermissionMode } from '../../providers/cliProviders';

export function registerUsageModeCallbacks(options: UseWindowCallbacksOptions): void {
  const {
    setUsagePercentage,
    setUsageUsedTokens,
    setUsageMaxTokens,
    setPermissionMode,
    setCurrentProvider,
    setQwenPermissionMode,
    setSelectedQwenModel,
    setReasoningEffort,
    setAlwaysThinkingEnabled,
    setStreamingEnabledSetting,
    setSendShortcut,
    setAutoOpenFileEnabled,
    setPermissionDialogTimeoutSeconds,
    currentProviderRef,
  } = options;

  window.onUsageUpdate = (json) => {
    try {
      const data = JSON.parse(json);
      if (typeof data.percentage === 'number') {
        const used =
          typeof data.usedTokens === 'number'
            ? data.usedTokens
            : typeof data.totalTokens === 'number'
              ? data.totalTokens
              : undefined;
        const max =
          typeof data.maxTokens === 'number'
            ? data.maxTokens
            : typeof data.limit === 'number'
              ? data.limit
              : undefined;

        if (used !== undefined && max !== undefined && used > max * 2) {
          console.warn(
            '[Frontend] Usage data may be incorrect: used=' + used + ', max=' + max,
          );
        }

        const safePercentage = Math.max(0, Math.min(100, data.percentage));
        setUsagePercentage(safePercentage);
        setUsageUsedTokens(used);
        setUsageMaxTokens(max);
      }
    } catch (error) {
      console.error('[Frontend] Failed to parse usage update:', error);
    }
  };

  if (typeof window.__pendingUsageUpdate === 'string') {
    const pending = window.__pendingUsageUpdate;
    delete window.__pendingUsageUpdate;
    window.onUsageUpdate(pending);
  }

  const updateMode = (mode?: PermissionMode, providerOverride?: string) => {
    const activeProvider = providerOverride || currentProviderRef.current;
    // Migrate legacy CC GUI aliases before validating the callback payload.
    const canonicalMode = mode ? normalizeCliPermissionMode(mode, 'qwen') : mode;
    const normalizedMode = isCliOnlyProvider(activeProvider)
      ? normalizeCliPermissionMode(canonicalMode ?? 'default', activeProvider)
      : canonicalMode;
    if (isValidPermissionMode(normalizedMode)) {
      setPermissionMode((prev) => (prev === normalizedMode ? prev : normalizedMode));
      setQwenPermissionMode((prev) => (prev === normalizedMode ? prev : normalizedMode));
    }
  };

  window.onModeChanged = (mode) => updateMode(mode as PermissionMode);
  window.onModeReceived = (mode) => updateMode(mode as PermissionMode);

  window.onModelChanged = (modelId) => {
    setSelectedQwenModel(modelId);
  };

  window.onModelConfirmed = (modelId, _provider) => {
    setSelectedQwenModel(modelId);
  };

  window.applyBackendTabState = (json: string) => {
    try {
      const state = JSON.parse(json) as Record<string, unknown>;
      // qwen is the only engine. Legacy persisted tab state may still carry a
      // retired provider id (e.g. 'dsh'); fold it into qwen like the Java
      // SessionProviderRouter instead of dropping the whole recovery state.
      const provider = 'qwen';

      // This is Java -> UI recovery state, not a user selection. Update the
      // synchronous ref and React state without emitting set_provider/set_model.
      currentProviderRef.current = provider;
      setCurrentProvider(provider);

      if (typeof state.model === 'string' && state.model.length > 0) {
        setSelectedQwenModel(state.model);
      }

      updateMode(state.permissionMode as PermissionMode | undefined, provider);

      const reasoningValues: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
      if (reasoningValues.includes(state.reasoningEffort as ReasoningEffort)) {
        setReasoningEffort(state.reasoningEffort as ReasoningEffort);
      }
      window.__CCGUI_RECOVERY_STATE_APPLIED__ = true;
    } catch (error) {
      console.error('[Frontend] Failed to apply backend tab state:', error);
    }
  };

  if (typeof window.__pendingBackendTabState === 'string') {
    const pending = window.__pendingBackendTabState;
    delete window.__pendingBackendTabState;
    window.applyBackendTabState(pending);
  }

  window.updateThinkingEnabled = (jsonStr: string) => {
    const trimmed = (jsonStr || '').trim();
    try {
      const data = JSON.parse(trimmed);
      if (typeof data === 'boolean') {
        setAlwaysThinkingEnabled(data);
        return;
      }
      if (data && typeof data.enabled === 'boolean') {
        setAlwaysThinkingEnabled(data.enabled);
        return;
      }
    } catch {
      if (trimmed === 'true' || trimmed === 'false') {
        setAlwaysThinkingEnabled(trimmed === 'true');
      }
    }
  };

  window.updateStreamingEnabled = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      setStreamingEnabledSetting(data.streamingEnabled ?? true);
    } catch (error) {
      console.error('[Frontend] Failed to parse streaming enabled:', error);
    }
  };

  window.updateSendShortcut = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.sendShortcut === 'enter' || data.sendShortcut === 'cmdEnter') {
        setSendShortcut(data.sendShortcut);
      }
    } catch (error) {
      console.error('[Frontend] Failed to parse send shortcut:', error);
    }
  };

  window.updateAutoOpenFileEnabled = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      setAutoOpenFileEnabled(data.autoOpenFileEnabled ?? false);
    } catch (error) {
      console.error('[Frontend] Failed to parse auto open file enabled:', error);
    }
  };

  window.updatePermissionDialogTimeout = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      setPermissionDialogTimeoutSeconds(clampPermissionDialogTimeoutSeconds(data.permissionDialogTimeoutSeconds));
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`[Frontend] Failed to parse permission dialog timeout payload: ${errorName}`);
    }
  };

  // Drain any pending settings that arrived before callback registration
  drainPendingSettings();
  // Kick off initial settings requests
  startInitialSettingsRequest();
}
