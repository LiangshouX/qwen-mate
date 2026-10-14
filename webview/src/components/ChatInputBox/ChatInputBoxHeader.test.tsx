import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInputBoxHeader } from './ChatInputBoxHeader';

vi.mock('../../contexts/UIStateContext', () => ({
  useUIState: () => ({ addToast: vi.fn() }),
}));

const createProps = (): ComponentProps<typeof ChatInputBoxHeader> => ({
  sdkInstalled: true,
  sdkStatusLoading: false,
  sdkStatusError: false,
  currentProvider: 'qwen',
  t: ((key: string) => key) as never,
  attachments: [],
  onRemoveAttachment: vi.fn(),
  usagePercentage: 0,
  showUsage: false,
  onAddAttachment: vi.fn(),
  onClearAgent: vi.fn(),
  statusPanelExpanded: false,
});

describe('ChatInputBoxHeader SDK status', () => {
  it('shows a retry action for query errors without showing the install warning', () => {
    const onRetrySdkStatus = vi.fn();
    render(
      <ChatInputBoxHeader
        {...createProps()}
        sdkStatusError
        onRetrySdkStatus={onRetrySdkStatus}
      />,
    );

    expect(screen.getByText('chat.sdkStatusUnavailable')).toBeTruthy();
    expect(screen.queryByText('chat.sdkNotInstalled')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'chat.retrySdkStatus' }));

    expect(onRetrySdkStatus).toHaveBeenCalledTimes(1);
  });
});

describe('ChatInputBoxHeader message queue', () => {
  const queuedItem = { id: 'q1', content: 'queued text', queuedAt: 1 };

  it('shows queue count/hint and wires edit, restore-all and remove', () => {
    const onEdit = vi.fn();
    const onRestoreAll = vi.fn();
    const onRemove = vi.fn();
    render(
      <ChatInputBoxHeader
        {...createProps()}
        messageQueue={[queuedItem]}
        onRemoveFromQueue={onRemove}
        onEditFromQueue={onEdit}
        onRestoreQueue={onRestoreAll}
      />,
    );

    expect(screen.getByText('chat.messageQueue.title')).toBeTruthy();
    expect(screen.getByText('chat.messageQueue.autoSendHint')).toBeTruthy();
    expect(screen.getByText('queued text')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'chat.messageQueue.edit' }));
    expect(onEdit).toHaveBeenCalledWith('q1');

    fireEvent.click(screen.getByRole('button', { name: 'chat.messageQueue.restoreAll' }));
    expect(onRestoreAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'chat.messageQueue.remove' }));
    expect(onRemove).toHaveBeenCalledWith('q1');
  });

  it('hides the queue block when the queue is empty', () => {
    render(<ChatInputBoxHeader {...createProps()} messageQueue={[]} />);

    expect(screen.queryByText('chat.messageQueue.title')).toBeNull();
  });
});
