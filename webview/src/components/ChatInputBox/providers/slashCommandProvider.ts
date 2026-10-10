import type { CommandItem, DropdownItemData } from '../types';
import { sendBridgeEvent } from '../../../utils/bridge';
import i18n from '../../../i18n/config';
import { debugError, debugLog, debugWarn } from '../../../utils/debug.js';

/**
 * Commands never suggested because the Qwen CLI does not have them (Claude Code
 * legacy names). Every Qwen Code command stays listed — including TUI-only ones
 * such as /theme, which the CLI itself answers with "not supported in this mode".
 */
const HIDDEN_COMMANDS = new Set([
  '/cost',
  '/pr-comments',
  '/release-notes',
  '/security-review',
  '/todo',
]);

/**
 * Local new session commands (/clear, /new, /reset are aliases for the same command)
 * These commands are handled directly on the frontend, no need to send to SDK
 */
const NEW_SESSION_COMMAND_ALIASES = new Set(['/clear', '/new', '/reset']);

/**
 * Commands the plugin executes itself instead of forwarding to the CLI
 * (see useMessageSender handleSubmit: resume→history, plan→plan mode,
 * context→dialog, mcp→MCP settings tab, skills→Skills settings tab,
 * effort→reasoning selector).
 * Kept in the palette even when the CLI runtime list does not contain them.
 */
const GUI_HANDLED_COMMANDS = new Set(['/clear', '/resume', '/continue', '/plan', '/context', '/mcp', '/skills', '/effort']);

function getLocalNewSessionCommands(): CommandItem[] {
  return [{
    id: 'clear',
    label: '/clear',
    description: i18n.t('chat.clearCommandDescription'),
    category: 'system',
    contentType: 'command',
  }];
}

// ============================================================================
// State Management
// ============================================================================

type LoadingState = 'idle' | 'loading' | 'success' | 'failed';

let cachedSdkCommands: CommandItem[] = [];
/**
 * Command names the running CLI registered for this mode (payload has no leading
 * "/"). null until the first turn delivers one — until then the full static
 * table is suggested, so commands like /compress are pickable before any turn.
 */
let runtimeCommandNames: Set<string> | null = null;
let loadingState: LoadingState = 'idle';
let lastRefreshTime = 0;
let callbackRegistered = false;
let retryCount = 0;
let pendingWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
const MIN_REFRESH_INTERVAL = 2000;
const LOADING_TIMEOUT = 30000; // Increased to 30s to handle slow initial load for some Windows users
const MAX_RETRY_COUNT = 3;

// ============================================================================
// Core Functions
// ============================================================================

export function resetSlashCommandsState() {
  cachedSdkCommands = [];
  // A new session may run in another cwd / CLI build; wait for its own runtime list.
  runtimeCommandNames = null;
  loadingState = 'idle';
  lastRefreshTime = 0;
  retryCount = 0;
  pendingWaiters.forEach(w => w.reject(new Error('Slash commands state reset')));
  pendingWaiters = [];
  debugLog('[SlashCommand] State reset');
}

interface SDKSlashCommand {
  name: string;
  description?: string;
  source?: string;
  type?: string;
}

function isSDKSlashCommand(value: unknown): value is SDKSlashCommand {
  if (typeof value !== 'object' || value === null) return false;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 && name.length <= 128;
}

function getContentType(command: Pick<SDKSlashCommand, 'name' | 'source' | 'type'>): 'command' | 'skill' {
  const type = typeof command.type === 'string' ? command.type.toLowerCase() : '';
  const source = typeof command.source === 'string' ? command.source.toLowerCase() : '';
  if (type === 'skill' || source === 'codex-skill') {
    return 'skill';
  }
  return command.name.startsWith('$') ? 'skill' : 'command';
}

export function setupSlashCommandsCallback() {
  if (typeof window === 'undefined') return;
  if (callbackRegistered && window.updateSlashCommands) return;

  const handler = (json: string) => {
    debugLog('[SlashCommand] Received data from backend, length=' + (typeof json === 'string' ? json.length : 0));

    try {
      if (typeof json !== 'string') {
        throw new Error('Slash commands payload must be a string');
      }
      const parsed: unknown = JSON.parse(json);
      let commands: CommandItem[] = [];

      if (Array.isArray(parsed)) {
        commands = parsed.flatMap(item => {
          if (isSDKSlashCommand(item)) {
            return [{
              id: item.name.replace(/^\//, ''),
              label: item.name.startsWith('/') ? item.name : `/${item.name}`,
              description: formatCommandDescription(
                typeof item.description === 'string' ? item.description : '',
                typeof item.source === 'string' ? item.source : undefined
              ),
              category: getCategoryFromCommand(item.name),
              contentType: getContentType(item),
            }];
          }

          if (typeof item === 'string' && item.length > 0) {
            return [{
              id: item.replace(/^\//, ''),
              label: item.startsWith('/') ? item : `/${item}`,
              description: '',
              category: getCategoryFromCommand(item),
              contentType: 'command' as const,
            }];
          }

          return [];
        });

        cachedSdkCommands = commands;
        loadingState = 'success';
        retryCount = 0;
        pendingWaiters.forEach(w => w.resolve());
        pendingWaiters = [];
        debugLog('[SlashCommand] Successfully loaded ' + commands.length + ' commands');
      } else {
        loadingState = 'failed';
        const error = new Error('Slash commands payload is not an array');
        pendingWaiters.forEach(w => w.reject(error));
        pendingWaiters = [];
        debugWarn('[SlashCommand] Invalid commands payload');
      }
    } catch (error) {
      loadingState = 'failed';
      pendingWaiters.forEach(w => w.reject(error));
      pendingWaiters = [];
      debugError('[SlashCommand] Failed to parse commands:', error);
    }
  };

  const originalHandler = window.updateSlashCommands;

  window.updateSlashCommands = (json: string) => {
    handler(json);
    originalHandler?.(json);
  };
  callbackRegistered = true;
  debugLog('[SlashCommand] Callback registered');

  window.updateRuntimeSlashCommands = (json: string) => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) return;
      const names = parsed
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .map((name) => (name.startsWith('/') ? name : `/${name}`));
      if (names.length > 0) {
        runtimeCommandNames = new Set(names);
        debugLog('[SlashCommand] Runtime list applied: ' + names.length + ' commands');
      }
    } catch (error) {
      debugWarn('[SlashCommand] Failed to parse runtime commands:', error);
    }
  };

  if (window.__pendingRuntimeSlashCommands) {
    const pending = window.__pendingRuntimeSlashCommands;
    window.__pendingRuntimeSlashCommands = undefined;
    window.updateRuntimeSlashCommands(pending);
  }

  if (window.__pendingSlashCommands) {
    debugLog('[SlashCommand] Processing pending commands');
    const pending = window.__pendingSlashCommands;
    window.__pendingSlashCommands = undefined;
    handler(pending);
  }
}

function waitForSlashCommands(signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (loadingState === 'success') return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const waiter = { resolve: () => {}, reject: (_error: unknown) => {} } as {
      resolve: () => void;
      reject: (error: unknown) => void;
    };

    const cleanup = () => {
      pendingWaiters = pendingWaiters.filter(w => w !== waiter);
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Slash commands loading timeout'));
    }, timeoutMs);

    signal.addEventListener('abort', onAbort, { once: true });

    waiter.resolve = () => {
      cleanup();
      resolve();
    };
    waiter.reject = (error: unknown) => {
      cleanup();
      reject(error);
    };

    pendingWaiters.push(waiter);
    if (loadingState === 'success') {
      waiter.resolve();
    } else if (loadingState === 'failed') {
      waiter.reject(new Error('Slash commands loading failed'));
    }
  });
}

function requestRefresh(): boolean {
  const now = Date.now();

  if (now - lastRefreshTime < MIN_REFRESH_INTERVAL) {
    debugLog('[SlashCommand] Skipping refresh (too soon)');
    return false;
  }

  if (retryCount >= MAX_RETRY_COUNT) {
    debugWarn('[SlashCommand] Max retry count reached');
    loadingState = 'failed';
    return false;
  }

  const attempt = retryCount + 1;
  const sent = sendBridgeEvent('refresh_slash_commands');
  if (!sent) {
    debugLog('[SlashCommand] Bridge not available yet, refresh not sent');
    return false;
  }

  lastRefreshTime = now;
  loadingState = 'loading';
  retryCount = attempt;

  debugLog('[SlashCommand] Requesting refresh from backend (attempt ' + retryCount + '/' + MAX_RETRY_COUNT + ')');
  return true;
}

function isHiddenCommand(name: string): boolean {
  const normalized = name.startsWith('/') ? name : `/${name}`;
  if (HIDDEN_COMMANDS.has(normalized)) return true;
  // Hide SDK-returned /clear (use local version instead)
  if (NEW_SESSION_COMMAND_ALIASES.has(normalized)) return true;
  const baseName = normalized.split(' ')[0];
  return HIDDEN_COMMANDS.has(baseName) || NEW_SESSION_COMMAND_ALIASES.has(baseName);
}

function getCategoryFromCommand(name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('workflow')) return 'workflow';
  if (lowerName.includes('memory') || lowerName.includes('skill')) return 'memory';
  if (lowerName.includes('task')) return 'task';
  if (lowerName.includes('speckit')) return 'speckit';
  if (lowerName.includes('cli')) return 'cli';
  return 'user';
}

function formatCommandDescription(description: string, source?: string): string {
  if (!source) return description;
  const suffix = `[${source}]`;
  if (!description) return suffix;
  return `${description} ${suffix}`;
}

/**
 * Calibrate the static/scanned list against the CLI runtime list: keep the
 * GUI-handled commands, drop commands this mode rejects, and surface runtime
 * commands the static table does not know about.
 */
function applyRuntimeCalibration(commands: CommandItem[]): CommandItem[] {
  const runtime = runtimeCommandNames;
  if (!runtime) {
    return commands;
  }
  const kept = commands.filter(cmd => GUI_HANDLED_COMMANDS.has(cmd.label) || runtime.has(cmd.label));
  const known = new Set(kept.map(cmd => cmd.label));
  const extras = [...runtime]
    .filter(label => !known.has(label) && !isHiddenCommand(label))
    .map(label => ({
      id: `runtime${label.replace(/^\//, '')}`,
      label,
      description: '',
      category: getCategoryFromCommand(label),
      contentType: 'command' as const,
    }));
  return [...kept, ...extras];
}

/**
 * Whether a typed slash command may be forwarded to the CLI. GUI-handled
 * commands never leave the webview (intercepted earlier in handleSubmit), and
 * once the first turn delivers the runtime list that list is authoritative:
 * forwarding an unlisted command burns a full turn respawn only to render
 * "not supported in this mode". Before any turn the runtime list is unknown,
 * so everything is allowed (same behaviour as the palette).
 */
export function isCommandSendable(label: string): boolean {
  const base = label.trim().split(/\s+/)[0];
  if (GUI_HANDLED_COMMANDS.has(base)) return true;
  if (runtimeCommandNames === null) return true;
  return runtimeCommandNames.has(base);
}

function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const visibleCommands = applyRuntimeCalibration(commands).filter(cmd => !isHiddenCommand(cmd.label));
  const localCommands = getLocalNewSessionCommands();
  const merged = [...localCommands, ...visibleCommands];

  if (!query) return merged;

  const lowerQuery = query.toLowerCase();
  return merged.filter(cmd =>
    cmd.label.toLowerCase().includes(lowerQuery) ||
    cmd.description?.toLowerCase().includes(lowerQuery) ||
    cmd.id.toLowerCase().includes(lowerQuery)
  );
}

export async function slashCommandProvider(
  query: string,
  signal: AbortSignal
): Promise<CommandItem[]> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  setupSlashCommandsCallback();

  const now = Date.now();

  if (loadingState === 'idle' || loadingState === 'failed') {
    requestRefresh();
  } else if (loadingState === 'loading' && now - lastRefreshTime > LOADING_TIMEOUT) {
    debugWarn('[SlashCommand] Loading timeout');
    loadingState = 'failed';
    requestRefresh();
  }

  if (loadingState !== 'success') {
    await waitForSlashCommands(signal, LOADING_TIMEOUT).catch(() => {});
  }

  if (loadingState === 'success') {
    return filterCommands(cachedSdkCommands, query);
  }

  if (retryCount >= MAX_RETRY_COUNT) {
    return [{
      id: '__error__',
      label: i18n.t('chat.loadingFailed'),
      description: i18n.t('chat.pleaseCloseAndReopen'),
      category: 'system',
    }];
  }

  return [{
    id: '__loading__',
    label: i18n.t('chat.loadingSlashCommands'),
    description: retryCount > 0 ? i18n.t('chat.retrying', { count: retryCount, max: MAX_RETRY_COUNT }) : i18n.t('chat.pleaseWait'),
    category: 'system',
  }];
}

export function commandToDropdownItem(command: CommandItem): DropdownItemData {
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    icon: 'codicon-terminal',
    type: 'command',
    data: { command },
  };
}

export function forceRefreshSlashCommands(): void {
  debugLog('[SlashCommand] Force refresh requested');
  loadingState = 'idle';
  lastRefreshTime = 0;
  retryCount = 0;
  pendingWaiters.forEach(w => w.reject(new Error('Slash commands refresh requested')));
  pendingWaiters = [];
  requestRefresh();
}

/**
 * Preload slash commands during app initialization
 * Load command data before user types "/" to improve perceived performance
 *
 * Safety guarantees:
 * - Skips if already loading or loaded (checks loadingState)
 * - requestRefresh() has MIN_REFRESH_INTERVAL deduplication protection
 * - Shares state with slashCommandProvider, subsequent calls hit cache directly
 */
export function preloadSlashCommands(): void {
  // Only preload in idle state, don't interfere with in-progress or completed loads
  if (loadingState !== 'idle') {
    debugLog('[SlashCommand] Preload skipped (state=' + loadingState + ')');
    return;
  }

  debugLog('[SlashCommand] Preloading commands on app init');

  // Ensure callback is registered before requesting refresh
  setupSlashCommandsCallback();

  // Request refresh -- built-in deduplication protection
  requestRefresh();
}

export default slashCommandProvider;
