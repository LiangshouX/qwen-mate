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
  heatmap: UsageHeatmap;
  /** Set by the Java side on failures instead of the fields above. */
  error?: string;
}
