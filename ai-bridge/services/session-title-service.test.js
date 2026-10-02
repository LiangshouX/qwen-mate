import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTitleFromResponse,
  maybeGenerateSessionTitle,
  resetTitleTriggerStateForTests,
} from './session-title-service.js';
import { extractUserMessageText } from './qwen/persistent-query-service.js';

// ---------- parseTitleFromResponse ----------

test('parseTitleFromResponse reads a bare JSON title', () => {
  assert.equal(parseTitleFromResponse('{"title": "修复登录按钮问题"}'), '修复登录按钮问题');
});

test('parseTitleFromResponse trims the returned title', () => {
  assert.equal(parseTitleFromResponse('{"title": "  Fix login button  "}'), 'Fix login button');
});

test('parseTitleFromResponse extracts a JSON title embedded in prose', () => {
  const text = 'Here is the title: {"title": "Refactor API errors"} — done.';
  assert.equal(parseTitleFromResponse(text), 'Refactor API errors');
});

test('parseTitleFromResponse returns null for empty or missing input', () => {
  assert.equal(parseTitleFromResponse(''), null);
  assert.equal(parseTitleFromResponse('   '), null);
  assert.equal(parseTitleFromResponse(null), null);
  assert.equal(parseTitleFromResponse(undefined), null);
});

// ---------- maybeGenerateSessionTitle (dedupe / throttle) ----------

test('maybeGenerateSessionTitle dedupes concurrent triggers for the same session', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const generateFn = async () => {
    calls++;
    await gate;
    return true;
  };

  const first = maybeGenerateSessionTitle('hi', 'session-dedupe', null, generateFn);
  const second = maybeGenerateSessionTitle('hi again', 'session-dedupe', null, generateFn);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1, 'generator must run only once for concurrent triggers');
  assert.equal(firstResult, true);
  assert.equal(secondResult, true);
});

test('maybeGenerateSessionTitle generates only once per session', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  const generateFn = async () => { calls++; return true; };

  assert.equal(await maybeGenerateSessionTitle('hi', 'session-once', null, generateFn), true);
  assert.equal(await maybeGenerateSessionTitle('next turn', 'session-once', null, generateFn), true);
  assert.equal(calls, 1, 'later turns must not regenerate the title');
});

test('maybeGenerateSessionTitle treats different sessions independently', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  const generateFn = async () => { calls++; return true; };

  await maybeGenerateSessionTitle('hi', 'session-a', null, generateFn);
  await maybeGenerateSessionTitle('hi', 'session-b', null, generateFn);
  assert.equal(calls, 2);
});

test('maybeGenerateSessionTitle throttles retries after transient failure', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  const failing = async () => { calls++; return false; };

  // First attempt fails (transient) — result is false.
  assert.equal(await maybeGenerateSessionTitle('hi', 'session-retry', null, failing), false);
  assert.equal(calls, 1);

  // Immediate retry is suppressed by the cooldown window.
  assert.equal(await maybeGenerateSessionTitle('hi', 'session-retry', null, failing), true);
  assert.equal(calls, 1, 'retry within the cooldown must be throttled');

  // After a reset (simulates the cooldown elapsing) the retry goes through.
  resetTitleTriggerStateForTests();
  assert.equal(await maybeGenerateSessionTitle('hi', 'session-retry', null, failing), false);
  assert.equal(calls, 2);
});

test('maybeGenerateSessionTitle throttles when the generator throws', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  const throwing = async () => { calls++; throw new Error('network down'); };

  assert.equal(await maybeGenerateSessionTitle('hi', 'session-throw', null, throwing), false);
  assert.equal(await maybeGenerateSessionTitle('hi', 'session-throw', null, throwing), true);
  assert.equal(calls, 1, 'thrown failures must also be throttled');
});

test('maybeGenerateSessionTitle never throws and skips empty session ids', async () => {
  resetTitleTriggerStateForTests();
  let calls = 0;
  const generateFn = async () => { calls++; return true; };

  assert.equal(await maybeGenerateSessionTitle('hi', null, null, generateFn), true);
  assert.equal(await maybeGenerateSessionTitle('hi', undefined, null, generateFn), true);
  assert.equal(calls, 0);
});

// ---------- extractUserMessageText ----------

test('extractUserMessageText handles plain strings and content blocks', () => {
  assert.equal(extractUserMessageText('hello'), 'hello');
  assert.equal(
    extractUserMessageText([
      { type: 'text', text: 'part one' },
      { type: 'image', data: 'xxx' },
      { type: 'text', text: 'part two' },
    ]),
    'part one\npart two'
  );
  assert.equal(extractUserMessageText([{ type: 'image', data: 'xxx' }]), null);
  assert.equal(extractUserMessageText(42), null);
  assert.equal(extractUserMessageText(null), null);
});
