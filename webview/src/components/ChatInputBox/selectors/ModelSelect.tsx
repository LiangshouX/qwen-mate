import { useRef } from 'react';
import { AVAILABLE_MODELS } from '../types';
import type { ModelInfo } from '../types';
import { ProviderModelIcon } from '../../shared/ProviderModelIcon';
import { resolveModelIdForIcon } from '../modelLabelUtils';
import { ModelDropdownContent } from './ModelDropdownContent';
import { useModelSelectState } from './useModelSelectState';
import {
  useModelDropdownLayout,
  useModelSelectHandlers,
  useModelSelectOutsideClick,
} from './useModelSelectDropdown';

const RELATIVE_INLINE_BLOCK_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-block' };
const CHEVRON_ICON_STYLE: React.CSSProperties = { fontSize: '10px', marginLeft: '2px' };

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  models?: ModelInfo[];
  currentProvider?: string;
  /** True while dynamic provider catalogs are still loading. */
  loading?: boolean;
  /** Set when the model catalog fetch failed (or timed out); row offers retry. */
  error?: string | null;
  /** Retries the model catalog fetch for the current provider. */
  onRetry?: () => void;
  onAddModel?: () => void;
  /** Render only the dropdown, positioned as a fly-out from triggerRef. */
  embedded?: boolean;
  /** Render the list flat inside a parent popover: no positioning, no close-on-select. */
  inline?: boolean;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose?: () => void;
}

/**
 * ModelSelect - Qwen-style model selector with search, pinning, and a
 * custom-model shortcut (opens the shared CustomModelDialog flow).
 */
export const ModelSelect = ({
  value,
  onChange,
  models = AVAILABLE_MODELS,
  currentProvider = 'qwen',
  loading = false,
  error = null,
  onRetry,
  onAddModel,
  embedded = false,
  inline = false,
  triggerRef,
  onClose,
}: ModelSelectProps) => {
  const {
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
  } = useModelSelectState({ value, models, currentProvider });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { dropdownStyle, recalculate } = useModelDropdownLayout({
    embedded,
    inline,
    isOpen,
    loading,
    triggerRef,
    buttonRef,
    dropdownRef,
    filteredModelCount: filteredModels.length,
    pinnedCount: pinnedIds.length,
  });
  const {
    handleToggle,
    handleSelect,
    handleTogglePin,
    handleAddModel,
    resetSearchAndClose,
  } = useModelSelectHandlers({
    isOpen,
    inline,
    currentProvider,
    recalculate,
    onChange,
    onClose,
    onAddModel,
    setIsOpen,
    setSearchQuery,
    setPinnedIds,
  });
  useModelSelectOutsideClick({ embedded, isOpen, buttonRef, dropdownRef, resetSearchAndClose });

  const renderDropdown = () => (
    <ModelDropdownContent
      inline={inline}
      dropdownRef={dropdownRef}
      dropdownStyle={dropdownStyle}
      showSearch={showSearch}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      loading={loading}
      error={error}
      onRetry={onRetry}
      sections={sections}
      pinnedIds={pinnedSet}
      currentProvider={currentProvider}
      isSelectedModel={isSelectedModel}
      getModelLabel={getModelLabel}
      getModelDescription={getModelDescription}
      onSelect={handleSelect}
      onTogglePin={handleTogglePin}
      visibleModelCount={visibleModelCount}
      hiddenModelCount={hiddenModelCount}
      onAddModelClick={onAddModel ? handleAddModel : undefined}
    />
  );

  if (embedded || inline) {
    return renderDropdown();
  }

  return (
    <div style={RELATIVE_INLINE_BLOCK_STYLE}>
      <button
        ref={buttonRef}
        className="selector-button"
        onClick={handleToggle}
        title={t('chat.currentModel', { model: getModelLabel(currentModel) })}
      >
        <ProviderModelIcon
          providerId={currentProvider}
          modelId={resolveModelIdForIcon(currentModel.id)}
          size={12}
          colored
        />
        <span className="selector-button-text">{getModelLabel(currentModel)}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={CHEVRON_ICON_STYLE} />
      </button>

      {isOpen && renderDropdown()}
    </div>
  );
};

export default ModelSelect;
