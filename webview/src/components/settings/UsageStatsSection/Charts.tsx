import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { UsageDailyPoint, UsageHeatmap, UsageModelStat } from '../../../types/usage';
import {
  buildHeatmapGrid,
  buildLinePoints,
  formatCount,
  formatDayLabel,
  formatTokens,
  maxValue,
  nearestPointIndex,
  type HeatmapCell,
} from './usageStatsUtils';
import styles from './style.module.less';

const RANK_COLORS = ['#4f8ff7', '#2ec4b6', '#f5a524'];

/** Tooltip half-width used to keep a near-edge tooltip inside its card. */
const HEAT_TIP_HALF_WIDTH = 130;

/** Clamps a tooltip's anchor X so the bubble stays inside `host` (viewport fallback). */
function clampTipX(x: number, host: HTMLElement | null | undefined): number {
  const half = HEAT_TIP_HALF_WIDTH;
  const rect = host?.getBoundingClientRect();
  const minX = rect ? rect.left + half : half;
  const maxX = rect
    ? Math.max(minX, rect.right - half)
    : Math.max(minX, (typeof window !== 'undefined' ? window.innerWidth : 1024) - half);
  return Math.min(Math.max(x, minX), maxX);
}

function rankColor(index: number): string {
  return RANK_COLORS[index] || '#8a8f98';
}

interface HeatHover {
  cell: HeatmapCell;
  x: number;
  y: number;
  below: boolean;
}

/** 12-month daily-token heatmap (columns = weeks, rows = Mon…Sun). */
export function UsageHeatmap({ heatmap }: { heatmap: UsageHeatmap }) {
  const { t, i18n } = useTranslation();
  const grid = useMemo(
    () => buildHeatmapGrid(heatmap, i18n.language),
    [heatmap, i18n.language],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HeatHover | null>(null);

  // The grid scrolls horizontally on narrow panes; drop the tooltip rather
  // than let it drift away from its cell.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const clear = () => setHover(null);
    el.addEventListener('scroll', clear);
    return () => el.removeEventListener('scroll', clear);
  }, []);

  const showHover = (e: ReactMouseEvent<HTMLDivElement>, cell: HeatmapCell) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({
      cell,
      x: clampTipX(rect.left + rect.width / 2, rootRef.current?.parentElement),
      y: rect.top,
      // Flip below when the cell sits too close to the viewport top.
      below: rect.top < 90,
    });
  };

  return (
    <div className={styles.heatCard}>
      <div className={styles.heatmap} ref={rootRef}>
        <div className={styles.heatmapLegend}>
          <span className={styles.legendLabel}>{t('settings.usageStats.heatmap.less')}</span>
          {[1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={`${styles.legendSwatch} ${styles[`heat${level}` as const]}`}
            />
          ))}
          <span className={styles.legendLabel}>{t('settings.usageStats.heatmap.more')}</span>
        </div>

        {/* One grid drives both the month row and the cells, so month labels
            sit exactly above their week column (the old sibling rows drifted:
            months were sized by content while cells stretched with 1fr). */}
        <div
          className={styles.heatmapTable}
          style={{ gridTemplateColumns: `auto repeat(${grid.columns}, 1fr)` }}
        >
          {grid.monthLabels.map(({ col, label }) => (
            <span key={col} className={styles.heatMonth} style={{ gridColumn: col + 2 }}>
              {label}
            </span>
          ))}

          <div className={styles.heatmapWeekdays}>
            <span>{t('settings.usageStats.heatmap.weekdayMon')}</span>
            <span aria-hidden="true" />
            <span>{t('settings.usageStats.heatmap.weekdayWed')}</span>
            <span aria-hidden="true" />
            <span>{t('settings.usageStats.heatmap.weekdayFri')}</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
          <div
            className={styles.heatmapCells}
            style={{
              gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
              gridTemplateRows: 'repeat(7, var(--usage-heat-cell))',
              gridAutoFlow: 'column',
            }}
          >
            {grid.cells.map((cell) => (
              <div
                key={cell.date}
                data-testid="usage-heat-cell"
                data-date={cell.date}
                className={[
                  styles.heatCell,
                  styles[`heat${cell.level}` as const],
                  cell.date === heatmap.today ? styles.heatToday : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={cell.future ? undefined : (e) => showHover(e, cell)}
                onMouseLeave={cell.future ? undefined : () => setHover(null)}
              />
            ))}
          </div>
        </div>
      </div>

      {hover &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="usage-heat-tooltip"
            className={`${styles.hoverTip} ${hover.below ? styles.hoverTipBelow : ''}`}
            style={{ position: 'fixed', left: `${hover.x}px`, top: `${hover.y}px` }}
          >
            {hover.cell.date} · Tokens: <strong>{formatTokens(hover.cell.tokens)}</strong>
            {hover.cell.cachePct !== null && (
              <>
                {' · Cache: '}
                <strong>{Math.round(hover.cell.cachePct)}%</strong>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface RangeChartProps {
  daily: UsageDailyPoint[];
  rangeLabel: string;
}

/** Daily token total: stretched line with an HTML end-dot (no ellipse skew). */
export function TokenLineChart({ daily, rangeLabel }: RangeChartProps) {
  const { t, i18n } = useTranslation();
  const values = daily.map((d) => d.tokens);
  const peak = maxValue(values);
  const last = values.length > 0 ? values[values.length - 1] : 0;
  const points = useMemo(() => buildLinePoints(values, 100, 100), [daily]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  useEffect(() => setHoverIndex(null), [daily]);
  const hovered = hoverIndex !== null ? points[hoverIndex] : undefined;
  const hoveredDay = hoverIndex !== null ? daily[hoverIndex] : undefined;
  const empty = peak <= 0;

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartTitle}>
        {t('settings.usageStats.charts.tokensTitle', { range: rangeLabel })}
      </div>
      <div className={styles.chartDesc}>{t('settings.usageStats.charts.tokensDesc')}</div>

      {empty ? (
        <div className={styles.chartEmpty}>{t('settings.usageStats.charts.empty')}</div>
      ) : (
        <>
          <div
            className={styles.lineChart}
            data-testid="usage-line-chart"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const idx = nearestPointIndex(e.clientX, rect.left, rect.width, points.length);
              setHoverIndex(idx >= 0 ? idx : null);
            }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className={styles.lineSvg}
              aria-hidden="true"
            >
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="var(--usage-line)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {points.length > 0 && (
              <span
                className={styles.lineEndDot}
                style={{
                  left: `${points[points.length - 1].x}%`,
                  top: `${points[points.length - 1].y}%`,
                }}
              />
            )}
            {hovered && hoveredDay && (
              <>
                <span className={styles.lineHoverGuide} style={{ left: `${hovered.x}%` }} />
                <span
                  className={styles.lineHoverDot}
                  style={{ left: `${hovered.x}%`, top: `${hovered.y}%` }}
                />
                <div
                  data-testid="usage-line-tooltip"
                  className={styles.lineTooltip}
                  style={{
                    left: `${Math.min(94, Math.max(6, hovered.x))}%`,
                    top: `${hovered.y}%`,
                  }}
                >
                  <div className={styles.tooltipDate}>
                    {formatDayLabel(hoveredDay.date, i18n.language)}
                  </div>
                  <div className={styles.tooltipValue}>
                    <span className={styles.legendDot} />
                    {t('settings.usageStats.charts.latest')}
                    <strong>{formatTokens(hoveredDay.tokens)}</strong>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className={styles.chartLegendRow}>
            <span className={styles.chartLegend}>
              <span className={styles.legendDot} />
              {t('settings.usageStats.charts.latest')}
              <strong>{formatTokens(last)}</strong>
            </span>
            <span className={styles.chartPeak}>
              {t('settings.usageStats.charts.peak', { value: formatTokens(peak) })}
            </span>
          </div>
          <div className={styles.chartAxisRow}>
            {daily.length > 0 && (
              <span>{formatDayLabel(daily[0].date, i18n.language)}</span>
            )}
            {daily.length > 1 && (
              <span>
                {formatDayLabel(daily[daily.length - 1].date, i18n.language)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface BarHover {
  point: UsageDailyPoint;
  x: number;
  y: number;
  below: boolean;
}

/** Daily active sessions: one bar per day in the window. */
export function SessionsBarChart({ daily, rangeLabel }: RangeChartProps) {
  const { t, i18n } = useTranslation();
  const values = daily.map((d) => d.sessions);
  const peak = maxValue(values);
  const empty = peak <= 0;
  const chartRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<BarHover | null>(null);
  useEffect(() => setHover(null), [daily]);

  const showBarHover = (e: ReactMouseEvent<HTMLDivElement>, point: UsageDailyPoint) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Anchor on the bar's top edge, not the full-height slot, so the tip hugs
    // the column it describes (slot height is the whole 160px plot area).
    const barPct = Math.max(4, (point.sessions / peak) * 100);
    const y = rect.bottom - (barPct / 100) * rect.height;
    setHover({
      point,
      x: clampTipX(rect.left + rect.width / 2, chartRef.current),
      y,
      below: y < 90,
    });
  };

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartTitle}>
        {t('settings.usageStats.charts.sessionsTitle', { range: rangeLabel })}
      </div>
      <div className={styles.chartDesc}>{t('settings.usageStats.charts.sessionsDesc')}</div>

      {empty ? (
        <div className={styles.chartEmpty}>{t('settings.usageStats.charts.empty')}</div>
      ) : (
        <>
          <div
            className={styles.barChart}
            ref={chartRef}
            onMouseLeave={() => setHover(null)}
          >
            {daily.map((point) => (
              <div
                key={point.date}
                className={styles.barSlot}
                data-testid="usage-bar-slot"
                data-date={point.date}
                onMouseEnter={(e) => showBarHover(e, point)}
              >
                {point.sessions > 0 && (
                  <div
                    className={`${styles.bar} ${
                      hover?.point.date === point.date ? styles.barHover : ''
                    }`}
                    style={{ height: `${Math.max(4, (point.sessions / peak) * 100)}%` }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className={styles.chartAxisRow}>
            <span>{formatDayLabel(daily[0].date, i18n.language)}</span>
            <span>
              {formatDayLabel(daily[daily.length - 1].date, i18n.language)}
            </span>
          </div>
          {hover &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                data-testid="usage-bar-tooltip"
                className={`${styles.hoverTip} ${hover.below ? styles.hoverTipBelow : ''}`}
                style={{ position: 'fixed', left: `${hover.x}px`, top: `${hover.y}px` }}
              >
                {formatDayLabel(hover.point.date, i18n.language)} ·{' '}
                {t('settings.usageStats.charts.sessionsLabel')}{' '}
                <strong>{formatCount(hover.point.sessions)}</strong>
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

/** Ranked model share bars: fill length = share, green prefix = cache reads. */
export function ModelShareList({ models }: { models: UsageModelStat[] }) {
  const { t } = useTranslation();
  if (models.length === 0) {
    return <div className={styles.chartEmpty}>{t('settings.usageStats.charts.empty')}</div>;
  }
  return (
    <div className={styles.modelList}>
      {models.map((model, index) => {
        const color = rankColor(index);
        const share = Math.max(0, Math.min(100, model.sharePct));
        const cache = Math.max(0, Math.min(100, model.cachePct));
        return (
          <div key={model.name} className={styles.modelRow}>
            <div className={styles.modelHeadline}>
              <span className={styles.rankBadge} style={{ background: color }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.modelMeta}>
                <span className={styles.modelName}>{model.name}</span>
                <span className={styles.modelSub}>
                  {t('settings.usageStats.models.tokensUnit', {
                    value: formatTokens(model.totalTokens),
                    cache: Math.round(model.cachePct),
                  })}
                </span>
              </span>
              <span className={styles.modelShare} style={{ color }}>
                {Math.round(model.sharePct)}%
              </span>
            </div>
            <div className={styles.shareTrack}>
              <div className={styles.shareFill} style={{ width: `${share}%` }}>
                <div className={styles.shareCache} style={{ width: `${cache}%` }} />
              </div>
              <span className={styles.shareDot} style={{ left: `${share}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
