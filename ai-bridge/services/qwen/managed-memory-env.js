/**
 * GUI-side managed auto-memory switch (方案 G).
 *
 * Headless turns block on managed auto-memory tasks before emitting `result`
 * (interactive TUI does not), which leaves the GUI spinner waiting 40s-5min
 * after the model stops. The plugin therefore keeps memory OFF by default and
 * injects `QWEN_CODE_SYSTEM_DEFAULTS_PATH` pointing at a plugin-owned settings
 * fragment with both memory keys set to false. The system-defaults layer has
 * the LOWEST merge priority in CLI 0.25.0 (system > workspace > user >
 * system-defaults), so explicit user/workspace/enterprise config always wins
 * and no other settings file is bypassed.
 *
 * State flows: Java persists the toggle in ~/.qwenmate/config.json and
 * projects it to `managed-memory.json` (this module never reads config.json).
 * Missing or corrupt projection reads as OFF — the safe default keeps the
 * end-of-turn stall fixed.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQwenMateDir } from '../../utils/path-utils.js';

export const MANAGED_MEMORY_FILE_NAME = 'managed-memory.json';
export const MANAGED_MEMORY_OVERRIDES_FILE_NAME = 'managed-memory-overrides.json';

const MEMORY_OFF_OVERRIDES = `${JSON.stringify({
  memory: {
    enableManagedAutoMemory: false,
    enableManagedAutoDream: false,
  },
}, null, 2)}\n`;

// mtime-keyed cache: one stat per query, re-parse only when Java rewrites.
let toggleCache = { path: null, mtimeMs: -1, enabled: false };

function readManagedMemoryEnabled(dir) {
  const path = join(dir, MANAGED_MEMORY_FILE_NAME);
  let mtimeMs;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    toggleCache = { path, mtimeMs: -1, enabled: false };
    return false;
  }
  if (toggleCache.path === path && toggleCache.mtimeMs === mtimeMs) {
    return toggleCache.enabled;
  }
  let enabled = false;
  try {
    enabled = JSON.parse(readFileSync(path, 'utf8'))?.managedMemoryEnabled === true;
  } catch {
    // Corrupt projection: fall through as OFF (safe default).
  }
  toggleCache = { path, mtimeMs, enabled };
  return enabled;
}

/**
 * Env delta for the CLI spawn, or undefined when managed memory should follow
 * the plain CLI configuration (toggle ON).
 *
 * @param {string} [dir] qwen-mate data dir (injectable for tests)
 * @returns {Record<string, string> | undefined}
 */
export function managedMemoryQueryEnv(dir = getQwenMateDir()) {
  if (readManagedMemoryEnabled(dir)) {
    return undefined;
  }
  const overridesPath = join(dir, MANAGED_MEMORY_OVERRIDES_FILE_NAME);
  try {
    mkdirSync(dir, { recursive: true });
    let current = null;
    try {
      current = readFileSync(overridesPath, 'utf8');
    } catch {
      // Missing overrides file → write it below.
    }
    if (current !== MEMORY_OFF_OVERRIDES) {
      writeFileSync(overridesPath, MEMORY_OFF_OVERRIDES, 'utf8');
    }
    return { QWEN_CODE_SYSTEM_DEFAULTS_PATH: overridesPath };
  } catch (error) {
    console.error(`[managed-memory] failed to write overrides for ${overridesPath}: ${error.message}`);
    // Stale-but-present overrides still enforce OFF; only a missing file means
    // we cannot inject at all.
    return existsSync(overridesPath) ? { QWEN_CODE_SYSTEM_DEFAULTS_PATH: overridesPath } : undefined;
  }
}
