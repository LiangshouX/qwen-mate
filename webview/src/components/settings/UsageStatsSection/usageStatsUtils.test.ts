import { describe, expect, it } from 'vitest';
import type { UsageHeatmap } from '../../../types/usage';
import {
  buildHeatmapGrid,
  buildLinePoints,
  formatCount,
  formatDayLabel,
  formatTokens,
  maxValue,
  nearestPointIndex,
} from './usageStatsUtils';

describe('formatTokens', () => {
  it('renders millions with one decimal like the Desktop dashboard', () => {
    expect(formatTokens(137_500_000)).toBe('137.5M');
    expect(formatTokens(1_700_000)).toBe('1.7M');
    expect(formatTokens(921_040_000)).toBe('921.0M');
    expect(formatTokens(1_527_000_000)).toBe('1527.0M');
  });

  it('renders zero and invalid input as 0', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
  });

  it('drops to K below one million so a small day does not read 0.0M', () => {
    expect(formatTokens(2_000)).toBe('2.0K');
    expect(formatTokens(12_340)).toBe('12.3K');
    expect(formatTokens(700_000)).toBe('700.0K');
    // Rounding 999,999 up to "1000.0K" would be silly — carry into millions.
    expect(formatTokens(999_999)).toBe('1.0M');
    expect(formatTokens(500)).toBe('500');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1044)).toBe('1,044');
    expect(formatCount(52_377)).toBe('52,377');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatDayLabel', () => {
  it('formats zh dates as 月/日', () => {
    expect(formatDayLabel('2026-10-02', 'zh')).toBe('10月2日');
    expect(formatDayLabel('2026-10-09', 'zh-CN')).toBe('10月9日');
  });
});

describe('buildHeatmapGrid', () => {
  const heatmap: UsageHeatmap = {
    start: '2026-09-28', // a Monday
    today: '2026-10-09',
    days: {
      '2026-10-03': 921_000_000,
      '2026-10-09': 137_500_000,
      '2026-10-05': 10_000_000,
    },
    cachePct: {
      '2026-10-03': 98,
      '2026-10-09': 93,
    },
    maxDayTokens: 921_000_000,
  };

  it('anchors the grid on a Monday with one column per week', () => {
    const grid = buildHeatmapGrid(heatmap, 'zh');
    // Sep 28 → Oct 9 spans 11 days → 2 full/partial weeks + start week = 2 columns
    expect(grid.columns).toBe(2);
    expect(grid.cells[0].date).toBe('2026-09-28');
    expect(grid.cells[0].row).toBe(0);
    expect(grid.cells[6].row).toBe(6);
    expect(grid.cells[7].col).toBe(1);
  });

  it('buckets intensity against the window max', () => {
    const grid = buildHeatmapGrid(heatmap, 'zh');
    const byDate = Object.fromEntries(grid.cells.map((c) => [c.date, c]));
    expect(byDate['2026-10-03'].level).toBe(4); // the peak
    expect(byDate['2026-10-09'].level).toBe(1); // ~15% of max
    expect(byDate['2026-10-05'].level).toBe(1);
    expect(byDate['2026-10-01'].level).toBe(0); // no data
  });

  it('carries the day cache ratio and leaves unknown days null', () => {
    const grid = buildHeatmapGrid(heatmap, 'zh');
    const byDate = Object.fromEntries(grid.cells.map((c) => [c.date, c]));
    expect(byDate['2026-10-03'].cachePct).toBe(98);
    expect(byDate['2026-10-05'].cachePct).toBeNull();
    expect(byDate['2026-10-01'].cachePct).toBeNull();
    // Older payloads have no cachePct map at all.
    const bare = buildHeatmapGrid(
      { ...heatmap, cachePct: undefined },
      'zh',
    );
    expect(bare.cells.every((c) => c.cachePct === null)).toBe(true);
  });

  it('pads the current week with future cells and labels each month once', () => {
    const grid = buildHeatmapGrid(heatmap, 'zh');
    // Sep 28 → Oct 9 lands mid-week (today = Fri): Sat/Sun stay as empty
    // placeholders so every column keeps 7 rows instead of a ragged edge.
    expect(grid.cells).toHaveLength(grid.columns * 7);
    const past = grid.cells.filter((c) => !c.future);
    expect(past[past.length - 1].date).toBe('2026-10-09');
    const tail = grid.cells[grid.cells.length - 1];
    expect(tail.future).toBe(true);
    expect(tail.date).toBe('2026-10-11');
    expect(tail.tokens).toBe(0);
    expect(tail.cachePct).toBeNull();
    // Both week-midpoints (Oct 1 / Oct 8) fall in October → a single label.
    expect(grid.monthLabels.map((l) => l.label)).toEqual(['10月']);
  });
});

describe('buildLinePoints', () => {
  it('scales points to the box and keeps the peak at the top', () => {
    const points = buildLinePoints([0, 50, 100], 100, 50);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[1].y).toBe(25);
    expect(points[2]).toEqual({ x: 100, y: 0 });
  });

  it('centers a single point instead of dividing by zero', () => {
    const points = buildLinePoints([7], 100, 50);
    expect(points).toEqual([{ x: 50, y: 0 }]);
  });

  it('returns nothing for an empty series', () => {
    expect(buildLinePoints([], 100, 50)).toEqual([]);
  });
});

describe('maxValue', () => {
  it('finds the peak of the daily series', () => {
    expect(maxValue([1, 921, 5])).toBe(921);
    expect(maxValue([])).toBe(0);
  });
});

describe('nearestPointIndex', () => {
  it('snaps the pointer to the closest data point', () => {
    expect(nearestPointIndex(0, 0, 100, 8)).toBe(0);
    expect(nearestPointIndex(100, 0, 100, 8)).toBe(7);
    expect(nearestPointIndex(50, 0, 100, 8)).toBe(4);
    expect(nearestPointIndex(10, 0, 100, 8)).toBe(1);
  });

  it('accounts for the chart offset inside the page', () => {
    expect(nearestPointIndex(150, 100, 100, 3)).toBe(1);
    expect(nearestPointIndex(199, 100, 100, 3)).toBe(2);
  });

  it('rejects unusable geometry instead of guessing', () => {
    expect(nearestPointIndex(50, 0, 0, 8)).toBe(-1);
    expect(nearestPointIndex(50, 0, 100, 0)).toBe(-1);
    expect(nearestPointIndex(Number.NaN, 0, 100, 8)).toBe(-1);
  });
});
