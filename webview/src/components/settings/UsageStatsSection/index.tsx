import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  UsageDailyPoint,
  UsagePayload,
  UsageRangeKey,
  UsageSessionDaily,
  UsageSessionGroup,
  UsageWindowStats,
} from '../../../types/usage';
import {
  ModelShareList,
  SessionsBarChart,
  TokenLineChart,
  UsageHeatmap,
} from './Charts';
import {
  DIMENSIONS,
  RANGES,
  duplicateBaseNames,
  formatClock,
  formatCount,
  formatTokens,
  projectDisplayName,
  samePath,
  sessionDisplayName,
  sessionSpansMultipleDays,
  type UsageDimensionKey,
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
  const [dimension, setDimension] = useState<UsageDimensionKey>('all');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  /** sessionId → lazily rebuilt per-day series (session-dimension line chart). */
  const [sessionDaily, setSessionDaily] = useState<Record<string, UsageDailyPoint[]>>({});
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
    const previousDaily = window.onUsageSessionDaily;
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
    window.onUsageSessionDaily = (json: string) => {
      try {
        const parsed = JSON.parse(json) as UsageSessionDaily;
        if (parsed.sessionId) {
          setSessionDaily((prev) => ({ ...prev, [parsed.sessionId]: parsed.daily ?? [] }));
        }
      } catch {
        // A malformed daily payload only costs the chart, never the page.
      }
    };
    request(false);
    return () => {
      window.onUsageStats = previous;
      window.onUsageSessionDaily = previousDaily;
      clearRequestTimeout();
    };
  }, [request, clearRequestTimeout]);

  const projectGroups = payload?.dimensions?.projects?.[range] ?? [];
  const sessionGroups = payload?.dimensions?.sessions?.[range] ?? [];
  const currentProject = payload?.currentProject;

  // Options = window projects (+ the IDE's current project when the window
  // has no sessions for it, so the documented default stays selectable).
  const projectOptions = useMemo(() => {
    const paths = projectGroups.map((group) => group.project);
    if (currentProject && !paths.some((path) => samePath(path, currentProject))) {
      paths.push(currentProject);
    }
    return paths;
  }, [projectGroups, currentProject]);
  const duplicateNames = useMemo(
    () => duplicateBaseNames(projectOptions),
    [projectOptions],
  );

  // One shared pick for both dimensions: an explicit By Project choice carries
  // into By Session; with none, the IDE's current project wins, then the
  // top-ranked window project. A selection missing from the current window
  // (range switch) is skipped rather than shown empty.
  const effectiveProjectPath =
    projectOptions.find((path) => samePath(path, selectedProject)) ??
    projectOptions.find((path) => samePath(path, currentProject)) ??
    projectOptions[0] ??
    '';

  // null when the pick has no data in this window (e.g. the idle current
  // project) — the stats area then renders the empty state.
  const activeProject =
    projectGroups.find((group) => samePath(group.project, effectiveProjectPath)) ?? null;

  const projectSessions = sessionGroups.filter((group) =>
    samePath(group.project, effectiveProjectPath),
  );
  const activeSession =
    projectSessions.find((group) => group.sessionId === selectedSessionId) ??
    projectSessions[0] ??
    null;

  // The session line chart needs per-day data a usage record cannot carry
  // (it buckets a whole session onto its end date) — fetch it from the
  // transcript on demand, once per session. The today range hides charts in
  // every dimension, so it never needs the series.
  useEffect(() => {
    if (dimension !== 'session' || range === 'today' || !activeSession) {
      return;
    }
    if (!sessionSpansMultipleDays(activeSession)) {
      return;
    }
    if (sessionDaily[activeSession.sessionId]) {
      return;
    }
    window.sendToJava?.(
      `get_usage_stats:${JSON.stringify({ sessionDaily: activeSession.sessionId })}`,
    );
  }, [dimension, range, activeSession, sessionDaily]);

  const stats: UsageWindowStats | UsageSessionGroup | undefined =
    dimension === 'project'
      ? activeProject ?? undefined
      : dimension === 'session'
        ? activeSession ?? undefined
        : payload?.windows?.[range];

  const rangeDef = RANGES.find((r) => r.key === range) ?? RANGES[0];
  const rangeLabel = t(rangeDef.labelKey);
  const heroLabel =
    dimension === 'project' && activeProject
      ? projectDisplayName(activeProject.project, duplicateNames, payload?.userHome)
      : dimension === 'session' && activeSession
        ? sessionDisplayName(activeSession)
        : t(`settings.usageStats.hero.${range}`);

  // Chart visibility per the agreed rules: the today range hides both charts
  // in every dimension; the session dimension additionally always hides the
  // sessions bar chart and shows the line chart only for multi-day sessions.
  const showBarChart = range !== 'today' && dimension !== 'session';
  const showLineChart =
    range !== 'today' &&
    (dimension === 'session'
      ? !!activeSession && sessionSpansMultipleDays(activeSession)
      : true);
  const lineDaily: UsageDailyPoint[] =
    dimension === 'session'
      ? (activeSession ? sessionDaily[activeSession.sessionId] ?? [] : [])
      : stats && 'daily' in stats
        ? stats.daily
        : [];

  const status = !payload
    ? loading
      ? 'loading'
      : 'error'
    : payload.supported
      ? 'ok'
      : 'noData';

  const statusLabel = t(`settings.usageStats.status.${status}`);

  // Shared project picker for both dimensions: window projects (ranked by
  // tokens, totals shown in the label) plus the IDE's current project when
  // the window holds no sessions for it. The raw path rides on the option as
  // a title for disambiguation.
  const projectSelect =
    payload && projectOptions.length > 0 ? (
      <select
        className={styles.sessionSelect}
        aria-label={t('settings.usageStats.projects.selectLabel')}
        value={effectiveProjectPath}
        onChange={(event) => setSelectedProject(event.target.value)}
      >
        {projectOptions.map((path) => {
          const group = projectGroups.find((candidate) => samePath(candidate.project, path));
          const name = projectDisplayName(path, duplicateNames, payload.userHome);
          return (
            <option key={path} value={path} title={path}>
              {group ? `${name} · ${formatTokens(group.totalTokens)}` : name}
            </option>
          );
        })}
      </select>
    ) : null;

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

      {/* Controls live at the payload level: an empty window in a dimension
          must not take the dimension switcher away. */}
      {payload && (
        <div className={styles.rangeRow}>
          <div className={styles.dimGroup}>
            {DIMENSIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.rangeBtn} ${dimension === item.key ? styles.rangeActive : ''}`}
                onClick={() => setDimension(item.key)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
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
      )}

      {payload && dimension === 'project' && projectSelect && (
        <div className={styles.sessionRow}>{projectSelect}</div>
      )}

      {payload && dimension === 'session' && projectSelect && (
        <div className={styles.sessionRow}>
          {projectSelect}
          {projectSessions.length > 0 && (
            <select
              className={styles.sessionSelect}
              aria-label={t('settings.usageStats.sessions.selectLabel')}
              value={activeSession?.sessionId ?? ''}
              onChange={(event) => setSelectedSessionId(event.target.value)}
            >
              {projectSessions.map((group) => (
                <option key={group.sessionId} value={group.sessionId}>
                  {sessionDisplayName(group)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {payload && stats && (
        <>
          <div className={styles.heroCard}>
            <div className={styles.heroTop}>
              <span className={styles.heroLabel} title={heroLabel}>
                {heroLabel}
              </span>
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

          {showLineChart && lineDaily.length > 0 && (
            <TokenLineChart daily={lineDaily} rangeLabel={rangeLabel} />
          )}
          {showBarChart && 'daily' in stats && (
            <SessionsBarChart daily={stats.daily} rangeLabel={rangeLabel} />
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
