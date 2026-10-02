/**
 * Path utility module (CommonJS version)
 * Responsible for path normalization and home directory handling
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Cache the resolved home directory path to avoid repeated lookups
let cachedRealHomeDir = null;

/**
 * Get the resolved home directory path.
 * Handles cases on Windows where the user directory is moved or uses a symlink/junction.
 * @returns {string} Resolved home directory path
 */
function getRealHomeDir() {
  if (cachedRealHomeDir) {
    return cachedRealHomeDir;
  }

  const rawHome = os.homedir();
  try {
    cachedRealHomeDir = fs.realpathSync(rawHome);
  } catch {
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
    const legacyDir = path.join(home, LEGACY_DIR_NAME);
    const currentDir = path.join(home, CURRENT_DIR_NAME);
    if (!fs.existsSync(legacyDir)) return;
    if (!fs.existsSync(currentDir)) {
      fs.renameSync(legacyDir, currentDir);
      console.error('[path-utils] Migrated ' + legacyDir + ' -> ' + currentDir);
      return;
    }
    for (const entry of fs.readdirSync(legacyDir)) {
      const target = path.join(currentDir, entry);
      if (!fs.existsSync(target)) {
        fs.renameSync(path.join(legacyDir, entry), target);
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
 * @returns {string} ~/.qwenmate directory path
 */
function getQwenMateDir() {
  migrateLegacyDirOnce(getRealHomeDir());
  return path.join(getRealHomeDir(), '.qwenmate');
}


module.exports = {
  getRealHomeDir,
  getQwenMateDir
};
