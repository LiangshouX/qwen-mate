import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropdownPosition } from '../../../hooks/useDropdownPosition';
import { useReasoningEffortGuard } from '../reasoningUtils';
import {
  AVAILABLE_MODELS,
  type ModelInfo,
  type ReasoningEffort,
} from '../types';
import { ModelConfigDropdown } from './ModelConfigDropdown';
import { ModelConfigTrigger } from './ModelConfigTrigger';
import { useModelConfigSubmenu } from './useModelConfigSubmenu';
import { useCurrentModel, useModelConfigRows, useModelConfigSummary } from './useModelConfigSummary';

export {
  SUBMENU_HOVER_DELAY_MS,
  SUBMENU_TRIGGER_DELAY_MS,
} from './useModelConfigSubmenu';

const WRAPPER_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };

interface ModelConfigSelectProps {
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
  models?: ModelInfo[];
  currentProvider?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningChange?: (effort: ReasoningEffort) => void;
}

/**
 * Model-settings selector: one summary trigger whose popover keeps the model
 * list flat at the top; the function rows (effort) sit below it,
 * next to the trigger. Rows that offer a choice open fly-out submenus beside
 * them.
 */
export const ModelConfigSelect = ({
  selectedModel,
  onModelSelect,
  models = AVAILABLE_MODELS,
  currentProvider = 'qwen',
  loading = false,
  error = null,
  onRetry,
  reasoningEffort = 'high',
  onReasoningChange,
}: ModelConfigSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const {
    activeSubmenu,
    effortTriggerRef,
    openSubmenu,
    scheduleSubmenu,
    retainActiveSubmenu,
    resetSubmenu,
  } = useModelConfigSubmenu();

  const { positionedStyle: mainPositionedStyle, maxHeight: mainMaxHeight, recalculate: mainRecalculate } = useDropdownPosition({
    buttonRef,
    dropdownRef,
    preferredAlignment: 'right',
    minWidth: 220,
  });

  const handleReasoningChange = useCallback((effort: ReasoningEffort) => {
    onReasoningChange?.(effort);
  }, [onReasoningChange]);

  const { isVisible: showEffort, currentLevel } = useReasoningEffortGuard(
    reasoningEffort,
    handleReasoningChange,
    selectedModel,
    currentProvider,
  );

  const currentModel = useCurrentModel(models, selectedModel);
  const {
    showEffortRow,
    showDivider,
  } = useModelConfigRows({
    onReasoningChange,
    showEffort,
  });
  const {
    effortLabel,
    summaryText,
  } = useModelConfigSummary({
    t,
    currentModel,
    currentProvider,
    showEffortRow,
    currentLevel,
  });

  const closeMenu = useCallback(() => {
    resetSubmenu();
    setIsOpen(false);
  }, [resetSubmenu]);

  // Bare `/effort` opens this popover with the effort submenu expanded — the
  // GUI equivalent of the CLI's interactive picker. Same window-callback
  // convention the Java bridge uses; registered only while mounted.
  useEffect(() => {
    window.openEffortSelector = () => {
      setIsOpen(true);
      mainRecalculate();
      openSubmenu('effort');
    };
    return () => {
      delete window.openEffortSelector;
    };
  }, [mainRecalculate, openSubmenu]);

  const handleToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    resetSubmenu();
    if (nextOpen) {
      mainRecalculate();
    }
  }, [resetSubmenu, isOpen, mainRecalculate]);

  const closeMenuOnOutsideClick = useEffectEvent(closeMenu);

  useEffect(() => {
    if (!isOpen) return;

    let armed = false;
    const timer = setTimeout(() => { armed = true; }, 0);
    const handleClickOutside = (event: MouseEvent) => {
      if (!armed) return;
      if (
        dropdownRef.current
        && !dropdownRef.current.contains(event.target as Node)
        && buttonRef.current
        && !buttonRef.current.contains(event.target as Node)
      ) {
        closeMenuOnOutsideClick();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) {
      mainRecalculate();
    }
  }, [isOpen, mainRecalculate, showEffortRow]);

  return (
    <div style={WRAPPER_STYLE}>
      <ModelConfigTrigger
        buttonRef={buttonRef}
        isOpen={isOpen}
        summaryText={summaryText}
        currentModel={currentModel}
        currentProvider={currentProvider}
        onToggle={handleToggle}
      />

      {isOpen && (
        <ModelConfigDropdown
          dropdownRef={dropdownRef}
          positionedStyle={mainPositionedStyle}
          maxHeight={mainMaxHeight}
          onMouseOverCapture={retainActiveSubmenu}
          onClose={closeMenu}
          selectedModel={selectedModel}
          onModelSelect={onModelSelect}
          models={models}
          currentProvider={currentProvider}
          loading={loading}
          error={error}
          onRetry={onRetry}
          showDivider={showDivider}
          showEffortRow={showEffortRow}
          reasoningEffort={reasoningEffort}
          onReasoningChange={handleReasoningChange}
          effortLabel={effortLabel}
          activeSubmenu={activeSubmenu}
          effortTriggerRef={effortTriggerRef}
          scheduleSubmenu={scheduleSubmenu}
          openSubmenu={openSubmenu}
        />
      )}
    </div>
  );
};

export default ModelConfigSelect;
