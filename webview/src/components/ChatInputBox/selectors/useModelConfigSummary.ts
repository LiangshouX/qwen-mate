import { useMemo } from 'react';
import {
  DSH_PRESETS,
  REASONING_LEVELS,
  getUserDshPresetOptions,
  type ModelInfo,
  type ReasoningEffort,
  type ReasoningInfo,
} from '../types';
import { resolveModelDisplayLabel } from '../modelLabelUtils';

function getReasoningLabel(
  t: (key: string, options?: { defaultValue?: string }) => string,
  effort: ReasoningEffort,
): string {
  const fallback = REASONING_LEVELS.find((level) => level.id === effort)?.label || effort;
  return t(`reasoning.${effort}.label`, { defaultValue: fallback });
}

/**
 * Resolve the display model for the trigger icon: exact id, then a bare
 * fallback entry. The empty id ("Default (follow CLI config)") stays a bare
 * entry so it renders as the localized follow-CLI label, never as models[0].
 */
export const useCurrentModel = (
  models: ModelInfo[],
  selectedModel: string,
) => {
  return models.find((model) => model.id === selectedModel)
    ?? ({ id: selectedModel, label: selectedModel } as ModelInfo);
};

interface UseModelConfigRowsInput {
  currentProvider: string;
  onReasoningChange?: (effort: ReasoningEffort) => void;
  onDshPresetChange?: (preset: string) => void;
  showEffort: boolean;
}

/**
 * Which function rows the popover shows for the current provider, plus the
 * divider between the flat model list and those rows.
 */
export const useModelConfigRows = ({
  currentProvider,
  onReasoningChange,
  onDshPresetChange,
  showEffort,
}: UseModelConfigRowsInput) => {
  const showEffortRow = showEffort && !!onReasoningChange;
  const showPreset = currentProvider === 'dsh' && !!onDshPresetChange;
  const showDivider = showEffortRow || showPreset;

  return {
    showEffortRow,
    showPreset,
    showDivider,
  };
};

interface UseModelConfigSummaryInput {
  t: (key: string, options?: { defaultValue?: string }) => string;
  currentModel: ModelInfo | undefined;
  currentProvider: string;
  dshPreset: string;
  showEffortRow: boolean;
  showPreset: boolean;
  currentLevel: ReasoningInfo | undefined;
}

/**
 * The current-value label of each function row and the combined summary text
 * shown on the trigger (model + effort + preset).
 */
export const useModelConfigSummary = ({
  t,
  currentModel,
  currentProvider,
  dshPreset,
  showEffortRow,
  showPreset,
  currentLevel,
}: UseModelConfigSummaryInput) => {
  const modelLabel = currentModel
    ? resolveModelDisplayLabel(currentModel, {
        t,
        currentProvider,
      })
    : '';

  const dshOptions = useMemo(
    () => [...DSH_PRESETS, ...getUserDshPresetOptions()],
    [],
  );
  const currentDshPreset = dshOptions.find((preset) => preset.id === dshPreset) || dshOptions[0];
  const dshPresetLabel = currentDshPreset?.label
    || (currentDshPreset?.labelKey ? t(currentDshPreset.labelKey, { defaultValue: currentDshPreset.id }) : '');
  const effortLabel = currentLevel ? getReasoningLabel(t, currentLevel.id) : '';
  const summaryParts = [
    modelLabel,
    showEffortRow ? effortLabel : '',
    showPreset && dshPreset ? dshPresetLabel : '',
  ].filter(Boolean);
  const summaryText = summaryParts.join(' ');

  return {
    dshPresetLabel,
    effortLabel,
    summaryText,
  };
};
