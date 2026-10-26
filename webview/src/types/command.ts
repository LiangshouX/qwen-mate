/**
 * Custom command type definitions
 *
 * Custom commands are Markdown files stored in:
 * - Global: ~/.qwen/commands
 * - Local: {workspace}/.qwen/commands (including parent directories)
 *
 * Nested directories map to colon-namespaced command names, e.g.
 * .qwen/commands/git/commit.md -> /git:commit
 */

/**
 * Command scope: global (user-level) or local (project-level)
 */
export type CommandScope = 'global' | 'local';

/**
 * A single custom command
 */
export interface Command {
  /** Unique identifier (scope + file path) */
  id: string;
  /** Command name including leading slash, e.g. /git:commit */
  name: string;
  /** Scope: global or local */
  scope: CommandScope;
  /** Full path of the .md file */
  path: string;
  /** Description from frontmatter */
  description?: string;
  /** All frontmatter key-value pairs */
  frontmatter?: Record<string, string>;
}

/**
 * Commands map (id -> Command)
 */
export type CommandsMap = Record<string, Command>;

/**
 * Commands configuration structure
 */
export interface CommandsConfig {
  /** Global commands (user-level) */
  global: CommandsMap;
  /** Local commands (project-level) */
  local: CommandsMap;
}

/**
 * Commands filter
 */
export type CommandFilter = 'all' | 'global' | 'local';
