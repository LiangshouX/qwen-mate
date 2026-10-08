import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeQueryStream, requestPermissionFromJava, requestAskUserAnswers, buildCanUseTool } from './persistent-query-service.js';

/** Run consumeQueryStream while capturing every stdout line it emits. */
async function captureMarkers(messageFactory) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    const outcome = await consumeQueryStream(messageFactory(), 'sess-test');
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

test('forwards text and thinking deltas from stream_event messages', async () => {
  const { lines, outcome } = await captureMarkers(() => toAsyncIterable([
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Hello', usage: { input_tokens: 1, output_tokens: 2 } },
  ]));

  assert.equal(outcome.success, true);
  assert.ok(lines.some((line) => line.startsWith('[CONTENT_DELTA]') && line.includes('"Hel"')),
    'first text delta must be emitted');
  assert.ok(lines.some((line) => line.startsWith('[CONTENT_DELTA]') && line.includes('"lo"')),
    'second text delta must be emitted');
  assert.ok(lines.some((line) => line.startsWith('[THINKING_DELTA]') && line.includes('"hmm"')),
    'thinking delta must be emitted');
  assert.ok(lines.includes('[STREAM_END]'),
    'a streamed turn must end with [STREAM_END] instead of relying on the onComplete fallback');

  // hasStreamEvents suppresses the final-text fallback, so the result text is
  // not re-emitted as a duplicate assistant snapshot on top of the real one.
  const assistantSnapshots = lines.filter((line) => line.startsWith('[MESSAGE]') && line.includes('"role":"assistant"'));
  assert.equal(assistantSnapshots.length, 1);
});

test('emits tool_result blocks with the SDK snake_case tool_use_id', async () => {
  const { lines } = await captureMarkers(() => toAsyncIterable([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_123', content: 'ok', is_error: false },
          { type: 'tool_result', tool_use_id: 'call_456', content: 'boom', is_error: true },
        ],
      },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'done' },
  ]));

  const toolResultMessages = lines
    .filter((line) => line.startsWith('[MESSAGE]'))
    .map((line) => JSON.parse(line.slice('[MESSAGE] '.length)))
    .filter((msg) => Array.isArray(msg.message?.content)
      && msg.message.content.some((block) => block.type === 'tool_result'));

  assert.equal(toolResultMessages.length, 2);
  const blocks = toolResultMessages.map((msg) => msg.message.content.find((b) => b.type === 'tool_result'));
  assert.equal(blocks[0].tool_use_id, 'call_123');
  assert.equal(blocks[0].is_error, false);
  assert.equal(blocks[1].tool_use_id, 'call_456');
  assert.equal(blocks[1].is_error, true, 'SDK is_error must survive the round trip');
});

test('keeps the legacy result-text fallback when no partial stream occurred', async () => {
  const { lines, outcome } = await captureMarkers(() => toAsyncIterable([
    { type: 'result', subtype: 'success', is_error: false, result: 'final answer' },
  ]));

  assert.equal(outcome.success, true);
  const assistantSnapshots = lines
    .filter((line) => line.startsWith('[MESSAGE]'))
    .map((line) => JSON.parse(line.slice('[MESSAGE] '.length)))
    .filter((msg) => msg.message?.role === 'assistant');
  assert.equal(assistantSnapshots.length, 1);
  const textBlock = assistantSnapshots[0].message.content.find((block) => block.type === 'text');
  assert.equal(textBlock?.text, 'final answer');
  assert.ok(!lines.includes('[STREAM_END]'), 'non-streamed turns keep the onComplete fallback path');
});

test('emits the runtime slash-command list from the system init message', async () => {
  const { lines } = await captureMarkers(() => toAsyncIterable([
    {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-init',
      slash_commands: ['compress', 'resume', 'help'],
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'ok' },
  ]));

  const marker = lines.find((line) => line.startsWith('[SLASH_COMMANDS]'));
  assert.ok(marker, 'the runtime command list must be forwarded to Java');
  assert.deepEqual(JSON.parse(marker.slice('[SLASH_COMMANDS]'.length)), ['compress', 'resume', 'help']);
  assert.ok(lines.includes('[SESSION_ID] sess-init'), 'session id still forwarded from the same message');
});

test('omits the marker when the CLI reports no slash commands', async () => {
  const { lines } = await captureMarkers(() => toAsyncIterable([
    { type: 'system', subtype: 'init', session_id: 'sess-init' },
    { type: 'result', subtype: 'success', is_error: false, result: 'ok' },
  ]));

  assert.ok(!lines.some((line) => line.startsWith('[SLASH_COMMANDS]')));
});

// ─── File-IPC approval flow (Node writes request, polls response) ───

const PERMISSION_ENV_KEYS = [
  'QWEN_MATE_PERMISSION_DIR',
  'QWEN_MATE_SESSION_ID',
  'QWEN_MATE_PERMISSION_SAFETY_NET_MS',
];

function withPermissionEnv(t) {
  const dir = mkdtempSync(join(tmpdir(), 'perm-svc-'));
  const saved = Object.fromEntries(PERMISSION_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.QWEN_MATE_PERMISSION_DIR = dir;
  process.env.QWEN_MATE_SESSION_ID = 'sess-test';
  // Short safety net: the fallback timer would otherwise keep the runner alive.
  process.env.QWEN_MATE_PERMISSION_SAFETY_NET_MS = '5000';
  t.after(() => {
    for (const key of PERMISSION_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function findRequestId(dir) {
  const file = readdirSync(dir).find((name) => name.startsWith('request-sess-test-') && name.endsWith('.json'));
  assert.ok(file, 'a request file must be written for Java to pick up');
  return file.slice('request-sess-test-'.length, -'.json'.length);
}

function findAskRequestId(dir) {
  const file = readdirSync(dir).find(
    (name) => name.startsWith('ask-user-question-sess-test-')
      && !name.startsWith('ask-user-question-response-')
      && name.endsWith('.json'),
  );
  assert.ok(file, 'an ask-user-question request file must be written for Java to pick up');
  return file.slice('ask-user-question-sess-test-'.length, -'.json'.length);
}

test('requestPermissionFromJava writes a request file and resolves allow when Java answers', async (t) => {
  const dir = withPermissionEnv(t);
  const input = { command: 'ls' };

  const pending = requestPermissionFromJava('Bash', input, { cwd: 'D:/Code' });

  const requestId = findRequestId(dir);
  const body = JSON.parse(readFileSync(join(dir, `request-sess-test-${requestId}.json`), 'utf8'));
  assert.equal(body.requestId, requestId);
  assert.equal(body.toolName, 'Bash');
  assert.deepEqual(body.inputs, input);
  assert.equal(body.cwd, 'D:/Code');

  writeFileSync(join(dir, `response-sess-test-${requestId}.json`), JSON.stringify({ allow: true }), 'utf8');

  assert.deepEqual(await pending, { behavior: 'allow', updatedInput: input });
  assert.deepEqual(readdirSync(dir), [], 'both IPC files must be consumed');
});

test('requestPermissionFromJava denies when Java answers false', async (t) => {
  const dir = withPermissionEnv(t);

  const pending = requestPermissionFromJava('Bash', { command: 'rm -rf /' });
  const requestId = findRequestId(dir);
  writeFileSync(join(dir, `response-sess-test-${requestId}.json`), JSON.stringify({ allow: false }), 'utf8');

  const decision = await pending;
  assert.equal(decision.behavior, 'deny');
  assert.equal(decision.message, 'Denied by user');
});

test('requestPermissionFromJava denies fast when the IPC env is unavailable', async (t) => {
  const saved = process.env.QWEN_MATE_PERMISSION_DIR;
  delete process.env.QWEN_MATE_PERMISSION_DIR;
  t.after(() => {
    if (saved !== undefined) {
      process.env.QWEN_MATE_PERMISSION_DIR = saved;
    }
  });

  const decision = await requestPermissionFromJava('Bash', { command: 'ls' });
  assert.equal(decision.behavior, 'deny');
  assert.match(decision.message, /Permission bridge unavailable/);
});

test('aborting the turn denies the pending request and removes its files', async (t) => {
  const dir = withPermissionEnv(t);
  const controller = new AbortController();

  const pending = requestPermissionFromJava('Bash', { command: 'ls' }, { signal: controller.signal });
  findRequestId(dir);
  controller.abort();

  const decision = await pending;
  assert.equal(decision.behavior, 'deny');
  assert.equal(decision.message, 'Request cancelled');
  assert.deepEqual(readdirSync(dir), [], 'an aborted turn must leave no ghost dialog behind');
});

// ─── AskUserQuestion answer collection (file IPC) ───

const SAMPLE_QUESTIONS = [
  {
    question: '你倾向哪种实现方案？',
    header: '推送方案',
    options: [{ label: 'WebSocket', description: '长连接' }, { label: 'SSE', description: '单向推送' }],
    multiSelect: false,
  },
  {
    question: '本次范围？',
    header: '范围',
    options: [{ label: '全部', description: '全量实现' }, { label: '一半', description: '部分实现' }],
    multiSelect: false,
  },
];

test('buildCanUseTool routes ask_user_question to the answer dialog even in yolo mode', async (t) => {
  const dir = withPermissionEnv(t);
  const canUseTool = buildCanUseTool({ permissionMode: 'yolo', cwd: 'D:/Code' });
  const input = { questions: SAMPLE_QUESTIONS };

  const pending = canUseTool('ask_user_question', input);

  const requestId = findAskRequestId(dir);
  const body = JSON.parse(readFileSync(join(dir, `ask-user-question-sess-test-${requestId}.json`), 'utf8'));
  assert.equal(body.toolName, 'ask_user_question');
  assert.deepEqual(body.questions, SAMPLE_QUESTIONS);
  assert.equal(body.cwd, 'D:/Code');

  // The GUI keys answers by question text; the bridge must hand the CLI
  // decimal index keys or execute() drops them as "No valid answers".
  writeFileSync(
    join(dir, `ask-user-question-response-sess-test-${requestId}.json`),
    JSON.stringify({ answers: { [SAMPLE_QUESTIONS[0].question]: 'WebSocket' } }),
    'utf8',
  );

  const decision = await pending;
  assert.equal(decision.behavior, 'allow');
  assert.deepEqual(decision.updatedInput, { questions: SAMPLE_QUESTIONS, answers: { '0': 'WebSocket' } });
  assert.deepEqual(readdirSync(dir), [], 'both IPC files must be consumed');
});

test('requestAskUserAnswers keeps valid index keys and flattens multi-select arrays', async (t) => {
  const dir = withPermissionEnv(t);
  const input = { questions: SAMPLE_QUESTIONS };

  const pending = requestAskUserAnswers('ask_user_question', input, { cwd: 'D:/Code' });
  const requestId = findAskRequestId(dir);
  writeFileSync(
    join(dir, `ask-user-question-response-sess-test-${requestId}.json`),
    JSON.stringify({
      answers: { '0': 'SSE', '1': ['全部', '一半'], 2: 'orphan', 9: 'out-of-range', bad: 'text' },
    }),
    'utf8',
  );

  const decision = await pending;
  assert.equal(decision.behavior, 'allow');
  assert.deepEqual(decision.updatedInput.answers, { '0': 'SSE', '1': '全部, 一半' });
});

test('requestAskUserAnswers denies fast when the IPC env is unavailable', async (t) => {
  const saved = process.env.QWEN_MATE_PERMISSION_DIR;
  delete process.env.QWEN_MATE_PERMISSION_DIR;
  t.after(() => {
    if (saved !== undefined) {
      process.env.QWEN_MATE_PERMISSION_DIR = saved;
    }
  });

  const decision = await requestAskUserAnswers('ask_user_question', { questions: SAMPLE_QUESTIONS });
  assert.equal(decision.behavior, 'deny');
  assert.match(decision.message, /Permission bridge unavailable/);
});

test('aborting the turn denies the pending ask and removes its files', async (t) => {
  const dir = withPermissionEnv(t);
  const controller = new AbortController();

  const pending = requestAskUserAnswers('ask_user_question', { questions: SAMPLE_QUESTIONS }, { signal: controller.signal });
  findAskRequestId(dir);
  controller.abort();

  const decision = await pending;
  assert.equal(decision.behavior, 'deny');
  assert.equal(decision.message, 'Request cancelled');
  assert.deepEqual(readdirSync(dir), [], 'an aborted ask must leave no ghost dialog behind');
});
