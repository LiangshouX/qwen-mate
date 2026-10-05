import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ToastContainer } from '../Toast';

// Import split-out components
import SettingsHeader from './SettingsHeader';
import SettingsSidebar, { type SettingsTab } from './SettingsSidebar';
import type { ProviderManageTab } from './ProviderTabSection';
import SettingsContent from './SettingsContent';
import SettingsDialogsHost from './SettingsDialogsHost';

// Import custom hooks
import {
  useAgentManagement,
  useSettingsWindowCallbacks,
  useSettingsPageState,
  useSettingsThemeSync,
  useSettingsBasicActions,
} from './hooks';
import { useLazyTabData } from './hooks/useLazyTabData';

import styles from './style.module.less';

interface SettingsViewProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  /** Deep link into the Providers tab's sub-tab (qwen/cli) */
  initialProviderSubTab?: ProviderManageTab;
  currentProvider: string;
  // Streaming configuration (passed from App.tsx for state sync)
  streamingEnabled?: boolean;
  onStreamingEnabledChange?: (enabled: boolean) => void;
  // Send shortcut configuration (passed from App.tsx for state sync)
  sendShortcut?: 'enter' | 'cmdEnter';
  onSendShortcutChange?: (shortcut: 'enter' | 'cmdEnter') => void;
  // Auto open file configuration (passed from App.tsx for state sync)
  autoOpenFileEnabled?: boolean;
  onAutoOpenFileEnabledChange?: (enabled: boolean) => void;
  // Permission dialog timeout configuration (passed from App.tsx for state sync)
  permissionDialogTimeoutSeconds?: number;
  onPermissionDialogTimeoutChange?: (seconds: number) => void;
}

const SettingsView = ({
  onClose,
  initialTab,
  initialProviderSubTab,
  currentProvider,
  streamingEnabled: streamingEnabledProp,
  onStreamingEnabledChange: onStreamingEnabledChangeProp,
  sendShortcut: sendShortcutProp,
  onSendShortcutChange: onSendShortcutChangeProp,
  autoOpenFileEnabled: autoOpenFileEnabledProp,
  onAutoOpenFileEnabledChange: onAutoOpenFileEnabledChangeProp,
  permissionDialogTimeoutSeconds: permissionDialogTimeoutSecondsProp,
  onPermissionDialogTimeoutChange: onPermissionDialogTimeoutChangeProp,
}: SettingsViewProps) => {
  const { t } = useTranslation();
  const disabledTabs = useMemo<SettingsTab[]>(() => [], []);

  // Page state: tabs, toasts, sidebar collapse, alert dialog
  const pageState = useSettingsPageState({ initialTab, isCodexMode: false, disabledTabs });

  // Theme sync: theme preference, IDE theme, font size, chat colors
  const themeSync = useSettingsThemeSync();

  // Basic settings actions: node path, working dir, streaming, shortcuts, sound, commit prompt, etc.
  const basicActions = useSettingsBasicActions({
    streamingEnabledProp,
    onStreamingEnabledChangeProp,
    sendShortcutProp,
    onSendShortcutChangeProp,
    autoOpenFileEnabledProp,
    onAutoOpenFileEnabledChangeProp,
    permissionDialogTimeoutSecondsProp,
    onPermissionDialogTimeoutChangeProp,
    currentProvider,
  });

  // Use agent management hook
  const agentManagement = useAgentManagement({
    onSuccess: (msg: string) => pageState.addToast(msg, 'success'),
  });

  // Note: Prompt management is now handled internally by PromptSection component

  useLazyTabData(pageState.currentTab, {
    loadAgents: agentManagement.loadAgents,
  });

  // Register window callbacks for Java bridge communication
  useSettingsWindowCallbacks({
    ...themeSync,
    ...basicActions,
    ...pageState,
    ...agentManagement,
    onStreamingEnabledChangeProp,
    onSendShortcutChangeProp,
  });

  // Save agent (wrapper function with validation logic)
  const handleSaveAgentFromDialog = (data: { name: string; prompt: string }) => {
    agentManagement.handleSaveAgent(data);
  };

  return (
    <div className={styles.settingsPage}>
      {/* Top header bar */}
      <SettingsHeader onClose={onClose} />

      {/* Main content */}
      <div className={styles.settingsMain}>
        {/* Sidebar */}
        <SettingsSidebar
          currentTab={pageState.currentTab}
          onTabChange={pageState.handleTabChange}
          isCollapsed={pageState.isCollapsed}
          onToggleCollapse={pageState.toggleManualCollapse}
          disabledTabs={disabledTabs}
          onDisabledTabClick={() => pageState.addToast(t('settings.codexFeatureUnavailable'), 'warning')}
        />

        <SettingsContent
          currentTab={pageState.currentTab}
          currentProvider={currentProvider}
          initialProviderSubTab={initialProviderSubTab}
          addToast={pageState.addToast}
          themeSync={themeSync}
          basicActions={basicActions}
          agentManagement={agentManagement}
        />
      </div>

      <SettingsDialogsHost
        pageState={pageState}
        agentManagement={agentManagement}
        onSaveAgent={handleSaveAgentFromDialog}
      />

      {/* Toast notifications */}
      <ToastContainer messages={pageState.toasts} onDismiss={pageState.dismissToast} />
    </div>
  );
};

export default SettingsView;
