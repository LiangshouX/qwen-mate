import { useEffect, useState } from 'react';
import { sendBridgeEvent } from '../../utils/bridge';
import type { ModelInfo } from '../../components/ChatInputBox/types';
import {
  EMPTY_QWEN_MODEL_OPTIONS,
  type QwenModelOptions,
} from '../../components/ChatInputBox/resolveProviderModels';

/**
 * Module-level cache so switching away from chat (history/settings) and back
 * does not drop the CLI model catalog and re-trigger a bridge round-trip.
 * ChatScreen unmounts on view change; this survives that remount.
 */
let optionsCache: QwenModelOptions | null = null;

/**
 * Multicast listeners: ButtonArea and the AI-feature settings panel mount this
 * hook simultaneously, and `window.updateQwenModelOptions` is a single slot —
 * a per-hook window assignment would let the last mount win and leave the
 * other hook stale.
 */
const subscribers = new Set<(options: QwenModelOptions) => void>();

/** Test-only: clear the module cache and subscribers between cases. */
export function __resetQwenModelOptionsCacheForTests() {
  optionsCache = null;
  subscribers.clear();
}

/**
 * Normalize the `updateQwenModelOptions` payload:
 * `{ configuredModel: string, models: Array<{ id, name, provider }> }` →
 * QwenModelOptions (label = name, description = provider). Invalid shapes are
 * rejected (null) so a malformed push never wipes a good cache entry.
 */
export function parseQwenModelOptions(dataOrStr: unknown): QwenModelOptions | null {
  let payload: Record<string, unknown> | null = null;
  if (typeof dataOrStr === 'string') {
    try {
      payload = JSON.parse(dataOrStr) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (dataOrStr && typeof dataOrStr === 'object') {
    payload = dataOrStr as Record<string, unknown>;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  // Reject wrong-typed fields so a malformed push is ignored wholesale instead
  // of wiping a good cache entry with an empty catalog.
  if (payload.configuredModel !== undefined && typeof payload.configuredModel !== 'string') {
    return null;
  }
  if (payload.models !== undefined && !Array.isArray(payload.models)) {
    return null;
  }

  const configuredModel = typeof payload.configuredModel === 'string'
    ? payload.configuredModel.trim()
    : '';
  const rawModels = Array.isArray(payload.models) ? payload.models : [];
  const models: ModelInfo[] = [];
  const seenIds = new Set<string>();
  for (const item of rawModels) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
    const provider = typeof row.provider === 'string' ? row.provider.trim() : '';
    const rawWindow = row.contextWindowSize;
    const contextWindowTokens = typeof rawWindow === 'number' && Number.isFinite(rawWindow) && rawWindow > 0
      ? rawWindow
      : undefined;
    models.push({ id, label: name, description: provider || undefined, contextWindowTokens });
  }
  return { configuredModel, models };
}

function handlePayload(dataOrStr: unknown): void {
  const parsed = parseQwenModelOptions(dataOrStr);
  if (!parsed) return;
  optionsCache = parsed;
  for (const notify of subscribers) {
    notify(parsed);
  }
}

/**
 * CLI-config-aware Qwen model catalog: requests `get_qwen_model_options` on
 * mount (only until the first answer lands) and mirrors the Java push
 * (`window.updateQwenModelOptions`) into React state.
 */
export function useQwenModelOptions(): QwenModelOptions {
  const [options, setOptions] = useState<QwenModelOptions>(() => optionsCache ?? EMPTY_QWEN_MODEL_OPTIONS);

  useEffect(() => {
    subscribers.add(setOptions);
    window.updateQwenModelOptions = handlePayload;
    if (optionsCache === null) {
      // No answer yet — request. Remounts before the answer arrive re-request
      // (idempotent on the Java side); after the first answer the cache ends it.
      sendBridgeEvent('get_qwen_model_options');
    }
    return () => {
      subscribers.delete(setOptions);
      if (subscribers.size === 0 && window.updateQwenModelOptions === handlePayload) {
        delete window.updateQwenModelOptions;
      }
    };
  }, []);

  return options;
}

export type UseQwenModelOptionsReturn = ReturnType<typeof useQwenModelOptions>;
