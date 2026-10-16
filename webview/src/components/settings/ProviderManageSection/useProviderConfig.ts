import { useCallback, useEffect, useRef, useState } from 'react';
import { sendBridgeEvent } from '../../../utils/bridge';
import type {
  ProviderConfigOp,
  ProviderConfigResult,
  ProviderConfigSnapshot,
} from '../../../types/providerConfig';

const OP_TIMEOUT_MS = 30_000;

type Pending = {
  resolve: (result: ProviderConfigResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Module-level pending map survives StrictMode double-mounts; every op gets a
// unique requestId so results correlate even if responses arrive out of order.
const pending = new Map<string, Pending>();
let requestSeq = 0;

function parseResult(raw: unknown): ProviderConfigResult | null {
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.ok !== 'boolean') return null;
  return obj as unknown as ProviderConfigResult;
}

function flushPending(result: ProviderConfigResult): void {
  if (!result.requestId) return;
  const entry = pending.get(result.requestId);
  if (!entry) return;
  pending.delete(result.requestId);
  clearTimeout(entry.timer);
  entry.resolve(result);
}

function rejectAllPending(code: string, message: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, code, message });
    pending.delete(id);
  }
}

export interface UseProviderConfigReturn {
  snapshot: ProviderConfigSnapshot | null;
  loading: boolean;
  loadError: string | null;
  /** Run one op; resolves with the service result (snapshot included on success). */
  runOp: (payload: ProviderConfigOp) => Promise<ProviderConfigResult>;
  /** Re-request the snapshot (e.g. after the user edited the file externally). */
  reload: () => void;
}

/**
 * Provider-config data channel:
 *  - `get_provider_config` → window.updateProviderConfig (redacted snapshot)
 *  - `provider_config_op`  → window.providerConfigResult ({ok, snapshot, requestId})
 *
 * The snapshot never contains API key values — only per-key status — so it is
 * safe to keep in React state.
 */
export function useProviderConfig(): UseProviderConfigReturn {
  const [snapshot, setSnapshot] = useState<ProviderConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    window.updateProviderConfig = (raw: string) => {
      const result = parseResult(raw);
      if (!result || !mountedRef.current) return;
      if (result.ok && result.snapshot) {
        setSnapshot(result.snapshot);
        setLoadError(null);
        setLoading(false);
      } else if (!result.ok) {
        setLoadError(result.message ?? 'load failed');
        setLoading(false);
      }
    };

    window.providerConfigResult = (raw: string) => {
      const result = parseResult(raw);
      if (!result) return;
      if (result.ok && result.snapshot && mountedRef.current) {
        setSnapshot(result.snapshot);
        setLoadError(null);
        setLoading(false);
      }
      flushPending(result);
    };

    sendBridgeEvent('get_provider_config');

    return () => {
      mountedRef.current = false;
      if (window.updateProviderConfig) delete window.updateProviderConfig;
      if (window.providerConfigResult) delete window.providerConfigResult;
      rejectAllPending('cancelled', 'settings page closed');
    };
  }, []);

  const runOp = useCallback((payload: ProviderConfigOp): Promise<ProviderConfigResult> => {
    requestSeq += 1;
    const requestId = `pc-${Date.now()}-${requestSeq}`;
    const body: ProviderConfigOp = { ...payload, requestId };

    return new Promise<ProviderConfigResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({
          ok: false,
          code: 'timeout',
          message: 'provider config operation timed out',
          requestId,
        });
      }, OP_TIMEOUT_MS);
      pending.set(requestId, { resolve, timer });
      sendBridgeEvent('provider_config_op', JSON.stringify(body));
    });
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    sendBridgeEvent('get_provider_config');
  }, []);

  return { snapshot, loading, loadError, runOp, reload };
}
