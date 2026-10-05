import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AskUserQuestionDialog, { type AskUserQuestionRequest } from './AskUserQuestionDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

// MarkdownBlock resolves links through the JCEF bridge; stub it like
// MarkdownBlock.test.tsx does.
vi.mock('./utils/bridge', () => ({
  openBrowser: vi.fn(),
  openClass: vi.fn(),
  openFile: vi.fn(),
  resolveFilePathWithCallback: vi.fn(),
}));

/**
 * Plan-review questions ask through this dialog and carry `detail` (the plan
 * under review) and `intent`; both were being dropped, which left a plan-review
 * question unreadable in cc-gui.
 */

const PLAN = [
  '# Migration plan',
  '',
  '- move the tables',
  '- backfill the ids',
].join('\n');

const renderDialog = (
  questions: AskUserQuestionRequest['questions'],
  provider?: AskUserQuestionRequest['provider'],
) => {
  const onSubmit = vi.fn();
  render(
    <AskUserQuestionDialog
      isOpen
      request={{ requestId: 'plan-1', toolName: 'AskUserQuestion', questions, provider }}
      onSubmit={onSubmit}
      onCancel={() => {}}
      timeoutSeconds={300}
    />,
  );
  return { onSubmit };
};

describe('AskUserQuestionDialog question detail', () => {
  it('renders the detail a question carries', () => {
    renderDialog([
      {
        question: 'Approve this plan and leave plan mode?',
        header: 'Plan review',
        multiSelect: false,
        detail: PLAN,
        options: [
          { label: 'Approve', description: 'carry it out' },
          { label: 'Keep planning', description: 'stay in plan mode' },
        ],
      },
    ]);

    // The plan is markdown; its rendered text must be visible in the dialog.
    expect(screen.getByText('Migration plan')).toBeTruthy();
    expect(screen.getByText('move the tables')).toBeTruthy();
    expect(screen.getByText('backfill the ids')).toBeTruthy();
  });

  it('labels a plan-review detail and still submits the approve label', () => {
    const { onSubmit } = renderDialog([
      {
        question: 'Approve this plan and leave plan mode?',
        header: 'Plan review',
        multiSelect: false,
        detail: PLAN,
        intent: { kind: 'plan-review', approve: 'Approve' },
        options: [
          { label: 'Approve', description: 'carry it out' },
          { label: 'Keep planning', description: 'stay in plan mode' },
        ],
      },
    ]);

    expect(screen.getByText('计划内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    fireEvent.click(screen.getByText('提交'));

    expect(onSubmit).toHaveBeenCalledWith('plan-1', {
      'Approve this plan and leave plan mode?': 'Approve',
    });
  });

  it('renders no detail block when the question has none', () => {
    renderDialog([
      { question: 'Q', header: 'H', multiSelect: false, options: [{ label: 'A', description: '' }] },
    ]);
    expect(document.querySelector('.question-detail')).toBeNull();
  });
});
