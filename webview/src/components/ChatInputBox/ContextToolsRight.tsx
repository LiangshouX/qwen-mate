import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ContextToolsRightProps {
  statusPanelExpanded: boolean;
  onToggleStatusPanel?: () => void;
}

/** Right side tools: StatusPanel expand/collapse toggle. */
export const ContextToolsRight: React.FC<ContextToolsRightProps> = memo(({
  statusPanelExpanded,
  onToggleStatusPanel,
}) => {
  const { t } = useTranslation();

  return (
    <div className="context-tools-right">
      {/* StatusPanel expand/collapse toggle - always visible */}
      {onToggleStatusPanel && (
        <button
          className={`context-tool-btn status-panel-toggle has-tooltip ${statusPanelExpanded ? 'expanded' : 'collapsed'}`}
          onClick={onToggleStatusPanel}
          data-tooltip={statusPanelExpanded ? t('statusPanel.collapse') : t('statusPanel.expand')}
          aria-label={statusPanelExpanded ? t('statusPanel.collapse') : t('statusPanel.expand')}
        >
          <span className={`codicon ${statusPanelExpanded ? 'codicon-chevron-down' : 'codicon-layers'}`} />
        </button>
      )}
    </div>
  );
});
