import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsagePayload, UsageWindowStats } from '../../../types/usage';
import UsageStatsSection from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: () => {} },
  }),
}));

function windowStats(overrides: Partial<UsageWindowStats> = {}): UsageWindowStats {
  return {
    startMs: 0,
    endMs: 0,
    sessions: 15,
    requests: 1044,
    toolCalls: 1533,
    changes: 3404,
    linesAdded: 3300,
    linesRemoved: 104,
    inputTokens: 136_500_000,
    outputTokens: 1_000_000,
    cachedTokens: 127_000_000,
    thoughtsTokens: 700_000,
    totalTokens: 137_500_000,
    cachePct: 93,
    models: [],
    skills: [],
    daily: [
      { date: '2026-10-08', tokens: 0, sessions: 0 },
      { date: '2026-10-09', tokens: 0, sessions: 15 },
    ],
    ...overrides,
  };
}

function payload(): UsagePayload {
  return {
    generatedAtMs: 1_790_000_000_000,
    supported: true,
    dataFileExists: true,
    dataFile: 'C:/Users/demo/.qwen/usage_record.jsonl',
    recordCount: 141,
    sessionCount: 90,
    liveSessionCount: 3,
    cliVersion: '0.25.0',
    minSupportedVersion: '0.18.0',
    earliestRecordMs: 1_780_000_000_000,
    latestRecordMs: 1_790_000_000_000,
    windows: {
      today: windowStats(),
      d7: windowStats({
        totalTokens: 2_000_000,
        requests: 12,
        daily: [
          { date: '2026-10-08', tokens: 0, sessions: 3 },
          { date: '2026-10-09', tokens: 52_400_000, sessions: 7 },
        ],
      }),
      d30: windowStats({ totalTokens: 3_000_000, requests: 24 }),
    },
    heatmap: {
      start: '2026-09-28',
      today: '2026-10-09',
      days: { '2026-10-09': 137_500_000 },
      maxDayTokens: 137_500_000,
    },
  };
}

function pushSnapshot(snap: UsagePayload) {
  act(() => {
    window.onUsageStats?.(JSON.stringify(snap));
  });
}

describe('UsageStatsSection', () => {
  beforeEach(() => {
    window.sendToJava = vi.fn();
  });

  it('requests the snapshot on mount and renders headline numbers', () => {
    render(<UsageStatsSection />);
    expect(window.sendToJava).toHaveBeenCalledWith('get_usage_stats:');

    pushSnapshot(payload());

    // Hero: today's total tokens.
    expect(screen.getByText('137.5M')).toBeTruthy();
    // Request counter card.
    expect(screen.getByText('1,044')).toBeTruthy();
    // Token split cards.
    expect(screen.getByText('136.5M')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
    // Healthy status + version notice.
    expect(screen.getByText('settings.usageStats.status.ok')).toBeTruthy();
    expect(screen.getByText('settings.usageStats.notice.version')).toBeTruthy();
  });

  it('switches windows client-side without a new bridge request', () => {
    render(<UsageStatsSection />);
    pushSnapshot(payload());
    const send = window.sendToJava as ReturnType<typeof vi.fn>;
    send.mockClear();

    fireEvent.click(screen.getByText('settings.usageStats.range.d7'));

    expect(screen.getByText('2.0M')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('refresh sends the refresh flag through the bridge', () => {
    render(<UsageStatsSection />);
    pushSnapshot(payload());
    const send = window.sendToJava as ReturnType<typeof vi.fn>;
    send.mockClear();

    fireEvent.click(screen.getAllByText('settings.usageStats.refresh')[0]);

    expect(send).toHaveBeenCalledWith('get_usage_stats:{"refresh":true}');
  });

  it('shows the warning notice when the data file is missing', () => {
    render(<UsageStatsSection />);
    const snap = payload();
    snap.supported = false;
    snap.dataFileExists = false;
    pushSnapshot(snap);

    expect(screen.getByText('settings.usageStats.status.noData')).toBeTruthy();
    expect(screen.getByText('settings.usageStats.notice.unsupported')).toBeTruthy();
  });

  it('surfaces bridge errors with a retry affordance', () => {
    render(<UsageStatsSection />);
    pushSnapshot({ error: 'boom' } as UsagePayload);

    expect(screen.getByText('settings.usageStats.error.title')).toBeTruthy();
    expect(screen.getByText('settings.usageStats.error.retry')).toBeTruthy();
  });

  it('hides the daily charts for the today range and shows them for 7/30 days', () => {
    render(<UsageStatsSection />);
    pushSnapshot(payload());

    expect(screen.queryByText('settings.usageStats.charts.tokensTitle')).toBeNull();
    expect(screen.queryByText('settings.usageStats.charts.sessionsTitle')).toBeNull();

    fireEvent.click(screen.getByText('settings.usageStats.range.d7'));
    expect(screen.getByText('settings.usageStats.charts.tokensTitle')).toBeTruthy();
    expect(screen.getByText('settings.usageStats.charts.sessionsTitle')).toBeTruthy();

    fireEvent.click(screen.getByText('settings.usageStats.range.today'));
    expect(screen.queryByText('settings.usageStats.charts.tokensTitle')).toBeNull();
  });

  it('shows date and value in a tooltip when hovering the line chart', () => {
    const { container } = render(<UsageStatsSection />);
    pushSnapshot(payload());
    fireEvent.click(screen.getByText('settings.usageStats.range.d7'));

    const chart = container.querySelector('[data-testid="usage-line-chart"]');
    expect(chart).toBeTruthy();
    chart!.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 100,
        top: 0,
        height: 160,
        right: 100,
        bottom: 160,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(chart!, { clientX: 100, clientY: 20 });

    const tip = document.querySelector('[data-testid="usage-line-tooltip"]');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('10月9日');
    expect(tip!.textContent).toContain('52.4M');

    fireEvent.mouseOut(chart!, { relatedTarget: document.body });
    expect(document.querySelector('[data-testid="usage-line-tooltip"]')).toBeNull();
  });
});
