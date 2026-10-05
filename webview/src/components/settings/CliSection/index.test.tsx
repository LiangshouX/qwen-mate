import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CliSection from './index';
import {
  CLI_PROVIDER_VISIBILITY_KEY,
  getHiddenCliProviderIds,
} from '../../../utils/cliProviderVisibility';

const translations: Record<string, string> = {
  'settings.cli.listTitle': 'Local CLI tools',
  'settings.cli.summary': '{{installed}} / {{total}} installed',
  'settings.cli.moreComingSoon': 'More coming soon',
  'settings.cli.hint': 'hint',
  'settings.cli.refresh': 'Re-check',
  'settings.cli.retry': 'Retry',
  'settings.cli.loading': 'Loading',
  'settings.cli.loadFailed': 'Failed',
  'settings.cli.status.installed': 'Installed',
  'settings.cli.status.notInstalled': 'Not installed',
  'settings.cli.viewInstallGuide': 'Install guide',
  'settings.cli.howToInstall': 'Install guide',
  'settings.cli.visibility.hide': 'Hide in provider switcher',
  'settings.cli.visibility.show': 'Show in provider switcher',
  'settings.cli.copy': 'Copy',
  'settings.cli.copyPath': 'Copy path',
  'settings.cli.copied': 'Copied',
  'settings.cli.copyFailed': 'Copy failed',
  'settings.cli.tools.qwen.name': 'Qwen Code',
  'settings.cli.tools.qwen.description': 'Qwen desc',
  'settings.cli.installDialog.title': 'Install {{name}}',
  'settings.cli.installDialog.lead': 'Lead {{name}} {{binary}}',
  'settings.cli.installDialog.stepOpenTerminal': 'Open terminal',
  'settings.cli.installDialog.stepRunCommand': 'Run command',
  'settings.cli.installDialog.stepVerify': 'Verify {{binary}}',
  'settings.cli.installDialog.stepReturn': 'Return',
  'settings.cli.installDialog.primaryCommand': 'Primary',
  'settings.cli.installDialog.windowsCommand': 'Windows',
  'settings.cli.installDialog.altCommand': 'Alt',
  'settings.cli.installDialog.openDocs': 'Docs',
  'common.close': 'Close',
  'common.gotIt': 'Got it',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const template = translations[key] ?? key;
      if (!options) return template;
      return Object.entries(options).reduce(
        (result, [token, value]) => result.replace(`{{${token}}}`, value),
        template,
      );
    },
  }),
}));

vi.mock('../../shared/ProviderModelIcon', () => ({
  ProviderModelIcon: () => <span data-testid="provider-icon" />,
}));

describe('CliSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sendToJava = vi.fn();
    window.updateCliStatus = undefined;
    localStorage.removeItem(CLI_PROVIDER_VISIBILITY_KEY);
  });

  afterEach(() => {
    window.sendToJava = undefined;
    window.updateCliStatus = undefined;
  });

  it('requests CLI status on mount', async () => {
    render(<CliSection />);
    await waitFor(() => {
      expect(window.sendToJava).toHaveBeenCalledWith('get_cli_status:');
    });
  });

  it('renders installed and missing CLI tools from backend payload', async () => {
    render(<CliSection />);

    // Missing tool: description meta plus the binary chip and install guide.
    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: {
          id: 'qwen',
          name: 'Qwen Code',
          binaryName: 'qwen',
          installed: false,
        },
      }));
    });

    expect(screen.getByText('Qwen Code')).toBeTruthy();
    expect(screen.getByText('Qwen desc')).toBeTruthy();
    expect(screen.getAllByText('Install guide').length).toBeGreaterThan(0);

    // Installed tool: version and binary path replace the description meta.
    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: {
          id: 'qwen',
          name: 'Qwen Code',
          binaryName: 'qwen',
          installed: true,
          version: '1.2.3',
          path: '/usr/local/bin/qwen',
        },
      }));
    });

    expect(screen.getByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText('/usr/local/bin/qwen')).toBeTruthy();
    expect(screen.getByText('More coming soon')).toBeTruthy();
  });
  it('persists switcher visibility when the eye toggle is clicked', async () => {
    render(<CliSection />);

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: {
          id: 'qwen',
          name: 'Qwen Code',
          binaryName: 'qwen',
          installed: true,
          version: '1.2.3',
        },
      }));
    });

    const qwenRow = screen.getByText('Qwen Code').closest('div')!.parentElement!;
    const toggle = Array.from(qwenRow.querySelectorAll('button')).find(
      (btn) => btn.getAttribute('aria-label') === 'Hide in provider switcher',
    )!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);

    expect(getHiddenCliProviderIds()).toEqual(['qwen']);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Show in provider switcher');

    fireEvent.click(toggle);

    expect(getHiddenCliProviderIds()).toEqual([]);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the loading state while CLI detection is still pending', async () => {
    render(<CliSection />);
    expect(screen.getByText('Loading')).toBeTruthy();
  });

  it('opens install guide dialog without auto-installing', async () => {
    render(<CliSection />);

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: { id: 'qwen', name: 'Qwen Code', binaryName: 'qwen', installed: false },
      }));
    });

    const guideButtons = screen.getAllByText('Install guide');
    fireEvent.click(guideButtons[0]);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/npm install -g @qwen-code\/qwen-code/)).toBeTruthy();
    // Never triggers install via Java bridge
    const calls = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.every((c) => !c.includes('install'))).toBe(true);
  });

  it('opens the install dialog docs link in the system browser via the bridge', async () => {
    render(<CliSection />);

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: { id: 'qwen', name: 'Qwen Code', binaryName: 'qwen', installed: false },
      }));
    });

    fireEvent.click(screen.getAllByText('Install guide')[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('Docs'));
    expect(window.sendToJava).toHaveBeenCalledWith('open_browser_external:https://github.com/QwenLM/qwen-code');
  });
});
