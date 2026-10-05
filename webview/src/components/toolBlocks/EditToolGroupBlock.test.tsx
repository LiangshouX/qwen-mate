import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditToolGroupBlock from './EditToolGroupBlock';
import type { ToolResultBlock } from '../../types';

const bridgeMocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  showDiff: vi.fn(),
  refreshFile: vi.fn(),
  resolveFilePathWithCallback: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../utils/bridge', () => ({
  openFile: bridgeMocks.openFile,
  showDiff: bridgeMocks.showDiff,
  refreshFile: bridgeMocks.refreshFile,
  resolveFilePathWithCallback: bridgeMocks.resolveFilePathWithCallback,
}));

const makeItem = (toolId: string, result: ToolResultBlock | null = null) => ({
  name: 'edit',
  input: { file_path: '/repo/doc.md', old_string: 'old', new_string: 'new' },
  result,
  toolId,
});

describe('EditToolGroupBlock', () => {
  beforeEach(() => {
    bridgeMocks.openFile.mockReset();
    bridgeMocks.showDiff.mockReset();
    bridgeMocks.refreshFile.mockReset();
    bridgeMocks.resolveFilePathWithCallback.mockReset();
    document.querySelectorAll('.file-link-tooltip').forEach((element) => element.remove());
  });

  it('keeps rows pending while no result has arrived', () => {
    const { container } = render(
      <EditToolGroupBlock items={[makeItem('call_1'), makeItem('call_2')]} />,
    );

    expect(container.querySelectorAll('.tool-status-indicator.pending')).toHaveLength(2);
  });

  it('finalizes denied rows as error instead of pending', () => {
    const { container } = render(
      <EditToolGroupBlock
        items={[makeItem('call_1'), makeItem('call_2')]}
        deniedToolIds={new Set(['call_1', 'call_2'])}
      />,
    );

    expect(container.querySelectorAll('.tool-status-indicator.pending')).toHaveLength(0);
    expect(container.querySelectorAll('.tool-status-indicator.error')).toHaveLength(2);
  });

  it('marks rows completed when the result arrived', () => {
    const { container } = render(
      <EditToolGroupBlock
        items={[makeItem('call_1', { type: 'tool_result', content: 'ok' })]}
      />,
    );

    expect(container.querySelectorAll('.tool-status-indicator.completed')).toHaveLength(1);
    expect(container.querySelectorAll('.tool-status-indicator.pending')).toHaveLength(0);
    expect(bridgeMocks.refreshFile).toHaveBeenCalledWith('/repo/doc.md');
  });
});
