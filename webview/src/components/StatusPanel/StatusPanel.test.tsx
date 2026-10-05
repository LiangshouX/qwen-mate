import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatusPanel from './StatusPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('StatusPanel', () => {
  it('uses the tasks tab label', () => {
    render(
      <StatusPanel
        todos={[]}
        fileChanges={[]}
        subagents={[]}
        currentProvider="qwen"
      />,
    );

    expect(screen.getByText('statusPanel.tasksTab')).toBeTruthy();
  });
});
