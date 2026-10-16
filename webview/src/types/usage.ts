/** Payload shapes for the Settings → 用量统计 page (Java: UsageStatsHandler). */

export type UsageRangeKey = 'today' | 'd7' | 'd30';

export interface UsageDailyPoint {
  /** Local date, yyyy-MM-dd. */
  date: string;
  tokens: number;
  sessions: number;
}

export interface UsageModelStat {
  name: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  /** Share of the window's total tokens, 0-100. */
  sharePct: number;
  /** cached / input, 0-100. */
  cachePct: number;
}

export interface UsageSkillStat {
  name: string;
  count: number;
}

export interface UsageWindowStats {
  startMs: number;
  endMs: number;
  sessions: number;
  requests: number;
  toolCalls: number;
  changes: number;
  linesAdded: number;
  linesRemoved: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  /** cached / input, 0-100. */
  cachePct: number;
  models: UsageModelStat[];
  skills: UsageSkillStat[];
  daily: UsageDailyPoint[];
}

export interface UsageHeatmap {
  /** Monday that anchors the grid, yyyy-MM-dd. */
  start: string;
  /** Last real cell, yyyy-MM-dd. */
  today: string;
  /** Sparse date → daily tokens. */
  days: Record<string, number>;
  /** Sparse date → daily cache ratio, cached / input, 0-100. */
  cachePct?: Record<string, number>;
  maxDayTokens: number;
}

/** One row of the "按 Project" dimension (a full window-stats per project). */
export interface UsageProjectGroup extends UsageWindowStats {
  /** Raw cwd path; the display name (dir name, parent disambiguation) is derived on the frontend. */
  project: string;
}

/**
 * One row of the "按会话" dimension (slim — no daily series; multi-day
 * sessions fetch their per-day tokens lazily via get_usage_stats sessionDaily).
 */
export interface UsageSessionGroup extends Omit<UsageWindowStats, 'daily'> {
  sessionId: string;
  /** Raw cwd path of the session's project. */
  project: string;
  /** History-panel title (custom > derived), when one could be resolved. */
  title?: string;
  startTimeMs: number;
  timestampMs: number;
}

export interface UsageDimensions {
  projects: Record<UsageRangeKey, UsageProjectGroup[]>;
  sessions: Record<UsageRangeKey, UsageSessionGroup[]>;
}

/** Response of the lazy per-session daily rebuild (session-dimension line chart). */
export interface UsageSessionDaily {
  sessionId: string;
  daily: UsageDailyPoint[];
  error?: string;
}

export interface UsagePayload {
  generatedAtMs: number;
  supported: boolean;
  dataFileExists: boolean;
  dataFile: string;
  recordCount: number;
  sessionCount: number;
  liveSessionCount: number;
  cliVersion: string;
  minSupportedVersion: string;
  earliestRecordMs: number;
  latestRecordMs: number;
  windows: Record<UsageRangeKey, UsageWindowStats>;
  /** Per-project / per-session breakdowns per window (absent on older payloads). */
  dimensions?: UsageDimensions;
  /** User home dir; its project group is displayed as a full path, not a basename. */
  userHome?: string;
  /** The IDE's effective working directory — default project of the session dimension's filter. */
  currentProject?: string;
  heatmap: UsageHeatmap;
  /** Set by the Java side on failures instead of the fields above. */
  error?: string;
}
