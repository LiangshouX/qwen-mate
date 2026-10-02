import { memo, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { TFunction } from 'i18next';
import type { QwenMateMessage, QwenMateContentBlock, QwenMateHistoryPageInfo, ToolResultBlock } from '../types';
import { sendToJava } from '../utils/bridge';
import { MessageItem } from './MessageItem';
import WaitingIndicator from './WaitingIndicator';
import { ContextMenu } from './ContextMenu';
import { useContextMenu, copySelection } from '../hooks/useContextMenu.js';
import { quoteToChatInput } from '../utils/quoteUtils';
import type { MessageListRevealHandle } from './ConversationSearch/types';
import {
  DETAILED_OUTPUT_ENABLED_EVENT,
  getDetailedOutputEnabled,
  type DetailedOutputEnabledChangedDetail,
} from '../utils/detailedOutputPreference';

/** Keep pagination aligned to complete user turns so assistant/tool chains are never split. */
const INITIAL_VISIBLE_TURNS = 5;
const REVEAL_TURN_PAGE_SIZE = 5;
/** Turns per disk-backed history page (mirrors the Java-side HISTORY_TURN_PAGE_LIMIT). */
const HISTORY_DISK_PAGE_SIZE = 30;

function isHumanUserMessage(message: QwenMateMessage): boolean {
  if (message.type !== 'user') return false;

  const raw = typeof message.raw === 'object' && message.raw !== null ? message.raw : null;
  const nestedMessage = raw?.message;
  const rawContent = raw?.content ?? (
    typeof nestedMessage === 'object' && nestedMessage !== null ? nestedMessage.content : undefined
  );

  if (Array.isArray(rawContent)) {
    return rawContent.some((block) => block
      && typeof block === 'object'
      && (block.type === 'text' || block.type === 'image'));
  }

  return message.content !== '[tool_result]';
}

function getFirstMessageBoundaryKey(message: QwenMateMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (typeof message.id === 'string') return `id:${message.id}`;
  if (typeof message.raw === 'object' && message.raw !== null && typeof message.raw.uuid === 'string') {
    return `uuid:${message.raw.uuid}`;
  }
  if (message.timestamp) return `timestamp:${message.type}:${message.timestamp}`;
  return `content:${message.type}:${message.content ?? ''}`;
}

function extractToolResultPreview(result: ToolResultBlock | null | undefined): string {
  if (!result) return 'pending';

  let text = '';
  if (typeof result.content === 'string') {
    text = result.content;
  } else if (Array.isArray(result.content)) {
    text = result.content
      .flatMap((item) => (item && typeof item.text === 'string' && item.text ? [item.text] : []))
      .join('\n');
  }

  const preview = text.length > 200 ? text.slice(0, 200) : text;
  return `${result.is_error === true ? 'error' : 'ok'}:${text.length}:${preview}`;
}

function getMessageToolResultSignature(
  message: QwenMateMessage,
  messageIndex: number,
  getContentBlocks: (message: QwenMateMessage) => QwenMateContentBlock[],
  findToolResult: (toolId: string | undefined, messageIndex: number) => ToolResultBlock | null | undefined,
): string {
  const toolUses = getContentBlocks(message).filter(
    (block): block is Extract<QwenMateContentBlock, { type: 'tool_use' }> => block.type === 'tool_use',
  );
  if (toolUses.length === 0) return '';

  return toolUses
    .map((block) => `${block.id ?? 'unknown'}:${extractToolResultPreview(findToolResult(block.id, messageIndex))}`)
    .join('|');
}

interface MessageListProps {
  messages: QwenMateMessage[];
  messageKeys: readonly string[];
  streamingActive: boolean;
  isThinking: boolean;
  loading: boolean;
  loadingStartTime: number | null;
  t: TFunction;
  getMessageText: (message: QwenMateMessage) => string;
  getContentBlocks: (message: QwenMateMessage) => QwenMateContentBlock[];
  findToolResult: (toolId: string | undefined, messageIndex: number) => ToolResultBlock | null | undefined;
  extractMarkdownContent: (message: QwenMateMessage) => string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onMessageNodeRef?: (id: string, node: HTMLDivElement | null) => void;
  /** Notify parent when the number of collapsed (hidden) messages changes. */
  onCollapsedCountChange?: (count: number) => void;
  onNavigateToProviderSettings?: () => void;
  onNavigateToDependencySettings?: () => void;
  /** Current active provider id; forwarded to MessageItem for streaming-connect label. */
  currentProvider?: string;
  currentSessionId?: string | null;
}

export const MessageList = memo(forwardRef<MessageListRevealHandle, MessageListProps>(function MessageList({
  messages,
  messageKeys,
  streamingActive,
  isThinking,
  loading,
  loadingStartTime,
  t,
  getMessageText,
  getContentBlocks,
  findToolResult,
  extractMarkdownContent,
  messagesEndRef,
  onMessageNodeRef,
  onCollapsedCountChange,
  onNavigateToProviderSettings,
  onNavigateToDependencySettings,
  currentProvider,
  currentSessionId,
}, ref) {
  const [revealedTurnCount, setRevealedTurnCount] = useState(0);
  const [historyPageInfo, setHistoryPageInfo] = useState<QwenMateHistoryPageInfo | null>(null);
  const [loadingEarlierHistory, setLoadingEarlierHistory] = useState(false);
  const [loadEarlierFailed, setLoadEarlierFailed] = useState(false);
  const loadingEarlierHistoryRef = useRef(false);

  // Keep the ref in sync with state. Every writer sets both; the sync lives in
  // an effect because render must stay pure (refs may not be mutated there).
  useEffect(() => {
    loadingEarlierHistoryRef.current = loadingEarlierHistory;
  }, [loadingEarlierHistory]);

  const [detailedOutputEnabled, setDetailedOutputEnabled] = useState(() =>
    getDetailedOutputEnabled()
  );

  // Context menu for message list (copy + quote, when text selected)
  const ctxMenu = useContextMenu();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMessageContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      ctxMenu.open(e);
    }
  }, [ctxMenu.open]);

  // Hotkey (Ctrl/Cmd+Shift+Q): quote the current selection when it lives inside the message list.
  useEffect(() => {
    const handleQuoteHotkey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'q' || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      const sel = window.getSelection();
      const selectedText = sel?.toString() ?? '';
      if (!selectedText.trim()) return;
      const anchor = sel?.anchorNode ?? null;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      if (!containerRef.current || !anchorElement || !containerRef.current.contains(anchorElement)) return;
      event.preventDefault();
      quoteToChatInput(selectedText);
    };
    window.addEventListener('keydown', handleQuoteHotkey);
    return () => window.removeEventListener('keydown', handleQuoteHotkey);
  }, []);

  // Session-switch reset as a render-time adjustment (React-sanctioned setState
  // during render): same resets the old prop-change effect performed, without
  // the extra commit. Identity mirrors the old logic — explicit session id
  // when available, else the first message boundary for isolated
  // callers/tests.
  const sessionIdentity = currentSessionId != null
    ? `session:${currentSessionId}`
    : `boundary:${getFirstMessageBoundaryKey(messages[0]) ?? ''}`;
  const [prevSessionIdentity, setPrevSessionIdentity] = useState(sessionIdentity);
  if (prevSessionIdentity !== sessionIdentity) {
    setPrevSessionIdentity(sessionIdentity);
    setRevealedTurnCount(0);
    setLoadingEarlierHistory(false);
    setLoadEarlierFailed(false);
    // Restore the pagination cursor from the window cache when it belongs to
    // the session taking the screen (a remount may miss the original event).
    const cached = window.__qwenMateHistoryPageInfo;
    setHistoryPageInfo(cached && cached.sessionId === currentSessionId ? cached : null);
  }

  // Disk-history pagination metadata arrives via window events dispatched by
  // the qwenMateHistoryPageInfo / qwenMateHistoryPageError bridge callbacks.
  useEffect(() => {
    const handlePageInfo = (event: Event) => {
      const info = (event as CustomEvent<QwenMateHistoryPageInfo>).detail;
      if (!info || info.sessionId !== currentSessionId) return;
      // cursorReset=true also lands here: the message transport has already
      // replaced the transcript wholesale; this swaps the cursor so the next
      // request pages from the new window's first turn instead of a stale one.
      setHistoryPageInfo(info);
      setLoadEarlierFailed(false);
      setLoadingEarlierHistory(false);
      loadingEarlierHistoryRef.current = false;
    };
    const handlePageError = (event: Event) => {
      const error = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!error?.sessionId || error.sessionId === currentSessionId) {
        // Keep historyPageInfo untouched so a retry re-sends the same cursor.
        setLoadingEarlierHistory(false);
        loadingEarlierHistoryRef.current = false;
        setLoadEarlierFailed(true);
      }
    };
    window.addEventListener('qwen-history-page-info', handlePageInfo);
    window.addEventListener('qwen-history-page-error', handlePageError);
    const cached = window.__qwenMateHistoryPageInfo;
    if (cached && cached.sessionId === currentSessionId) {
      setHistoryPageInfo(cached);
    }
    return () => {
      window.removeEventListener('qwen-history-page-info', handlePageInfo);
      window.removeEventListener('qwen-history-page-error', handlePageError);
    };
  }, [currentSessionId]);

  const userTurnStartIndexes = useMemo(
    () => messages.reduce<number[]>((indexes, message, index) => {
      if (isHumanUserMessage(message)) indexes.push(index);
      return indexes;
    }, []),
    [messages],
  );
  const visibleTurnCount = Math.min(
    userTurnStartIndexes.length,
    INITIAL_VISIBLE_TURNS + revealedTurnCount,
  );
  const hiddenTurnCount = userTurnStartIndexes.length - visibleTurnCount;
  const collapsedCount = hiddenTurnCount > 0 ? userTurnStartIndexes[hiddenTurnCount] : 0;
  const shouldCollapse = collapsedCount > 0;
  const nextTurnCount = Math.min(REVEAL_TURN_PAGE_SIZE, hiddenTurnCount);

  // Disk pagination: hidden once the transcript provably starts at the
  // session's first turn (hasMore=false), available while earlier turns may
  // still exist — including when no page info has arrived yet, where the first
  // request has no turn cursor and asks for the latest page (beforeTurn=null).
  const canLoadEarlierFromDisk = Boolean(currentSessionId)
    && messages.length > 0
    && (historyPageInfo == null || historyPageInfo.hasMore);

  const handleLoadEarlierFromDisk = useCallback(() => {
    if (loadingEarlierHistoryRef.current || !currentSessionId) return;
    loadingEarlierHistoryRef.current = true;
    setLoadingEarlierHistory(true);
    setLoadEarlierFailed(false);
    const sent = sendToJava('load_qwen_history_page', {
      sessionId: currentSessionId,
      beforeTurn: historyPageInfo?.fromTurn ?? null,
    });
    if (!sent) {
      loadingEarlierHistoryRef.current = false;
      setLoadingEarlierHistory(false);
      setLoadEarlierFailed(true);
    }
  }, [currentSessionId, historyPageInfo]);

  const handleRevealMore = useCallback(() => {
    if (loadingEarlierHistoryRef.current) return;
    if (hiddenTurnCount > 0) {
      setRevealedTurnCount((prev) => prev + REVEAL_TURN_PAGE_SIZE);
      return;
    }
    if (!canLoadEarlierFromDisk) return;
    handleLoadEarlierFromDisk();
  }, [canLoadEarlierFromDisk, handleLoadEarlierFromDisk, hiddenTurnCount]);

  // Imperative API so the in-page search can expand everything before scanning.
  // Returns the number of messages that were just revealed (0 when nothing
  // was collapsed). This lets the search panel surface "Expanded N earlier
  // messages" exactly once per panel-open, per the agreed design.
  useImperativeHandle(ref, (): MessageListRevealHandle => ({
    revealAll: () => {
      const previouslyHidden = collapsedCount;
      if (previouslyHidden === 0) return 0;
      setRevealedTurnCount(userTurnStartIndexes.length);
      return previouslyHidden;
    },
  }), [collapsedCount, userTurnStartIndexes.length]);

  // Notify parent of collapsed count changes (for anchor rail sync)
  useLayoutEffect(() => {
    onCollapsedCountChange?.(collapsedCount);
  }, [collapsedCount, onCollapsedCountChange]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<DetailedOutputEnabledChangedDetail>;
      if (custom.detail && typeof custom.detail.enabled === 'boolean') {
        setDetailedOutputEnabled(custom.detail.enabled);
      }
    };
    window.addEventListener(DETAILED_OUTPUT_ENABLED_EVENT, handler);
    return () => window.removeEventListener(DETAILED_OUTPUT_ENABLED_EVENT, handler);
  }, []);

  const visibleMessages = useMemo(
    () => (shouldCollapse ? messages.slice(collapsedCount) : messages),
    [messages, shouldCollapse, collapsedCount]
  );
  return (
    <div ref={containerRef} onContextMenu={handleMessageContextMenu}>
      {ctxMenu.visible && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={ctxMenu.close}
          items={[
            { label: t('contextMenu.quote', 'Quote'), action: () => quoteToChatInput(ctxMenu.selectedText) },
            { label: t('contextMenu.copy', 'Copy'), action: () => copySelection(ctxMenu.savedRange, ctxMenu.selectedText) },
          ]}
        />
      )}
      {(shouldCollapse || canLoadEarlierFromDisk) && (
        <div
          className="collapsed-messages-indicator"
          onClick={handleRevealMore}
          role="button"
          tabIndex={0}
          aria-disabled={loadingEarlierHistory}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleRevealMore();
            }
          }}
        >
          {loadingEarlierHistory
            ? t('chat.loadingEarlierTurns', { defaultValue: '正在加载更早消息…' })
            : shouldCollapse
              ? t('chat.showEarlierTurns', {
                count: nextTurnCount,
                remaining: hiddenTurnCount,
              })
              : loadEarlierFailed
                ? t('chat.loadEarlierTurnsFailed', {
                  defaultValue: '加载更早消息失败，点击重试',
                })
                : t('chat.loadEarlierTurns', {
                  defaultValue: '加载更早消息',
                  count: Math.min(HISTORY_DISK_PAGE_SIZE, historyPageInfo?.fromTurn ?? 0),
                  remaining: historyPageInfo?.fromTurn ?? 0,
                  total: historyPageInfo?.totalTurns ?? 0,
                })}
        </div>
      )}

      {visibleMessages.map((message, visibleIndex) => {
        const messageIndex = shouldCollapse ? visibleIndex + collapsedCount : visibleIndex;
        const messageKey = messageKeys[messageIndex];
        const toolResultSignature = getMessageToolResultSignature(message, messageIndex, getContentBlocks, findToolResult);

        return (
          <MessageItem
            key={messageKey}
            message={message}
            messageIndex={messageIndex}
            messageKey={messageKey}
            isLast={messageIndex === messages.length - 1}
            streamingActive={streamingActive}
            isThinking={isThinking}
            t={t}
            getMessageText={getMessageText}
            getContentBlocks={getContentBlocks}
            findToolResult={findToolResult}
            extractMarkdownContent={extractMarkdownContent}
            onNodeRef={onMessageNodeRef}
            onNavigateToProviderSettings={onNavigateToProviderSettings}
            onNavigateToDependencySettings={onNavigateToDependencySettings}
            toolResultSignature={toolResultSignature}
            currentProvider={currentProvider}
            detailedOutputEnabled={detailedOutputEnabled}
          />
        );
      })}

      {/* Loading indicator */}
      {loading && <WaitingIndicator startTime={loadingStartTime ?? undefined} />}
      <div ref={messagesEndRef} />
    </div>
  );
}));
