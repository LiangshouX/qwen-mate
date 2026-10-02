import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogManagement } from '../../useDialogManagement';
import { registerPermissionCallbacks } from './permissionCallbacks';
import { sendBridgeEvent } from '../../../utils/bridge';

vi.mock('../../../utils/bridge', () => ({ sendBridgeEvent: vi.fn() }));
const t = ((key: string) => key) as TFunction;
const payload = (dialogToken: string) => JSON.stringify({
  channelId: 'C', requestId: 'C', dialogToken, deadlineMs: 10_000,
  toolName: 'test', inputs: {}, questions: [],
});
const cases = [
  { kind: 'permission', current: 'currentPermissionRequest', close: 'forceClosePermissionDialog' },
  { kind: 'askUserQuestion', current: 'currentAskUserQuestionRequest', close: 'forceCloseAskUserQuestionDialog' },
  { kind: 'planApproval', current: 'currentPlanApprovalRequest', close: 'forceClosePlanApprovalDialog' },
] as const;

afterEach(() => {
  delete window.__pendingDialogEvents;
  delete window.showPermissionDialog;
  delete window.showAskUserQuestionDialog;
  delete window.showPlanApprovalDialog;
  delete window.forceClosePermissionDialog;
  delete window.forceCloseAskUserQuestionDialog;
  delete window.forceClosePlanApprovalDialog;
  vi.clearAllMocks();
});

describe.each(cases)('$kind bootstrap delivery', ({ kind, current, close }) => {
  it('drains show, close-all, fresh show in their original order', () => {
    const { result } = renderHook(() => useDialogManagement({ t }));
    window.__pendingDialogEvents = [
      { kind, type: 'show', payload: payload('old') },
      { kind, type: 'close', targetId: null },
      { kind, type: 'show', payload: payload('new') },
    ];
    act(() => { registerPermissionCallbacks(result.current); });
    expect(result.current[current]?.dialogToken).toBe('new');
    expect(window.__pendingDialogEvents).toEqual([]);
    expect(sendBridgeEvent).not.toHaveBeenCalled();
  });

  it('acknowledges the exact token only after consuming the queued close', () => {
    const { result } = renderHook(() => useDialogManagement({ t }));
    window.__pendingDialogEvents = [
      { kind, type: 'close', targetId: 'C', dialogToken: 'old' },
      { kind, type: 'show', payload: payload('old') },
    ];
    expect(sendBridgeEvent).not.toHaveBeenCalled();
    act(() => { registerPermissionCallbacks(result.current); });
    expect(result.current[current]).toBeNull();
    expect(sendBridgeEvent).toHaveBeenCalledWith('dialog_delivery_ack', JSON.stringify({
      functionName: close, targetId: 'C', dialogToken: 'old',
    }));
  });
});

it('echoes the request token in all three response types', () => {
  const { result } = renderHook(() => useDialogManagement({ t }));
  const request = JSON.parse(payload('response-token'));
  act(() => {
    result.current.openPermissionDialog(request);
    result.current.openAskUserQuestionDialog(request);
    result.current.openPlanApprovalDialog(request);
  });
  act(() => {
    result.current.handlePermissionApprove('C');
    result.current.handleAskUserQuestionSubmit('C', {});
    result.current.handlePlanApprovalApprove('C', 'default');
  });
  expect(vi.mocked(sendBridgeEvent).mock.calls.map(([event, json]) => [event, JSON.parse(json!).dialogToken]))
    .toEqual([
      ['permission_decision', 'response-token'],
      ['ask_user_question_response', 'response-token'],
      ['plan_approval_response', 'response-token'],
    ]);
});
