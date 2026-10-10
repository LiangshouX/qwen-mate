import { useEffect, useMemo } from 'react';
import {
  REASONING_LEVELS,
  type ReasoningEffort,
  type ReasoningInfo,
} from './types';

/**
 * The reasoning selector is available for every supported provider and offers
 * the full Qwen Code tier ladder (low/medium/high/xhigh/max); the CLI clamps
 * a tier the active model does not support.
 */
export function isReasoningVisible(_currentProvider?: string, _selectedModel?: string): boolean {
  return true;
}

export function getAvailableReasoningLevels(
  _currentProvider?: string,
  _selectedModel?: string,
): ReasoningInfo[] {
  // Full Qwen Code ladder (low/medium/high/xhigh/max) — the CLI clamps the
  // tier to what the active model supports, so the selector stays model-agnostic.
  return REASONING_LEVELS;
}

export function resolveCurrentReasoningLevel(
  value: ReasoningEffort,
  availableLevels: ReasoningInfo[],
): ReasoningInfo | undefined {
  return availableLevels.find((level) => level.id === value)
    || availableLevels.find((level) => level.id === 'high')
    || availableLevels[0];
}

export function useReasoningEffortGuard(
  value: ReasoningEffort,
  onChange: (effort: ReasoningEffort) => void,
  selectedModel?: string,
  currentProvider?: string,
): {
  isVisible: boolean;
  availableLevels: ReasoningInfo[];
  currentLevel: ReasoningInfo | undefined;
} {
  const isVisible = isReasoningVisible(currentProvider, selectedModel);
  const availableLevels = useMemo(
    () => getAvailableReasoningLevels(currentProvider, selectedModel),
    [currentProvider, selectedModel],
  );
  const currentLevel = resolveCurrentReasoningLevel(value, availableLevels);

  useEffect(() => {
    if (!isVisible || availableLevels.some((level) => level.id === value)) {
      return;
    }
    if (currentLevel) {
      onChange(currentLevel.id);
    }
  }, [availableLevels, currentLevel, isVisible, onChange, value]);

  return { isVisible, availableLevels, currentLevel };
}
