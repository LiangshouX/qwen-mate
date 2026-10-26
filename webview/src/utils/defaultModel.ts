import { sendBridgeEvent } from './bridge';

/**
 * One-shot request/response bridge for the global default-model write.
 *
 * Java answers through the single `window.onQwenDefaultModelResult` slot, so
 * concurrent callers cannot be told apart — a newer request supersedes a
 * pending one instead of letting a stale answer resolve the wrong promise.
 */
export interface DefaultModelWriteResult {
  success: boolean;
  modelId?: string;
  code?: string;
  error?: string;
}

type PendingRequest = {
  resolve: (result: DefaultModelWriteResult) => void;
  timer: number;
};

const TIMEOUT_MS = 15000;

let pending: PendingRequest | null = null;
let callbackRegistered = false;

function settle(result: DefaultModelWriteResult): void {
  const current = pending;
  if (!current) return;
  pending = null;
  window.clearTimeout(current.timer);
  current.resolve(result);
}

type RawDefaultModelResult = {
  success?: boolean;
  modelId?: string;
  code?: string;
  error?: string;
};

function handleResultPayload(payload: string | RawDefaultModelResult): void {
  let parsed: RawDefaultModelResult | null = null;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload) as RawDefaultModelResult;
    } catch {
      parsed = null;
    }
  } else if (payload && typeof payload === 'object') {
    parsed = payload;
  }
  if (!parsed || typeof parsed.success !== 'boolean') {
    settle({ success: false, code: 'invalid_result' });
    return;
  }
  settle({
    success: parsed.success,
    ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
    ...(parsed.code ? { code: parsed.code } : {}),
    ...(parsed.error ? { error: parsed.error } : {}),
  });
}

function ensureCallback(): void {
  if (callbackRegistered || typeof window === 'undefined') return;
  window.onQwenDefaultModelResult = handleResultPayload;
  callbackRegistered = true;
}

/**
 * Ask Java to persist `modelId` as the CLI's global default model. Resolves
 * with the writer result; never rejects (callers show a toast/inline error).
 */
export function setDefaultModel(modelId: string, provider?: string): Promise<DefaultModelWriteResult> {
  ensureCallback();
  // Supersede a pending request — its answer can no longer be matched.
  settle({ success: false, code: 'superseded' });

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      settle({ success: false, code: 'timeout' });
    }, TIMEOUT_MS);
    pending = { resolve, timer };

    const sent = sendBridgeEvent('set_qwen_default_model', JSON.stringify({
      modelId,
      ...(provider ? { provider } : {}),
    }));
    if (!sent) {
      settle({ success: false, code: 'bridge_unavailable' });
    }
  });
}

/** Test-only: drop the pending request and the registered callback. */
export function __resetDefaultModelBridgeForTests(): void {
  settle({ success: false, code: 'reset' });
  if (typeof window !== 'undefined') {
    delete window.onQwenDefaultModelResult;
  }
  callbackRegistered = false;
}
