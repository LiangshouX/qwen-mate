// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSelect } from './ProviderSelect';

vi.mock('../../shared/ProviderModelIcon', () => ({
  ProviderModelIcon: () => <span data-testid="provider-icon" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      const map: Record<string, string> = {
        'providers.qwen.label': 'Qwen Code',
        'providers.manageCli': 'CLI Settings',
        'config.switchProvider': 'Switch provider',
      };
      const defaultValue = options && typeof options === 'object' && 'defaultValue' in options
        ? String((options as Record<string, unknown>).defaultValue)
        : '';
      return map[key] ?? (defaultValue || key);
    },
  }),
}));

describe('ProviderSelect CLI settings footer', () => {
  afterEach(cleanup);
  it('renders the footer only when onOpenCliSettings is provided', () => {
    const { unmount } = render(<ProviderSelect value="qwen" />);
    fireEvent.click(screen.getByRole('button'));
    expect(document.querySelector('.provider-cli-footer-btn')).toBeNull();
    unmount();

    render(<ProviderSelect value="qwen" onOpenCliSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(document.querySelector('.provider-cli-footer-btn')).toBeTruthy();
    expect(screen.getByText('CLI Settings')).toBeTruthy();
  });

  it('reaches CLI settings with End and closes the menu when tabbing away', () => {
    render(<ProviderSelect value="qwen" onOpenCliSettings={() => {}} />);
    const trigger = screen.getByRole('button');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitemradio', { checked: true }), { key: 'End' });
    const footer = screen.getByRole('button', { name: 'CLI Settings' });
    expect(document.activeElement).toBe(footer);
    fireEvent.keyDown(footer, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { checked: true }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([false, true])('closes a pointer-opened menu when the trigger receives Tab (shift: %s)', (shiftKey) => {
    render(<ProviderSelect value="qwen" onOpenCliSettings={() => {}} />);
    const trigger = screen.getByRole('button');
    act(() => trigger.focus());
    fireEvent.click(trigger, { detail: 1 });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).not.toBeNull();

    expect(fireEvent.keyDown(trigger, { key: 'Tab', shiftKey })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('invokes onOpenCliSettings and closes the dropdown on click', () => {
    const onOpenCliSettings = vi.fn();
    render(<ProviderSelect value="qwen" onOpenCliSettings={onOpenCliSettings} />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByText('CLI Settings'));

    expect(onOpenCliSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.selector-dropdown')).toBeNull();
  });
});
