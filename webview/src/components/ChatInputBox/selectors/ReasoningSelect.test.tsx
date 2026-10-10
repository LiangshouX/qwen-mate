import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReasoningEffort } from '../types';
import { ReasoningSelect } from './ReasoningSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('ReasoningSelect', () => {
  it('lists the retained effort levels and selects one', () => {
    const onChange = vi.fn();

    render(
      <ReasoningSelect
        value="high"
        onChange={onChange}
        currentProvider="qwen"
        selectedModel="qwen3-coder-plus"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    const dropdown = screen.getByTestId('reasoning-selector-dropdown');
    for (const label of ['Low', 'Medium', 'High', 'XHigh', 'Max']) {
      expect(within(dropdown).getByText(label)).toBeTruthy();
    }

    fireEvent.click(within(dropdown).getByText('Low'));
    expect(onChange).toHaveBeenCalledWith('low');
  });

  it('offers the full Qwen Code ladder, including Max', () => {
    render(
      <ReasoningSelect
        value="xhigh"
        onChange={vi.fn()}
        currentProvider="qwen"
        selectedModel="qwen3-coder-plus"
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    const dropdown = screen.getByTestId('reasoning-selector-dropdown');

    expect(within(dropdown).getByText('XHigh')).toBeTruthy();
    expect(within(dropdown).getByText('Max')).toBeTruthy();
  });

  it('resets an effort outside the ladder to the default tier', () => {
    const onChange = vi.fn();

    render(
      <ReasoningSelect
        value={'ultra' as ReasoningEffort}
        onChange={onChange}
        currentProvider="qwen"
        selectedModel="qwen3-coder-plus"
      />,
    );

    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('renders the picker regardless of model', () => {
    render(
      <ReasoningSelect
        value="high"
        onChange={vi.fn()}
        currentProvider="qwen"
        selectedModel="auto"
      />,
    );
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('does not force a scrollbar on the embedded submenu when all levels fit', () => {
    const trigger = document.createElement('div');
    trigger.getBoundingClientRect = () => ({
      x: 20,
      y: 80,
      top: 80,
      left: 20,
      bottom: 108,
      right: 200,
      width: 180,
      height: 28,
      toJSON() {
        return {};
      },
    });

    render(
      <ReasoningSelect
        embedded
        triggerRef={{ current: trigger }}
        value="high"
        onChange={vi.fn()}
        currentProvider="qwen"
        selectedModel="qwen3-coder-plus"
      />,
    );

    const dropdown = screen.getByTestId('reasoning-selector-dropdown');
    expect(dropdown.style.overflowY).not.toBe('auto');
    expect(dropdown.style.maxHeight).toBe('');
  });
});
