import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PermissionDialog from './PermissionDialog';
import PlanApprovalDialog from './PlanApprovalDialog';
import AskUserQuestionDialog from './AskUserQuestionDialog';
import { readDialogDraft, writeDialogDraft } from '../utils/dialogStateStorage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));
vi.mock('./MarkdownBlock', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));

const request = {
  channelId: 'C', requestId: 'C', dialogToken: 'old', deadlineMs: 30_000,
  toolName: 'test', inputs: { command: 'test command' }, plan: 'test plan',
  questions: [{ question: 'Pick a color', header: 'Color', multiSelect: false,
    options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }],
};
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  sessionStorage.clear();
  window.name = '';
});
afterEach(() => {
  sessionStorage.clear();
  window.name = '';
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('dialog draft recovery', () => {
  it('restores permission selection after remount and resets for a new token', () => {
    const props = { isOpen: true, request, onApprove: noop, onSkip: noop, onApproveAlways: noop };
    const first = render(<PermissionDialog {...props} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.click(screen.getByTitle('chat.collapse'));
    first.unmount();

    const second = render(<PermissionDialog {...props} />);
    expect(screen.getByRole('button', { name: 'permission.allowAlways 2' }).classList.contains('selected')).toBe(true);
    expect(screen.queryByText('test command')).toBeNull();
    second.rerender(<PermissionDialog {...props} request={{ ...request, dialogToken: 'new' }} />);
    expect(screen.getByRole('button', { name: 'permission.allow 1' }).classList.contains('selected')).toBe(true);
    expect(screen.getByText('test command')).toBeTruthy();
    expect(readDialogDraft('permission', 'C', 30_000, 'new')).toMatchObject({ selectedIndex: 0, showCommand: true });
  });

  it('does not carry a previously selected bypass mode into a new plan', () => {
    const props = { isOpen: true, request, onApprove: vi.fn(), onReject: noop };
    const first = render(<PlanApprovalDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'yolo' }));
    first.unmount();
    const second = render(<PlanApprovalDialog {...props} />);
    expect(screen.getByRole('button', { name: 'yolo' }).classList.contains('selected')).toBe(true);
    second.rerender(<PlanApprovalDialog {...props} request={{ ...request, dialogToken: 'new' }} />);
    fireEvent.click(screen.getByRole('button', { name: '批准并执行' }));
    expect(props.onApprove).toHaveBeenCalledWith('C', 'default');
    expect(readDialogDraft('planApproval', 'C', 30_000, 'new')).toBeNull();
  });

  it('restores answers after remount and removes the submitted draft', () => {
    const props = { isOpen: true, request, onSubmit: vi.fn(), onCancel: noop };
    const first = render(<AskUserQuestionDialog {...props} />);
    fireEvent.click(screen.getByText('Blue'));
    first.unmount();
    render(<AskUserQuestionDialog {...props} />);
    fireEvent.click(screen.getByText('提交'));
    expect(props.onSubmit).toHaveBeenCalledWith('C', { 'Pick a color': 'Blue' });
    expect(readDialogDraft('askUserQuestion', 'C', 30_000, 'old')).toBeNull();
  });

  it('does not overwrite the next request draft with the previous answers', () => {
    const props = { isOpen: true, request, onSubmit: vi.fn(), onCancel: noop };
    const view = render(<AskUserQuestionDialog {...props} />);
    fireEvent.click(screen.getByText('Blue'));
    writeDialogDraft('askUserQuestion', 'C', {
      dialogToken: 'new', deadlineMs: 30_000, answers: { 'Pick a color': ['Red'] },
    });
    view.rerender(<AskUserQuestionDialog {...props} request={{ ...request, dialogToken: 'new' }} />);
    fireEvent.click(screen.getByText('提交'));
    expect(props.onSubmit).toHaveBeenCalledWith('C', { 'Pick a color': 'Red' });
  });
});
