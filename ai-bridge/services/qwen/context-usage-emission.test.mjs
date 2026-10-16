import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeQueryStream } from './persistent-query-service.js';

/** Run consumeQueryStream while capturing every stdout line it emits. */
async function captureMarkers(messages) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    const outcome = await consumeQueryStream(toAsyncIterable(messages), 'sess-usage');
    return { lines, outcome };
  } finally {
    console.log = originalLog;
  }
}

async function* toAsyncIterable(messages) {
  for (const message of messages) {
    yield message;
  }
}

function usageLines(lines) {
  return lines.filter((line) => line.startsWith('[USAGE] '));
}

test('emits [USAGE] for a main-session assistant round', async () => {
  const usage = {
    input_tokens: 250_000,
    output_tokens: 800,
    cache_read_input_tokens: 10_000,
    total_tokens: 260_800,
  };
  const { lines, outcome } = await captureMarkers([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage,
      },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'hi' },
  ]);

  assert.equal(outcome.success, true);
  const emitted = usageLines(lines);
  assert.equal(emitted.length, 1, 'one [USAGE] per assistant round drives the live ring');
  const payload = JSON.parse(emitted[0].slice('[USAGE] '.length));
  assert.equal(payload.input_tokens, usage.input_tokens);
  assert.equal(payload.total_tokens, usage.total_tokens);
});

test('reads the nested SDK shape instead of the top-level field', async () => {
  // Regression guard: the old check read `message.usage`, which never exists on
  // an SDKAssistantMessage, so the ring stayed frozen until a history reload.
  const { lines } = await captureMarkers([
    {
      type: 'assistant',
      // A top-level `usage` must NOT satisfy the read when the nested one is
      // present — the nested round wins.
      usage: { input_tokens: 1, output_tokens: 1 },
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 42_000, output_tokens: 700 },
      },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'hi' },
  ]);

  const emitted = usageLines(lines);
  assert.equal(emitted.length, 1);
  assert.equal(JSON.parse(emitted[0].slice('[USAGE] '.length)).input_tokens, 42_000);
});

test('keeps emitting when a gateway puts usage on the message itself', async () => {
  const { lines } = await captureMarkers([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
      usage: { input_tokens: 9_000, output_tokens: 120 },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'hi' },
  ]);

  const emitted = usageLines(lines);
  assert.equal(emitted.length, 1);
  assert.equal(JSON.parse(emitted[0].slice('[USAGE] '.length)).input_tokens, 9_000);
});

test('skips [USAGE] for sub-agent rounds', async () => {
  const { lines } = await captureMarkers([
    {
      type: 'assistant',
      parent_tool_use_id: 'tool_sub_1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'sub' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'done' },
  ]);

  assert.ok(!usageLines(lines).some(() => true),
    'sub-agent usage measures its own context window and must not move the main ring');
});

test('never turns the cumulative result usage into a ring push', async () => {
  // The result envelope's usage is session-cumulative (computeUsageFromMetrics
  // across every round). Pushing it would clamp the ring to 100%.
  const { lines } = await captureMarkers([
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      usage: { input_tokens: 9_000_000, output_tokens: 1 },
    },
  ]);

  assert.equal(usageLines(lines).length, 0);
  assert.ok(lines.some((line) => line.startsWith('[MESSAGE] ') && line.includes('"type":"result"')),
    'the result still travels with its usage for cost accounting');
});
