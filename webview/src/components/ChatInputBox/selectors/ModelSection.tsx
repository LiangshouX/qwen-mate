import { useTranslation } from 'react-i18next';
import type { ModelInfo } from '../types';
import { PINNED_GROUP_ID } from '../modelSelectUtils';
import type { ModelGroup } from '../modelSelectUtils';
import { ModelOptionRow } from './ModelOptionRow';

interface ModelSectionProps {
  section: ModelGroup;
  pinnedIds: ReadonlySet<string>;
  currentProvider: string;
  isSelectedModel: (modelId: string) => boolean;
  getModelLabel: (model: ModelInfo) => string;
  getModelDescription: (model: ModelInfo) => string | undefined;
  onSelect: (modelId: string) => void;
  onTogglePin: (e: React.MouseEvent, modelId: string) => void;
}

/**
 * ModelSection - One grouped section of the model dropdown: an optional group
 * header (always shown for the pinned group) followed by its model rows.
 */
export const ModelSection = ({
  section,
  pinnedIds,
  currentProvider,
  isSelectedModel,
  getModelLabel,
  getModelDescription,
  onSelect,
  onTogglePin,
}: ModelSectionProps) => {
  const { t } = useTranslation();

  const renderSectionLabel = (sectionId: string, sectionLabel: string, labelKey?: string): string => {
    if (sectionId === PINNED_GROUP_ID) {
      return t('models.pinned', { defaultValue: 'Pinned' });
    }
    if (labelKey) {
      return t(labelKey, { defaultValue: sectionLabel });
    }
    return sectionLabel;
  };

  return (
    <div className="model-selector-section" data-testid={`model-section-${section.id}`}>
      {section.label !== '' || section.id === PINNED_GROUP_ID ? (
        <div className="model-selector-group-header" data-testid={`model-group-${section.id}`}>
          {section.id === PINNED_GROUP_ID && (
            <span className="codicon codicon-pinned model-selector-group-icon" />
          )}
          <span>{renderSectionLabel(section.id, section.label, section.labelKey)}</span>
        </div>
      ) : null}
      {section.models.map((model) => (
        <ModelOptionRow
          key={model.id}
          model={model}
          currentProvider={currentProvider}
          isSelected={isSelectedModel(model.id)}
          isPinned={pinnedIds.has(model.id)}
          label={getModelLabel(model)}
          description={getModelDescription(model)}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
};

export default ModelSection;
