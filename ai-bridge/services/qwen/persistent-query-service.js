/**
 * Qwen Code persistent query service — daemon-mode entry point.
 *
 * Contract (mirrors the shared persistent-query service shape):
 *   sendMessagePersistent / preconnectPersistent / resetRuntimePersistent /
 *   abortCurrentTurn / setPermissionModePersistent / getContextUsagePersistent /
 *   shutdownPersistentRuntimes / getRuntimeSnapshot
 *
 * Uses the Qwen Code TypeScript SDK (`@qwen-code/sdk`) with its `query()` API.
 */
import {
  beginStream,
  endStream,
  emitSessionId,
  emitUsage,
  emitSlashCommands,
  emitMessageMarker,
  emitSendError,
} from '../../utils/marker-protocol.js';
import { loadQwenSdk, isQwenSdkAvailable } from '../../utils/sdk-loader.js';
import { maybeGenerateSessionTitle } from '../session-title-service.js';
import {
  DEFAULT_SAFETY_NET_MS,
  pollAskQuestionResponse,
  pollPermissionResponse,
  removeAskQuestionFiles,
  removePermissionFiles,
  resolvePermissionIpcConfig,
  writeAskQuestionRequest,
  writePermissionRequest,
} from './permission-file-ipc.js';

// ─── Runtime registry (mirrors the upstream SDK pattern) ───

const runtimes = new Map();          // key → { query, sessionId, model, permissionMode, ... }
const activeTurns = new Map();       // key → { abortController, ... }
let activeTurnRuntime = null;

// ─── Helpers ───

function makeRuntimeKey(params) {
  return `${params.sessionId || 'anon'}::${params.cwd || process.cwd()}::${params.model || 'default'}`;
}

// Qwen Code CLI approval modes (mirrors its ApprovalMode enum). Legacy CC GUI
// ids are migrated so persisted sessions keep their meaning.
const VALID_PERMISSION_MODES = ['plan', 'default', 'auto-edit', 'auto', 'yolo'];
const LEGACY_MODE_ALIASES = {
  acceptEdits: 'auto-edit',
  autoEdit: 'auto-edit',
  bypassPermissions: 'yolo',
};

function normalizePermissionMode(mode) {
  const aliased = LEGACY_MODE_ALIASES[mode] ?? mode;
  return VALID_PERMISSION_MODES.includes(aliased) ? aliased : 'default';
}

function buildUserMessage(text, sessionId) {
  return {
    type: 'user',
    session_id: sessionId || 'qwen-session',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

function emitContentDelta(text) {
  if (text) {
    noteDelta('text');
    console.log(`[CONTENT_DELTA] ${JSON.stringify(text)}`);
  }
}

// ─── Turn timing instrumentation ───
// One [TIMING] line per milestone, forwarded by QwenSDKBridge.processOutputLine
// as an INFO log. This is the only way to see where a turn's wall time goes
// (CLI spawn vs. first token vs. end-of-turn result) — the phases below used to
// be invisible, which made "GUI slower than CLI" unfalsifiable from logs.
let turnBaseMillis = 0;
let lastDeltaMillis = 0;
let lastActivityMillis = 0;
let lastEventKind = null;
let firstDeltaKind = null;
let toolEventsAfterDelta = 0;

function emitTiming(event, extra) {
  const at = Date.now();
  const base = turnBaseMillis || at;
  console.log(`[TIMING] ${JSON.stringify({ event, relMs: at - base, at, ...extra })}`);
}

// Single choke point for every outgoing delta: records first/last delta
// milestones so the end-of-turn tail (last token → result) is measurable.
function noteDelta(kind) {
  const now = Date.now();
  lastDeltaMillis = now;
  lastActivityMillis = now;
  lastEventKind = kind;
  toolEventsAfterDelta = 0;
  if (!firstDeltaKind) {
    firstDeltaKind = kind;
    emitTiming('first_delta', { kind });
  }
}

// Tool markers are activity too: a turn can go delta-silent for minutes while
// tools run (CLI keeps printing, so it never looks stalled). Tracking them
// separates "tail = tool execution" from "tail = true silence waiting on the
// gateway/CLI to close the turn".
function noteActivity(kind) {
  lastActivityMillis = Date.now();
  lastEventKind = kind;
  if (lastDeltaMillis > 0) {
    toolEventsAfterDelta += 1;
  }
}

function emitThinkingDelta(text) {
  if (text) {
    noteDelta('thinking');
    console.log(`[THINKING_DELTA] ${JSON.stringify(text)}`);
  }
}

function emitToolUse(toolUse) {
  noteActivity('tool_use');
  emitMessageMarker({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolUse.id || `tool_${Date.now()}`,
        name: toolUse.name,
        input: toolUse.input || {},
      }],
    },
  });
}

function emitToolResult(toolResult) {
  noteActivity('tool_result');
  // SDK ToolResultBlock fields are snake_case ({ tool_use_id, is_error }).
  // Reading camelCase here dropped the id entirely: findToolResult could never
  // match the result (tool cards spun forever) and useFileChanges counted
  // nothing because it requires a successful result. camelCase stays as a
  // fallback for ACP-normalized shapes.
  emitMessageMarker({
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolResult.tool_use_id ?? toolResult.toolUseId ?? toolResult.id,
        content: toolResult.content ?? '',
        is_error: toolResult.is_error ?? !!toolResult.isError,
      }],
    },
  });
}

function safeString(v, max = 20000) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, Math.floor(max * 0.65)) + '\n...[truncated]...\n' + s.slice(-Math.floor(max * 0.35)) : s;
}

/**
 * Extract plain text out of the user prompt (string or content-block array)
 * for session-title generation. Exported for tests.
 * @param {string|Array|unknown} message
 * @returns {string|null}
 */
export function extractUserMessageText(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    const text = message
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    return text || null;
  }
  return null;
}

// ─── Event normalization: SDK messages → marker protocol ───

// Exported for tests: consumes a raw SDK query() stream and re-emits it as
// marker-protocol stdout lines.
export async function consumeQueryStream(result, sessionId) {
  let hasStreamEvents = false;
  let sawSessionId = false;
  let lastUsage = null;

  for await (const message of result) {
    // System init message: session ID plus the command surface this mode exposes
    if (message.type === 'system') {
      if (message.session_id && !sawSessionId) {
        sawSessionId = true;
        emitSessionId(message.session_id);
        sessionId = message.session_id;
        emitTiming('session_init');
      }
      if (Array.isArray(message.slash_commands)) {
        emitSlashCommands(message.slash_commands);
      }
    }

    // Partial/streaming messages
    if (message.type === 'assistant' || message.type === 'partial_assistant') {
      const content = message.message?.content;
      if (!content) continue;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            if (message.type === 'partial_assistant') {
              if (!hasStreamEvents) {
                beginStream();
                hasStreamEvents = true;
              }
              emitContentDelta(block.text);
            } else {
              // Full snapshot
              emitMessageMarker({
                type: 'assistant',
                message: { role: 'assistant', content: [block] },
              });
            }
          } else if (block.type === 'thinking') {
            if (message.type === 'partial_assistant') {
              if (!hasStreamEvents) {
                beginStream();
                hasStreamEvents = true;
              }
              emitThinkingDelta(block.thinking || block.text);
            } else {
              emitMessageMarker({
                type: 'assistant',
                message: { role: 'assistant', content: [block] },
              });
            }
          } else if (block.type === 'tool_use') {
            emitToolUse(block);
          }
        }
      } else if (typeof content === 'string') {
        if (!hasStreamEvents) {
          beginStream();
          hasStreamEvents = true;
        }
        emitContentDelta(content);
      }

      // Track usage from assistant messages
      if (message.usage) {
        lastUsage = message.usage;
      }
    }

    // Streaming deltas. The SDK wraps incremental events as `stream_event`
    // (payload in `.event`); the legacy `partial_assistant` branch above never
    // fires, which left [CONTENT_DELTA]/[THINKING_DELTA] unemitted — text only
    // arrived via whole-message snapshots, so the UI rendered chat-style chunks
    // instead of streaming token by token.
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event?.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          // beginStream() is intentionally skipped: sendMessagePersistent
          // already emitted [MESSAGE_START]/[STREAM_START] before the query.
          // hasStreamEvents only drives endStream() + the final-text fallback.
          hasStreamEvents = true;
          emitContentDelta(delta.text);
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          hasStreamEvents = true;
          emitThinkingDelta(delta.thinking);
        }
      }
    }

    // User messages (tool results)
    if (message.type === 'user') {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            emitToolResult(block);
          }
        }
      }
    }

    // Result message
    if (message.type === 'result') {
      // Tail composition of this turn:
      //   deltaTailMs        — last text/thinking token → result (UI output stops)
      //   silentMs           — last ANY outbound event (incl. tool markers) → result
      //   lastEvent          — what the UI was last showing
      //   toolEventsAfterDelta — tool markers emitted inside the delta-tail
      // deltaTailMs big + silentMs small + tools>0  ⇒ tail was tool execution
      // (CLI shows scrolling tool output, GUI must too — not a gateway stall).
      // Both big                                  ⇒ true silence waiting on the
      // gateway/CLI to close the turn.
      const timingExtra = {};
      if (lastDeltaMillis > 0) timingExtra.deltaTailMs = Date.now() - lastDeltaMillis;
      if (lastActivityMillis > 0) timingExtra.silentMs = Date.now() - lastActivityMillis;
      if (lastEventKind) timingExtra.lastEvent = lastEventKind;
      if (toolEventsAfterDelta > 0) timingExtra.toolEventsAfterDelta = toolEventsAfterDelta;
      emitTiming('result_received', timingExtra);
      if (message.usage) {
        lastUsage = message.usage;
      }

      if (message.is_error || message.subtype === 'error_during_execution') {
        const error = message.error?.message || message.result || 'Unknown error';
        if (hasStreamEvents) endStream();
        emitSendError(String(error));
        return { success: false, sessionId, error: String(error) };
      }

      // Emit final assistant message if we haven't yet
      if (!hasStreamEvents && message.result) {
        emitMessageMarker({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: String(message.result) }],
          },
        });
      }

      if (hasStreamEvents) endStream();
      emitMessageMarker({ type: 'result', result: message.result, usage: lastUsage });
      return { success: true, sessionId };
    }
  }

  // Stream ended without explicit result
  if (hasStreamEvents) endStream();
  console.log('[MESSAGE_END]');
  return { success: true, sessionId };
}

// ─── CanUseTool callback (permission handling) ───

// Qwen Code tool names (lowercase wire ids) plus upstream-style aliases, so the
// gates below match regardless of the naming the SDK reports.
const READ_ONLY_TOOL_NAMES = new Set([
  'read_file', 'grep', 'grep_search', 'glob', 'list_directory', 'ls',
  'web_search', 'web_fetch', 'todo_write', 'todo_read', 'tool_search',
  'read_mcp_resource', 'lsp', 'zoom_image',
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead',
]);

// Auto-edit auto-approves exactly these (mirrors the CLI docs: "自动审批的编辑
// 工具包括 edit、write_file 和 notebook_edit").
const AUTO_EDIT_TOOL_NAMES = new Set([
  'edit', 'write_file', 'notebook_edit',
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
]);

function isReadOnlyTool(toolName) {
  return READ_ONLY_TOOL_NAMES.has(toolName);
}

const ASK_USER_QUESTION_TOOL_NAMES = new Set(['ask_user_question', 'AskUserQuestion']);

function isAskUserQuestionTool(toolName) {
  return ASK_USER_QUESTION_TOOL_NAMES.has(toolName);
}

// Exported for tests.
export function buildCanUseTool(params) {
  const mode = normalizePermissionMode(params.permissionMode);

  return async (toolName, input, { signal } = {}) => {
    // AskUserQuestion is an answer dialog, never an allow/deny question, in
    // every approval mode: the CLI auto-confirms a bare allow with no answers
    // and the turn continues with "No valid answers were provided".
    if (isAskUserQuestionTool(toolName)) {
      emitAskEvent('can_use_tool_entered', { requestId: `ask_${Date.now()}` });
      return requestAskUserAnswers(toolName, input, { signal, cwd: params.cwd });
    }

    // YOLO: the CLI auto-approves every tool call. Keep a permissive callback as
    // a second gate for anything the CLI still surfaces (plugin tools etc.).
    if (mode === 'yolo') {
      return { behavior: 'allow', updatedInput: input };
    }

    // Plan: read-only analysis only — no edits, no shell (mirrors the CLI's own
    // plan restrictions as a second gate).
    if (mode === 'plan') {
      if (isReadOnlyTool(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }
      return { behavior: 'deny', message: 'Plan mode: write operations are not allowed' };
    }

    // auto-edit / auto / default (Ask Permissions): the CLI's approval-mode
    // policy decides which tools ask at all (auto-edit pre-approves edits, auto
    // runs its classifier). Whatever still reaches us goes to the GUI dialog,
    // except read-only tools which never need confirmation.
    if (isReadOnlyTool(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (mode === 'auto-edit' && AUTO_EDIT_TOOL_NAMES.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    return requestPermissionFromJava(toolName, input, { signal, cwd: params.cwd });
  };
}

// Permission request/response bridge (file IPC, see permission-file-ipc.js)
const pendingPermissions = new Map();

// Node-side fallbacks must answer AFTER the Java dialog safety net
// (QWEN_MATE_PERMISSION_SAFETY_NET_MS) so a live host always wins the race.
const PERMISSION_FALLBACK_EXTRA_MS = 10_000;
// The SDK/CLI canUseTool timeout (default 60s) would cancel the command while
// the approval dialog is still open; stretch it over the whole dialog window.
const SDK_CAN_USE_TOOL_EXTRA_MS = 30_000;

function permissionCanUseToolTimeoutMs() {
  const config = resolvePermissionIpcConfig();
  return (config.ok ? config.safetyNetMs : DEFAULT_SAFETY_NET_MS) + SDK_CAN_USE_TOOL_EXTRA_MS;
}

// Exported for tests: file-IPC approval entry point used by buildCanUseTool.
export function requestPermissionFromJava(toolName, input, { signal, cwd } = {}) {
  return new Promise((resolve) => {
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const config = resolvePermissionIpcConfig();
    if (!config.ok) {
      // Without an IPC dir the Java host cannot be asked at all — fail fast
      // with the reason instead of hanging until some timeout.
      resolve({ behavior: 'deny', message: `Permission bridge unavailable: ${config.reason}` });
      return;
    }

    const entry = { resolve, input, timer: null, poll: null, cleanup: null };
    pendingPermissions.set(requestId, entry);

    entry.cleanup = () => {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (entry.poll) {
        entry.poll.stop();
        entry.poll = null;
      }
      // Drop unconsumed IPC files so an aborted turn leaves no ghost dialog.
      removePermissionFiles(config, requestId);
    };

    try {
      writePermissionRequest(config, requestId, { toolName, inputs: input, cwd });
    } catch (error) {
      pendingPermissions.delete(requestId);
      resolve({ behavior: 'deny', message: `Permission request failed: ${error.message}` });
      return;
    }

    entry.poll = pollPermissionResponse(config, requestId, {
      onResult: (allow) => {
        respondToPermission(requestId, allow, allow ? undefined : 'Denied by user');
      },
    });

    entry.timer = setTimeout(() => {
      respondToPermission(requestId, false, 'Permission request timed out');
    }, config.safetyNetMs + PERMISSION_FALLBACK_EXTRA_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        respondToPermission(requestId, false, 'Request cancelled');
      }, { once: true });
    }
  });
}

export function respondToPermission(requestId, allowed, message, updatedInput) {
  const entry = pendingPermissions.get(requestId);
  if (!entry) {
    return false;
  }
  pendingPermissions.delete(requestId);
  if (entry.cleanup) {
    entry.cleanup();
  }
  if (allowed) {
    entry.resolve({ behavior: 'allow', updatedInput: updatedInput !== undefined ? updatedInput : entry.input });
  } else {
    entry.resolve({ behavior: 'deny', message: message || 'Denied by user' });
  }
  return true;
}

// The GUI dialog keys answers by question text; the CLI only accepts decimal
// question indices ("0".."n") and string values — translate both shape and
// key so execute() actually picks the answers up.
function normalizeAskAnswers(questions, answers) {
  const normalized = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return normalized;
  }
  const list = Array.isArray(questions) ? questions : [];
  for (const [key, value] of Object.entries(answers)) {
    let index = null;
    if (/^\d+$/.test(key) && Number(key) < list.length) {
      index = Number(key);
    } else {
      const matched = list.findIndex((question) => question && question.question === key);
      if (matched >= 0) {
        index = matched;
      }
    }
    if (index === null) {
      continue;
    }
    const answer = Array.isArray(value)
      ? value.filter((item) => typeof item === 'string' && item.trim() !== '').join(', ')
      : typeof value === 'string' ? value : String(value);
    if (answer.trim() === '') {
      continue;
    }
    normalized[String(index)] = answer;
  }
  return normalized;
}

// Exported for tests: AskUserQuestion answer collection via file IPC. Writes
// ask-user-question-*.json, waits for Java's answer dialog, then resolves
// canUseTool with updatedInput.answers — the CLI treats a bare allow as
// "proceed with no answers", so the choices must travel with the allow.
// Every exit path emits [ASK_EVENT] (→ Java INFO log): the fast-deny paths
// used to be completely silent, which made "model continued without waiting
// for an answer" undiagnosable from logs.
function emitAskEvent(stage, extra = {}) {
  console.log(`[ASK_EVENT] ${JSON.stringify({ stage, at: Date.now(), ...extra })}`);
}

export function requestAskUserAnswers(toolName, input, { signal, cwd } = {}) {
  return new Promise((resolve) => {
    const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const config = resolvePermissionIpcConfig();
    if (!config.ok) {
      emitAskEvent('deny_no_ipc', { requestId, reason: config.reason });
      resolve({ behavior: 'deny', message: `Permission bridge unavailable: ${config.reason}` });
      return;
    }

    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const entry = { resolve, input, questions, timer: null, poll: null, cleanup: null };
    pendingPermissions.set(requestId, entry);
    emitAskEvent('request_written', {
      requestId,
      questionCount: questions.length,
      safetyNetMs: config.safetyNetMs,
    });

    entry.cleanup = () => {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (entry.poll) {
        entry.poll.stop();
        entry.poll = null;
      }
      removeAskQuestionFiles(config, requestId);
    };

    try {
      writeAskQuestionRequest(config, requestId, { toolName, questions, cwd });
    } catch (error) {
      pendingPermissions.delete(requestId);
      emitAskEvent('deny_write_failed', { requestId, error: String(error?.message || error) });
      resolve({ behavior: 'deny', message: `Ask question request failed: ${error.message}` });
      return;
    }

    entry.poll = pollAskQuestionResponse(config, requestId, {
      onResult: (answers) => {
        const normalized = normalizeAskAnswers(entry.questions, answers);
        emitAskEvent('answers_received', {
          requestId,
          answerKeys: Object.keys(normalized || {}),
        });
        const updatedInput = { ...entry.input, answers: normalized };
        respondToPermission(requestId, true, undefined, updatedInput);
      },
    });

    entry.timer = setTimeout(() => {
      emitAskEvent('deny_timeout', { requestId, timeoutMs: config.safetyNetMs + PERMISSION_FALLBACK_EXTRA_MS });
      respondToPermission(requestId, false, 'Ask user question timed out');
    }, config.safetyNetMs + PERMISSION_FALLBACK_EXTRA_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        emitAskEvent('deny_aborted', { requestId });
        respondToPermission(requestId, false, 'Request cancelled');
      }, { once: true });
    }
  });
}

// ─── Persistent service API (daemon contract) ───

export async function sendMessagePersistent(params = {}) {
  const {
    message,
    sessionId: requestSessionId,
    cwd,
    permissionMode = 'default',
    model,
    streaming = true,
    attachments,
  } = params;

  const runtimeKey = makeRuntimeKey(params);

  try {
    // Timing base for every [TIMING] line of this turn (see emitTiming).
    turnBaseMillis = Date.now();
    lastDeltaMillis = 0;
    lastActivityMillis = 0;
    lastEventKind = null;
    firstDeltaKind = null;
    toolEventsAfterDelta = 0;
    emitTiming('turn_start');

    // Load SDK
    const sdk = await loadQwenSdk();
    emitTiming('sdk_ready');
    const queryFn = sdk?.query;
    if (typeof queryFn !== 'function') {
      throw new Error('Qwen SDK does not export a query() function');
    }

    // Build options
    const options = {
      cwd: cwd || process.cwd(),
      permissionMode: normalizePermissionMode(permissionMode),
      includePartialMessages: streaming,
    };

    if (model) options.model = model;
    if (requestSessionId) options.resume = requestSessionId;
    // Stretch the SDK/CLI canUseTool timeout over the whole approval dialog
    // window; the 60s default cancels the command while the dialog is open.
    options.timeout = { canUseTool: permissionCanUseToolTimeoutMs() };

    // Attachments → content blocks
    let prompt;
    if (attachments && attachments.length > 0) {
      const blocks = [{ type: 'text', text: message }];
      for (const att of attachments) {
        if (att.mediaType?.startsWith('image/')) {
          blocks.push({ type: 'image', data: att.data, mimeType: att.mediaType });
        }
      }
      prompt = blocks;
    } else {
      prompt = message;
    }

    // Permission callback
    const canUseTool = buildCanUseTool(params);
    if (canUseTool) options.canUseTool = canUseTool;

    // Emit stream markers
    console.log('[MESSAGE_START]');
    console.log('[STREAM_START]');

    // Execute query
    const abortController = new AbortController();
    options.abortController = abortController;

    activeTurns.set(runtimeKey, { abortController });
    activeTurnRuntime = runtimeKey;

    const result = queryFn({ prompt, options });
    // query() returns once the CLI child process is spawned and the Query is
    // constructed — everything after this waits on the CLI, not on us.
    emitTiming('query_created');
    const outcome = await consumeQueryStream(result, requestSessionId);

    activeTurns.delete(runtimeKey);
    activeTurnRuntime = null;

    emitTiming('turn_end');
    console.log('[MESSAGE_END]');

    // Emit final result
    const resultPayload = {
      success: outcome.success,
      sessionId: outcome.sessionId || requestSessionId,
    };
    if (outcome.error) resultPayload.error = outcome.error;

    console.log(JSON.stringify(resultPayload));

    // Fire-and-forget: generate an AI title for brand-new sessions (not
    // resumes). maybeGenerateSessionTitle dedupes concurrent triggers per
    // session, never generates twice, and throttles retries after transient
    // failures. Failures are silent (logged as structured daemon events).
    if (outcome.success && outcome.sessionId && !requestSessionId) {
      const userMessageText = extractUserMessageText(message);
      if (userMessageText) {
        maybeGenerateSessionTitle(userMessageText, outcome.sessionId, cwd || null)
          .catch(() => { /* fire-and-forget must never throw */ });
      }
    }

  } catch (error) {
    activeTurns.delete(runtimeKey);
    activeTurnRuntime = null;
    emitSendError(safeString(error?.message || error));
    console.log(JSON.stringify({ success: false, error: safeString(error?.message || error, 5000) }));
  }
}

export async function sendMessageWithAttachmentsPersistent(params = {}) {
  return sendMessagePersistent(params);
}

export async function preconnectPersistent(params = {}) {
  try {
    await loadQwenSdk();
    console.log(JSON.stringify({ success: true, preconnected: true }));
  } catch (error) {
    emitSendError(`Preconnect failed: ${error?.message || error}`);
    console.log(JSON.stringify({ success: false, error: String(error?.message || error) }));
  }
}

export async function resetRuntimePersistent(params = {}) {
  // Close any running queries
  for (const [key, turn] of activeTurns) {
    try {
      turn.abortController?.abort();
    } catch { /* ignore */ }
    activeTurns.delete(key);
  }
  activeTurnRuntime = null;

  // Clear cached runtimes
  runtimes.clear();
  console.log(JSON.stringify({ success: true }));
}

export async function setPermissionModePersistent(params = {}) {
  // Qwen SDK supports setPermissionMode on active query
  // For now, this is handled per-turn via options.permissionMode
  console.log(JSON.stringify({ success: true }));
}

export async function abortCurrentTurn() {
  if (activeTurnRuntime && activeTurns.has(activeTurnRuntime)) {
    try {
      activeTurns.get(activeTurnRuntime).abortController?.abort();
    } catch { /* ignore */ }
    activeTurns.delete(activeTurnRuntime);
    activeTurnRuntime = null;
    return true;
  }
  // Also resolve any pending permission requests as denied
  for (const id of [...pendingPermissions.keys()]) {
    respondToPermission(id, false, 'Turn cancelled');
  }
  return false;
}

export async function getContextUsagePersistent(params = {}) {
  try {
    const sdk = await loadQwenSdk();
    // The Qwen SDK's query instance has getContextUsage()
    // For now, return a placeholder — this requires an active query instance
    console.log(JSON.stringify({ success: true, usage: { used: 0, size: 1000000 } }));
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: String(error?.message || error) }));
  }
}

export async function shutdownPersistentRuntimes() {
  await abortCurrentTurn();
  runtimes.clear();
}

export function getRuntimeSnapshot() {
  return {
    qwen: {
      runtimes: runtimes.size,
      activeTurns: activeTurns.size,
      hasActiveTurn: activeTurnRuntime !== null,
      sdkAvailable: isQwenSdkAvailable(),
    },
  };
}
