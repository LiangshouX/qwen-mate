import { describe, expect, it } from 'vitest';
import {
  computeStatusScopeMessages,
  finalizeTodosForSettledTurn,
  selectLatestSubagentTurn,
} from './turnScope';
import type { QwenMateMessage, SubagentInfo, TodoItem } from '../types';

const userMsg = (content: string): QwenMateMessage => ({ type: 'user', content });
const assistantMsg = (): QwenMateMessage => ({ type: 'assistant', content: 'ok' });

describe('computeStatusScopeMessages', () => {
  it('uses the full conversation when not streaming', () => {
    const messages = [userMsg('a'), assistantMsg()];
    expect(computeStatusScopeMessages(false, false, [], messages, false)).toBe(messages);
    expect(computeStatusScopeMessages(false, true, [], messages, true)).toBe(messages);
  });

  it('keeps the full conversation while streaming when async agents are present', () => {
    // The reported symptom: a run_in_background agent started in an earlier turn
    // keeps running after the main turn settles; a later turn (agent report /
    // new user request) starts streaming and narrowing would drop its card.
    const messages = [userMsg('a'), assistantMsg()];
    const latest = [userMsg('b'), assistantMsg()];
    expect(computeStatusScopeMessages(true, true, latest, messages, true)).toBe(messages);
    expect(computeStatusScopeMessages(true, true, [], messages, false)).toBe(messages);
  });

  it('narrows to the latest turn while streaming, no async agents, with tool use', () => {
    const latest = [userMsg('b'), assistantMsg()];
    const messages = [userMsg('a'), assistantMsg(), ...latest];
    expect(computeStatusScopeMessages(true, false, latest, messages, true)).toBe(latest);
  });

  it('widens to the full conversation when the latest turn carries no tool use', () => {
    const messages = [userMsg('a'), assistantMsg()];
    expect(computeStatusScopeMessages(true, false, [assistantMsg()], messages, false)).toBe(messages);
  });

  it('widens when the latest-turn slice is empty', () => {
    const messages = [userMsg('a'), assistantMsg()];
    expect(computeStatusScopeMessages(true, false, [], messages, false)).toBe(messages);
  });
});

const subagent = (overrides: Partial<SubagentInfo>): SubagentInfo => ({
  id: 'tu_1',
  type: 'research',
  description: 'task',
  status: 'running',
  messageIndex: 0,
  ...overrides,
});

describe('finalizeTodosForSettledTurn', () => {
  const todos: TodoItem[] = [{ content: 'Implement', status: 'in_progress' }];

  it('preserves plan state when the main turn settles', () => {
    expect(finalizeTodosForSettledTurn(todos, false, 'dsh')).toEqual(todos);
  });

  it('keeps the existing settled-task behavior', () => {
    expect(finalizeTodosForSettledTurn(todos, false, 'qwen')).toEqual([
      { content: 'Implement', status: 'completed' },
    ]);
  });
});

describe('selectLatestSubagentTurn', () => {
  const user = (content: string): QwenMateMessage => ({ type: 'user', content });
  const assistant = (): QwenMateMessage => ({ type: 'assistant' });

  it('keeps only the most recent turn containing valid extracted subagents', () => {
    const messages = [user('first'), assistant(), user('second'), assistant()];
    const first = subagent({ id: 'first', messageIndex: 1 });
    const second = subagent({ id: 'second', messageIndex: 3 });

    expect(selectLatestSubagentTurn(messages, [first, second])).toEqual([second]);
  });

  it('keeps the previous valid turn when a later turn produced no valid subagent', () => {
    const messages = [user('first'), assistant(), user('noise-only'), assistant()];
    const first = subagent({ id: 'first', messageIndex: 1 });

    expect(selectLatestSubagentTurn(messages, [first])).toEqual([first]);
  });

  it('keeps all valid subagents from the selected turn', () => {
    const messages = [user('first'), assistant(), assistant()];
    const first = subagent({ id: 'first', messageIndex: 1 });
    const second = subagent({ id: 'second', messageIndex: 2 });

    expect(selectLatestSubagentTurn(messages, [first, second])).toEqual([first, second]);
  });
});
