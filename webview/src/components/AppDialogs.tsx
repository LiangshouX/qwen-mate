import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import PermissionDialog from './PermissionDialog';
import AskUserQuestionDialog from './AskUserQuestionDialog';
import PlanApprovalDialog from './PlanApprovalDialog';
import CustomModelDialog from './settings/CustomModelDialog';
import { usePluginModels } from './settings/hooks/usePluginModels';
import { STORAGE_KEYS } from '../types/provider';
import { useDialogs } from '../contexts/DialogContext';
import { useUIState } from '../contexts/UIStateContext';
import ContextUsageDialog from './ContextUsageDialog';
import { DEFAULT_PERMISSION_DIALOG_TIMEOUT_SECONDS } from '../utils/permissionDialogTimeout';
import { setSkipNewSessionConfirm } from '../utils/skipNewSessionConfirm';

/**
 * Wrapper that manages plugin-level custom Qwen models for the add-model dialog.
 * Uses the shared usePluginModels hook for localStorage persistence.
 */
const AddModelDialogWrapper = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { models, updateModels } = usePluginModels(STORAGE_KEYS.QWEN_CUSTOM_MODELS);
  return (
    <CustomModelDialog
      isOpen={isOpen}
      models={models}
      onModelsChange={updateModels}
      onClose={onClose}
      contextWindowEnabled
      initialAddMode
    />
  );
};

export interface AppDialogsProps {
  /** Session-management dialogs come from useSessionManagement, still passed as props. */
  showNewSessionConfirm: boolean;
  onConfirmNewSession: () => void;
  onCancelNewSession: () => void;
  showInterruptConfirm: boolean;
  onConfirmInterrupt: () => void;
  onCancelInterrupt: () => void;
  /** Permission dialog timeout in seconds (from backend config). */
  permissionDialogTimeoutSeconds?: number;
  /** Apply the execution mode chosen while approving a plan. */
  onPlanApprovalModeChange?: (mode: string) => void;
}

/**
 * Renders all top-level dialogs.
 * Permission / ask-user / plan / add-model state is read from
 * DialogContext and UIStateContext directly to avoid prop drilling 25+ fields
 * from App.tsx (stage 4-5 of TASK-P1-01).
 */
export const AppDialogs = ({
  showNewSessionConfirm,
  onConfirmNewSession,
  onCancelNewSession,
  showInterruptConfirm,
  onConfirmInterrupt,
  onCancelInterrupt,
  permissionDialogTimeoutSeconds = DEFAULT_PERMISSION_DIALOG_TIMEOUT_SECONDS,
  onPlanApprovalModeChange,
}: AppDialogsProps) => {
  const { t } = useTranslation();
  const {
    permissionDialogOpen, currentPermissionRequest,
    handlePermissionApprove, handlePermissionApproveAlways, handlePermissionSkip,
    askUserQuestionDialogOpen, currentAskUserQuestionRequest,
    handleAskUserQuestionSubmit, handleAskUserQuestionCancel,
    planApprovalDialogOpen, currentPlanApprovalRequest,
    handlePlanApprovalApprove, handlePlanApprovalReject,
    contextUsageDialogOpen, contextUsageIsLoading, contextUsageData, closeContextUsageDialog,
  } = useDialogs();
  const {
    addModelDialogOpen, setAddModelDialogOpen,
  } = useUIState();

  // "Don't ask again" checkbox state for the new-session confirm dialog.
  // Resets to unchecked every time the dialog re-opens so the user re-affirms
  // intent each time they want to silence it.
  const [skipNewSessionAgain, setSkipNewSessionAgain] = useState(false);
  // Reset via render-time adjustment whenever the dialog (re-)opens.
  const [prevShowNewSessionConfirm, setPrevShowNewSessionConfirm] = useState(showNewSessionConfirm);
  if (prevShowNewSessionConfirm !== showNewSessionConfirm) {
    setPrevShowNewSessionConfirm(showNewSessionConfirm);
    if (showNewSessionConfirm) {
      setSkipNewSessionAgain(false);
    }
  }

  const handleConfirmNewSessionWithSkip = () => {
    if (skipNewSessionAgain) {
      // Persist before navigating away — listeners (settings page) sync automatically.
      setSkipNewSessionConfirm(true);
    }
    onConfirmNewSession();
  };
  // Note: We deliberately do NOT persist the "don't ask again" checkbox when the
  // user cancels the dialog. A cancelled dialog means they did not intend the
  // destructive action AND did not intend to change the preference. The state is
  // discarded via the render-time adjustment above on next open.

  return (
    <>
      <ConfirmDialog
        isOpen={showNewSessionConfirm}
        title={t('chat.createNewSession')}
        message={t('chat.confirmNewSession')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={handleConfirmNewSessionWithSkip}
        onCancel={onCancelNewSession}
      >
        <label className="confirm-dialog-dont-ask-again">
          <input
            type="checkbox"
            checked={skipNewSessionAgain}
            onChange={(e) => setSkipNewSessionAgain(e.target.checked)}
          />
          <span>{t('common.dontAskAgain')}</span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={showInterruptConfirm}
        title={t('chat.createNewSession')}
        message={t('chat.confirmInterrupt')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={onConfirmInterrupt}
        onCancel={onCancelInterrupt}
      />
      <PermissionDialog
        isOpen={permissionDialogOpen}
        request={currentPermissionRequest}
        onApprove={handlePermissionApprove}
        onSkip={handlePermissionSkip}
        onApproveAlways={handlePermissionApproveAlways}
        timeoutSeconds={permissionDialogTimeoutSeconds}
      />
      <AskUserQuestionDialog
        isOpen={askUserQuestionDialogOpen}
        request={currentAskUserQuestionRequest}
        onSubmit={handleAskUserQuestionSubmit}
        onCancel={handleAskUserQuestionCancel}
        timeoutSeconds={permissionDialogTimeoutSeconds}
      />
      <PlanApprovalDialog
        isOpen={planApprovalDialogOpen}
        request={currentPlanApprovalRequest}
        onApprove={(requestId, targetMode) => {
          handlePlanApprovalApprove(requestId, targetMode);
          onPlanApprovalModeChange?.(targetMode);
        }}
        onReject={handlePlanApprovalReject}
        timeoutSeconds={permissionDialogTimeoutSeconds}
      />
      <AddModelDialogWrapper
        isOpen={addModelDialogOpen}
        onClose={() => setAddModelDialogOpen(false)}
      />
      {contextUsageDialogOpen ? (
        <ContextUsageDialog
          isOpen={contextUsageDialogOpen}
          isLoading={contextUsageIsLoading}
          data={contextUsageData}
          onClose={closeContextUsageDialog}
        />
      ) : null}
    </>
  );
};
