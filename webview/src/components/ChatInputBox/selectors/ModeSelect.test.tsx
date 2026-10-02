import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModeSelect } from './ModeSelect';

const LABELS: Record<string, string> = {
  'modes.plan.label': 'Plan',
  'modes.plan.shortLabel': 'Plan',
  'modes.default.label': 'Ask Permission',
  'modes.default.shortLabel': 'Ask',
  'modes.auto-edit.label': 'Auto-Edit',
  'modes.auto-edit.shortLabel': 'Auto-Edit',
  'modes.auto.label': 'Auto',
  'modes.auto.shortLabel': 'Auto',
  'modes.yolo.label': 'YOLO',
  'modes.yolo.shortLabel': 'YOLO',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => LABELS[key] ?? options?.defaultValue ?? key,
  }),
}));

function openAndGetOptionIds(provider: string): string[] {
  render(<ModeSelect value="default" onChange={vi.fn()} provider={provider} />);
  fireEvent.click(screen.getByRole('button'));
  return screen
    .getAllByTestId(/^mode-option-/)
    .map((el) => el.getAttribute('data-testid')!.replace('mode-option-', ''));
}

describe('ModeSelect', () => {
  it('shows the full Qwen Code approval-mode list (in CLI cycle order) for qwen', () => {
    expect(openAndGetOptionIds('qwen')).toEqual(['plan', 'default', 'auto-edit', 'auto', 'yolo']);
  });

  it('hides plan and provider-native auto for the dsh provider', () => {
    expect(openAndGetOptionIds('dsh')).toEqual(['default', 'auto-edit', 'yolo']);
  });

  it('shows a compact short label on the trigger and the full label in the menu', () => {
    render(<ModeSelect value="default" onChange={vi.fn()} provider="qwen" />);

    expect(screen.getByRole('button').textContent).toContain('Ask');
    expect(screen.getByRole('button').textContent).not.toContain('Ask Permission');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Ask Permission')).toBeTruthy();
  });

  it('renders native auto and YOLO as separate qwen choices', () => {
    render(<ModeSelect value="auto" onChange={vi.fn()} provider="qwen" />);
    expect(screen.getByRole('button').textContent).toContain('Auto');
    expect(screen.getByRole('button').className).not.toContain('mode-full-auto-active');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('mode-option-auto').textContent).toContain('Auto');
    expect(screen.getByTestId('mode-option-yolo').textContent).toContain('YOLO');
  });

  it('uses the warning treatment only for YOLO', () => {
    render(<ModeSelect value="yolo" onChange={vi.fn()} provider="qwen" />);
    expect(screen.getByRole('button').className).toContain('mode-full-auto-active');
  });

  it('selecting an option fires onChange with the mode id', () => {
    const onChange = vi.fn();
    render(<ModeSelect value="default" onChange={onChange} provider="qwen" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('mode-option-auto-edit'));
    expect(onChange).toHaveBeenCalledWith('auto-edit');
  });
});
