import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageDailyPoint, UsageHeatmap, UsageModelStat } from '../../../types/usage';
import {
  buildHeatmapGrid,
  buildLinePoints,
  formatDayLabel,
  formatTokens,
  maxValue,
  nearestPointIndex,
} from './usageStatsUtils';
import styles from './style.module.less';

const RANK_COLORS = ['#4f8ff7', '#2ec4b6', '#f5a524'];

function rankColor(index: number): string {
  return RANK_COLORS[index] || '#8a8f98';
}

/** 12-month daily-token heatmap (columns = weeks, rows = Mon…Sun). */
export function UsageHeatmap({ heatmap }: { heatmap: UsageHeatmap }) {
  const { t, i18n } = useTranslation();
  const grid = useMemo(
    () => buildHeatmapGrid(heatmap, i18n.language),
    [heatmap, i18n.language],
  );

  return (
    <div className={styles.heatmap}>
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

      <div className={styles.heatmapMonths}>
        {grid.monthLabels.map(({ col, label }) => (
          <span key={col} style={{ gridColumn: col + 1 }}>
            {label}
          </span>
        ))}
      </div>

      <div className={styles.heatmapBody}>
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
            gridTemplateRows: 'repeat(7, var(--usage-heat-cell))',
            gridAutoFlow: 'column',
            gridAutoColumns: '1fr',
          }}
        >
          {grid.cells.map((cell) => (
            <div
              key={cell.date}
              className={[
                styles.heatCell,
                styles[`heat${cell.level}` as const],
                cell.date === heatmap.today ? styles.heatToday : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`${cell.date} · ${formatTokens(cell.tokens)}`}
            />
          ))}
        </div>
      </div>
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

/** Daily active sessions: one bar per day in the window. */
export function SessionsBarChart({ daily, rangeLabel }: RangeChartProps) {
  const { t, i18n } = useTranslation();
  const values = daily.map((d) => d.sessions);
  const peak = maxValue(values);
  const empty = peak <= 0;

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
          <div className={styles.barChart}>
            {daily.map((point) => (
              <div key={point.date} className={styles.barSlot} title={`${point.date}: ${point.sessions}`}>
                {point.sessions > 0 && (
                  <div
                    className={styles.bar}
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
