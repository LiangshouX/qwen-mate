import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  UsagePayload,
  UsageProjectGroup,
  UsageSessionGroup,
  UsageWindowStats,
} from '../../../types/usage';
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

function projectGroup(project: string, overrides: Partial<UsageProjectGroup> = {}): UsageProjectGroup {
  return {
    ...windowStats(),
    project,
    ...overrides,
  };
}

function sessionGroup(
  sessionId: string,
  overrides: Partial<UsageSessionGroup> = {},
): UsageSessionGroup {
  const stats = windowStats();
  const { daily: _daily, ...slim } = stats;
  return {
    ...slim,
    sessionId,
    project: 'D:\\Code\\qwen-mate',
    // Local-time construction: the same local day (single-day session) and a
    // stable fallback label regardless of the runner's timezone.
    startTimeMs: new Date(2026, 9, 9, 10, 30).getTime(),
    timestampMs: new Date(2026, 9, 9, 12, 0).getTime(),
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
    dimensions: {
      projects: {
        today: [
          projectGroup('D:\\Code\\qwen-mate', { totalTokens: 100_000_000, sessions: 9 }),
          // Duplicate dir names force the last-two-segments display form.
          projectGroup('C:\\Users\\demo\\AppData\\qwen-code-gui\\ai-bridge', {
            totalTokens: 20_000_000,
            sessions: 2,
          }),
          projectGroup('C:\\Users\\demo\\AppData\\qwenmate\\ai-bridge', {
            totalTokens: 5_000_000,
            sessions: 1,
          }),
        ],
        d7: [projectGroup('D:\\Code\\qwen-mate', { totalTokens: 2_000_000 })],
        d30: [],
      },
      sessions: {
        today: [
          sessionGroup('c30309ab-22c7-4efc-bda0-358b8bfd7187', { title: '修 Bug 会话' }),
          sessionGroup('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { totalTokens: 1_000 }),
        ],
        d7: [],
        d30: [],
      },
    },
    userHome: 'C:\\Users\\demo',
    currentProject: 'D:\\Code\\qwen-mate',
    heatmap: {
      start: '2026-09-28',
      today: '2026-10-09',
      days: { '2026-10-09': 137_500_000 },
      cachePct: { '2026-10-09': 93 },
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

  it('shows date and value in a tooltip when hovering a heat cell', () => {
    const { container } = render(<UsageStatsSection />);
    pushSnapshot(payload());

    const cell = container.querySelector('[data-date="2026-10-09"]');
    expect(cell).toBeTruthy();

    // React derives mouseenter from mouseover.
    fireEvent.mouseOver(cell!);

    const tip = document.querySelector('[data-testid="usage-heat-tooltip"]');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('2026-10-09');
    expect(tip!.textContent).toContain('Tokens: 137.5M');
    expect(tip!.textContent).toContain('Cache: 93%');

    fireEvent.mouseOut(cell!, { relatedTarget: document.body });
    expect(document.querySelector('[data-testid="usage-heat-tooltip"]')).toBeNull();
  });

  it('shows date and session count in a tooltip when hovering a bar', () => {
    render(<UsageStatsSection />);
    pushSnapshot(payload());
    fireEvent.click(screen.getByText('settings.usageStats.range.d7'));

    const slots = document.querySelectorAll('[data-testid="usage-bar-slot"]');
    expect(slots.length).toBe(2);

    // React derives mouseenter from mouseover.
    fireEvent.mouseOver(slots[1]);

    const tip = document.querySelector('[data-testid="usage-bar-tooltip"]');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('10月9日');
    expect(tip!.textContent).toContain('settings.usageStats.charts.sessionsLabel');
    expect(tip!.textContent).toContain('7');

    fireEvent.mouseOut(slots[1], { relatedTarget: document.body });
    expect(document.querySelector('[data-testid="usage-bar-tooltip"]')).toBeNull();
  });

  describe('project dimension', () => {
    it('offers window projects in a dropdown with duplicate names escalated', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.project'));

      const select = screen.getByLabelText(
        'settings.usageStats.projects.selectLabel',
      ) as HTMLSelectElement;
      const labels = Array.from(select.options).map((o) => o.textContent);
      // Ranked window projects, each labelled with its token total.
      expect(labels[0]).toBe('qwen-mate · 100.0M');
      expect(labels).toContain('qwen-code-gui/ai-bridge · 20.0M');
      expect(labels).toContain('qwenmate/ai-bridge · 5.0M');
      // The raw path rides on the option title for disambiguation.
      expect(select.options[0].title).toBe('D:\\Code\\qwen-mate');
      expect(select.options[1].title).toBe(
        'C:\\Users\\demo\\AppData\\qwen-code-gui\\ai-bridge',
      );
    });

    it('defaults to the IDE current project and switches on selection', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.project'));
      const select = screen.getByLabelText(
        'settings.usageStats.projects.selectLabel',
      ) as HTMLSelectElement;
      // Default = the IDE's current project (carries into the session dimension).
      expect(select.value).toBe('D:\\Code\\qwen-mate');
      expect(screen.getAllByText('100.0M').length).toBeGreaterThanOrEqual(1);

      fireEvent.change(select, {
        target: { value: 'C:\\Users\\demo\\AppData\\qwenmate\\ai-bridge' },
      });
      // Hero + hero label follow the picked project.
      expect(screen.getAllByText('5.0M').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('qwenmate/ai-bridge').length).toBeGreaterThanOrEqual(1);
    });

    it('keeps the today range hiding both charts', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.project'));

      expect(screen.queryByText('settings.usageStats.charts.tokensTitle')).toBeNull();
      expect(screen.queryByText('settings.usageStats.charts.sessionsTitle')).toBeNull();

      fireEvent.click(screen.getByText('settings.usageStats.range.d7'));
      expect(screen.getByText('settings.usageStats.charts.tokensTitle')).toBeTruthy();
      expect(screen.getByText('settings.usageStats.charts.sessionsTitle')).toBeTruthy();
    });
  });

  describe('session dimension', () => {
    it('filters sessions by project and shows /resume names with a date-time fallback', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.session'));

      // Two-level filter: the project picker defaults to the IDE project.
      const projectSelect = screen.getByLabelText(
        'settings.usageStats.projects.selectLabel',
      ) as HTMLSelectElement;
      expect(projectSelect.value).toBe('D:\\Code\\qwen-mate');

      const sessionSelect = screen.getByLabelText(
        'settings.usageStats.sessions.selectLabel',
      ) as HTMLSelectElement;
      const labels = Array.from(sessionSelect.options).map((o) => o.textContent);
      // Resolved history-panel title (the /resume name) first…
      expect(labels[0]).toBe('修 Bug 会话');
      // …then a local date-time fallback — never a truncated session id.
      expect(labels[1]).toBe('2026-10-09 10:30');
      expect(labels.join(' | ')).not.toContain('aaaaaaaa');
    });

    it('carries the By Project choice into the session dimension', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.project'));
      fireEvent.change(
        screen.getByLabelText('settings.usageStats.projects.selectLabel') as HTMLSelectElement,
        { target: { value: 'C:\\Users\\demo\\AppData\\qwenmate\\ai-bridge' } },
      );

      fireEvent.click(screen.getByText('settings.usageStats.dimension.session'));
      const projectSelect = screen.getByLabelText(
        'settings.usageStats.projects.selectLabel',
      ) as HTMLSelectElement;
      expect(projectSelect.value).toBe('C:\\Users\\demo\\AppData\\qwenmate\\ai-bridge');
      // That project has no sessions in this window → no session picker and
      // an explicit empty state instead of silently listing other projects.
      expect(screen.queryByLabelText('settings.usageStats.sessions.selectLabel')).toBeNull();
      expect(screen.getByText('settings.usageStats.charts.empty')).toBeTruthy();
    });

    it('switches the page to the selected session and never shows the bar chart', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.session'));
      // The bar chart (daily session counts) is meaningless for one session.
      expect(screen.queryByText('settings.usageStats.charts.sessionsTitle')).toBeNull();

      const sessionSelect = screen.getByLabelText(
        'settings.usageStats.sessions.selectLabel',
      ) as HTMLSelectElement;
      fireEvent.change(sessionSelect, {
        target: { value: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      });

      // Hero + option both carry the fallback label of the selection.
      expect(screen.getAllByText(/2026-10-09 10:30/).length).toBeGreaterThanOrEqual(2);
    });

    it('hides the line chart for a single-day session', () => {
      render(<UsageStatsSection />);
      pushSnapshot(payload());

      fireEvent.click(screen.getByText('settings.usageStats.dimension.session'));
      fireEvent.click(screen.getByText('settings.usageStats.range.d7'));
      // The d7 window has no sessions in the fixture → nothing selected.
      expect(screen.queryByText('settings.usageStats.charts.tokensTitle')).toBeNull();

      // A same-local-day session also hides the chart even when listed.
      const snap = payload();
      snap.dimensions!.sessions.d7 = [
        sessionGroup('single-day-1', { title: '单日会话' }),
      ];
      pushSnapshot(snap);
      expect(screen.queryByText('settings.usageStats.charts.tokensTitle')).toBeNull();
      expect(screen.queryByText('settings.usageStats.charts.sessionsTitle')).toBeNull();
    });

    it('fetches the rebuilt daily series and shows the chart for a multi-day session', () => {
      const snap = payload();
      snap.dimensions!.sessions.d7 = [
        sessionGroup('multi-day-1', {
          title: '跨天会话',
          // Local-time construction: the multi-day gate compares LOCAL dates.
          startTimeMs: new Date(2026, 9, 8, 20).getTime(),
          timestampMs: new Date(2026, 9, 9, 4).getTime(),
        }),
      ];
      render(<UsageStatsSection />);
      pushSnapshot(snap);

      fireEvent.click(screen.getByText('settings.usageStats.dimension.session'));
      fireEvent.click(screen.getByText('settings.usageStats.range.d7'));
      const send = window.sendToJava as ReturnType<typeof vi.fn>;
      expect(send).toHaveBeenCalledWith('get_usage_stats:{"sessionDaily":"multi-day-1"}');

      act(() => {
        window.onUsageSessionDaily?.(
          JSON.stringify({
            sessionId: 'multi-day-1',
            daily: [
              { date: '2026-10-08', tokens: 0, sessions: 0 },
              { date: '2026-10-09', tokens: 5_000, sessions: 1 },
            ],
          }),
        );
      });

      expect(screen.getByText('settings.usageStats.charts.tokensTitle')).toBeTruthy();
    });
  });
});
