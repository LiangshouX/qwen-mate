/**
 * messageCallbacks.test.ts
 *
 * Disk history pagination routing and page-delivery contract:
 * - the CLI-derived title is stored even when the page info arrives before the
 *   webview learns its session id (Java-driven auto-restore), because the entry
 *   is keyed by session and re-validated when read;
 * - the pagination cache and the dispatched event stay scoped to the session on
 *   screen, so a stale page info cannot drive the earlier-page loader;
 * - page messages ride the standard updateMessages / updateMessageTail
 *   transport (the Java side prepends — or replaces on cursorReset — before it
 *   snapshots the session), so the transcript must land with earlier messages
 *   first on a prepend and be replaced wholesale on a cursorReset, while the
 *   __messageBaseIndex tail merge keeps working afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerMessageCallbacks } from './messageCallbacks';
import type { UseWindowCallbacksOptions } from '../../useWindowCallbacks';
import type { QwenMateMessage } from '../../../types';

const ref = <T,>(value: T) => ({ current: value });

interface StoredTitle {
  sessionId: string;
  title: string;
}

const msg = (type: QwenMateMessage['type'], content: string): QwenMateMessage =>
  ({ type, content, timestamp: `2026-09-30T10:00:${content.length.toString().padStart(2, '0')}.000Z` }) as QwenMateMessage;

function createHarness(currentSessionId: string | null) {
  const storedTitles: Array<StoredTitle | null> = [];
  const addToast = vi.fn();
  let messages: QwenMateMessage[] = [];

  const options = {
    addToast,
    setMessages: (update: unknown) => {
      messages = typeof update === 'function'
        ? (update as (prev: QwenMateMessage[]) => QwenMateMessage[])(messages)
        : (update as QwenMateMessage[]);
    },
    setStatus: () => {},
    setLoading: () => {},
    setLoadingStartTime: () => {},
    setIsThinking: () => {},
    setHistoryData: () => {},
    userPausedRef: ref(false),
    isUserAtBottomRef: ref(true),
    messagesContainerRef: ref(null),
    suppressNextStatusToastRef: ref(false),
    streamingContentRef: ref(''),
    isStreamingRef: ref(false),
    useBackendStreamingRenderRef: ref(false),
    streamingMessageIndexRef: ref(-1),
    streamingTurnIdRef: ref(-1),
    findLastAssistantIndex: () => -1,
    extractRawBlocks: () => [],
    patchAssistantForStreaming: (message: unknown) => message,
    updateContextUsageData: () => {},
    closeContextUsageDialog: () => {},
    currentProviderRef: ref('qwen'),
    currentSessionIdRef: ref(currentSessionId),
    // Mirrors React's functional-update contract so the no-op identity branch
    // can be asserted through reference equality.
    setRestoredSessionTitle: (updater: unknown) => {
      const prev = storedTitles.length > 0 ? storedTitles[storedTitles.length - 1] : null;
      const next = typeof updater === 'function'
        ? (updater as (previous: StoredTitle | null) => StoredTitle | null)(prev)
        : updater;
      storedTitles.push(next as StoredTitle | null);
    },
  } as unknown as UseWindowCallbacksOptions;

  registerMessageCallbacks(options, () => {}, () => {});
  const dispatch = window.qwenMateHistoryPageInfo;
  if (!dispatch) throw new Error('qwenMateHistoryPageInfo was not registered');
  return { storedTitles, addToast, dispatch, getMessages: () => messages };
}

const pageInfo = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: 's1',
  fromTurn: 0,
  totalTurns: 4,
  hasMore: true,
  cursorReset: false,
  sessionTitle: 'CLI title',
  ...overrides,
});

describe('qwenMateHistoryPageInfo', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__qwenMateHistoryPageInfo;
    delete (window as unknown as Record<string, unknown>).__pendingQwenMateHistoryPageInfo;
    delete (window as unknown as Record<string, unknown>).__pendingQwenMateHistoryPageError;
  });

  it('stores the CLI title even when the session id is not synced yet', () => {
    const harness = createHarness(null);
    harness.dispatch(pageInfo());

    expect(harness.storedTitles.at(-1)).toEqual({ sessionId: 's1', title: 'CLI title' });
    // Pagination state still waits for the session to be on screen.
    expect(window.__qwenMateHistoryPageInfo).toBeUndefined();
  });

  it('caches pagination state and notifies listeners for the on-screen session', () => {
    const harness = createHarness('s1');
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('qwen-history-page-info', listener);
    harness.dispatch(pageInfo({ fromTurn: 2, totalTurns: 8 }));
    window.removeEventListener('qwen-history-page-info', listener);

    expect(harness.storedTitles.at(-1)).toEqual({ sessionId: 's1', title: 'CLI title' });
    expect(window.__qwenMateHistoryPageInfo?.sessionId).toBe('s1');
    expect(window.__qwenMateHistoryPageInfo?.fromTurn).toBe(2);
    expect(window.__qwenMateHistoryPageInfo?.hasMore).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('keeps the stored title stable when an earlier page repeats the same title', () => {
    const harness = createHarness('s1');
    harness.dispatch(pageInfo());
    const first = harness.storedTitles.at(-1);
    harness.dispatch(pageInfo({ fromTurn: 0, toTurn: 2, totalTurns: 8 }));
    const second = harness.storedTitles.at(-1);

    // Same session and title must keep the previous object so SessionContext
    // consumers do not re-render on every earlier-page load.
    expect(second).toBe(first);
  });

  it('drops pagination state for a session that is not on screen', () => {
    const harness = createHarness('other');
    harness.dispatch(pageInfo({ hasMore: false }));
    expect(window.__qwenMateHistoryPageInfo).toBeUndefined();
  });

  it('replaces the cached cursor on cursorReset so the next request cannot re-serve a page', () => {
    const harness = createHarness('s1');
    harness.dispatch(pageInfo({ fromTurn: 2, totalTurns: 8, cursorReset: false }));
    harness.dispatch(pageInfo({ fromTurn: 6, totalTurns: 8, cursorReset: true }));

    expect(window.__qwenMateHistoryPageInfo?.fromTurn).toBe(6);
    expect(window.__qwenMateHistoryPageInfo?.cursorReset).toBe(true);
  });

  it('drains page info buffered before callback registration', () => {
    window.__pendingQwenMateHistoryPageInfo = { json: pageInfo({ fromTurn: 4 }) };
    const harness = createHarness('s1');

    expect(window.__pendingQwenMateHistoryPageInfo).toBeUndefined();
    expect(window.__qwenMateHistoryPageInfo?.fromTurn).toBe(4);
    expect(harness.storedTitles.at(-1)).toEqual({ sessionId: 's1', title: 'CLI title' });
  });
});

describe('qwenMateHistoryPageError', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__qwenMateHistoryPageInfo;
  });

  it('dispatches the failure and surfaces a toast for the on-screen session', () => {
    const harness = createHarness('s1');
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('qwen-history-page-error', listener);
    window.qwenMateHistoryPageError!(JSON.stringify({ sessionId: 's1', message: 'boom' }));
    window.removeEventListener('qwen-history-page-error', listener);

    expect(seen).toHaveLength(1);
    expect(harness.addToast).toHaveBeenCalledWith('boom', 'error');
  });

  it('drops failures for a session that is not on screen', () => {
    const harness = createHarness('s1');
    window.qwenMateHistoryPageError!(JSON.stringify({ sessionId: 'other', message: 'boom' }));

    expect(harness.addToast).not.toHaveBeenCalled();
  });
});

describe('history page delivery over the message transport', () => {
  beforeEach(() => {
    window.__sessionTransitioning = false;
    window.__minAcceptedUpdateSequence = 0;
    window.__messageBaseIndex = 0;
    delete (window as unknown as Record<string, unknown>).__qwenMateHistoryPageInfo;
    delete (window as unknown as Record<string, unknown>).__pendingQwenMateHistoryPageInfo;
    delete (window as unknown as Record<string, unknown>).__pendingQwenMateHistoryPageError;
  });

  it('keeps earlier messages in front after a prepended page and keeps tail merges aligned', () => {
    const harness = createHarness('s1');

    // Current window (turn 2), then Java prepends the earlier page and pushes
    // the full snapshot through the standard transport.
    window.updateMessages!(JSON.stringify([msg('user', 'u2'), msg('assistant', 'a2')]), 1);
    window.updateMessages!(JSON.stringify([
      msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2'), msg('assistant', 'a2'),
    ]), 2);

    expect(harness.getMessages().map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(window.__messageBaseIndex).toBe(0);

    // Subsequent tail updates must still land after the prepended window.
    window.updateMessageTail!(JSON.stringify([msg('user', 'u3'), msg('assistant', 'a3')]), 4, 3);

    expect(harness.getMessages().map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(window.__messageBaseIndex).toBe(0);
  });

  it('replaces the transcript wholesale on cursorReset without duplicating the visible tail', () => {
    const harness = createHarness('s1');

    window.updateMessages!(JSON.stringify([
      msg('user', 'u1'), msg('assistant', 'a1'),
      msg('user', 'u2'), msg('assistant', 'a2'),
      msg('user', 'u3'), msg('assistant', 'a3'),
    ]), 1);

    // The requested cursor went stale; Java serves the latest page and the
    // frontend must show exactly it — never the old window plus the page.
    window.updateMessages!(JSON.stringify([
      msg('user', 'u3'), msg('assistant', 'a3'),
      msg('user', 'u4'), msg('assistant', 'a4'),
    ]), 2);
    window.qwenMateHistoryPageInfo!(pageInfo({ fromTurn: 2, toTurn: 4, totalTurns: 4, cursorReset: true }));

    expect(harness.getMessages().map((m) => m.content)).toEqual(['u3', 'a3', 'u4', 'a4']);
    expect(window.__qwenMateHistoryPageInfo?.cursorReset).toBe(true);
    expect(window.__qwenMateHistoryPageInfo?.fromTurn).toBe(2);
  });

  it('clearMessages drops the cached pagination cursor with the transcript', () => {
    createHarness('s1');
    window.qwenMateHistoryPageInfo!(pageInfo({ fromTurn: 2 }));

    window.clearMessages!();

    expect(window.__qwenMateHistoryPageInfo).toBeUndefined();
  });
});
