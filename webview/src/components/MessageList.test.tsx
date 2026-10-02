import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QwenMateMessage, QwenMateContentBlock, ToolResultBlock } from '../types';
import { MessageList } from './MessageList';
import { reconcileMessageKeys, type MessageKeySnapshot } from '../utils/messageUtils';

// Mock MessageItem to keep this suite focused on list-level paging behaviour.
vi.mock('./MessageItem', () => ({
  MessageItem: ({ messageKey, message }: { messageKey: string; message: QwenMateMessage }) => {
    const [localState, setLocalState] = useState('initial');
    return (
      <div
        data-testid="message-item"
        data-key={messageKey}
        data-type={message.type}
        data-local-state={localState}
        onClick={() => setLocalState('preserved')}
      >
        {message.content}
      </div>
    );
  },
}));

vi.mock('./WaitingIndicator', () => ({
  default: () => <div data-testid="waiting-indicator">waiting</div>,
}));

vi.mock('./ContextMenu', () => ({
  ContextMenu: () => null,
}));

vi.mock('../hooks/useContextMenu.js', () => ({
  useContextMenu: () => ({
    visible: false,
    x: 0,
    y: 0,
    savedRange: null,
    selectedText: '',
    open: vi.fn(),
    close: vi.fn(),
  }),
  copySelection: vi.fn(),
}));

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key === 'chat.showEarlierTurns') {
    return `Show ${opts?.count ?? 0} earlier turns (${opts?.remaining ?? 0} remaining)`;
  }
  if (key === 'chat.loadEarlierTurns') {
    return 'Load earlier messages';
  }
  if (key === 'chat.loadingEarlierTurns') {
    return 'Loading earlier messages';
  }
  if (key === 'chat.loadEarlierTurnsFailed') {
    return 'Load earlier messages failed, click to retry';
  }
  return key;
}) as never;

function makeMessages(count: number, idPrefix = 'm'): QwenMateMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    type: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
    id: `${idPrefix}-${i}`,
  }) as unknown as QwenMateMessage);
}

function makeToolDenseTurns(turnCount: number): QwenMateMessage[] {
  return Array.from({ length: turnCount }, (_, turn) => [
    { type: 'user', content: `user ${turn}`, id: `user-${turn}` },
    { type: 'assistant', content: `thinking ${turn}`, id: `thinking-${turn}` },
    {
      type: 'assistant',
      content: `tool ${turn}`,
      id: `tool-${turn}`,
      raw: { content: [{ type: 'tool_use', id: `call-${turn}`, name: 'Read', input: {} }] },
    },
    {
      type: 'user',
      content: '[tool_result]',
      id: `result-${turn}`,
      raw: { content: [{ type: 'tool_result', tool_use_id: `call-${turn}`, content: 'ok' }] },
    },
    { type: 'assistant', content: `answer ${turn}`, id: `answer-${turn}` },
  ]).flat() as unknown as QwenMateMessage[];
}

const noopGetText = (m: QwenMateMessage) => m.content ?? '';
const noopGetBlocks = (_m: QwenMateMessage): QwenMateContentBlock[] => [];
const noopFindToolResult = (_id: string | undefined, _i: number): ToolResultBlock | null => null;
const noopExtractMd = (_m: QwenMateMessage) => '';
const keysFor = (messages: QwenMateMessage[]) =>
  reconcileMessageKeys(messages, undefined, 'test-session').keys;

function StableMessageList({
  messages,
}: {
  messages: QwenMateMessage[];
}) {
  const previousRef = useRef<MessageKeySnapshot | undefined>(undefined);
  const snapshot = useMemo(
    () => reconcileMessageKeys(messages, previousRef.current, 'test-session'),
    [messages],
  );
  useLayoutEffect(() => {
    previousRef.current = snapshot;
  }, [snapshot]);
  return (
    <MessageList
      messages={messages}
      messageKeys={snapshot.keys}
      streamingActive
      isThinking
      loading={false}
      loadingStartTime={null}
      t={t}
      getMessageText={noopGetText}
      getContentBlocks={noopGetBlocks}
      findToolResult={noopFindToolResult}
      extractMarkdownContent={noopExtractMd}
      messagesEndRef={createRef<HTMLDivElement>()}
    />
  );
}

function renderList(messages: QwenMateMessage[]) {
  const endRef = createRef<HTMLDivElement>();
  return render(
    <MessageList
      messages={messages}
      messageKeys={keysFor(messages)}
      streamingActive={false}
      isThinking={false}
      loading={false}
      loadingStartTime={null}
      t={t}
      getMessageText={noopGetText}
      getContentBlocks={noopGetBlocks}
      findToolResult={noopFindToolResult}
      extractMarkdownContent={noopExtractMd}
      messagesEndRef={endRef}
    />
  );
}

describe('MessageList paged collapse', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all messages when there are at most five user turns', () => {
    renderList(makeMessages(10));
    expect(screen.getAllByTestId('message-item')).toHaveLength(10);
    expect(screen.queryByText(/Show.*earlier/)).toBeNull();
  });

  it('collapses earlier complete turns when there are more than five user turns', () => {
    const { container } = renderList(makeMessages(50));
    expect(screen.getAllByTestId('message-item')).toHaveLength(10);
    const indicator = container.querySelector('.collapsed-messages-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toBe('Show 5 earlier turns (20 remaining)');
  });

  it('reveals five complete turns per click instead of expanding everything', () => {
    const { container } = renderList(makeMessages(100));
    expect(screen.getAllByTestId('message-item')).toHaveLength(10);

    const indicator = container.querySelector('.collapsed-messages-indicator');
    expect(indicator?.textContent).toBe('Show 5 earlier turns (45 remaining)');
    fireEvent.click(indicator!);
    expect(screen.getAllByTestId('message-item')).toHaveLength(20);

    fireEvent.click(container.querySelector('.collapsed-messages-indicator')!);
    expect(screen.getAllByTestId('message-item')).toHaveLength(30);
  });

  it('removes the indicator once everything is revealed', () => {
    const { container } = renderList(makeMessages(16));
    const indicator = container.querySelector('.collapsed-messages-indicator');
    expect(indicator?.textContent).toBe('Show 3 earlier turns (3 remaining)');

    fireEvent.click(indicator!);
    expect(screen.getAllByTestId('message-item')).toHaveLength(16);
    expect(container.querySelector('.collapsed-messages-indicator')).toBeNull();
  });

  it('never starts rendering in the middle of an assistant and tool chain', () => {
    const { container } = renderList(makeToolDenseTurns(8));
    const visible = screen.getAllByTestId('message-item');

    expect(visible).toHaveLength(25);
    expect(visible[0].textContent).toBe('user 3');
    expect(container.querySelector('.collapsed-messages-indicator')?.textContent)
      .toBe('Show 3 earlier turns (3 remaining)');
  });

  it('tolerates malformed raw content blocks from history transport', () => {
    const messages = makeMessages(14);
    messages[0] = {
      ...messages[0],
      raw: { content: [null, 'unexpected'] },
    } as unknown as QwenMateMessage;

    expect(() => renderList(messages)).not.toThrow();
    expect(screen.getAllByTestId('message-item')).toHaveLength(10);
  });

  it('reports collapsedCount changes to parent for anchor rail sync', () => {
    const onCollapsedCountChange = vi.fn();
    const messages = makeMessages(60);
    const endRef = createRef<HTMLDivElement>();
    const { rerender, container } = render(
      <MessageList
        messages={messages}
        messageKeys={keysFor(messages)}
        streamingActive={false}
        isThinking={false}
        loading={false}
        loadingStartTime={null}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={endRef}
        onCollapsedCountChange={onCollapsedCountChange}
      />
    );

    expect(onCollapsedCountChange).toHaveBeenLastCalledWith(50);

    // Reveal one chunk
    const indicator = container.querySelector('.collapsed-messages-indicator');
    fireEvent.click(indicator!);
    expect(onCollapsedCountChange).toHaveBeenLastCalledWith(40);

    // Trigger a session switch via first-message-id change
    rerender(
      <MessageList
        messages={makeMessages(50, 'session2')}
        messageKeys={keysFor(makeMessages(50, 'session2'))}
        streamingActive={false}
        isThinking={false}
        loading={false}
        loadingStartTime={null}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={endRef}
        onCollapsedCountChange={onCollapsedCountChange}
      />
    );
    expect(onCollapsedCountChange).toHaveBeenLastCalledWith(40);
  });

  it('resets revealed turns when id-less history messages switch sessions', () => {
    const firstSession = makeMessages(40).map(({ id: _id, ...message }, index) => ({
      ...message,
      timestamp: `2026-07-16T10:00:${String(index).padStart(2, '0')}.000Z`,
    })) as QwenMateMessage[];
    const secondSession = makeMessages(40).map(({ id: _id, ...message }, index) => ({
      ...message,
      timestamp: `2026-07-17T10:00:${String(index).padStart(2, '0')}.000Z`,
    })) as QwenMateMessage[];
    const endRef = createRef<HTMLDivElement>();
    const { container, rerender } = render(
      <MessageList
        messages={firstSession}
        messageKeys={keysFor(firstSession)}
        streamingActive={false}
        isThinking={false}
        loading={false}
        loadingStartTime={null}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={endRef}
      />
    );

    fireEvent.click(container.querySelector('.collapsed-messages-indicator')!);
    expect(screen.getAllByTestId('message-item')).toHaveLength(20);

    rerender(
      <MessageList
        messages={secondSession}
        messageKeys={keysFor(secondSession)}
        streamingActive={false}
        isThinking={false}
        loading={false}
        loadingStartTime={null}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={endRef}
      />
    );

    expect(screen.getAllByTestId('message-item')).toHaveLength(10);
  });
});

describe('MessageList container behaviour', () => {
  afterEach(cleanup);

  it('preserves the live assistant component when a tool snapshot adds its UUID', () => {
    const initialMessage: QwenMateMessage = {
      type: 'assistant',
      content: '',
      timestamp: '2026-07-28T09:00:00.000Z',
      isStreaming: true,
      __turnId: 42,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'Working through it' }],
        },
      },
    };
    const renderMessageList = (messages: QwenMateMessage[]) => <StableMessageList messages={messages} />;
    const { rerender } = render(renderMessageList([initialMessage]));
    const liveItem = screen.getByTestId('message-item');

    fireEvent.click(liveItem);
    expect(liveItem.getAttribute('data-local-state')).toBe('preserved');

    const toolSnapshot: QwenMateMessage = {
      ...initialMessage,
      raw: {
        uuid: 'backend-assistant-uuid',
        message: {
          content: [
            { type: 'thinking', thinking: 'Working through it' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/example' } },
          ],
        },
      },
    };
    rerender(renderMessageList([toolSnapshot]));

    expect(screen.getByTestId('message-item')).toBe(liveItem);
    expect(liveItem.getAttribute('data-key')).toBe('test-session:turn-42');
    expect(liveItem.getAttribute('data-local-state')).toBe('preserved');

    rerender(renderMessageList([{ ...toolSnapshot, __turnId: undefined }]));

    expect(screen.getByTestId('message-item')).toBe(liveItem);
    expect(liveItem.getAttribute('data-key')).toBe('test-session:turn-42');
    expect(liveItem.getAttribute('data-local-state')).toBe('preserved');
  });

  it('preserves a UUID-keyed replay message when a runtime turn ID is attached', () => {
    const replayMessage: QwenMateMessage = {
      type: 'assistant',
      content: '',
      timestamp: '2026-07-28T09:00:00.000Z',
      raw: {
        uuid: 'replay-assistant-uuid',
        message: {
          content: [{ type: 'thinking', thinking: 'Resuming the thought' }],
        },
      },
    };
    const renderMessageList = (message: QwenMateMessage) => <StableMessageList messages={[message]} />;
    const { rerender } = render(renderMessageList(replayMessage));
    const replayItem = screen.getByTestId('message-item');

    fireEvent.click(replayItem);
    rerender(renderMessageList({ ...replayMessage, isStreaming: true, __turnId: 43 }));

    expect(screen.getByTestId('message-item')).toBe(replayItem);
    expect(replayItem.getAttribute('data-key')).toBe('test-session:replay-assistant-uuid');
    expect(replayItem.getAttribute('data-local-state')).toBe('preserved');
  });

  it('uses the latest message index for isLast even when paginated', () => {
    const messages = makeMessages(40);
    renderList(messages);
    const items = screen.getAllByTestId('message-item');
    const last = items[items.length - 1];
    // The last item must correspond to messages[39]
    expect(last.textContent).toBe('message 39');
  });

  it('renders waiting indicator when loading', () => {
    const endRef = createRef<HTMLDivElement>();
    render(
      <MessageList
        messages={makeMessages(3)}
        messageKeys={keysFor(makeMessages(3))}
        streamingActive={false}
        isThinking={false}
        loading={true}
        loadingStartTime={Date.now()}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={endRef}
      />
    );
    expect(screen.getByTestId('waiting-indicator')).toBeTruthy();
  });
});

describe('MessageList disk history pagination', () => {
  const dispatchPageInfo = (detail: Record<string, unknown>) => {
    act(() => {
      window.dispatchEvent(new CustomEvent('qwen-history-page-info', { detail }));
    });
  };
  const dispatchPageError = (detail: Record<string, unknown>) => {
    act(() => {
      window.dispatchEvent(new CustomEvent('qwen-history-page-error', { detail }));
    });
  };

  function renderListWithSession(messages: QwenMateMessage[], sessionId: string | null = 'session-1') {
    return render(
      <MessageList
        messages={messages}
        messageKeys={keysFor(messages)}
        streamingActive={false}
        isThinking={false}
        loading={false}
        loadingStartTime={null}
        t={t}
        getMessageText={noopGetText}
        getContentBlocks={noopGetBlocks}
        findToolResult={noopFindToolResult}
        extractMarkdownContent={noopExtractMd}
        messagesEndRef={createRef<HTMLDivElement>()}
        currentSessionId={sessionId}
      />
    );
  }

  const indicatorOf = (container: HTMLElement) => container.querySelector('.collapsed-messages-indicator');

  beforeEach(() => {
    window.sendToJava = vi.fn();
    delete (window as unknown as Record<string, unknown>).__qwenMateHistoryPageInfo;
  });

  afterEach(cleanup);

  it('requests the latest page with a null cursor when no page info exists yet', () => {
    const { container } = renderListWithSession(makeMessages(2));
    const indicator = indicatorOf(container);
    expect(indicator?.textContent).toBe('Load earlier messages');

    fireEvent.click(indicator!);

    expect(window.sendToJava).toHaveBeenCalledTimes(1);
    expect(window.sendToJava).toHaveBeenCalledWith(
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":null}',
    );
  });

  it('requests earlier pages with the visible window cursor', () => {
    const { container } = renderListWithSession(makeMessages(2));
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 5, totalTurns: 8, hasMore: true });
    fireEvent.click(indicatorOf(container)!);
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 2, totalTurns: 8, hasMore: true });
    fireEvent.click(indicatorOf(container)!);

    expect(window.sendToJava).toHaveBeenNthCalledWith(
      1,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":5}',
    );
    expect(window.sendToJava).toHaveBeenNthCalledWith(
      2,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":2}',
    );
  });

  it('ignores page info that belongs to another session', () => {
    const { container } = renderListWithSession(makeMessages(2));
    dispatchPageInfo({ sessionId: 'other', fromTurn: 5, totalTurns: 8, hasMore: true });
    fireEvent.click(indicatorOf(container)!);

    expect(window.sendToJava).toHaveBeenCalledWith(
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":null}',
    );
  });

  it('stays single-flight while a page request is in flight', () => {
    const { container } = renderListWithSession(makeMessages(2));
    const indicator = indicatorOf(container)!;

    fireEvent.click(indicator);
    fireEvent.click(indicator);

    expect(window.sendToJava).toHaveBeenCalledTimes(1);
    expect(indicator.textContent).toBe('Loading earlier messages');
    expect(indicator.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(indicator);
    expect(window.sendToJava).toHaveBeenCalledTimes(1);
  });

  it('hides the button once hasMore is false', () => {
    const { container } = renderListWithSession(makeMessages(2));
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 2, totalTurns: 4, hasMore: true });
    expect(indicatorOf(container)).toBeTruthy();

    fireEvent.click(indicatorOf(container)!);
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 0, totalTurns: 4, hasMore: false });

    expect(indicatorOf(container)).toBeNull();
  });

  it('offers a retry with the same cursor after a failed page load', () => {
    const { container } = renderListWithSession(makeMessages(2));
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 2, totalTurns: 8, hasMore: true });
    const indicator = indicatorOf(container)!;

    fireEvent.click(indicator);
    dispatchPageError({ sessionId: 'session-1', message: 'boom' });
    expect(indicator.textContent).toBe('Load earlier messages failed, click to retry');

    fireEvent.click(indicator);
    expect(window.sendToJava).toHaveBeenCalledTimes(2);
    expect(window.sendToJava).toHaveBeenNthCalledWith(
      1,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":2}',
    );
    expect(window.sendToJava).toHaveBeenNthCalledWith(
      2,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":2}',
    );
  });

  it('recovers a failed request even when the error carries no session id', () => {
    const { container } = renderListWithSession(makeMessages(2));
    fireEvent.click(indicatorOf(container)!);
    dispatchPageError({ message: 'boom' });

    expect(indicatorOf(container)?.textContent).toBe('Load earlier messages failed, click to retry');
  });

  it('replaces the request cursor after a cursorReset page', () => {
    const { container } = renderListWithSession(makeMessages(2));
    dispatchPageInfo({ sessionId: 'session-1', fromTurn: 5, totalTurns: 8, hasMore: true });
    fireEvent.click(indicatorOf(container)!);

    // The stale cursor was detected server-side: the served latest page resets
    // the window, and the next request must page from the new first turn or the
    // same page would be served (and prepended) twice.
    dispatchPageInfo({
      sessionId: 'session-1',
      fromTurn: 30,
      totalTurns: 40,
      hasMore: true,
      cursorReset: true,
    });
    fireEvent.click(indicatorOf(container)!);

    expect(window.sendToJava).toHaveBeenNthCalledWith(
      1,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":5}',
    );
    expect(window.sendToJava).toHaveBeenNthCalledWith(
      2,
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":30}',
    );
  });

  it('keeps the loader hidden without a session id or without messages', () => {
    const withoutSession = renderListWithSession(makeMessages(2), null);
    expect(indicatorOf(withoutSession.container)).toBeNull();
    cleanup();

    const emptyTranscript = renderListWithSession([]);
    expect(indicatorOf(emptyTranscript.container)).toBeNull();
  });

  it('restores the pagination cursor from the window cache on remount', () => {
    window.__qwenMateHistoryPageInfo = {
      sessionId: 'session-1',
      fromTurn: 4,
      totalTurns: 8,
      hasMore: true,
    };
    const { container } = renderListWithSession(makeMessages(2));
    fireEvent.click(indicatorOf(container)!);

    expect(window.sendToJava).toHaveBeenCalledWith(
      'load_qwen_history_page:{"sessionId":"session-1","beforeTurn":4}',
    );
  });
});
