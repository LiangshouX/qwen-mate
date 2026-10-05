/**
 * Headless CLI tools shown under Settings → Provider Management → CLI.
 * Detection only — the plugin never auto-installs these binaries.
 */

export type CliToolId = 'qwen';

export interface CliToolStatus {
  id: CliToolId;
  name: string;
  binaryName: string;
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export type CliStatusMap = Partial<Record<CliToolId, CliToolStatus>>;

export interface CliToolDefinition {
  id: CliToolId;
  /** i18n key for display name */
  nameKey: string;
  /** i18n key for short description */
  descriptionKey: string;
  /** Binary name users should find on PATH */
  binaryName: string;
  /** Docs / homepage URL */
  docsUrl: string;
  /** Primary install command (macOS / Linux) */
  installCommand: string;
  /** Optional Windows PowerShell install command */
  installCommandWindows?: string;
  /** Optional secondary install command (e.g. npm) */
  altInstallCommand?: string;
}

/**
 * Static catalog — matches what the Java CliStatusDetector detects (qwen).
 * Install commands match each CLI's official docs
 * and are shown in a dialog — never executed by the plugin.
 */
export const CLI_TOOL_DEFINITIONS: CliToolDefinition[] = [
  {
    id: 'qwen',
    nameKey: 'settings.cli.tools.qwen.name',
    descriptionKey: 'settings.cli.tools.qwen.description',
    binaryName: 'qwen',
    docsUrl: 'https://github.com/QwenLM/qwen-code',
    // npm is cross-platform — one command covers macOS / Linux / Windows.
    installCommand: 'npm install -g @qwen-code/qwen-code',
  },
];
