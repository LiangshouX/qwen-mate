// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSelect } from './ProviderSelect';
import {
  CLI_PROVIDER_VISIBILITY_KEY,
  setCliProviderHidden,
} from '../../../utils/cliProviderVisibility';

vi.mock('../../shared/ProviderModelIcon', () => ({
  ProviderModelIcon: () => <span data-testid="provider-icon" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      const map: Record<string, string> = {
        'providers.qwen.label': 'Qwen Code',
        'config.switchProvider': 'Switch provider',
      };
      const defaultValue = options && typeof options === 'object' && 'defaultValue' in options
        ? String((options as Record<string, unknown>).defaultValue)
        : '';
      return map[key] ?? (defaultValue || key);
    },
  }),
}));

describe('ProviderSelect CLI visibility', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem(CLI_PROVIDER_VISIBILITY_KEY);
  });

  const openMenu = () => {
    fireEvent.click(screen.getByRole('button'));
    return within(document.querySelector('.provider-dropdown') as HTMLElement);
  };

  it('omits hidden CLI providers from the switcher menu', () => {
    setCliProviderHidden('qwen', true);

    render(<ProviderSelect value="qwen" />);
    const menu = openMenu();

    expect(menu.queryByText('Qwen Code')).toBeNull();
  });

  it('reacts to visibility changes made while mounted', () => {
    render(<ProviderSelect value="qwen" />);
    const menu = openMenu();
    expect(menu.getByText('Qwen Code')).toBeTruthy();
    act(() => {
      setCliProviderHidden('qwen', true);
    });

    expect(menu.queryByText('Qwen Code')).toBeNull();
  });

  it('keeps a hidden provider functional when it is the active selection', () => {
    setCliProviderHidden('qwen', true);

    render(<ProviderSelect value="qwen" />);

    // Trigger button still displays the active hidden provider.
    expect(screen.getByRole('button').textContent).toContain('Qwen Code');
  });
});
