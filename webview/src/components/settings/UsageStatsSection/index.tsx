import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsagePayload, UsageRangeKey } from '../../../types/usage';
import {
  ModelShareList,
  SessionsBarChart,
  TokenLineChart,
  UsageHeatmap,
} from './Charts';
import {
  RANGES,
  formatClock,
  formatCount,
  formatTokens,
} from './usageStatsUtils';
import styles from './style.module.less';

/** Java may not answer get_usage_stats (older plugin) — fail instead of spinning forever. */
const REQUEST_TIMEOUT_MS = 20_000;

const UsageStatsSection = () => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<UsageRangeKey>('today');
  const timeoutRef = useRef<number | null>(null);
  const payloadRef = useRef<UsagePayload | null>(null);

  const clearRequestTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const request = useCallback(
    (refresh: boolean) => {
      setLoading(true);
      setFailed(false);
      clearRequestTimeout();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setLoading(false);
        if (!payloadRef.current) {
          setFailed(true);
        }
      }, REQUEST_TIMEOUT_MS);
      window.sendToJava?.(
        `get_usage_stats:${refresh ? JSON.stringify({ refresh: true }) : ''}`,
      );
    },
    [clearRequestTimeout],
  );

  useEffect(() => {
    const previous = window.onUsageStats;
    window.onUsageStats = (json: string) => {
      clearRequestTimeout();
      try {
        const parsed = JSON.parse(json) as UsagePayload;
        if (parsed.error || !parsed.windows) {
          setFailed(true);
        } else {
          payloadRef.current = parsed;
          setPayload(parsed);
          setFailed(false);
        }
      } catch {
        setFailed(true);
      }
      setLoading(false);
    };
    request(false);
    return () => {
      window.onUsageStats = previous;
      clearRequestTimeout();
    };
  }, [request, clearRequestTimeout]);

  const rangeDef = RANGES.find((r) => r.key === range) ?? RANGES[0];
  const rangeLabel = t(rangeDef.labelKey);
  const heroLabel = t(`settings.usageStats.hero.${range}`);
  const stats = payload?.windows?.[range];

  const status = !payload
    ? loading
      ? 'loading'
      : 'error'
    : payload.supported
      ? 'ok'
      : 'noData';

  const statusLabel = t(`settings.usageStats.status.${status}`);

  return (
    <div className={styles.section}>
      <div className={styles.headerRow}>
        <div className={styles.headerTitleGroup}>
          <h3 className={styles.sectionTitle}>{t('settings.usageStats.title')}</h3>
          <span
            className={`${styles.statusBadge} ${styles[`status_${status}` as const]}`}
          >
            {statusLabel}
          </span>
          {payload && (
            <span className={styles.updatedAt}>
              {t('settings.usageStats.updatedAt', {
                time: formatClock(payload.generatedAtMs),
              })}
            </span>
          )}
          {payload && payload.liveSessionCount > 0 && (
            <span className={styles.liveNote}>
              {t('settings.usageStats.notice.liveNote', {
                count: payload.liveSessionCount,
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          disabled={loading}
          onClick={() => request(true)}
        >
          <span className="codicon codicon-refresh" />
          {t('settings.usageStats.refresh')}
        </button>
      </div>

      <p className={styles.sectionDesc}>{t('settings.usageStats.desc')}</p>

      {payload && (
        <div
          className={`${styles.notice} ${
            payload.supported ? styles.noticeInfo : styles.noticeWarning
          }`}
        >
          <span className="codicon codicon-info" />
          <span>
            {payload.supported
              ? t('settings.usageStats.notice.source', { path: payload.dataFile })
              : t('settings.usageStats.notice.unsupported', {
                  path: payload.dataFile,
                  min: payload.minSupportedVersion,
                  version: payload.cliVersion || t('settings.usageStats.versionUnknown'),
                })}
          </span>
          <span className={styles.noticeVersion}>
            {t('settings.usageStats.notice.version', {
              min: payload.minSupportedVersion,
              version: payload.cliVersion || t('settings.usageStats.versionUnknown'),
            })}
          </span>
        </div>
      )}

      {failed && !payload && (
        <div className={styles.errorCard}>
          <span className="codicon codicon-error" />
          <span>{t('settings.usageStats.error.title')}</span>
          <button type="button" className={styles.retryBtn} onClick={() => request(true)}>
            {t('settings.usageStats.error.retry')}
          </button>
        </div>
      )}

      {payload && stats && (
        <>
          <div className={styles.rangeRow}>
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.rangeBtn} ${range === item.key ? styles.rangeActive : ''}`}
                onClick={() => setRange(item.key)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          <div className={styles.heroCard}>
            <div className={styles.heroTop}>
              <span className={styles.heroLabel}>{heroLabel}</span>
              <button
                type="button"
                className={styles.heroRefresh}
                disabled={loading}
                onClick={() => request(true)}
              >
                {t('settings.usageStats.refresh')}
              </button>
            </div>
            <div className={styles.heroValue}>{formatTokens(stats.totalTokens)}</div>
            <div className={styles.heroSub}>{t('settings.usageStats.tokensLabel')}</div>
          </div>

          <div className={styles.statsGrid}>
            {(
              [
                ['sessions', stats.sessions],
                ['requests', stats.requests],
                ['toolCalls', stats.toolCalls],
                ['changes', stats.changes],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className={styles.statCard}>
                <div className={styles.statValue}>{formatCount(value)}</div>
                <div className={styles.statLabel}>
                  {t(`settings.usageStats.cards.${key}`)}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.blockTitle}>{t('settings.usageStats.split.title')}</div>
          <div className={styles.splitGrid}>
            <div className={styles.splitCard}>
              <div className={styles.splitHead}>
                <span className={styles.splitMark} />
                {t('settings.usageStats.split.input')}
              </div>
              <div className={styles.splitValue}>{formatTokens(stats.inputTokens)}</div>
              <div className={styles.splitSub}>{t('settings.usageStats.split.inputSub')}</div>
            </div>
            <div className={styles.splitCard}>
              <div className={styles.splitHead}>
                <span className={styles.splitMark} />
                {t('settings.usageStats.split.output')}
              </div>
              <div className={styles.splitValue}>
                {formatTokens(stats.outputTokens + stats.thoughtsTokens)}
              </div>
              <div className={styles.splitSub}>{t('settings.usageStats.split.outputSub')}</div>
            </div>
            <div className={styles.splitCard}>
              <div className={styles.splitHead}>
                <span className={`${styles.splitMark} ${styles.splitMarkGreen}`} />
                {t('settings.usageStats.split.cache')}
              </div>
              <div className={styles.splitValue}>{Math.round(stats.cachePct)}%</div>
              <div className={styles.splitSub}>{t('settings.usageStats.split.cacheSub')}</div>
            </div>
          </div>

          <div className={styles.blockTitle}>{t('settings.usageStats.heatmap.title')}</div>
          <div className={styles.blockDesc}>{t('settings.usageStats.heatmap.desc')}</div>
          <UsageHeatmap heatmap={payload.heatmap} />

          <div className={styles.blockTitle}>
            {t('settings.usageStats.models.title', { range: rangeLabel })}
          </div>
          <div className={styles.blockDesc}>{t('settings.usageStats.models.shareDesc')}</div>
          <ModelShareList models={stats.models} />

          <div className={styles.blockTitle}>
            {t('settings.usageStats.skills.title', { range: rangeLabel })}
          </div>
          <div className={styles.blockDesc}>{t('settings.usageStats.skills.desc')}</div>
          {stats.skills.length === 0 ? (
            <div className={styles.chartEmpty}>{t('settings.usageStats.skills.empty')}</div>
          ) : (
            <div className={styles.skillTable}>
              <div className={styles.skillHead}>
                <span>{t('settings.usageStats.skills.name')}</span>
                <span>{t('settings.usageStats.skills.count')}</span>
              </div>
              {stats.skills.map((skill) => (
                <div key={skill.name} className={styles.skillRow}>
                  <span className={styles.skillName}>{skill.name}</span>
                  <span className={styles.skillCount}>{skill.count}</span>
                </div>
              ))}
            </div>
          )}

          {range !== 'today' && (
            <>
              <TokenLineChart daily={stats.daily} rangeLabel={rangeLabel} />
              <SessionsBarChart daily={stats.daily} rangeLabel={rangeLabel} />
            </>
          )}
        </>
      )}

      {payload && !stats && (
        <div className={styles.chartEmpty}>{t('settings.usageStats.charts.empty')}</div>
      )}
    </div>
  );
};

export default UsageStatsSection;
