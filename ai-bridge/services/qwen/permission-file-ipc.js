/**
 * File-based permission IPC between the Node bridge and the Java host.
 *
 * Contract (must stay in sync with Java `PermissionFileProtocol`):
 *   - request:  <dir>/request-<sessionId>-<requestId>.json   {requestId, toolName, inputs, cwd}
 *   - response: <dir>/response-<sessionId>-<requestId>.json  {allow: boolean}
 *   - only an explicit boolean `allow` resolves a request; a half-written or
 *     malformed response keeps the poller waiting so a torn file can never
 *     grant permission by accident.
 *
 * The directory / session id / safety-net timeout come from the env Java
 * injects when spawning the bridge (QWEN_MATE_PERMISSION_DIR,
 * QWEN_MATE_SESSION_ID, QWEN_MATE_PERMISSION_SAFETY_NET_MS = dialog timeout +
 * buffer), so the JVM side answers first and Node only backs it up.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Session/request ids become file names — keep them path-safe. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Fallback for QWEN_MATE_PERMISSION_SAFETY_NET_MS: dialog 300s + buffer 60s. */
export const DEFAULT_SAFETY_NET_MS = 360_000;

export const RESPONSE_POLL_INTERVAL_MS = 250;

/**
 * Read the permission IPC configuration from the bridge environment.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ok: false, reason: string} | {ok: true, dir: string, sessionId: string, safetyNetMs: number}}
 */
export function resolvePermissionIpcConfig(env = process.env) {
  const dir = typeof env.QWEN_MATE_PERMISSION_DIR === 'string'
    ? env.QWEN_MATE_PERMISSION_DIR.trim()
    : '';
  if (!dir) {
    return { ok: false, reason: 'QWEN_MATE_PERMISSION_DIR not set' };
  }
  const sessionId = typeof env.QWEN_MATE_SESSION_ID === 'string'
    ? env.QWEN_MATE_SESSION_ID.trim()
    : '';
  if (!sessionId || !SAFE_ID_PATTERN.test(sessionId)) {
    return { ok: false, reason: 'QWEN_MATE_SESSION_ID missing or invalid' };
  }
  const parsed = Number(env.QWEN_MATE_PERMISSION_SAFETY_NET_MS);
  const safetyNetMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAFETY_NET_MS;
  return { ok: true, dir, sessionId, safetyNetMs };
}

function requestPath(config, requestId) {
  return join(config.dir, `request-${config.sessionId}-${requestId}.json`);
}

function responsePath(config, requestId) {
  return join(config.dir, `response-${config.sessionId}-${requestId}.json`);
}

function assertSafeRequestId(requestId) {
  if (typeof requestId !== 'string' || !SAFE_ID_PATTERN.test(requestId)) {
    throw new Error('invalid permission requestId');
  }
}

/**
 * Write the request file for the Java PermissionRequestWatcher.
 * Written via temp-file + rename so the watcher never reads a partial file.
 *
 * @param {{dir: string, sessionId: string}} config
 * @param {string} requestId
 * @param {{toolName?: string, inputs?: object, cwd?: string}} payload
 */
export function writePermissionRequest(config, requestId, payload = {}) {
  assertSafeRequestId(requestId);
  mkdirSync(config.dir, { recursive: true });
  const body = {
    requestId,
    toolName: payload.toolName,
    inputs: payload.inputs && typeof payload.inputs === 'object' ? payload.inputs : {},
  };
  if (payload.cwd) {
    body.cwd = payload.cwd;
  }
  const target = requestPath(config, requestId);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(body), 'utf8');
  renameSync(temp, target);
}

/**
 * Poll for the response file written by Java. Resolves `onResult` exactly once
 * with an explicit boolean; unreadable / non-boolean payloads keep polling.
 * The response file is consumed (deleted) once a decision is delivered.
 *
 * @param {{dir: string, sessionId: string}} config
 * @param {string} requestId
 * @param {{onResult: (allow: boolean) => void, intervalMs?: number}} options
 * @returns {{stop: () => void}}
 */
export function pollPermissionResponse(config, requestId, { onResult, intervalMs = RESPONSE_POLL_INTERVAL_MS } = {}) {
  assertSafeRequestId(requestId);
  const file = responsePath(config, requestId);
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return; // not written yet (or already consumed)
    }
    let allow = null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.allow === 'boolean') {
        allow = parsed.allow;
      }
    } catch {
      return; // half-written JSON — keep polling
    }
    if (allow === null) {
      return; // not an explicit boolean — keep polling
    }
    stop();
    try {
      unlinkSync(file);
    } catch {
      // already gone
    }
    onResult(allow);
  }, intervalMs);

  return { stop };
}

/**
 * Best-effort removal of both IPC files for a request (used when the turn is
 * aborted before Java can answer, so no ghost dialog / stale response lingers).
 */
export function removePermissionFiles(config, requestId) {
  if (!SAFE_ID_PATTERN.test(requestId)) {
    return;
  }
  for (const file of [requestPath(config, requestId), responsePath(config, requestId)]) {
    try {
      unlinkSync(file);
    } catch {
      // not present — nothing to clean
    }
  }
}
