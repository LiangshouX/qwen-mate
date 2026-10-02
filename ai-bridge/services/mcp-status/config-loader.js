/**
 * MCP configuration loader module
 * Provides functionality to read MCP server configuration from Qwen Code
 * settings (~/.qwen/settings.json and <project>/.qwen/settings.json,
 * mcpServers field).
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getRealHomeDir } from '../../utils/path-utils.js';
import { log } from './logger.js';

/**
 * Expand ${VAR} placeholders in an MCP server env value
 *
 * Qwen Code resolves these from the `env` section of the project and user
 * `.qwen/settings.json`, falling back to the process environment. The plugin passed the
 * literal placeholder through to the spawned MCP server, so containers
 * received e.g. DATABASE_URI=${NEXUS_MCP_DB_URI} verbatim (#1722).
 *
 * Lookup order (first hit wins): project settings env -> user
 * settings env -> process.env. Unresolvable placeholders are left as-is so
 * misconfiguration stays visible in logs instead of becoming empty strings.
 *
 * @param {string} value - Raw env value that may contain ${VAR} placeholders
 * @param {Object} projectEnv - env map from <project>/.qwen/settings.json
 * @param {Object} userEnv - env map from ~/.qwen/settings.json
 * @returns {string} Value with all resolvable ${VAR} placeholders expanded
 */
function expandEnvPlaceholders(value, projectEnv, userEnv) {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  // ${VAR} only - no command substitution, nesting, or defaults syntax
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(projectEnv, name)) {
      return String(projectEnv[name]);
    }
    if (Object.prototype.hasOwnProperty.call(userEnv, name)) {
      return String(userEnv[name]);
    }
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      return process.env[name];
    }
    log('warn', `[MCP Config] Unresolved \${${name}} placeholder left as-is in MCP env`);
    return match;
  });
}

/**
 * Load the env override maps used for ${VAR} expansion
 *
 * Reads the `env` section of <project>/.qwen/settings.json (project-local)
 * and ~/.qwen/settings.json (user-level), matching the resolution order
 * Qwen Code uses for .mcp.json placeholders.
 * Files that are missing, unparseable, or have no env section produce {}.
 *
 * @param {string} cwd - Current working directory (project root)
 * @returns {Promise<{projectEnv: Object, userEnv: Object}>} env maps
 */
async function loadEnvExpansionSources(cwd) {
  const projectEnv = {};
  const userEnv = {};

  const sources = [
    { label: 'project qwen settings.json', file: cwd ? join(cwd, '.qwen', 'settings.json') : null, into: projectEnv },
    { label: 'user qwen settings.json', file: join(getRealHomeDir(), '.qwen', 'settings.json'), into: userEnv }
  ];

  for (const source of sources) {
    if (!source.file || !existsSync(source.file)) continue;
    try {
      const parsed = JSON.parse(await readFile(source.file, 'utf8'));
      if (parsed && typeof parsed.env === 'object' && parsed.env !== null) {
        Object.assign(source.into, parsed.env);
      }
    } catch (e) {
      log('warn', `[MCP Config] Failed to read ${source.label} for env expansion:`, e.message);
    }
  }

  return { projectEnv, userEnv };
}

/**
 * Apply ${VAR} expansion to every env value of every server config
 * @param {Object} mcpServers - Server name -> config map
 * @param {Object} projectEnv - env map from <project>/.qwen/settings.json
 * @param {Object} userEnv - env map from ~/.qwen/settings.json
 * @returns {Object} New map with expanded env values (input is not mutated)
 */
function expandMcpServersEnv(mcpServers, projectEnv, userEnv) {
  const expanded = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    if (config && typeof config === 'object' && config.env && typeof config.env === 'object') {
      const env = {};
      for (const [key, value] of Object.entries(config.env)) {
        env[key] = expandEnvPlaceholders(value, projectEnv, userEnv);
      }
      expanded[name] = { ...config, env };
    } else {
      expanded[name] = config;
    }
  }
  return expanded;
}

/**
 * Validate the basic structure of an MCP server configuration
 * @param {Object} serverConfig - Server configuration object
 * @returns {boolean} Whether the configuration is valid
 */
function isValidServerConfig(serverConfig) {
  if (!serverConfig || typeof serverConfig !== 'object') {
    return false;
  }
  // Must have command (stdio) or url (http)
  const hasCommand = typeof serverConfig.command === 'string' && serverConfig.command.length > 0;
  const hasUrl = typeof serverConfig.url === 'string' && serverConfig.url.length > 0;
  if (!hasCommand && !hasUrl) {
    return false;
  }
  // args must be an array if present
  if (serverConfig.args !== undefined && !Array.isArray(serverConfig.args)) {
    return false;
  }
  // env must be an object if present
  if (serverConfig.env !== undefined && (typeof serverConfig.env !== 'object' || serverConfig.env === null)) {
    return false;
  }
  return true;
}


/**
 * Match an MCP server name against qwen's `mcp.excluded` entry patterns.
 * Qwen Code supports `*` wildcards in excluded entries (matchesServerPattern).
 * @param {string} name - Server name
 * @param {string} pattern - Exclusion entry (exact name or wildcard pattern)
 * @returns {boolean}
 */
function matchesServerPattern(name, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  if (!pattern.includes('*')) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * Whether a server name is disabled given a set of exact names / patterns.
 * @param {string} serverName
 * @param {Set<string>} disabledServers
 * @returns {boolean}
 */
function isNameDisabled(serverName, disabledServers) {
  if (disabledServers.has(serverName)) return true;
  for (const pattern of disabledServers) {
    if (pattern.includes('*') && matchesServerPattern(serverName, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Read a JSON object from disk, tolerating missing/unparseable files.
 * @param {string} filePath
 * @param {string} label - Human-readable label for log messages
 * @returns {Promise<Object|null>} Parsed object or null
 */
async function readJsonFileSafe(filePath, label) {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    log('warn', `[MCP Config] ${label} is not a JSON object, ignoring`);
    return null;
  } catch (e) {
    log('warn', `[MCP Config] Failed to parse ${label}:`, e.message);
    return null;
  }
}

/**
 * Extract the disabled-server names/patterns from a settings-shaped object.
 * Qwen Code stores toggle state in `mcp.excluded`; the legacy
 * `disabledMcpServers` array is honored for compatibility.
 * @param {Object} settings
 * @param {Set<string>} into
 */
function collectDisabledServers(settings, into) {
  if (!settings || typeof settings !== 'object') return;
  const excluded = settings.mcp && typeof settings.mcp === 'object'
    ? settings.mcp.excluded
    : undefined;
  if (Array.isArray(excluded)) {
    for (const entry of excluded) {
      if (typeof entry === 'string' && entry.length > 0) into.add(entry);
    }
  }
  if (Array.isArray(settings.disabledMcpServers)) {
    for (const entry of settings.disabledMcpServers) {
      if (typeof entry === 'string' && entry.length > 0) into.add(entry);
    }
  }
}

/**
 * Parse MCP config from the Qwen Code settings layout:
 *   user:    ~/.qwen/settings.json      -> mcpServers / mcp.excluded
 *   project: <cwd>/.qwen/settings.json  -> mcpServers / mcp.excluded
 * Project entries override user entries with the same name.
 *
 * @param {string} cwd - Current working directory (used for project detection)
 * @returns {Promise<{mcpServers: Object, disabledServers: Set<string>} | null>}
 *   null when no qwen settings source is available/valid.
 */
async function parseQwenSettingsConfig(cwd = null) {
  const userFile = join(getRealHomeDir(), '.qwen', 'settings.json');
  const projectFile = cwd ? join(cwd, '.qwen', 'settings.json') : null;

  const userSettings = await readJsonFileSafe(userFile, 'user qwen settings.json');
  const projectSettings = projectFile
    ? await readJsonFileSafe(projectFile, 'project qwen settings.json')
    : null;

  if (!userSettings && !projectSettings) {
    return null;
  }

  const hasUserServers = userSettings
    && userSettings.mcpServers !== undefined
    && typeof userSettings.mcpServers === 'object'
    && userSettings.mcpServers !== null
    && !Array.isArray(userSettings.mcpServers);
  const hasProjectServers = projectSettings
    && projectSettings.mcpServers !== undefined
    && typeof projectSettings.mcpServers === 'object'
    && projectSettings.mcpServers !== null
    && !Array.isArray(projectSettings.mcpServers);

  if (userSettings && userSettings.mcpServers !== undefined && !hasUserServers) {
    log('warn', '[MCP Config] user qwen settings.json mcpServers is not an object, ignoring');
  }
  if (projectSettings && projectSettings.mcpServers !== undefined && !hasProjectServers) {
    log('warn', '[MCP Config] project qwen settings.json mcpServers is not an object, ignoring');
  }

  // No usable mcpServers block in either file.
  if (!hasUserServers && !hasProjectServers) {
    return null;
  }

  // Project entries override user entries with the same name (qwen scope merge).
  const mcpServers = {};
  if (hasUserServers) Object.assign(mcpServers, userSettings.mcpServers);
  if (hasProjectServers) Object.assign(mcpServers, projectSettings.mcpServers);

  const disabledServers = new Set();
  collectDisabledServers(userSettings, disabledServers);
  collectDisabledServers(projectSettings, disabledServers);

  log('info', '[MCP Config] Using qwen settings MCP configuration');
  return { mcpServers, disabledServers };
}


/**
 * Resolve the MCP server configuration from the Qwen Code settings sources
 * (~/.qwen/settings.json, <project>/.qwen/settings.json). Unavailable/invalid
 * sources degrade gracefully instead of throwing.
 * @param {string} cwd - Current working directory (used for project detection)
 * @returns {Promise<{mcpServers: Object, disabledServers: Set<string>} | null>}
 */
async function parseMcpConfig(cwd = null) {
  const parsed = await parseQwenSettingsConfig(cwd);
  if (!parsed) return null;

  // Expand ${VAR} placeholders in server env values (e.g. from settings env
  // blocks or the process environment) so spawned servers receive real values,
  // matching Qwen Code's behaviour for the same config (#1722).
  const { projectEnv, userEnv } = await loadEnvExpansionSources(cwd);
  return {
    mcpServers: expandMcpServersEnv(parsed.mcpServers, projectEnv, userEnv),
    disabledServers: parsed.disabledServers
  };
}

/**
 * Read MCP server configuration from the resolved config source
 * (Qwen Code settings).
 * Supports two modes:
 * 1. Global config - uses the global mcpServers
 * 2. Project config - uses project-specific mcpServers
 * @param {string} cwd - Current working directory (used for project detection)
 * @returns {Promise<Array<{name: string, config: Object}>>} List of enabled MCP servers
 */
export async function loadMcpServersConfig(cwd = null) {
  try {
    const parsed = await parseMcpConfig(cwd);
    if (!parsed) return [];

    const { mcpServers, disabledServers } = parsed;

    const enabledServers = [];
    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      if (!isNameDisabled(serverName, disabledServers)) {
        // Skip invalid server configurations
        if (!isValidServerConfig(serverConfig)) {
          log('warn', `Skipping invalid server config: ${serverName}`);
          continue;
        }
        enabledServers.push({ name: serverName, config: serverConfig });
      }
    }

    log('info', '[MCP Config] Loaded', enabledServers.length, 'enabled MCP servers');
    return enabledServers;
  } catch (error) {
    log('error', 'Failed to load MCP servers config:', error.message);
    return [];
  }
}

/**
 * Load enabled MCP server config and return as a Record<name, config> for the
 * Qwen Code SDK's `mcpServers` option.
 *
 * Returns null (rather than an empty object) when no servers are enabled, so
 * callers can naturally write `...(mcpServers && { mcpServers })` to omit the
 * field from SDK options entirely.
 *
 * @param {string} cwd - Current working directory (used for project detection)
 * @returns {Promise<Record<string, Object> | null>}
 */
export async function loadMcpServersConfigAsRecord(cwd = null) {
  const list = await loadMcpServersConfig(cwd);
  if (list.length === 0) return null;
  return Object.fromEntries(list.map(({ name, config }) => [name, config]));
}

/**
 * Load all MCP server info (including disabled and invalid ones)
 * Merges global and project-level mcpServers to stay consistent with the server list seen by the Java side
 * @param {string} cwd - Current working directory
 * @returns {Promise<{enabled: Array, disabled: Array<string>, invalid: Array<{name: string, reason: string}>}>}
 */
export async function loadAllMcpServersInfo(cwd = null) {
  const result = { enabled: [], disabled: [], invalid: [] };

  try {
    const parsed = await parseMcpConfig(cwd);
    if (!parsed) return result;

    const { mcpServers, disabledServers } = parsed;

    // Collect server names within the project scope
    const processedNames = new Set();

    // Process servers resolved from project/global config (the parseMcpConfig result) first
    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      processedNames.add(serverName);
      classifyServer(serverName, serverConfig, disabledServers, result);
    }

    // If cwd is specified, global servers may have been overridden by project config.
    // Read the global config separately to pick up servers that only exist globally.
    if (cwd) {
      const globalParsed = await parseMcpConfig(null);
      if (globalParsed) {
        for (const [serverName, serverConfig] of Object.entries(globalParsed.mcpServers)) {
          if (processedNames.has(serverName)) continue; // Already covered by project config, skip
          processedNames.add(serverName);
          classifyServer(serverName, serverConfig, globalParsed.disabledServers, result);
        }
      }
    }

    log('info', '[MCP Config] All servers:', result.enabled.length, 'enabled,', result.disabled.length, 'disabled,', result.invalid.length, 'invalid');
    return result;
  } catch (error) {
    log('error', 'Failed to load all MCP servers info:', error.message);
    return result;
  }
}

/**
 * Classify a server into the enabled/disabled/invalid buckets
 */
function classifyServer(serverName, serverConfig, disabledServers, result) {
  if (isNameDisabled(serverName, disabledServers)) {
    result.disabled.push(serverName);
  } else if (!isValidServerConfig(serverConfig)) {
    const hasCommand = typeof serverConfig?.command === 'string' && serverConfig.command.length > 0;
    const hasUrl = typeof serverConfig?.url === 'string' && serverConfig.url.length > 0;
    const reason = !hasCommand && !hasUrl
      ? 'Missing command or url'
      : 'Invalid config structure';
    result.invalid.push({ name: serverName, reason });
  } else {
    result.enabled.push({ name: serverName, config: serverConfig });
  }
}
