import { useState, useCallback, useEffect } from 'react';
import type { CustomModel } from '../../../types/provider';
import { STORAGE_KEYS, validateCustomModels } from '../../../types/provider';
import { sendBridgeEvent } from '../../../utils/bridge';

function validatePluginModels(value: unknown): CustomModel[] {
  return validateCustomModels(value);
}

function readPluginModels(storageKey: string): CustomModel[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return validatePluginModels(parsed);
  } catch {
    return [];
  }
}

/**
 * Write plugin-level custom models to localStorage and notify listeners
 */
function writePluginModels(storageKey: string, models: CustomModel[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(models));
    window.dispatchEvent(new CustomEvent('localStorageChange', { detail: { key: storageKey } }));
  } catch {
    // localStorage write failure (e.g. quota exceeded)
  }
}

/**
 * Mirror custom model metadata into the Java config file used by usage displays and aggregators.
 * The complete model list is sent because deleting a model or clearing optional metadata
 * must replace the provider's persisted maps, not merge with stale entries.
 */
function syncCustomModelMetadata(models: CustomModel[]) {
  sendBridgeEvent('set_custom_model_pricing', JSON.stringify({
    provider: 'qwen',
    models,
  }));
}

/** Custom event detail shape for localStorageChange */
interface LocalStorageChangeDetail {
  key: string;
}

/**
 * Hook to manage plugin-level custom Qwen models with localStorage persistence.
 * Listens for both native StorageEvent (cross-tab) and custom localStorageChange (same-tab) events.
 */
export function usePluginModels(storageKey: string = STORAGE_KEYS.QWEN_CUSTOM_MODELS) {
  const [models, setModels] = useState<CustomModel[]>(() => readPluginModels(storageKey));

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };
    const handleCustomChange = (e: Event) => {
      const detail = (e as CustomEvent<LocalStorageChangeDetail>).detail;
      if (detail?.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomChange);
    };
  }, [storageKey]);

  const updateModels = useCallback((newModels: CustomModel[]) => {
    const validModels = validatePluginModels(newModels);
    setModels(validModels);
    writePluginModels(storageKey, validModels);
    syncCustomModelMetadata(validModels);
  }, [storageKey]);

  return { models, updateModels };
}
