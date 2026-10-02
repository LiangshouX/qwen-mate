/**
 * Path utilities module
 * Handles path normalization, temporary directory detection, and working directory selection
 */

import fs from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';

// Cache the resolved home directory path to avoid redundant computation
let cachedRealHomeDir = null;

/**
 * Get the real (physical) home directory path.
 * Resolves issues on Windows where the home directory may have been moved
 * or accessed via symlinks/junctions.
 * Uses fs.realpathSync to obtain the physical path, ensuring consistency
 * with the actual filesystem.
 * @returns {string} The resolved physical home directory path
 */
export function getRealHomeDir() {
  if (cachedRealHomeDir) {
    return cachedRealHomeDir;
  }

  const rawHome = homedir();
  try {
    // Use realpathSync to get the real physical path, resolving symlinks/junctions
    cachedRealHomeDir = fs.realpathSync(rawHome);
  } catch {
    // If realpath fails, fall back to the raw path
    console.warn('[path-utils] Failed to resolve real home path, using raw path:', rawHome);
    cachedRealHomeDir = rawHome;
  }

  return cachedRealHomeDir;
}


const LEGACY_DIR_NAME = '.codemoss';
const CURRENT_DIR_NAME = '.qwenmate';
let legacyMigrated = false;

/**
 * One-time migration of the legacy ~/.codemoss directory to ~/.qwenmate.
 * Rename-wholesale when the target is absent; otherwise move only the missing
 * top-level entries so an existing install is never overwritten. Idempotent and
 * best-effort: failures are logged and ignored (Java migrates at startup too).
 */
function migrateLegacyDirOnce(home) {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    const legacyDir = join(home, LEGACY_DIR_NAME);
    const currentDir = join(home, CURRENT_DIR_NAME);
    if (!fs.existsSync(legacyDir)) return;
    if (!fs.existsSync(currentDir)) {
      fs.renameSync(legacyDir, currentDir);
      console.error('[path-utils] Migrated ' + legacyDir + ' -> ' + currentDir);
      return;
    }
    for (const entry of fs.readdirSync(legacyDir)) {
      const target = join(currentDir, entry);
      if (!fs.existsSync(target)) {
        fs.renameSync(join(legacyDir, entry), target);
      }
    }
    if (fs.readdirSync(legacyDir).length === 0) {
      fs.rmdirSync(legacyDir);
    }
    console.error('[path-utils] Merged legacy entries from ' + legacyDir + ' into ' + currentDir);
  } catch (err) {
    console.warn('[path-utils] Legacy dir migration failed:', err.message);
  }
}

/**
 * Get the .qwenmate configuration directory path.
 * @returns {string} The ~/.qwenmate directory path
 */
export function getQwenMateDir() {
  migrateLegacyDirOnce(getRealHomeDir());
  return join(getRealHomeDir(), '.qwenmate');
}

/**
 * Get the list of system temporary directory prefixes
 * Supports Windows, macOS, and Linux
 */
export function getTempPathPrefixes() {
  const prefixes = [];

  // 1. Get the system temp directory via os.tmpdir()
  const systemTempDir = tmpdir();
  if (systemTempDir) {
    prefixes.push(normalizePathForComparison(systemTempDir));
  }

  // 2. Windows-specific environment variables
  if (process.platform === 'win32') {
    const winTempVars = ['TEMP', 'TMP', 'LOCALAPPDATA'];
    for (const varName of winTempVars) {
      const value = process.env[varName];
      if (value) {
        prefixes.push(normalizePathForComparison(value));
        // Windows Temp is typically at LOCALAPPDATA\Temp
        if (varName === 'LOCALAPPDATA') {
          prefixes.push(normalizePathForComparison(join(value, 'Temp')));
        }
      }
    }
    // Default Windows temp paths
    prefixes.push('c:\\windows\\temp');
    prefixes.push('c:\\temp');
  } else {
    // Unix/macOS temp path prefixes
    prefixes.push('/tmp');
    prefixes.push('/var/tmp');
    prefixes.push('/private/tmp');

    // Environment variables
    if (process.env.TMPDIR) {
      prefixes.push(normalizePathForComparison(process.env.TMPDIR));
    }
  }

  // Deduplicate
  return [...new Set(prefixes)];
}

/**
 * Normalize a path for comparison purposes.
 * On Windows: converts to lowercase and uses forward slashes.
 * @internal Exposed for unit testing; not part of the public API.
 */
export function normalizePathForComparison(pathValue) {
  if (!pathValue) return '';
  let normalized = pathValue.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Sanitize a path candidate.
 * @param {string} candidate - The candidate path
 * @returns {string|null} The normalized path, or null if invalid
 */
export function sanitizePath(candidate) {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    return null;
  }
  try {
    return resolve(candidate.trim());
  } catch {
    return null;
  }
}

/**
 * Check whether a path is inside a temporary directory.
 * @param {string} pathValue - The path to check
 * @returns {boolean}
 */
export function isTempDirectory(pathValue) {
  if (!pathValue) return false;

  const normalizedPath = normalizePathForComparison(pathValue);
  const tempPrefixes = getTempPathPrefixes();

  return tempPrefixes.some(tempPath => {
    if (!tempPath) return false;
    return normalizedPath.startsWith(tempPath) ||
           normalizedPath === tempPath;
  });
}

// Cache the resolved ai-bridge install directory path.
let cachedBridgeDir = null;

/**
 * Resolve the ai-bridge install directory from this module's own location.
 * This file lives at <bridge>/utils/path-utils.js, so the bridge root is one
 * level up from its directory. Deriving it from import.meta.url is reliable
 * regardless of process.cwd(), which the daemon mutates via process.chdir()
 * between turns.
 * @returns {string} The resolved physical ai-bridge directory path
 */
function getBridgeDir() {
  if (cachedBridgeDir) {
    return cachedBridgeDir;
  }
  const bridgeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    // Match getRealHomeDir(): resolve symlinks/junctions so comparisons against
    // a possibly-realpath'd process.cwd() stay consistent.
    cachedBridgeDir = fs.realpathSync(bridgeDir);
  } catch (err) {
    console.warn('[WARN] getBridgeDir: realpathSync failed, using unresolved path:', err.message);
    cachedBridgeDir = bridgeDir;
  }
  return cachedBridgeDir;
}

/**
 * Check whether a path points at the ai-bridge install directory itself.
 *
 * The daemon launches with process.cwd() === the bridge dir, and a per-process
 * worker falls back to it when no valid cwd is supplied. Resolving the working
 * directory to it makes the SDK persist sessions under
 * a sanitized-bridge-dir key, scattering every project's history
 * into one bogus folder (issue #1343). Such a candidate must always be rejected.
 * @param {string} pathValue - The path to check
 * @returns {boolean}
 */
export function isBridgeDirectory(pathValue) {
  if (!pathValue) return false;
  return normalizePathForComparison(pathValue) === normalizePathForComparison(getBridgeDir());
}

/**
 * Intelligently select the working directory.
 * @param {string} requestedCwd - The requested working directory
 * @returns {string} The selected working directory
 */
export function selectWorkingDirectory(requestedCwd) {
  const candidates = [];

  const envProjectPath = process.env.IDEA_PROJECT_PATH || process.env.PROJECT_PATH;

  if (requestedCwd && requestedCwd !== 'undefined' && requestedCwd !== 'null') {
    candidates.push(requestedCwd);
  }
  if (envProjectPath) {
    candidates.push(envProjectPath);
  }

  candidates.push(process.cwd());
  candidates.push(getRealHomeDir());

  console.error('[DEBUG] selectWorkingDirectory candidates:', JSON.stringify(candidates));

  for (const candidate of candidates) {
    const normalized = sanitizePath(candidate);
    if (!normalized) continue;

    // Never resolve the working directory to the ai-bridge install dir itself
    // (issue #1343). The daemon launches with process.cwd() === the bridge dir,
    // so an empty requestedCwd + missing IDEA_PROJECT_PATH would otherwise land
    // here and make the SDK persist sessions under the bridge dir's own key,
    // hiding every project's history.
    if (isBridgeDirectory(normalized)) {
      console.error('[DEBUG] Skipping ai-bridge directory candidate:', normalized);
      continue;
    }

    if (isTempDirectory(normalized) && envProjectPath) {
      console.error('[DEBUG] Skipping temp directory candidate:', normalized);
      continue;
    }

    try {
      const stats = fs.statSync(normalized);
      if (stats.isDirectory()) {
        console.error('[DEBUG] selectWorkingDirectory resolved:', normalized);
        return normalized;
      }
    } catch {
      // Ignore invalid candidates
      console.error('[DEBUG] Candidate is invalid:', normalized);
    }
  }

  console.error('[DEBUG] selectWorkingDirectory fallback triggered');
  // Guard: reject the bridge dir even from IDEA_PROJECT_PATH (e.g. when the user
  // is developing the bridge itself). The home dir is always a safe fallback.
  const fallback = envProjectPath || getRealHomeDir();
  if (isBridgeDirectory(fallback)) {
    console.error('[DEBUG] Fallback env path is bridge dir, using home dir instead');
    return getRealHomeDir();
  }
  return fallback;
}
