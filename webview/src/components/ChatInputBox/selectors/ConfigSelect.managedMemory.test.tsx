import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigSelect } from './ConfigSelect';

// Test env resolves real zh translations (see title="配置" below), so the
// assertions match the rendered zh strings, not the raw i18n keys.
function renderConfigSelect(props: Partial<React.ComponentProps<typeof ConfigSelect>> = {}) {
  const onManagedMemoryEnabledChange = vi.fn();
  render(
    <ConfigSelect
      streamingEnabled
      alwaysThinkingEnabled={false}
      managedMemoryEnabled={false}
      onManagedMemoryEnabledChange={onManagedMemoryEnabledChange}
      {...props}
    />
  );
  return { onManagedMemoryEnabledChange };
}

function openMenu() {
  fireEvent.click(screen.getByTitle('配置'));
}

describe('ConfigSelect managed memory quick toggle', () => {
  it('opens the menu, shows the managed memory row unchecked, and reports toggling it on', () => {
    const { onManagedMemoryEnabledChange } = renderConfigSelect();

    openMenu();

    const row = screen.getByRole('button', { name: /托管记忆/ });
    expect(row).toBeTruthy();

    fireEvent.click(row);
    expect(onManagedMemoryEnabledChange).toHaveBeenCalledWith(true);
  });

  it('reports turning the switch off when it is currently on', () => {
    const { onManagedMemoryEnabledChange } = renderConfigSelect({ managedMemoryEnabled: true });

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /托管记忆/ }));

    expect(onManagedMemoryEnabledChange).toHaveBeenCalledWith(false);
  });

  it('keeps the streaming and thinking rows alongside the managed memory row', () => {
    renderConfigSelect();

    openMenu();

    expect(screen.getByRole('button', { name: /流式传输/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /托管记忆/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /思考/ })).toBeTruthy();
  });
});
