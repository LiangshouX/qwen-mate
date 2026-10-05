import { type RefObject, useCallback, useMemo, useRef } from 'react';
import type { TFunction } from 'i18next';
import type {
  QwenMateContentBlock,
  QwenMateMessage,
  QwenMateRawMessage,
  SubagentHistoryResponse,
  TodoItem,
  ToolResultBlock,
} from '../types';
import type { GetToolResultRawFn } from '../contexts/SubagentContext';
import type { RestoredSessionTitle } from '../contexts/SessionContext';
import {
  containsAnyTag,
  hasTaskNotificationTag,
  INTERNAL_METADATA_TAGS,
} from '../utils/messageUtils';
import { extractTodosFromToolUse, extractAccumulatedTasks } from '../utils/todoToolNormalization';
import {
  computeStatusScopeMessages,
  finalizeSubagentsForSettledTurn,
  finalizeTodosForSettledTurn,
  isToolResultOnlyUserMessage,
  sliceLatestConversationTurn,
} from '../utils/turnScope';
import { extractSubagentsFromMessages, useSubagents } from './useSubagents';
import { useFileChanges } from './useFileChanges';
import { useFileChangesManagement } from './useFileChangesManagement';
import type { useMessageProcessing } from './useMessageProcessing';

interface UseChatComputationsParams {
  t: TFunction;
  messages: QwenMateMessage[];
  subagentHistories: Record<string, SubagentHistoryResponse>;
  customSessionTitle: string | null;
  restoredSessionTitle: RestoredSessionTitle | null;
  streamingActive: boolean;
  currentProvider: string;
  currentSessionId: string | null;
  currentSessionIdRef: RefObject<string | null>;
  getMessageText: ReturnType<typeof useMessageProcessing>['getMessageText'];
  getContentBlocks: ReturnType<typeof useMessageProcessing>['getContentBlocks'];
}

/**
 * Whether a message slice contains any assistant tool_use block. Used to decide
 * whether the latest-turn scope is carrying active tool work worth focusing on,
 * or is empty of tools (a reload snapshot / text-only turn) and should widen to
 * the full conversation so StatusPanel lists do not disappear.
 */
function sliceHasToolUse(
  messages: QwenMateMessage[],
  getContentBlocks: (message: QwenMateMessage) => QwenMateContentBlock[],
): boolean {
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    const blocks = getContentBlocks(message);
    for (const block of blocks) {
      if (block.type === 'tool_use') return true;
    }
  }
  return false;
}

/**
 * Resolve the title shown in the session header, in priority order: a
 * user-set custom title, the CLI-derived title carried by a history page,
 * then the first real prompt among the loaded messages. The CLI title matters
 * for paginated history: a page may not span the session's first prompt, so
 * prompt-derivation alone would surface a mid-conversation row.
 */
export function deriveSessionTitle(params: {
  customSessionTitle: string | null;
  restoredSessionTitle: RestoredSessionTitle | null;
  currentSessionId: string | null;
  messages: QwenMateMessage[];
  fallbackTitle: string;
  getMessageText: (message: QwenMateMessage) => string;
}): string {
  const {
    customSessionTitle,
    restoredSessionTitle,
    currentSessionId,
    messages,
    fallbackTitle,
    getMessageText,
  } = params;
  if (customSessionTitle) return customSessionTitle;
  // Only a title keyed to the session on screen may show; a stale entry from a
  // previously opened session falls through to the message-derived title.
  if (restoredSessionTitle && restoredSessionTitle.sessionId === currentSessionId) {
    return restoredSessionTitle.title;
  }
  if (messages.length === 0) return fallbackTitle;
  // Pick the first REAL prompt: skip meta/caveat messages and anything whose
  // text is raw internal XML (e.g. <local-command-caveat>) so the tag is
  // never leaked as the session title.
  let text = '';
  for (const message of messages) {
    if (message.type !== 'user') continue;
    const raw = message.raw;
    if (raw && typeof raw === 'object' && raw.isMeta === true) continue;
    // Tool-result carriers are CLI-injected rows, not user input; a paginated
    // page can start with one, and it must never become the session title.
    if (isToolResultOnlyUserMessage(message)) continue;
    const candidate = getMessageText(message).trim();
    if (!candidate) continue;
    if (candidate.startsWith('<')) continue;
    if (containsAnyTag(candidate, INTERNAL_METADATA_TAGS) || hasTaskNotificationTag(candidate)) continue;
    text = candidate;
    break;
  }
  if (!text) return fallbackTitle;
  return text.length > 15 ? `${text.substring(0, 15)}...` : text;
}

export function deriveTodosForTurn(
  turnMessages: QwenMateMessage[],
  getContentBlocks: (message: QwenMateMessage) => QwenMateContentBlock[],
  streamingActive: boolean,
  currentProvider: string,
): TodoItem[] {
  const scopedMessages = turnMessages;
  let latestTodos: ReturnType<typeof extractTodosFromToolUse> = null;
  let sawEmptyClaudeSnapshot = false;
  for (let i = scopedMessages.length - 1; i >= 0; i--) {
    const msg = scopedMessages[i];
    if (msg.type !== 'assistant') continue;
    const blocks = getContentBlocks(msg);
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      const todos = extractTodosFromToolUse(block);
      const input = block.type === 'tool_use' ? block.input : undefined;
      const isExplicitEmptySnapshot = Boolean(input) && (
        (Array.isArray(input?.todos) && input.todos.length === 0)
        || (Array.isArray(input?.plan) && input.plan.length === 0)
      );
      if (todos && todos.length > 0) {
        latestTodos = todos;
        break;
      }
      if (todos && isExplicitEmptySnapshot) {
        sawEmptyClaudeSnapshot = true;
      }
    }
    if (latestTodos) break;
  }

  const accumulatedTasks = sawEmptyClaudeSnapshot
    ? extractAccumulatedTasks(scopedMessages, getContentBlocks)
    : null;
  if (accumulatedTasks && accumulatedTasks.length > 0) {
    return accumulatedTasks;
  }

  if (latestTodos !== null) {
    return finalizeTodosForSettledTurn(latestTodos, streamingActive, currentProvider);
  }

  return accumulatedTasks ?? extractAccumulatedTasks(scopedMessages, getContentBlocks);
}

/**
 * Bundles all chat-view derived computations: tool result lookup table,
 * subagent extraction, todos, file change filtering, and session title.
 *
 * Stage 5 of TASK-P1-01 — moves ~120 lines of computation out of App.tsx.
 */
export function useChatComputations({
  t,
  messages,
  subagentHistories,
  customSessionTitle,
  restoredSessionTitle,
  streamingActive,
  currentProvider,
  currentSessionId,
  currentSessionIdRef,
  getMessageText,
  getContentBlocks,
}: UseChatComputationsParams) {
  // Scan over messages for tool_result blocks, with a per-id ref-backed cache.
  const toolResultRawMapRef = useRef<Map<string, QwenMateRawMessage>>(new Map());

  const findToolResult = useCallback((toolUseId?: string, messageIndex?: number): ToolResultBlock | null => {
    if (!toolUseId || typeof messageIndex !== 'number') return null;
    const currentMessages = messages;
    const cachedRaw = toolResultRawMapRef.current.get(toolUseId);
    if (cachedRaw != null) {
      const content = cachedRaw.content ?? cachedRaw.message?.content;
      if (Array.isArray(content)) {
        const hit = content.find(
          (block): block is ToolResultBlock =>
            Boolean(block) && block.type === 'tool_result' && block.tool_use_id === toolUseId,
        );
        if (hit) return hit;
      }
    }
    for (let i = 0; i < currentMessages.length; i += 1) {
      const candidate = currentMessages[i];
      const raw = candidate.raw;
      if (!raw || typeof raw === 'string') continue;
      const content = raw.content ?? raw.message?.content;
      if (!Array.isArray(content)) continue;
      const resultBlock = content.find(
        (block): block is ToolResultBlock =>
          Boolean(block) && block.type === 'tool_result' && block.tool_use_id === toolUseId,
      );
      if (resultBlock) {
        toolResultRawMapRef.current.set(toolUseId, raw);
        return resultBlock;
      }
    }
    return null;
  }, [messages]);

  const getToolResultRaw = useCallback<GetToolResultRawFn>(
    (toolUseId: string) => toolResultRawMapRef.current.get(toolUseId) ?? null,
    [],
  );

  // File changes (depend on findToolResult which is now stable above).
  const fileChangeMgmt = useFileChangesManagement({
    currentSessionId, currentSessionIdRef, messages,
    getContentBlocks, findToolResult,
  });
  const fileChanges = useFileChanges({
    messages, getContentBlocks, findToolResult,
    startFromIndex: fileChangeMgmt.baseMessageIndex,
    // Sidechain Edit/Write from Agent/Task tools must appear in the Edits tab too
    subagentHistories,
    currentSessionId,
  });

  const filteredFileChanges = useMemo(() => {
    if (fileChangeMgmt.processedFiles.length === 0) return fileChanges;
    return fileChanges.filter((fc) => !fileChangeMgmt.processedFiles.includes(fc.filePath));
  }, [fileChanges, fileChangeMgmt.processedFiles]);

  const latestTurnMessages = useMemo(() => sliceLatestConversationTurn(messages), [messages]);

  // A run_in_background agent outlives the turn that launched it: the main turn
  // settles while the sidechain keeps running, and its terminal report arrives
  // as a later turn's task-notification user message. The turn-scoped narrowing
  // below exists to focus sync tool progress on the current turn; if the
  // session contains any async agent, narrowing would drop the agent's card
  // from StatusPanel while the user waits for it to return — the reported
  // "subagent list disappears after the session ends" symptom. Keep the full
  // conversation in scope in that case. The check reuses the same extraction
  // as the list itself (isAsyncAgentInput on the raw tool input) so the two
  // can never disagree.
  const asyncAgentPresence = useMemo(
    () => extractSubagentsFromMessages(messages, getContentBlocks, findToolResult, getToolResultRaw, {})
      .some((subagent) => subagent.isAsync === true),
    [messages, getContentBlocks, findToolResult, getToolResultRaw],
  );

  // While streaming, focus on the current turn's task progress; once settled
  // (history replay or idle), widen the scope to the whole conversation -
  // otherwise a multi-turn history session whose last turn has no task tool
  // would lose its task and subagent lists entirely.
  //
  // Exception: if the latest-turn slice carries no tool_use at all (e.g. a
  // same-session reload snapshot whose latest turn predates the active work, or
  // a text-only turn), widen to the full conversation. Without this, the
  // StatusPanel subagent list can briefly disappear when a deferred
  // reload's message refresh lands at the frontend a moment before the
  // stream-end signal flips streamingActive back to false. Widening only adds
  // content (earlier turns' settled items) - it never drops the current turn's.
  // A session with any async agent likewise never narrows (see asyncAgentPresence).
  const statusScopeMessages = useMemo(() => {
    const latestTurnHasToolUse = latestTurnMessages.length > 0 && sliceHasToolUse(latestTurnMessages, getContentBlocks);
    return computeStatusScopeMessages(streamingActive, asyncAgentPresence, latestTurnMessages, messages, latestTurnHasToolUse);
  }, [streamingActive, asyncAgentPresence, latestTurnMessages, messages, getContentBlocks]);

  // Plans belong to the current user turn while streaming. Unlike subagents,
  // a text-only new turn must not temporarily revive a previous turn's plan.
  // Settled/history views scan the full transcript.
  const todoScopeMessages = streamingActive ? latestTurnMessages : messages;

  const extractedSubagents = useSubagents({
    messages: statusScopeMessages,
    getContentBlocks,
    findToolResult,
    getToolResultRaw,
    subagentHistories,
  });

  const subagents = useMemo(
    () => finalizeSubagentsForSettledTurn(extractedSubagents, streamingActive),
    [extractedSubagents, streamingActive],
  );

  const globalTodos = useMemo(() => {
    return deriveTodosForTurn(todoScopeMessages, getContentBlocks, streamingActive, currentProvider);
  }, [todoScopeMessages, getContentBlocks, streamingActive, currentProvider]);

  const sessionTitle = useMemo(() => deriveSessionTitle({
    customSessionTitle,
    restoredSessionTitle,
    currentSessionId,
    messages,
    fallbackTitle: t('common.newSession'),
    getMessageText,
  }), [customSessionTitle, restoredSessionTitle, currentSessionId, messages, t, getMessageText]);

  return {
    findToolResult,
    getToolResultRaw,
    fileChangeMgmt,
    filteredFileChanges,
    subagents,
    globalTodos,
    sessionTitle,
  };
}
