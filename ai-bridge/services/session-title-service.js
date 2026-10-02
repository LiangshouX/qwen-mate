/**
 * Session title service.
 * Generates AI titles for sessions via the one-shot ask service
 * (services/ask-service.js, Qwen SDK engine) and stores them in the
 * provider-agnostic session-titles store (services/session-titles-service.cjs).
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { askOneShot } from './ask-service.js';
import sessionTitles from './session-titles-service.cjs';
import { getQwenMateDir } from '../utils/path-utils.js';

const DEFAULT_TITLE_MODEL = 'auto';
const MAX_CONVERSATION_TEXT = 1000;
// Aligns with Java HistoryDeleteService.SESSION_ID_PATTERN — alphanumeric,
// dot, dash, underscore. Defeats path-traversal payloads in upstream payloads.
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
// Safety net for title calls — avoids hung requests holding daemon resources.
// 30s: thinking models (e.g. mimo) can spend >15s reasoning before the JSON
// title appears, which surfaced as aborts ("Query aborted by user").
const TITLE_API_TIMEOUT_MS = 30000;

function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);
}

const SESSION_TITLE_PROMPT = `Generate a concise title (3-7 words) for this coding session. The title must be in the SAME LANGUAGE as the user's message.

Return JSON: {"title": "..."}

English examples:
{"title": "Fix login button on mobile"}
{"title": "Refactor API error handling"}

Chinese examples:
{"title": "修复登录按钮移动端问题"}
{"title": "重构API错误处理逻辑"}

Bad: {"title": "Code changes"} (too vague)
Bad: {"title": "修复登录按钮在移动设备上不响应的问题"} (too long)`;

// --- Logging ---
// Title generation runs fire-and-forget after the daemon request completes,
// so activeRequestId is null. Output structured JSON via process.stdout.write
// which the daemon passes through for lines starting with '{'.
// DaemonBridge.java handles "title_log" events with appropriate log levels.

function logTitleEvent(level, message) {
  const line = JSON.stringify({
    type: 'daemon',
    event: 'title_log',
    level,
    message
  }) + '\n';
  process.stdout.write(line);
}

/**
 * Emit a title_generated daemon event so the Java layer can forward the
 * AI title to the frontend for immediate display in the chat header.
 */
function emitTitleGenerated(sessionId, title) {
  const line = JSON.stringify({
    type: 'daemon',
    event: 'title_generated',
    sessionId,
    title
  }) + '\n';
  process.stdout.write(line);
}

/**
 * Read the AI title generation toggle from ~/.qwenmate/config.json.
 * Defaults to true (enabled) when the config is missing, malformed, or the
 * field is not set, matching the Java QwenMateSettingsService default.
 * @returns {Promise<boolean>}
 */
async function isTitleGenerationEnabled() {
  try {
    const configPath = join(getQwenMateDir(), 'config.json');
    const text = await readFile(configPath, 'utf8');
    const config = JSON.parse(text);
    if (config && typeof config === 'object' && 'aiTitleGenerationEnabled' in config) {
      return config.aiTitleGenerationEnabled !== false;
    }
    return true;
  } catch {
    return true;
  }
}

// --- API ---

/**
 * Parse the generated title out of the model response text.
 * Accepts a bare JSON object or one embedded in surrounding prose.
 * Exposed for tests.
 * @param {string} text - Raw model response
 * @returns {string|null} Trimmed title or null
 */
export function parseTitleFromResponse(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.title && typeof parsed.title === 'string') {
      return parsed.title.trim() || null;
    }
    logTitleEvent('warn', 'Title response missing "title" field: ' + trimmed.substring(0, 200));
    return null;
  } catch {
    const jsonMatch = trimmed.match(/\{[^}]*"title"\s*:\s*"[^"]*"[^}]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title && typeof parsed.title === 'string') {
          return parsed.title.trim() || null;
        }
      } catch {
        // fall through
      }
    }
    logTitleEvent('warn', 'Failed to parse title response as JSON: ' + trimmed.substring(0, 200));
    return null;
  }
}

/**
 * Call the one-shot ask service to generate a title.
 * @param {string} userMessage - The user's first message text
 * @returns {Promise<string|null>} Generated title or null
 */
async function generateTitleViaAsk(userMessage) {
  logTitleEvent('info', 'Calling ask service for session title, model: ' + DEFAULT_TITLE_MODEL);

  const text = await askOneShot({
    provider: 'qwen',
    prompt: userMessage,
    systemPrompt: SESSION_TITLE_PROMPT,
    model: DEFAULT_TITLE_MODEL,
    timeoutMs: TITLE_API_TIMEOUT_MS,
  });

  if (!text) {
    logTitleEvent('warn', 'Title generation returned empty response');
    return null;
  }
  return parseTitleFromResponse(text);
}

/**
 * Save AI title to the provider-agnostic session titles store.
 * @param {string} sessionId
 * @param {string} title
 */
async function saveAiTitle(sessionId, title) {
  try {
    if (!sessionTitles.setAiTitle(sessionId, title)) {
      return false;
    }
    logTitleEvent('info', 'Saved AI title: "' + title + '" for session ' + sessionId);

    // Notify the Java layer so it can forward to the frontend for display
    emitTitleGenerated(sessionId, title);
    return true;
  } catch (e) {
    logTitleEvent('error', 'Failed to save AI title: ' + e.message);
    return false;
  }
}

/**
 * Generate and save an AI title for the session.
 * Called when a session turn ends successfully.
 * Fire-and-forget: errors are logged to IDEA via structured daemon events.
 *
 * @param {string} userMessage - The user's first message text (already extracted)
 * @param {string} sessionId - Session ID
 * @param {string|null} cwd - Working directory (kept for caller compatibility)
 */
export async function generateSessionTitle(userMessage, sessionId, cwd) {
  if (!userMessage || !userMessage.trim() || !sessionId) {
    logTitleEvent('info', 'Skipping title generation: missing userMessage or sessionId');
    // Treat invalid input as "do not retry" — return true so callers don't
    // un-flag titleGenerationAttempted and re-trigger on the next turn.
    return true;
  }

  if (!isValidSessionId(sessionId)) {
    logTitleEvent('warn', 'Skipping title generation: invalid sessionId rejected');
    return true;
  }

  if (!(await isTitleGenerationEnabled())) {
    logTitleEvent('info', 'Skipping title generation: disabled in user settings');
    return true;
  }

  // Defensive: skip if the session already has an AI title (prevents overwrite).
  // The caller guards (!resumeSessionId / !requestedSessionId) normally prevent
  // duplicate calls, but this check protects against edge cases where the guard
  // fails or the session already has a title from another source.
  try {
    if (sessionTitles.getAiTitle(sessionId)) {
      logTitleEvent('info', 'Skipping title generation: session already has an AI title');
      return true;
    }
  } catch (e) {
    logTitleEvent('warn', 'Failed to check existing AI title, proceeding: ' + e.message);
  }

  try {
    // Iterate by Unicode code point so we never split a surrogate pair
    // (e.g. CJK extension characters or emoji) when truncating.
    let input = userMessage;
    if (userMessage.length > MAX_CONVERSATION_TEXT) {
      const codePoints = Array.from(userMessage);
      if (codePoints.length > MAX_CONVERSATION_TEXT) {
        input = codePoints.slice(-MAX_CONVERSATION_TEXT).join('');
      }
    }

    const title = await generateTitleViaAsk(input);
    if (title) {
      // saveAiTitle returning false signals an FS error; don't retry — disk
      // problems are usually persistent and a retry storm helps no one.
      await saveAiTitle(sessionId, title);
      return true;
    }
    // generateTitleViaAsk returns null for permanent skips (unparseable
    // response). Treat as "already attempted" so the caller does not reset its
    // guard and re-call on the next turn.
    logTitleEvent('info', 'Title generation returned no result for session ' + sessionId);
    return true;
  } catch (e) {
    // Thrown errors come from the SDK / network layer and are typically
    // transient — return false so callers may reset their guard and retry.
    logTitleEvent('error', 'Title generation failed: ' + e.message);
    return false;
  }
}

// --- Turn-completion trigger (fire-and-forget with per-session dedupe) ---

// Sessions whose title generation already completed (or permanently skipped).
const titleAttemptedSessions = new Set();
// Sessions with a title generation currently in flight.
const titleInFlightSessions = new Set();
// Last transient-failure timestamp per session — throttles retry storms when
// the model/network keeps failing: at most one retry per cooldown window.
const titleRetryAfter = new Map();
const TITLE_RETRY_COOLDOWN_MS = 60_000;

/**
 * Fire-and-forget session title generation with per-session dedupe/throttle.
 *
 * Call this when a session turn completes successfully. Guarantees:
 * - at most one in-flight title request per session (concurrent turn
 *   completions for the same session are deduplicated);
 * - at most one completed generation per session (subsequent turns skip);
 * - on transient failure the session may retry, but not within the retry
 *   cooldown window.
 *
 * Never throws — failures are logged as structured daemon events.
 *
 * @param {string} userMessage - The user's first message text (already extracted)
 * @param {string} sessionId - Session ID
 * @param {string|null} cwd - Working directory
 * @param {Function} [generateFn] - Injectable generator (tests); defaults to
 *   {@link generateSessionTitle}. Must resolve to a boolean
 *   (true = attempt consumed, false = transient failure, may retry).
 * @returns {Promise<boolean>} true when the attempt was consumed (or skipped),
 *   false on transient failure.
 */
export async function maybeGenerateSessionTitle(userMessage, sessionId, cwd, generateFn = generateSessionTitle) {
  if (!sessionId) {
    return true;
  }

  if (titleAttemptedSessions.has(sessionId) || titleInFlightSessions.has(sessionId)) {
    logTitleEvent('info', 'Skipping title generation: already attempted or in flight for session ' + sessionId);
    return true;
  }

  const retryAfter = titleRetryAfter.get(sessionId);
  if (retryAfter && Date.now() < retryAfter) {
    logTitleEvent('info', 'Skipping title generation: retry cooldown active for session ' + sessionId);
    return true;
  }

  titleInFlightSessions.add(sessionId);
  try {
    const completed = await generateFn(userMessage, sessionId, cwd);
    if (completed) {
      titleAttemptedSessions.add(sessionId);
      titleRetryAfter.delete(sessionId);
    } else {
      // Transient failure — allow a later turn to retry, but throttle it.
      titleRetryAfter.set(sessionId, Date.now() + TITLE_RETRY_COOLDOWN_MS);
    }
    return completed;
  } catch (e) {
    titleRetryAfter.set(sessionId, Date.now() + TITLE_RETRY_COOLDOWN_MS);
    logTitleEvent('error', 'Title generation attempt failed: ' + e.message);
    return false;
  } finally {
    titleInFlightSessions.delete(sessionId);
  }
}

/**
 * Reset the per-session dedupe/throttle state. Exposed for tests.
 */
export function resetTitleTriggerStateForTests() {
  titleAttemptedSessions.clear();
  titleInFlightSessions.clear();
  titleRetryAfter.clear();
}
