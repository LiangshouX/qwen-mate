import type { UseWindowCallbacksOptions } from '../../useWindowCallbacks';
import { sendBridgeEvent } from '../../../utils/bridge';

type PermissionCallbacks = Pick<UseWindowCallbacksOptions,
  | 'openPermissionDialog' | 'openAskUserQuestionDialog' | 'openPlanApprovalDialog'
  | 'forceClosePermissionDialog' | 'forceCloseAskUserQuestionDialog' | 'forceClosePlanApprovalDialog'
>;

export function registerPermissionCallbacks(options: PermissionCallbacks): void {
  const {
    openPermissionDialog,
    openAskUserQuestionDialog,
    openPlanApprovalDialog,
    forceClosePermissionDialog,
    forceCloseAskUserQuestionDialog,
    forceClosePlanApprovalDialog,
  } = options;

  window.showPermissionDialog = (json) => {
    try {
      openPermissionDialog(JSON.parse(json));
    } catch (error) {
      console.error('[Frontend] Failed to parse permission request:', error);
    }
  };
  window.showAskUserQuestionDialog = (json) => {
    try {
      openAskUserQuestionDialog(JSON.parse(json));
    } catch (error) {
      console.error('[Frontend] Failed to parse ask user question request:', error);
    }
  };
  window.showPlanApprovalDialog = (json) => {
    try {
      openPlanApprovalDialog(JSON.parse(json));
    } catch (error) {
      console.error('[Frontend] Failed to parse plan approval request:', error);
    }
  };

  const acknowledgeClose = (functionName: string, targetId: string | null, dialogToken?: string) => {
    if (!dialogToken) return;
    // Placeholders only buffer signals; acknowledging before consumption would lose closes on reload.
    sendBridgeEvent('dialog_delivery_ack', JSON.stringify({ functionName, targetId, dialogToken }));
  };
  window.forceClosePermissionDialog = (targetId, dialogToken) => {
    forceClosePermissionDialog(targetId ?? null, dialogToken);
    acknowledgeClose('forceClosePermissionDialog', targetId ?? null, dialogToken);
  };
  window.forceCloseAskUserQuestionDialog = (targetId, dialogToken) => {
    forceCloseAskUserQuestionDialog(targetId ?? null, dialogToken);
    acknowledgeClose('forceCloseAskUserQuestionDialog', targetId ?? null, dialogToken);
  };
  window.forceClosePlanApprovalDialog = (targetId, dialogToken) => {
    forceClosePlanApprovalDialog(targetId ?? null, dialogToken);
    acknowledgeClose('forceClosePlanApprovalDialog', targetId ?? null, dialogToken);
  };

  const callbacks = {
    permission: { show: window.showPermissionDialog, close: window.forceClosePermissionDialog },
    askUserQuestion: { show: window.showAskUserQuestionDialog, close: window.forceCloseAskUserQuestionDialog },
    planApproval: { show: window.showPlanApprovalDialog, close: window.forceClosePlanApprovalDialog },
  };
  const pending = window.__pendingDialogEvents ?? [];
  window.__pendingDialogEvents = [];
  for (const event of pending) {
    if (event.type === 'show') {
      callbacks[event.kind].show(event.payload);
    } else {
      callbacks[event.kind].close(event.targetId, event.dialogToken);
    }
  }
}
