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
  'settings.cli.tools.dsh.name': 'DeepSeek Harness',
  'settings.cli.tools.dsh.description': 'DSH desc',
  'settings.cli.dsh.groupTitle': 'DeepSeek Harness',
  'settings.cli.dsh.cliRowTitle': 'CLI install',
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

vi.mock('./DshConnectionCard', () => ({
  default: () => <div data-testid="dsh-connection-card">DSH connection</div>,
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

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: {
          id: 'qwen',
          name: 'Qwen Code',
          binaryName: 'qwen',
          installed: false,
        },
        dsh: {
          id: 'dsh',
          name: 'DeepSeek Harness',
          binaryName: 'dsh',
          installed: true,
          version: '1.2.3',
          path: '/usr/local/bin/dsh',
        },
      }));
    });

    expect(screen.getByText('Qwen Code')).toBeTruthy();
    expect(screen.getByText('DeepSeek Harness')).toBeTruthy();
    expect(screen.getByText('CLI install')).toBeTruthy();
    expect(screen.queryByText('One product, two steps')).toBeNull();
    expect(screen.getByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText('/usr/local/bin/dsh')).toBeTruthy();
    expect(screen.getByText('More coming soon')).toBeTruthy();

    const group = screen.getByTestId('dsh-group');
    const harness = screen.getByText('DeepSeek Harness');
    const cliRow = screen.getByText('CLI install');
    const connection = screen.getByTestId('dsh-connection-card');
    expect(group.contains(harness)).toBe(true);
    expect(group.contains(cliRow)).toBe(true);
    expect(group.contains(connection)).toBe(true);
    expect(cliRow.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it('hides the local host card until the DSH CLI is detected as installed', async () => {
    render(<CliSection />);

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: { id: 'qwen', name: 'Qwen Code', binaryName: 'qwen', installed: false },
        dsh: { id: 'dsh', name: 'DeepSeek Harness', binaryName: 'dsh', installed: false },
      }));
    });

    expect(screen.getByText('DeepSeek Harness')).toBeTruthy();
    expect(screen.getByText('CLI install')).toBeTruthy();
    expect(screen.queryByText('Install the CLI first')).toBeNull();
    expect(screen.queryByTestId('dsh-connection-card')).toBeNull();
  });

  it('does not show the local host card while CLI detection is still loading', async () => {
    render(<CliSection />);
    expect(screen.queryByTestId('dsh-connection-card')).toBeNull();
    expect(screen.getByText('Loading')).toBeTruthy();
  });

  it('opens install guide dialog without auto-installing', async () => {
    render(<CliSection />);

    await act(async () => {
      window.updateCliStatus?.(JSON.stringify({
        qwen: { id: 'qwen', name: 'Qwen Code', binaryName: 'qwen', installed: false },
        dsh: { id: 'dsh', name: 'DeepSeek Harness', binaryName: 'dsh', installed: false },
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
