import { describe, expect, it } from 'vitest';
import type { QwenMateContentBlock, QwenMateMessage } from '../types';
import { sliceLatestConversationTurn } from '../utils/turnScope';
import { deriveSessionTitle, deriveTodosForTurn } from './useChatComputations';

interface TestMessage extends QwenMateMessage {
  __blocks?: QwenMateContentBlock[];
}

const getContentBlocks = (message: QwenMateMessage): QwenMateContentBlock[] =>
  (message as TestMessage).__blocks ?? [];

const user = (content: string): QwenMateMessage => ({ type: 'user', content });

const assistant = (blocks: QwenMateContentBlock[]): QwenMateMessage =>
  ({ type: 'assistant', __blocks: blocks }) as TestMessage;

const toolUse = (id: string, name: string, input: Record<string, unknown>): QwenMateContentBlock =>
  ({ type: 'tool_use', id, name, input });

describe('deriveTodosForTurn', () => {
  it('does not carry a completed plan into a new user turn', () => {
    const messages = [
      user('previous request'),
      assistant([
        toolUse('plan-1', 'update_plan', {
          plan: Array.from({ length: 5 }, (_, index) => ({
            step: `Previous step ${index + 1}`,
            status: 'completed',
          })),
        }),
      ]),
      user('Only answer OK'),
    ];

    const latestTurn = sliceLatestConversationTurn(messages);
    expect(deriveTodosForTurn(latestTurn, getContentBlocks, true, 'qwen')).toEqual([]);
  });

  it('shows the latest plan created in the current turn', () => {
    const messages = [
      user('previous request'),
      assistant([toolUse('old-plan', 'update_plan', {
        plan: [{ step: 'Old step', status: 'completed' }],
      })]),
      user('new request'),
      assistant([toolUse('new-plan', 'update_plan', {
        plan: [
          { step: 'First', status: 'in_progress' },
          { step: 'Second', status: 'pending' },
          { step: 'Third', status: 'pending' },
        ],
      })]),
    ];

    const latestTurn = sliceLatestConversationTurn(messages);
    expect(deriveTodosForTurn(latestTurn, getContentBlocks, true, 'qwen')).toEqual([
      { content: 'First', status: 'in_progress' },
      { content: 'Second', status: 'pending' },
      { content: 'Third', status: 'pending' },
    ]);
  });

  it('does not carry completed structured tasks into a new user turn', () => {
    const messages = [
      user('previous request'),
      assistant([toolUse('task-create-1', 'TaskCreate', { subject: 'Previous task' })]),
      {
        type: 'user',
        raw: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'task-create-1',
            content: 'Task #1 created successfully',
          }],
        },
      } as QwenMateMessage,
      assistant([toolUse('task-update-1', 'TaskUpdate', { taskId: '1', status: 'completed' })]),
      user('Only answer OK'),
    ];

    const latestTurn = sliceLatestConversationTurn(messages);
    expect(deriveTodosForTurn(latestTurn, getContentBlocks, true, 'qwen')).toEqual([]);
  });

  it('keeps earlier todos when the full transcript is scoped (settled history replay)', () => {
    // Non-streaming scope feeds the WHOLE transcript to deriveTodosForTurn, so an
    // earlier turn's plan survives even when the last turn has no task tool —
    // exactly what a resumed history session needs to render its task list.
    const messages = [
      user('previous request'),
      assistant([toolUse('old-plan', 'update_plan', {
        plan: [
          { step: 'Kept step', status: 'completed' },
          { step: 'In-flight step', status: 'in_progress' },
        ],
      })]),
      user('Only answer OK'),
    ];

    expect(deriveTodosForTurn(messages, getContentBlocks, false, 'qwen')).toEqual([
      { content: 'Kept step', status: 'completed' },
      { content: 'In-flight step', status: 'completed' },
    ]);
  });

  it('lets structured tasks survive an empty TodoWrite snapshot', () => {
    const messages = [
      user('implement the fix'),
      assistant([toolUse('legacy-todos', 'TodoWrite', {
        todos: [{ content: 'Legacy task', status: 'in_progress' }],
      })]),
      assistant([toolUse('task-create-1', 'TaskCreate', { subject: 'Review implementation' })]),
      {
        type: 'user',
        raw: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'task-create-1',
            content: 'Task #1 created successfully',
          }],
        },
      } as QwenMateMessage,
      assistant([toolUse('empty-todos', 'TodoWrite', { todos: [] })]),
    ];

    expect(deriveTodosForTurn(messages, getContentBlocks, false, 'qwen')).toEqual([
      { id: '1', content: 'Review implementation', status: 'pending' },
    ]);
  });
});

describe('deriveSessionTitle', () => {
  const messageText = (message: QwenMateMessage) => message.content ?? '';
  const derive = (overrides: Partial<Parameters<typeof deriveSessionTitle>[0]> = {}) => deriveSessionTitle({
    customSessionTitle: null,
    restoredSessionTitle: null,
    currentSessionId: null,
    messages: [],
    fallbackTitle: 'New Session',
    getMessageText: messageText,
    ...overrides,
  });

  it('prefers a user-set custom title over every other source', () => {
    expect(derive({
      customSessionTitle: 'Renamed by hand',
      restoredSessionTitle: { sessionId: 's1', title: 'CLI title' },
      currentSessionId: 's1',
      messages: [user('first prompt')],
    })).toBe('Renamed by hand');
  });

  it('prefers the CLI title of the session on screen over prompt derivation', () => {
    expect(derive({
      restoredSessionTitle: { sessionId: 's1', title: 'CLI title' },
      currentSessionId: 's1',
      messages: [user('mid-conversation prompt')],
    })).toBe('CLI title');
  });

  it('ignores a CLI title belonging to another session', () => {
    expect(derive({
      restoredSessionTitle: { sessionId: 'other', title: 'CLI title' },
      currentSessionId: 's1',
      messages: [user('first prompt')],
    })).toBe('first prompt');
  });

  it('falls back to the new-session label when nothing can title the session', () => {
    expect(derive({ messages: [{ type: 'assistant', content: 'hi' }] })).toBe('New Session');
  });

  it('skips tool-result carriers so a paginated page never titles from a tool row', () => {
    // The carrier's rendered text is not the "[tool_result]" marker, so only the
    // raw block type identifies it.
    const carrier: QwenMateMessage = {
      type: 'user',
      content: 'Bash tool output preview',
      raw: { message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    };
    expect(derive({ messages: [carrier, user('real prompt')] })).toBe('real prompt');
  });

  it('skips meta rows and internal XML wrappers', () => {
    expect(derive({
      messages: [
        { type: 'user', content: 'caveat', raw: { isMeta: true } } as QwenMateMessage,
        user('<local-command-caveat>noise</local-command-caveat>'),
        user('real prompt'),
      ],
    })).toBe('real prompt');
  });

  it('truncates a long prompt to the header budget', () => {
    expect(derive({ messages: [user('abcdefghijklmnopqrstuvwxyz')] })).toBe('abcdefghijklmno...');
  });
});
