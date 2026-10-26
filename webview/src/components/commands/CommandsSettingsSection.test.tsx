import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendToJava } from '../../utils/bridge';
import { CommandsSettingsSection } from './CommandsSettingsSection';

vi.mock('../../utils/bridge', () => ({
  sendToJava: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const payload = JSON.stringify({
  global: {
    'global:C:/home/.qwen/commands/review.md': {
      id: 'global:C:/home/.qwen/commands/review.md',
      name: '/review',
      scope: 'global',
      path: 'C:/home/.qwen/commands/review.md',
      description: 'Review the code',
      frontmatter: { description: 'Review the code', 'argument-hint': '<target>' },
    },
  },
  local: {},
});

describe('CommandsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests commands on mount and renders the received list', () => {
    render(<CommandsSettingsSection />);

    expect(sendToJava).toHaveBeenCalledWith('get_all_commands', {});

    act(() => {
      window.updateCommands?.(payload);
    });

    expect(screen.getByText('/review')).toBeTruthy();
    // All / Global / Local count badges
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('shows the frontmatter on expand and opens the file in the IDE', () => {
    render(<CommandsSettingsSection />);

    act(() => {
      window.updateCommands?.(payload);
    });

    fireEvent.click(screen.getByText('/review'));

    expect(screen.getByText('argument-hint')).toBeTruthy();
    expect(screen.getByText('<target>')).toBeTruthy();

    fireEvent.click(screen.getByText('commands.editInIde'));

    expect(sendToJava).toHaveBeenLastCalledWith('open_command', {
      path: 'C:/home/.qwen/commands/review.md',
    });
  });
});
