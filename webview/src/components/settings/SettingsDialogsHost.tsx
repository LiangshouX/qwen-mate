import SettingsDialogs from './SettingsDialogs';
import type {
  UseSettingsPageStateReturn,
  UseAgentManagementReturn,
} from './hooks';

interface SettingsDialogsHostProps {
  pageState: UseSettingsPageStateReturn;
  agentManagement: UseAgentManagementReturn;
  onSaveAgent: (data: { name: string; prompt: string }) => void;
}

// All dialogs (alert, agent)
const SettingsDialogsHost = ({
  pageState,
  agentManagement,
  onSaveAgent,
}: SettingsDialogsHostProps) => (
  <SettingsDialogs
    alertDialog={pageState.alertDialog}
    onCloseAlert={pageState.closeAlert}
    agentDialog={agentManagement.agentDialog}
    deleteAgentConfirm={agentManagement.deleteAgentConfirm}
    onCloseAgentDialog={agentManagement.handleCloseAgentDialog}
    onSaveAgent={onSaveAgent}
    onConfirmDeleteAgent={agentManagement.confirmDeleteAgent}
    onCancelDeleteAgent={agentManagement.cancelDeleteAgent}
    agentExportDialog={agentManagement.exportDialog}
    agentImportPreviewDialog={agentManagement.importPreviewDialog}
    agents={agentManagement.agents}
    onCloseAgentExportDialog={agentManagement.handleCloseExportDialog}
    onConfirmAgentExport={agentManagement.handleConfirmExport}
    onCloseAgentImportPreview={agentManagement.handleCloseImportPreview}
    onSaveImportedAgents={agentManagement.handleSaveImportedAgents}
    addToast={pageState.addToast}
  />
);

export default SettingsDialogsHost;
