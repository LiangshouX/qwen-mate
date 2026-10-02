import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelInfo } from '../types';
import { resolveModelDescription, resolveModelDisplayLabel } from '../modelLabelUtils';
import {
  buildModelDropdownSections,
  MAX_VISIBLE_MODEL_OPTIONS,
  readPinnedModelIds,
  shouldShowModelSearch,
} from '../modelSelectUtils';

interface UseModelSelectStateArgs {
  value: string;
  models: ModelInfo[];
  currentProvider: string;
}

/**
 * Holds ModelSelect's open/search/pinned state plus every derived value
 * (current model resolution, label/description helpers, filtered sections).
 */
export function useModelSelectState({ value, models, currentProvider }: UseModelSelectStateArgs) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readPinnedModelIds(currentProvider));
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Prefer the user's selection even when the catalog is still loading / only a
  // static fallback is available. Falling back to models[0] made dynamic
  // providers visually snap back to the first entry after leaving history and
  // remounting ChatScreen. The empty id is the explicit "Default (follow CLI
  // config)" selection and resolves to a bare entry that renders as the
  // localized follow-CLI label — never as a concrete model.
  const currentModel = models.find(m => m.id === value)
    ?? ({ id: value, label: value } as ModelInfo);

  useEffect(() => {
    setPinnedIds(readPinnedModelIds(currentProvider));
  }, [currentProvider]);

  const isSelectedModel = (modelId: string): boolean => modelId === value;

  const getModelLabel = (model: ModelInfo): string => {
    return resolveModelDisplayLabel(model, {
      t,
      currentProvider,
    });
  };

  const getModelDescription = (model: ModelInfo): string | undefined => {
    return resolveModelDescription(model, t);
  };

  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const filteredModels = normalizedSearchQuery
    ? models.filter((model) => {
        const label = getModelLabel(model);
        const description = getModelDescription(model) ?? '';
        return [model.id, label, description].some((text) => text.toLowerCase().includes(normalizedSearchQuery));
      })
    : models;

  const { sections, hiddenCount: hiddenModelCount } = buildModelDropdownSections(filteredModels, pinnedIds, {
    visibleLimit: MAX_VISIBLE_MODEL_OPTIONS,
  });
  const visibleModelCount = sections.reduce((n, s) => n + s.models.length, 0);
  const showSearch = shouldShowModelSearch(models.length, searchQuery);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  return {
    t,
    isOpen,
    setIsOpen,
    searchQuery,
    setSearchQuery,
    pinnedIds,
    setPinnedIds,
    pinnedSet,
    currentModel,
    isSelectedModel,
    getModelLabel,
    getModelDescription,
    filteredModels,
    sections,
    hiddenModelCount,
    visibleModelCount,
    showSearch,
  };
}
