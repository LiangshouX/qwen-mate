import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ButtonAreaProps, PermissionMode, ReasoningEffort } from './types';
import { DEFAULT_QWEN_MODEL_ID } from './types';
import { ConfigSelect, ModeSelect, ModelConfigSelect, ProviderSelect } from './selectors';
import { useCliModels } from '../../hooks/providers/useCliModels';
import { useQwenModelOptions } from '../../hooks/providers/useQwenModelOptions';
import { useToolbarSelectorCompact } from './hooks/useToolbarSelectorCompact';
import { resolveProviderModels } from './resolveProviderModels';

/**
 * ButtonArea - Bottom toolbar component
 * Contains mode selector, model selector, attachment button, prompt enhancer button, send/stop button
 */
export const ButtonArea = ({
  disabled = false,
  hasInputContent = false,
  isLoading = false,
  isEnhancing = false,
  selectedModel = DEFAULT_QWEN_MODEL_ID,
  permissionMode = 'default',
  currentProvider = 'qwen',
  reasoningEffort = 'high',
  onSubmit,
  onStop,
  onModeSelect,
  onModelSelect,
  onProviderSelect,
  onReasoningChange,
  onEnhancePrompt,
  alwaysThinkingEnabled = false,
  onToggleThinking,
  streamingEnabled = true,
  onStreamingEnabledChange,
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  onOpenCliSettings,
}: ButtonAreaProps) => {
  const { t } = useTranslation();
  const { cliModels, cliModelsLoading, cliModelsError, cliCatalogHasEntries, refreshCliModels } = useCliModels(currentProvider);

  // Select model list based on current provider — shared with Prompt Enhancer /
  // Commit AI settings so the three surfaces never diverge. The qwen list leads
  // with the "follow CLI config" entry and the models configured in
  // ~/.qwen/settings.json (get_qwen_model_options).
  const qwenModelOptions = useQwenModelOptions();
  const availableModels = useMemo(() => {
    return resolveProviderModels({
      provider: currentProvider,
      cliModels,
      cliCatalogHasEntries,
      qwenModelOptions,
      t,
    });
  }, [currentProvider, cliModels, cliCatalogHasEntries, qwenModelOptions, t]);

  /**
   * Handle submit button click
   */
  const handleSubmitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSubmit?.();
  }, [onSubmit]);

  /**
   * Handle stop button click
   */
  const handleStopClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStop?.();
  }, [onStop]);

  /**
   * Handle mode selection
   */
  const handleModeSelect = useCallback((mode: PermissionMode) => {
    onModeSelect?.(mode);
  }, [onModeSelect]);

  /**
   * Handle model selection
   */
  const handleModelSelect = useCallback((modelId: string) => {
    onModelSelect?.(modelId);
  }, [onModelSelect]);

  /**
   * Handle provider selection
   */
  const handleProviderSelect = useCallback((providerId: string) => {
    onProviderSelect?.(providerId);
  }, [onProviderSelect]);

  /**
   * Handle reasoning depth selection
   */
  const handleReasoningChange = useCallback((effort: ReasoningEffort) => {
    onReasoningChange?.(effort);
  }, [onReasoningChange]);

  /**
   * Handle enhance prompt button click
   */
  const handleEnhanceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEnhancePrompt?.();
  }, [onEnhancePrompt]);

  // Collapse selector labels for every provider when left cluster is about to hit the send cluster (10px).
  const buttonAreaRef = useRef<HTMLDivElement>(null);
  const buttonAreaLeftRef = useRef<HTMLDivElement>(null);
  const buttonAreaRightRef = useRef<HTMLDivElement>(null);
  const selectorContentKey = [
    currentProvider,
    selectedModel,
    permissionMode,
    reasoningEffort,
    selectedAgent?.id ?? '',
    cliModelsLoading ? 'loading' : 'ready',
  ].join('|');
  const selectorsCompact = useToolbarSelectorCompact(
    buttonAreaRef,
    buttonAreaLeftRef,
    buttonAreaRightRef,
    selectorContentKey,
  );

  return (
    <div
      ref={buttonAreaRef}
      className={`button-area${selectorsCompact ? ' button-area--compact' : ''}`}
      data-provider={currentProvider}
    >
      {/* Left side: selectors */}
      <div ref={buttonAreaLeftRef} className="button-area-left">
        <ConfigSelect
          alwaysThinkingEnabled={alwaysThinkingEnabled}
          onToggleThinking={onToggleThinking}
          streamingEnabled={streamingEnabled}
          onStreamingEnabledChange={onStreamingEnabledChange}
          selectedAgent={selectedAgent}
          onAgentSelect={onAgentSelect}
          onOpenAgentSettings={onOpenAgentSettings}
        />
        <ProviderSelect
          value={currentProvider}
          onChange={handleProviderSelect}
          onOpenCliSettings={onOpenCliSettings}
          compact
        />
        <ModeSelect
          value={permissionMode}
          onChange={handleModeSelect}
          provider={currentProvider}
        />
        <ModelConfigSelect
          selectedModel={selectedModel}
          onModelSelect={handleModelSelect}
          models={availableModels}
          currentProvider={currentProvider}
          loading={cliModelsLoading}
          error={cliModelsError}
          onRetry={() => refreshCliModels(currentProvider)}
          reasoningEffort={reasoningEffort}
          onReasoningChange={handleReasoningChange}
        />
      </div>

      {/* Right side: tool buttons */}
      <div ref={buttonAreaRightRef} className="button-area-right">
        <div className="button-divider" />

        {/* Enhance prompt button */}
        <button
          className="enhance-prompt-button has-tooltip"
          onClick={handleEnhanceClick}
          disabled={disabled || !hasInputContent || isLoading || isEnhancing}
          data-tooltip={`${t('promptEnhancer.tooltip')} (${t('promptEnhancer.shortcut')})`}
          aria-label={t('promptEnhancer.tooltip')}
        >
          <span className={`codicon ${isEnhancing ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} />
        </button>

        {/* Send/Stop button */}
        {isLoading ? (
          <button
            className="submit-button stop-button"
            onClick={handleStopClick}
            title={t('chat.stopGeneration')}
          >
            <span className="codicon codicon-debug-stop" />
          </button>
        ) : (
          <button
            className="submit-button"
            onClick={handleSubmitClick}
            disabled={disabled || !hasInputContent}
            title={t('chat.sendMessageEnter')}
          >
            <span className="codicon codicon-send" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ButtonArea;
