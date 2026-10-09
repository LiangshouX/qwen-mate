/**
 * One-shot text generation service (no session, no tools).
 *
 * Unified "ask" entry for the AI-assisted GUI features (commit message,
 * prompt enhancement, session titles) so they no longer depend on the
 * Qwen Code SDK.
 *
 * Generation engine: the Qwen Code SDK (`@qwen-code/sdk`) `query()` API in
 * single-turn, deny-all-tools mode.
 */

import { loadQwenSdk } from '../utils/sdk-loader.js';
import { managedMemoryQueryEnv } from './qwen/managed-memory-env.js';

export const ASK_PROVIDERS = ['qwen'];

// Same sentinel set the removed CLI askers used: these mean "no explicit model".
const DEFAULT_MODEL_TOKENS = new Set([
  'auto',
  'default',
  '__config_default__',
  'config-default',
  'config_default',
  '(default)',
  'qwen-default',
]);

// Safety net so a hung generation never pins the caller's process forever.
const DEFAULT_TIMEOUT_MS = 120_000;

export function isAskProvider(provider) {
  return typeof provider === 'string' && ASK_PROVIDERS.includes(provider);
}

function resolveModelFlag(model) {
  if (model == null) return null;
  const trimmed = String(model).trim();
  if (!trimmed || DEFAULT_MODEL_TOKENS.has(trimmed.toLowerCase())) return null;
  // A leading dash would be parsed as a flag by CLI backends / rejected by the SDK.
  if (trimmed.startsWith('-')) return null;
  return trimmed;
}

/** Snapshot-style text merge: returns only the appended slice of a growing snapshot. */
function extractAppendedDelta(previousText, nextText) {
  const previous = typeof previousText === 'string' ? previousText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  if (!next.trim()) return '';
  if (!previous) return next;
  if (next === previous) return '';
  if (!next.startsWith(previous)) return next;
  return next.slice(previous.length);
}

/**
 * Build the QueryOptions object for a one-shot ask turn.
 *
 * Kept as a pure function so tests can pin the shape: the SDK validates
 * QueryOptions strictly and rejects unknown keys (e.g. a stray `maxTurns`
 * fails every call with "Unrecognized key(s) in object").
 *
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {string} [options.model]
 * @param {AbortController} [options.abortController]
 * @returns {object} SDK QueryOptions
 */
export function buildAskQueryOptions({ cwd, model, abortController } = {}) {
  const options = {
    // A string prompt is already single-turn in the SDK; tool use stays denied.
    includePartialMessages: true,
    // One-shot text generation must never execute tools: prompts embed
    // third-party controlled text (git diffs, pasted content).
    canUseTool: async () => ({ behavior: 'deny', message: 'One-shot generation does not execute tools' }),
  };
  if (cwd && String(cwd).trim()) options.cwd = String(cwd).trim();
  const modelFlag = resolveModelFlag(model);
  if (modelFlag) options.model = modelFlag;
  if (abortController) options.abortController = abortController;
  return options;
}

/**
 * Run one prompt through the Qwen Code SDK and collect the assistant text.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.systemPrompt] - prepended to the prompt (the SDK has
 *   no first-class system prompt for one-shot calls).
 * @param {string} [options.model]
 * @param {string} [options.cwd]
 * @param {(delta: string) => void} [options.onDelta] - progressive text chunks
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string>} trimmed assistant text
 */
async function generateWithQwenSdk({
  prompt,
  systemPrompt,
  model,
  cwd,
  onDelta,
  timeoutMs,
}) {
  const sdk = await loadQwenSdk();
  const queryFn = sdk?.query;
  if (typeof queryFn !== 'function') {
    throw new Error('Qwen SDK does not export a query() function');
  }

  const parts = [];
  const systemPromptText = (systemPrompt || '').trim();
  if (systemPromptText) {
    parts.push(systemPromptText);
  }
  parts.push(prompt);

  const abortController = new AbortController();
  const options = buildAskQueryOptions({ cwd, model, abortController });
  // Same managed-memory env as chat turns: a one-shot query also awaits
  // `result`, so memory tasks would stall titles/prompts by the same margin.
  const memoryEnv = managedMemoryQueryEnv();
  if (memoryEnv) options.env = memoryEnv;
  const timeoutHandle = setTimeout(
    () => abortController.abort(),
    timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  );

  let text = '';
  let lastSnapshot = '';

  try {
    for await (const message of queryFn({ prompt: parts.join('\n\n'), options })) {
      const type = message?.type;
      const content = message?.message?.content;

      if (type === 'partial_assistant' && Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && block.text) {
            text += block.text;
            if (typeof onDelta === 'function') onDelta(block.text);
          }
        }
        continue;
      }

      if (type === 'assistant') {
        let snapshot = '';
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && block.text) snapshot += block.text;
          }
        } else if (typeof content === 'string') {
          snapshot = content;
        }
        if (!snapshot) continue;
        const delta = extractAppendedDelta(lastSnapshot, snapshot);
        lastSnapshot = snapshot;
        if (delta) {
          text += delta;
          if (typeof onDelta === 'function') onDelta(delta);
        }
        continue;
      }

      if (type === 'result') {
        const result = typeof message.result === 'string' ? message.result.trim() : '';
        if (!text.trim() && result) {
          text = result;
          if (typeof onDelta === 'function') onDelta(result);
        }
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const finalText = text.trim();
  if (!finalText) {
    throw new Error('Qwen one-shot response is empty');
  }
  return finalText;
}

/**
 * One-shot text generation for an AI feature.
 *
 * @param {object} options
 * @param {'qwen'} options.provider
 * @param {string} options.prompt
 * @param {string} [options.systemPrompt]
 * @param {string} [options.model]
 * @param {string} [options.cwd]
 * @param {(delta: string) => void} [options.onDelta]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string>}
 */
export async function askOneShot({
  provider,
  prompt,
  systemPrompt,
  model,
  cwd,
  onDelta,
  timeoutMs,
} = {}) {
  if (!provider || !isAskProvider(provider)) {
    throw new Error(`Unsupported ask provider: ${provider || '(none)'}`);
  }
  if (!prompt || !String(prompt).trim()) {
    return '';
  }

  return generateWithQwenSdk({
    prompt: String(prompt),
    systemPrompt,
    model,
    cwd,
    onDelta,
    timeoutMs,
  });
}
