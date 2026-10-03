import type { ModelInfo } from '../types';
import type { ModelGroup } from '../modelSelectUtils';
import { ModelSearchRow } from './ModelSearchRow';
import { ModelStatusRows } from './ModelStatusRows';
import { ModelSection } from './ModelSection';
import { ModelListHints } from './ModelListHints';

const DROPDOWN_LIST_STYLE: React.CSSProperties = { overflowY: 'auto', flex: 1, minHeight: 0 };

interface ModelDropdownContentProps {
  /** Render the list flat inside a parent popover: no positioning, no close-on-select. */
  inline: boolean;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownStyle: React.CSSProperties;
  showSearch: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  sections: ModelGroup[];
  pinnedIds: ReadonlySet<string>;
  currentProvider: string;
  isSelectedModel: (modelId: string) => boolean;
  getModelLabel: (model: ModelInfo) => string;
  getModelDescription: (model: ModelInfo) => string | undefined;
  onSelect: (modelId: string) => void;
  onTogglePin: (e: React.MouseEvent, modelId: string) => void;
  visibleModelCount: number;
  hiddenModelCount: number;
}

/**
 * ModelDropdownContent - The model dropdown panel: search row, status rows,
 * grouped/pinned model sections, and the hidden-count hint.
 */
export const ModelDropdownContent = ({
  inline,
  dropdownRef,
  dropdownStyle,
  showSearch,
  searchQuery,
  onSearchQueryChange,
  loading,
  error,
  onRetry,
  sections,
  pinnedIds,
  currentProvider,
  isSelectedModel,
  getModelLabel,
  getModelDescription,
  onSelect,
  onTogglePin,
  visibleModelCount,
  hiddenModelCount,
}: ModelDropdownContentProps) => {
  return (
    <div
      ref={dropdownRef}
      className={inline ? 'model-selector-inline' : 'selector-dropdown model-selector-dropdown'}
      data-testid="model-selector-dropdown"
      style={inline ? undefined : dropdownStyle}
      onMouseEnter={(e) => e.stopPropagation()}
    >
      {showSearch && (
        <ModelSearchRow
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
        />
      )}
      <div className={inline ? 'model-selector-list model-selector-list--inline' : 'model-selector-list'} style={DROPDOWN_LIST_STYLE}>
        <ModelStatusRows loading={loading} error={error} onRetry={onRetry} />
        {sections.map((section) => (
          <ModelSection
            key={section.id}
            section={section}
            pinnedIds={pinnedIds}
            currentProvider={currentProvider}
            isSelectedModel={isSelectedModel}
            getModelLabel={getModelLabel}
            getModelDescription={getModelDescription}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
          />
        ))}
        <ModelListHints
          loading={loading}
          visibleModelCount={visibleModelCount}
          hiddenModelCount={hiddenModelCount}
        />
      </div>
    </div>
  );
};

export default ModelDropdownContent;
