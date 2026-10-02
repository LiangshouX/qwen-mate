/**
 * SDK dependency type definitions
 *
 * SDK dependency installation path: ~/.qwenmate/dependencies/
 * - qwen-sdk: Qwen Code SDK (@qwen-code/sdk and its dependencies)
 *
 * Supported operations:
 * - Install/uninstall SDKs
 * - Check for updates
 * - View installation status
 */

/**
 * SDK ID type
 */
export type SdkId = 'qwen-sdk';

/**
 * SDK installation status
 */
export type SdkInstallStatus = 'installed' | 'not_installed' | 'installing' | 'error';

/**
 * Status information for a single SDK
 */
export interface SdkStatus {
  /** Unique SDK identifier */
  id: SdkId;
  /** SDK display name */
  name: string;
  /** Installation status */
  status: SdkInstallStatus;
  /** Installed version (empty when not installed) */
  installedVersion?: string;
  /** Minimum required version for full feature support (e.g. Qwen Code SDK Fable tier or Codex native auto review) */
  minimumVersion?: string;
  /** Whether the installed version meets the minimum required version */
  meetsMinimumVersion?: boolean;
  /** Latest available version */
  latestVersion?: string;
  /** Whether an update is available */
  hasUpdate?: boolean;
  /** Installation path */
  installPath?: string;
  /** Description */
  description?: string;
  /** Last checked time */
  lastChecked?: string;
  /** Error message (when status is error) */
  errorMessage?: string;
}

/**
 * Status map for all SDKs
 */
export interface DependencyStatus {
  [key: string]: SdkStatus;
}

/**
 * Installation progress information
 */
export interface InstallProgress {
  /** SDK ID */
  sdkId: SdkId;
  /** Log output */
  log: string;
}

/**
 * Installation result
 */
export interface InstallResult {
  /** Whether successful */
  success: boolean;
  /** SDK ID */
  sdkId: SdkId;
  /** Installed version (on success) */
  installedVersion?: string;
  /** Requested version (on success/failure) */
  requestedVersion?: string;
  /** Error message (on failure) */
  error?: string;
  /** Installation logs */
  logs?: string;
}

/**
 * Uninstall result
 */
export interface UninstallResult {
  /** Whether successful */
  success: boolean;
  /** SDK ID */
  sdkId: SdkId;
  /** Error message (on failure) */
  error?: string;
}

/**
 * Update information
 */
export interface UpdateInfo {
  /** SDK ID */
  sdkId: SdkId;
  /** SDK name */
  sdkName: string;
  /** Whether an update is available */
  hasUpdate: boolean;
  /** Current version */
  currentVersion?: string;
  /** Latest version */
  latestVersion?: string;
  /** Error message */
  error?: string;
}

/**
 * Update check result
 */
export interface UpdateCheckResult {
  [key: string]: UpdateInfo;
}

export type DependencyVersionSource = 'remote' | 'fallback';

export interface DependencyVersionInfo {
  sdkId: SdkId;
  versions: string[];
  fallbackVersions?: string[];
  source: DependencyVersionSource;
  latestVersion?: string;
  error?: string;
}

export interface DependencyVersionResult {
  [key: string]: DependencyVersionInfo;
}

/**
 * Node.js environment status
 */
export interface NodeEnvironmentStatus {
  /** Whether available */
  available: boolean;
  /** Error message */
  error?: string;
}

/**
 * SDK definition (for UI display)
 */
export interface SdkDefinition {
  /** SDK ID */
  id: SdkId;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Related providers (for feature association) */
  relatedProviders: string[];
}

/**
 * Predefined SDK list
 */
export const SDK_DEFINITIONS: SdkDefinition[] = [
  {
    id: 'qwen-sdk',
    name: 'Qwen Code SDK',
    description: 'Qwen Code 运行所需。包含 @qwen-code/sdk 及相关依赖。',
    relatedProviders: ['qwen'],
  },
];
