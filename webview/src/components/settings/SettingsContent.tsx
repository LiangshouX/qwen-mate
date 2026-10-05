import type { ComponentType } from 'react';
import type { ToastMessage } from '../Toast';
import type { SettingsTab } from './SettingsSidebar';
import type { ProviderManageTab } from './ProviderTabSection';
import {
  BasicPanel,
  ProvidersPanel,
  DependenciesPanel,
  McpPanel,
  PromptEnhancerPanel,
  CommitPanel,
  SkillsPanel,
  OtherPanel,
  type SettingsTabPanelProps,
} from './SettingsTabPanels';
import type {
  UseSettingsThemeSyncReturn,
  UseSettingsBasicActionsReturn,
  UseAgentManagementReturn,
} from './hooks';
import styles from './style.module.less';

// The usage/permissions/agents/prompts pages are hidden (menu entries removed
// with them) and await a redo; their panels stay exported from SettingsTabPanels
// as reference implementations.
const TAB_PANELS: Partial<Record<SettingsTab, ComponentType<SettingsTabPanelProps>>> = {
  basic: BasicPanel,
  providers: ProvidersPanel,
  dependencies: DependenciesPanel,
  mcp: McpPanel,
  promptEnhancer: PromptEnhancerPanel,
  commit: CommitPanel,
  skills: SkillsPanel,
  other: OtherPanel,
};

interface SettingsContentProps {
  currentTab: SettingsTab;
  currentProvider: string;
  initialProviderSubTab?: ProviderManageTab;
  addToast: (message: string, type?: ToastMessage['type']) => void;
  themeSync: UseSettingsThemeSyncReturn;
  basicActions: UseSettingsBasicActionsReturn;
  agentManagement: UseAgentManagementReturn;
}

// Content area — mount only the active tab.
// Previously every tab stayed mounted under display:none, which made
// Settings open cost ~all sections (MCP/Skills/TokenTracker/…) at once.
const SettingsContent = ({
  currentTab,
  currentProvider,
  initialProviderSubTab,
  addToast,
  themeSync,
  basicActions,
  agentManagement,
}: SettingsContentProps) => {
  const ActivePanel = TAB_PANELS[currentTab];
  return (
    <div className={`${styles.settingsContent} ${currentTab === 'providers' ? styles.providerSettingsContent : ''}`}>
      {ActivePanel && (
        <ActivePanel
          currentProvider={currentProvider}
          initialProviderSubTab={initialProviderSubTab}
          addToast={addToast}
          themeSync={themeSync}
          basicActions={basicActions}
          agentManagement={agentManagement}
        />
      )}
    </div>
  );
};

export default SettingsContent;
