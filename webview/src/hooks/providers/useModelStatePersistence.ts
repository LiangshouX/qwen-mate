import { useEffect } from 'react';
import { sendBridgeEvent } from '../../utils/bridge';
import {
  DEFAULT_QWEN_MODEL_ID,
  isValidPermissionMode,
  normalizeQwenModelId,
  QWEN_MODELS,
} from '../../components/ChatInputBox/types';
import type { PermissionMode, ReasoningEffort } from '../../components/ChatInputBox/types';
import { isCliOnlyProvider, normalizeCliPermissionMode } from './cliProviders';

const STORAGE_KEY = 'model-selection-state';
const REASONING_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === 'string' && (REASONING_VALUES as readonly string[]).includes(value);

// Older sessions stored CC GUI ids (autoEdit / acceptEdits / bypassPermissions);
// migrate them to the Qwen Code CLI approval-mode ids before validating.
const normalizeRestoredPermissionMode = (value: unknown): PermissionMode | null => {
  const migrated = typeof value === 'string'
    ? normalizeCliPermissionMode(value as PermissionMode, 'qwen')
    : value;
  return typeof migrated === 'string' && isValidPermissionMode(migrated) ? migrated : null;
};

/**
 * Accept any non-empty saved model id (custom models are user-defined and the
 * catalog may not be loaded yet). An empty/invalid value leaves the default in
 * place — never silently blank the user's selection.
 */
const isRestorableModelId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Qwen additionally restores the explicit empty id: '' is the "Default (follow
 * CLI config)" selection and must survive the save/restore round trip verbatim
 * (it syncs to the backend as an empty `set_model`, so the CLI configuration
 * decides the model). Whitespace-only values still count as "nothing saved".
 */
const isRestorableQwenModelId = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || value.trim().length > 0);

const QWEN_MODEL_IDS = new Set(QWEN_MODELS.map((model) => model.id));

/**
 * Legacy multi-provider snapshots stored the Claude model in `claudeModel`.
 * Only Qwen ids survive that migration (retired ids map through the alias
 * table first); anything else is a retired Claude model id that the Qwen CLI
 * would reject, so it falls back to the Qwen default (follow CLI config)
 * instead of poisoning the qwen slot.
 */
const migrateLegacyClaudeModel = (value: unknown): string | undefined => {
  if (!isRestorableModelId(value)) return undefined;
  const normalized = normalizeQwenModelId(value);
  return QWEN_MODEL_IDS.has(normalized) ? normalized : DEFAULT_QWEN_MODEL_ID;
};

export interface UseModelStatePersistenceOptions {
  // Cross-slice load setters (run once on mount)
  setCurrentProvider: (value: string) => void;
  setSelectedQwenModel: (value: string) => void;
  setQwenPermissionMode: (value: PermissionMode) => void;
  setPermissionMode: (value: PermissionMode) => void;
  setReasoningEffort: (value: ReasoningEffort) => void;
  // Cross-slice save deps (re-saves on any change)
  currentProvider: string;
  selectedQwenModel: string;
  qwenPermissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
}

/**
 * Two effects for persisting cross-slice provider/model state to localStorage:
 *  1. On mount: hydrate state from localStorage and sync the restored values
 *     to the backend (retrying until the JCEF bridge is ready).
 *  2. On change: re-save the snapshot to localStorage.
 *
 * Save uses `JSON.stringify` of the persisted keys; load applies defensive
 * validation (permission mode allowlists, reasoning effort allowlist) before
 * invoking the slice setters. Legacy multi-provider snapshots (claude/codex/…)
 * migrate to the qwen slice so a pre-upgrade selection is not lost silently.
 */
export function useModelStatePersistence(options: UseModelStatePersistenceOptions) {
  const {
    setCurrentProvider,
    setSelectedQwenModel,
    setQwenPermissionMode,
    setPermissionMode,
    setReasoningEffort,
    currentProvider,
    selectedQwenModel,
    qwenPermissionMode,
    reasoningEffort,
  } = options;

  // Hydrate from localStorage and sync to backend (mount only).
  // Setters are stable; deps left empty to ensure single execution.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Tracked so the boot sync retry loop cannot outlive the component: it used
    // to fire after teardown and touch `window` on a disposed page.
    let syncTimer: number | undefined;
    let syncCancelled = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Per-tab restore (issue #1353): when the Java backend has loaded a saved
      // session for this specific tab, it injects __INITIAL_TAB_PROVIDER__ /
      // __INITIAL_TAB_MODEL__ into the HTML before React boots. Those values
      // win over the global localStorage snapshot, which is shared across every
      // tab in the JCEF process and would otherwise cause every tab on restart
      // to be set to whichever provider was last saved by ANY tab.
      const initialTabProvider = typeof window.__INITIAL_TAB_PROVIDER__ === 'string'
        ? window.__INITIAL_TAB_PROVIDER__.trim()
        : '';
      const initialTabModel = typeof window.__INITIAL_TAB_MODEL__ === 'string'
        ? window.__INITIAL_TAB_MODEL__.trim()
        : '';
      const hasBackendProvider = isCliOnlyProvider(initialTabProvider);
      const hasBackendModel = initialTabModel.length > 0;

      let restoredProvider = 'qwen';
      let restoredQwenModel = DEFAULT_QWEN_MODEL_ID;
      let restoredQwenPermissionMode: PermissionMode = 'default';

      // Model restore appliers — custom models make any non-empty id valid;
      // the qwen empty id (follow CLI config) is a valid saved selection too.
      const applyQwenModel = (modelId: unknown) => {
        if (isRestorableQwenModelId(modelId)) {
          const normalized = normalizeQwenModelId(modelId);
          restoredQwenModel = normalized;
          setSelectedQwenModel(normalized);
        }
      };

      if (saved) {
        const state = JSON.parse(saved);

        // Backend-supplied provider wins. Legacy snapshots (claude/codex/…)
        // migrate to qwen so the model below is still restored. We still fall
        // through the rest of the hydration so non-provider preferences
        // (permission mode, reasoning effort, …) are restored from localStorage.
        const providerCandidate = hasBackendProvider ? initialTabProvider : state.provider;
        if (isCliOnlyProvider(providerCandidate)) {
          restoredProvider = providerCandidate;
          setCurrentProvider(providerCandidate);
        }

        // Tolerant reads with legacy-key migration: a pre-upgrade snapshot
        // stores the mode in `claudePermissionMode`.
        const restoredQwenMode = normalizeRestoredPermissionMode(
          state.qwenPermissionMode ?? state.claudePermissionMode,
        );
        if (restoredQwenMode) {
          restoredQwenPermissionMode = normalizeCliPermissionMode(restoredQwenMode, 'qwen');
        }

        if (isReasoningEffort(state.reasoningEffort)) {
          setReasoningEffort(state.reasoningEffort);
        }

        // Tolerant reads: prefer the qwen key; legacy snapshots without
        // it fall back to the old claudeModel slot (migrated to the Qwen
        // default when it is not a Qwen id) so nothing is silently blanked.
        const qwenModelCandidate = hasBackendModel && restoredProvider === 'qwen'
          ? initialTabModel
          : (state.qwenModel ?? migrateLegacyClaudeModel(state.claudeModel));
        applyQwenModel(qwenModelCandidate);
      } else if (hasBackendProvider) {
        // No localStorage yet (fresh user) but backend supplied a provider:
        // honor it so the tab starts with the right provider.
        restoredProvider = initialTabProvider;
        setCurrentProvider(initialTabProvider);
        if (hasBackendModel) {
          if (initialTabProvider === 'qwen') applyQwenModel(initialTabModel);
        }
      }

      const initialPermissionMode: PermissionMode = restoredQwenPermissionMode;
      setQwenPermissionMode(restoredQwenPermissionMode);
      setPermissionMode(initialPermissionMode);

      let syncRetryCount = 0;
      const MAX_SYNC_RETRIES = 30;

      const syncToBackend = () => {
        // The retry loop used to outlive the component: a pending timer fired
        // after teardown/unmount and touched `window` on a disposed page
        // (vitest reports it as an unhandled "window is not defined" error).
        if (syncCancelled) {
          return;
        }
        if (window.sendToJava) {
          // Native watchdog reload reuses the original HTML snapshot. Java
          // pushes the current Session state after frontend_ready; echoing the
          // stale boot snapshot would route the existing transcript incorrectly.
          if (window.__CCGUI_RECOVERY_RELOAD__ === true) {
            return;
          }
          sendBridgeEvent('set_provider', restoredProvider);
          sendBridgeEvent('set_model', restoredQwenModel);
          // Do NOT push the permission mode to Java on boot. Java is the source
          // of truth for the mode (persisted app-level in PropertiesComponent,
          // which survives a plugin reinstall) and the webview seeds its own mode
          // FROM Java via get_mode → onModeReceived. Our localStorage copy is
          // wiped on reinstall, so pushing it here would clobber the surviving
          // Java value with 'default'. The mode is only sent to Java on an
          // explicit user switch (handleModeSelect → set_mode).
        } else {
          syncRetryCount++;
          if (syncRetryCount < MAX_SYNC_RETRIES) {
            syncTimer = window.setTimeout(syncToBackend, 100);
          }
        }
      };
      syncTimer = window.setTimeout(syncToBackend, 200);
    } catch {
      // Failed to load model selection state — fall back to defaults already
      // set by individual slice hooks.
    }
    return () => {
      syncCancelled = true;
      if (syncTimer !== undefined) {
        window.clearTimeout(syncTimer);
      }
    };
  }, []);

  // Persist snapshot whenever any of the persisted keys change.
  useEffect(() => {
    let retryTimer: number | undefined;
    let retryCount = 0;

    const persistWhenPageContextIsReady = () => {
      const pageContextPending = window.__CCGUI_PAGE_CONTEXT_READY__ !== true;
      const recoveryStatePending = window.__CCGUI_RECOVERY_RELOAD__ === true
        && window.__CCGUI_RECOVERY_STATE_APPLIED__ !== true;

      // React may mount before onLoadEnd/fallback establishes the runtime page
      // context. Never publish provisional HTML/default state to the localStorage
      // snapshot shared by every tab. Keep the same fast-then-slow retry policy as
      // bridge startup so delayed remote JCEF initialization can still settle.
      if (pageContextPending || recoveryStatePending) {
        retryCount += 1;
        retryTimer = window.setTimeout(
          persistWhenPageContextIsReady,
          retryCount < 50 ? 100 : 1000,
        );
        return;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          provider: currentProvider,
          qwenModel: selectedQwenModel,
          qwenPermissionMode,
          reasoningEffort,
        }));
      } catch {
        // Failed to save model selection state — non-fatal.
      }
    };

    persistWhenPageContextIsReady();
    return () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    currentProvider,
    selectedQwenModel,
    qwenPermissionMode,
    reasoningEffort,
  ]);
}
