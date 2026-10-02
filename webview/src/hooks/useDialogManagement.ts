import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { PermissionRequest } from '../components/PermissionDialog';
import type { AskUserQuestionRequest } from '../components/AskUserQuestionDialog';
import type { PlanApprovalRequest } from '../components/PlanApprovalDialog';
import type { ContextUsageData } from '../components/ContextUsageDialog';
import { sendBridgeEvent } from '../utils/bridge';
import { clearDialogDraft, type DialogDraftKind } from '../utils/dialogStateStorage';

const CLOSED_DIALOG_TOKEN_LIMIT = 256;

function rememberClosedDialog(tokens: Set<string>, token?: string): void {
  if (!token) return;
  tokens.add(token);
  if (tokens.size > CLOSED_DIALOG_TOKEN_LIMIT) {
    tokens.delete(tokens.values().next().value!);
  }
}

interface ForceCloseableRequest {
  dialogToken?: string;
}

// Replayed closes must target the exact request; reused IDs and deadlines cannot identify a generation.
function applyForceClose<T extends ForceCloseableRequest>(
  targetId: string | null,
  dialogToken: string | undefined,
  kind: DialogDraftKind,
  closedTokens: Set<string>,
  currentRef: { current: T | null },
  pendingRef: { current: T[] },
  getId: (item: T) => string,
  closeActive: () => void,
): void {
  rememberClosedDialog(closedTokens, dialogToken);
  if (targetId !== null && dialogToken) clearDialogDraft(kind, targetId, dialogToken);
  const matches = (item: T) => targetId === null
    || (getId(item) === targetId && (!dialogToken || item.dialogToken === dialogToken));
  const discard = (item: T) => {
    rememberClosedDialog(closedTokens, item.dialogToken);
    if (targetId === null || !dialogToken) clearDialogDraft(kind, getId(item), item.dialogToken);
  };
  pendingRef.current = pendingRef.current.filter((item) => {
    if (!matches(item)) return true;
    discard(item);
    return false;
  });
  if (currentRef.current && matches(currentRef.current)) {
    discard(currentRef.current);
    closeActive();
  }
}

interface UseDialogManagementOptions {
  t: TFunction;
}

interface UseDialogManagementReturn {
  // Permission dialog
  permissionDialogOpen: boolean;
  currentPermissionRequest: PermissionRequest | null;
  openPermissionDialog: (request: PermissionRequest) => void;
  handlePermissionApprove: (channelId: string) => void;
  handlePermissionApproveAlways: (channelId: string) => void;
  handlePermissionSkip: (channelId: string) => void;
  forceClosePermissionDialog: (channelId?: string | null, dialogToken?: string) => void;

  // AskUserQuestion dialog
  askUserQuestionDialogOpen: boolean;
  currentAskUserQuestionRequest: AskUserQuestionRequest | null;
  openAskUserQuestionDialog: (request: AskUserQuestionRequest) => void;
  handleAskUserQuestionSubmit: (requestId: string, answers: Record<string, string | string[]>) => void;
  handleAskUserQuestionCancel: (requestId: string) => void;
  forceCloseAskUserQuestionDialog: (requestId?: string | null, dialogToken?: string) => void;

  // PlanApproval dialog
  planApprovalDialogOpen: boolean;
  currentPlanApprovalRequest: PlanApprovalRequest | null;
  openPlanApprovalDialog: (request: PlanApprovalRequest) => void;
  handlePlanApprovalApprove: (requestId: string, targetMode: string) => void;
  handlePlanApprovalReject: (requestId: string) => void;
  forceClosePlanApprovalDialog: (requestId?: string | null, dialogToken?: string) => void;

  // Context usage dialog
  contextUsageDialogOpen: boolean;
  contextUsageIsLoading: boolean;
  contextUsageData: ContextUsageData | null;
  openContextUsageDialog: (requestId?: string | null, loading?: boolean) => void;
  updateContextUsageData: (requestId: string | null | undefined, data: ContextUsageData) => boolean;
  closeContextUsageDialog: (requestId?: string | null) => boolean;
}

/**
 * Hook for managing dialog states (permission, ask user question, plan approval)
 */
export function useDialogManagement({ t }: UseDialogManagementOptions): UseDialogManagementReturn {
  // Permission dialog state
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [currentPermissionRequest, setCurrentPermissionRequest] = useState<PermissionRequest | null>(null);
  const currentPermissionRequestRef = useRef<PermissionRequest | null>(null);
  const pendingPermissionRequestsRef = useRef<PermissionRequest[]>([]);
  const closedPermissionTokensRef = useRef(new Set<string>());

  // AskUserQuestion dialog state
  const [askUserQuestionDialogOpen, setAskUserQuestionDialogOpen] = useState(false);
  const [currentAskUserQuestionRequest, setCurrentAskUserQuestionRequest] = useState<AskUserQuestionRequest | null>(null);
  const currentAskUserQuestionRequestRef = useRef<AskUserQuestionRequest | null>(null);
  const pendingAskUserQuestionRequestsRef = useRef<AskUserQuestionRequest[]>([]);
  const closedAskUserQuestionTokensRef = useRef(new Set<string>());

  // PlanApproval dialog state
  const [planApprovalDialogOpen, setPlanApprovalDialogOpen] = useState(false);
  const [currentPlanApprovalRequest, setCurrentPlanApprovalRequest] = useState<PlanApprovalRequest | null>(null);
  const currentPlanApprovalRequestRef = useRef<PlanApprovalRequest | null>(null);
  const pendingPlanApprovalRequestsRef = useRef<PlanApprovalRequest[]>([]);
  const closedPlanApprovalTokensRef = useRef(new Set<string>());

  // Context usage dialog state
  const [contextUsageDialogOpen, setContextUsageDialogOpen] = useState(false);
  const [contextUsageIsLoading, setContextUsageIsLoading] = useState(false);
  const [contextUsageData, setContextUsageData] = useState<ContextUsageData | null>(null);
  const contextUsageRequestIdRef = useRef<string | null>(null);

  // Open permission dialog
  const openPermissionDialog = useCallback((request: PermissionRequest) => {
    if (request.dialogToken && closedPermissionTokensRef.current.has(request.dialogToken)) {
      return;
    }
    // If a permission dialog is currently open, enqueue the new request instead of overriding.
    // This avoids losing follow-up requests when the user denies the current one.
    if (currentPermissionRequestRef.current) {
      const currentId = currentPermissionRequestRef.current?.channelId;
      const alreadyQueued = pendingPermissionRequestsRef.current.some(
        (item) => item.channelId === request.channelId && item.dialogToken === request.dialogToken
      );
      if ((request.channelId !== currentId || request.dialogToken !== currentPermissionRequestRef.current?.dialogToken) && !alreadyQueued) {
        pendingPermissionRequestsRef.current.push(request);
      }
      return;
    }

    currentPermissionRequestRef.current = request;
    setCurrentPermissionRequest(request);
    setPermissionDialogOpen(true);
  }, []);

  // Open ask user question dialog
  const openAskUserQuestionDialog = useCallback((request: AskUserQuestionRequest) => {
    if (request.dialogToken && closedAskUserQuestionTokensRef.current.has(request.dialogToken)) {
      return;
    }
    // If an ask user question dialog is currently open, enqueue the new request instead of overriding.
    // This avoids losing follow-up requests when multiple questions arrive in quick succession.
    if (currentAskUserQuestionRequestRef.current) {
      const currentId = currentAskUserQuestionRequestRef.current?.requestId;
      const alreadyQueued = pendingAskUserQuestionRequestsRef.current.some(
        (item) => item.requestId === request.requestId && item.dialogToken === request.dialogToken
      );
      if ((request.requestId !== currentId || request.dialogToken !== currentAskUserQuestionRequestRef.current?.dialogToken) && !alreadyQueued) {
        pendingAskUserQuestionRequestsRef.current.push(request);
      }
      return;
    }

    currentAskUserQuestionRequestRef.current = request;
    setCurrentAskUserQuestionRequest(request);
    setAskUserQuestionDialogOpen(true);
  }, []);

  // Open plan approval dialog
  const openPlanApprovalDialog = useCallback((request: PlanApprovalRequest) => {
    if (request.dialogToken && closedPlanApprovalTokensRef.current.has(request.dialogToken)) {
      return;
    }
    // If a plan approval dialog is currently open, enqueue the new request instead of overriding.
    // This avoids losing follow-up requests when multiple plan approval requests arrive in quick succession.
    if (currentPlanApprovalRequestRef.current) {
      const currentId = currentPlanApprovalRequestRef.current?.requestId;
      const alreadyQueued = pendingPlanApprovalRequestsRef.current.some(
        (item) => item.requestId === request.requestId && item.dialogToken === request.dialogToken
      );
      if ((request.requestId !== currentId || request.dialogToken !== currentPlanApprovalRequestRef.current?.dialogToken) && !alreadyQueued) {
        pendingPlanApprovalRequestsRef.current.push(request);
      }
      return;
    }

    currentPlanApprovalRequestRef.current = request;
    setCurrentPlanApprovalRequest(request);
    setPlanApprovalDialogOpen(true);
  }, []);

  // Process pending permission requests queue
  useEffect(() => {
    if (permissionDialogOpen) return;
    if (currentPermissionRequest) return;
    const next = pendingPermissionRequestsRef.current.shift();
    if (next) {
      openPermissionDialog(next);
    }
  }, [permissionDialogOpen, currentPermissionRequest, openPermissionDialog]);

  // Process pending ask user question requests queue
  useEffect(() => {
    if (askUserQuestionDialogOpen) return;
    if (currentAskUserQuestionRequest) return;
    const next = pendingAskUserQuestionRequestsRef.current.shift();
    if (next) {
      openAskUserQuestionDialog(next);
    }
  }, [askUserQuestionDialogOpen, currentAskUserQuestionRequest, openAskUserQuestionDialog]);

  // Process pending plan approval requests queue
  useEffect(() => {
    if (planApprovalDialogOpen) return;
    if (currentPlanApprovalRequest) return;
    const next = pendingPlanApprovalRequestsRef.current.shift();
    if (next) {
      openPlanApprovalDialog(next);
    }
  }, [planApprovalDialogOpen, currentPlanApprovalRequest, openPlanApprovalDialog]);

  // Permission handlers
  const handlePermissionApprove = useCallback((channelId: string) => {
    const payload = JSON.stringify({
      channelId,
      dialogToken: currentPermissionRequestRef.current?.dialogToken,
      allow: true,
      remember: false,
      rejectMessage: null,
    });
    rememberClosedDialog(closedPermissionTokensRef.current, currentPermissionRequestRef.current?.dialogToken);
    sendBridgeEvent('permission_decision', payload);
    currentPermissionRequestRef.current = null;
    setPermissionDialogOpen(false);
    setCurrentPermissionRequest(null);
  }, []);

  const handlePermissionApproveAlways = useCallback((channelId: string) => {
    const payload = JSON.stringify({
      channelId,
      dialogToken: currentPermissionRequestRef.current?.dialogToken,
      allow: true,
      remember: true,
      rejectMessage: null,
    });
    rememberClosedDialog(closedPermissionTokensRef.current, currentPermissionRequestRef.current?.dialogToken);
    sendBridgeEvent('permission_decision', payload);
    currentPermissionRequestRef.current = null;
    setPermissionDialogOpen(false);
    setCurrentPermissionRequest(null);
  }, []);

  const handlePermissionSkip = useCallback((channelId: string) => {
    const payload = JSON.stringify({
      channelId,
      dialogToken: currentPermissionRequestRef.current?.dialogToken,
      allow: false,
      remember: false,
      rejectMessage: t('permission.userDenied'),
    });
    rememberClosedDialog(closedPermissionTokensRef.current, currentPermissionRequestRef.current?.dialogToken);
    sendBridgeEvent('permission_decision', payload);
    currentPermissionRequestRef.current = null;
    setPermissionDialogOpen(false);
    setCurrentPermissionRequest(null);
  }, [t]);

  // AskUserQuestion handlers
  const handleAskUserQuestionSubmit = useCallback((requestId: string, answers: Record<string, string | string[]>) => {
    const payload = JSON.stringify({
      requestId,
      dialogToken: currentAskUserQuestionRequestRef.current?.dialogToken,
      answers,
    });
    rememberClosedDialog(closedAskUserQuestionTokensRef.current, currentAskUserQuestionRequestRef.current?.dialogToken);
    sendBridgeEvent('ask_user_question_response', payload);
    currentAskUserQuestionRequestRef.current = null;
    setAskUserQuestionDialogOpen(false);
    setCurrentAskUserQuestionRequest(null);
  }, []);

  const handleAskUserQuestionCancel = useCallback((requestId: string) => {
    const payload = JSON.stringify({
      requestId,
      dialogToken: currentAskUserQuestionRequestRef.current?.dialogToken,
      answers: {},
    });
    rememberClosedDialog(closedAskUserQuestionTokensRef.current, currentAskUserQuestionRequestRef.current?.dialogToken);
    sendBridgeEvent('ask_user_question_response', payload);
    currentAskUserQuestionRequestRef.current = null;
    setAskUserQuestionDialogOpen(false);
    setCurrentAskUserQuestionRequest(null);
  }, []);

  // PlanApproval handlers
  const handlePlanApprovalApprove = useCallback((requestId: string, targetMode: string) => {
    const payload = JSON.stringify({
      requestId,
      dialogToken: currentPlanApprovalRequestRef.current?.dialogToken,
      approved: true,
      targetMode,
    });
    rememberClosedDialog(closedPlanApprovalTokensRef.current, currentPlanApprovalRequestRef.current?.dialogToken);
    sendBridgeEvent('plan_approval_response', payload);
    currentPlanApprovalRequestRef.current = null;
    setPlanApprovalDialogOpen(false);
    setCurrentPlanApprovalRequest(null);
  }, []);

  const handlePlanApprovalReject = useCallback((requestId: string) => {
    const payload = JSON.stringify({
      requestId,
      dialogToken: currentPlanApprovalRequestRef.current?.dialogToken,
      approved: false,
      targetMode: 'default',
    });
    rememberClosedDialog(closedPlanApprovalTokensRef.current, currentPlanApprovalRequestRef.current?.dialogToken);
    sendBridgeEvent('plan_approval_response', payload);
    currentPlanApprovalRequestRef.current = null;
    setPlanApprovalDialogOpen(false);
    setCurrentPlanApprovalRequest(null);
  }, []);

  // The backend already resolved this request; closing its dialog must not send another rejection.
  const forceCloseAskUserQuestionDialog = useCallback((requestId?: string | null, dialogToken?: string) => {
    applyForceClose(
      requestId && requestId.length > 0 ? requestId : null,
      dialogToken,
      'askUserQuestion',
      closedAskUserQuestionTokensRef.current,
      currentAskUserQuestionRequestRef,
      pendingAskUserQuestionRequestsRef,
      (item) => item.requestId,
      () => {
        currentAskUserQuestionRequestRef.current = null;
        setAskUserQuestionDialogOpen(false);
        setCurrentAskUserQuestionRequest(null);
      },
    );
  }, []);

  const forceClosePermissionDialog = useCallback((channelId?: string | null, dialogToken?: string) => {
    applyForceClose(
      channelId && channelId.length > 0 ? channelId : null,
      dialogToken,
      'permission',
      closedPermissionTokensRef.current,
      currentPermissionRequestRef,
      pendingPermissionRequestsRef,
      (item) => item.channelId,
      () => {
        currentPermissionRequestRef.current = null;
        setPermissionDialogOpen(false);
        setCurrentPermissionRequest(null);
      },
    );
  }, []);

  const forceClosePlanApprovalDialog = useCallback((requestId?: string | null, dialogToken?: string) => {
    applyForceClose(
      requestId && requestId.length > 0 ? requestId : null,
      dialogToken,
      'planApproval',
      closedPlanApprovalTokensRef.current,
      currentPlanApprovalRequestRef,
      pendingPlanApprovalRequestsRef,
      (item) => item.requestId,
      () => {
        currentPlanApprovalRequestRef.current = null;
        setPlanApprovalDialogOpen(false);
        setCurrentPlanApprovalRequest(null);
      },
    );
  }, []);

  // Context usage dialog handlers
  const isCurrentContextUsageRequest = useCallback((requestId?: string | null) => {
    if (requestId == null || requestId === '') {
      return true;
    }
    return contextUsageRequestIdRef.current === requestId;
  }, []);

  const openContextUsageDialog = useCallback((requestId?: string | null, loading = true) => {
    contextUsageRequestIdRef.current = requestId ?? null;
    setContextUsageData(null);
    setContextUsageIsLoading(loading);
    setContextUsageDialogOpen(true);
  }, []);

  const updateContextUsageData = useCallback((requestId: string | null | undefined, data: ContextUsageData) => {
    if (!isCurrentContextUsageRequest(requestId)) {
      return false;
    }
    setContextUsageIsLoading(false);
    setContextUsageData(data);
    return true;
  }, [isCurrentContextUsageRequest]);

  const closeContextUsageDialog = useCallback((requestId?: string | null) => {
    if (!isCurrentContextUsageRequest(requestId)) {
      return false;
    }
    contextUsageRequestIdRef.current = null;
    setContextUsageDialogOpen(false);
    setContextUsageIsLoading(false);
    setContextUsageData(null);
    return true;
  }, [isCurrentContextUsageRequest]);

  return {
    // Permission dialog
    permissionDialogOpen,
    currentPermissionRequest,
    openPermissionDialog,
    handlePermissionApprove,
    handlePermissionApproveAlways,
    handlePermissionSkip,
    forceClosePermissionDialog,

    // AskUserQuestion dialog
    askUserQuestionDialogOpen,
    currentAskUserQuestionRequest,
    openAskUserQuestionDialog,
    handleAskUserQuestionSubmit,
    handleAskUserQuestionCancel,
    forceCloseAskUserQuestionDialog,

    // PlanApproval dialog
    planApprovalDialogOpen,
    currentPlanApprovalRequest,
    openPlanApprovalDialog,
    handlePlanApprovalApprove,
    handlePlanApprovalReject,
    forceClosePlanApprovalDialog,

    // Context usage dialog
    contextUsageDialogOpen,
    contextUsageIsLoading,
    contextUsageData,
    openContextUsageDialog,
    updateContextUsageData,
    closeContextUsageDialog,
  };
}
