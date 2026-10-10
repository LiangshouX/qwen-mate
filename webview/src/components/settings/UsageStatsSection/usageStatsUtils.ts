import type { UsageHeatmap, UsageRangeKey } from '../../../types/usage';

export interface RangeDef {
  key: UsageRangeKey;
  labelKey: string;
}

export const RANGES: RangeDef[] = [
  { key: 'today', labelKey: 'settings.usageStats.range.today' },
  { key: 'd7', labelKey: 'settings.usageStats.range.d7' },
  { key: 'd30', labelKey: 'settings.usageStats.range.d30' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Token formatting matching Qwen Code Desktop: one decimal in millions
 * ("137.5M", "1.7M"), dropping to K below 1M so a quiet day reads
 * "2.0K" instead of "0.0M", plain zero for nothing.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value < 1_000_000) {
    if (value < 1_000) {
      return `${Math.round(value)}`;
    }
    const k = (value / 1_000).toFixed(1);
    // 999,999 rounds to "1000.0K" — hand it back to the millions branch.
    if (Number(k) < 1_000) {
      return `${k}K`;
    }
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Integer counter with grouping ("1,044"). */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return Math.round(value).toLocaleString();
}

/** Local HH:mm:ss for the "更新于 …" stamp. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parses a yyyy-MM-dd date as a LOCAL date (no UTC shift). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Axis label like the Desktop charts: "10月2日" for zh, "Oct 2" otherwise.
 */
export function formatDayLabel(iso: string, language: string): string {
  const d = parseLocalDate(iso);
  if (language.startsWith('zh')) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  try {
    return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(d);
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

/** Month label for heatmap headers: "10月" / "Oct". */
export function formatMonthLabel(d: Date, language: string): string {
  if (language.startsWith('zh')) {
    return `${d.getMonth() + 1}月`;
  }
  try {
    return new Intl.DateTimeFormat(language, { month: 'short' }).format(d);
  } catch {
    return String(d.getMonth() + 1);
  }
}

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  date: string;
  tokens: number;
  /** Day's cache ratio (cached / input, 0-100); null when input is unknown. */
  cachePct: number | null;
  level: HeatmapLevel;
  col: number;
  row: number;
}

export interface HeatmapGrid {
  columns: number;
  /** Cells in column-major order (grid-auto-flow: column renders them). */
  cells: HeatmapCell[];
  monthLabels: { col: number; label: string }[];
}

/**
 * Builds the 7×N heatmap grid: rows are Mon…Sun, columns are weeks starting
 * at the Monday given by the payload; cells after "today" are omitted, and
 * intensity is bucketed into 4 swatches against the window max.
 */
export function buildHeatmapGrid(
  heatmap: UsageHeatmap,
  language: string,
): HeatmapGrid {
  const start = parseLocalDate(heatmap.start);
  const today = parseLocalDate(heatmap.today);
  const spanDays = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
  const columns = Math.max(1, Math.floor(spanDays / 7) + 1);
  const max = Math.max(1, heatmap.maxDayTokens || 0);

  const cells: HeatmapCell[] = [];
  for (let i = 0; i <= spanDays; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const date = toIso(d);
    const tokens = heatmap.days[date] || 0;
    let level: HeatmapLevel = 0;
    if (tokens > 0) {
      const ratio = tokens / max;
      level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
    }
    const cache = heatmap.cachePct?.[date];
    cells.push({
      date,
      tokens,
      cachePct: typeof cache === 'number' && Number.isFinite(cache) ? cache : null,
      level,
      col: Math.floor(i / 7),
      row: i % 7,
    });
  }

  const monthLabels: { col: number; label: string }[] = [];
  let prev = '';
  for (let col = 0; col < columns; col++) {
    const mid = new Date(start.getTime() + (col * 7 + 3) * DAY_MS);
    const key = `${mid.getFullYear()}-${mid.getMonth()}`;
    if (key !== prev) {
      prev = key;
      monthLabels.push({ col, label: formatMonthLabel(mid, language) });
    }
  }

  return { columns, cells, monthLabels };
}

export interface LinePoint {
  x: number;
  y: number;
}

/**
 * Maps daily values into a 0..width × 0..height polyline. A single point is
 * centered so lone days still render.
 */
export function buildLinePoints(
  values: number[],
  width: number,
  height: number,
): LinePoint[] {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values, 1);
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? width / 2 : (i / (n - 1)) * width,
    y: height - (v / max) * height,
  }));
}

export function maxValue(values: number[]): number {
  return values.reduce((acc, v) => Math.max(acc, v), 0);
}

/**
 * Maps a mouse X position inside the chart to the nearest data point index.
 * Returns -1 when the geometry or the series is unusable.
 */
export function nearestPointIndex(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  count: number,
): number {
  if (count <= 0 || !Number.isFinite(clientX) || !Number.isFinite(rectWidth) || rectWidth <= 0) {
    return -1;
  }
  const ratio = (clientX - rectLeft) / rectWidth;
  const idx = Math.round(ratio * (count - 1));
  return Math.min(count - 1, Math.max(0, idx));
}
