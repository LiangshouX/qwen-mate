import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AiFeatureProviderModelPanel from './index';
import type { CommitAiConfig } from '../../../types/aiFeatureConfig';
import { DEFAULT_AI_FEATURE_MODELS } from '../../../types/aiFeatureConfig';

const panelStyles = readFileSync(
  'src/components/settings/AiFeatureProviderModelPanel/style.module.less',
  'utf8'
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (options?.provider) {
        return `${key}:${options.provider}`;
      }
      if (options?.defaultValue) {
        return options.defaultValue;
      }
      return key;
    },
  }),
}));

vi.mock('../../../hooks/providers/useCliModels', () => ({
  useCliModels: () => {
    // Qwen catalog comes from the CLI config — no dynamic fetch.
    return {
      cliModels: [],
      cliCatalogHasEntries: false,
      cliModelsLoading: false,
      cliModelsError: null,
    };
  },
}));

vi.mock('../../../hooks/providers/useQwenModelOptions', () => ({
  useQwenModelOptions: () => ({
    configuredModel: 'qwen3-coder-plus',
    models: [
      { id: 'qwen3-coder-flash', label: 'Qwen3-Coder-Flash' },
      { id: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus' },
    ],
  }),
}));

describe('AiFeatureProviderModelPanel', () => {
  const config: CommitAiConfig = {
    provider: null,
    effectiveProvider: 'qwen',
    resolutionSource: 'auto',
    models: { ...DEFAULT_AI_FEATURE_MODELS },
    availability: {
      qwen: true,
    },
  };

  it('renders auto mode summary without provider/model selects', () => {
    render(
      <AiFeatureProviderModelPanel
        config={config}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    expect(screen.getByTestId('ai-feature-mode-segment')).toBeTruthy();
    expect(screen.getByTestId('ai-feature-mode-auto').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ai-feature-mode-manual').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('ai-feature-auto-summary')).toBeTruthy();
    expect(screen.getByText(/settings\.commit\.providerModel\.autoSummary/)).toBeTruthy();
    expect(screen.queryByTestId('ai-feature-provider-select')).toBeNull();
    expect(screen.queryByTestId('ai-feature-model-select')).toBeNull();
    expect(screen.queryByRole('button', { name: 'settings.commit.providerModel.resetToDefault' })).toBeNull();
  });

  it('switches auto → manual by pinning the resolved provider', () => {
    const onProviderChange = vi.fn();
    render(
      <AiFeatureProviderModelPanel
        config={{ ...config, effectiveProvider: 'qwen' }}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={onProviderChange}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('ai-feature-mode-manual'));
    expect(onProviderChange).toHaveBeenCalledWith('qwen');
  });

  it('switches manual → auto via reset callback', () => {
    const onResetToDefault = vi.fn();
    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'qwen',
          effectiveProvider: 'qwen',
          resolutionSource: 'manual',
        }}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={onResetToDefault}
      />
    );

    expect(screen.getByTestId('ai-feature-mode-manual').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ai-feature-provider-select')).toBeTruthy();
    expect(screen.getByTestId('ai-feature-model-select')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ai-feature-mode-auto'));
    expect(onResetToDefault).toHaveBeenCalledTimes(1);
  });

  it('lists the same providers as the main chat provider selector in manual mode', () => {
    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'qwen',
          effectiveProvider: 'qwen',
          resolutionSource: 'manual',
        }}
        settingsKeyPrefix="settings.basic.promptEnhancer"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        fallbackProvider="qwen"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const providerRoot = screen.getByTestId('ai-feature-provider-select');
    fireEvent.click(within(providerRoot).getByRole('button'));
    const options = within(providerRoot).getAllByRole('option');
    expect(options).toHaveLength(1);
    const labels = options.map((opt) => opt.textContent ?? '');
    expect(labels.some((l) => /qwen/i.test(l))).toBe(true);
    expect(labels.find((l) => /qwen/i.test(l))).not.toMatch(/Beta/);
  });

  it('keeps selects compact with ellipsis instead of wrapping', () => {
    expect(panelStyles).toMatch(
      /\.selectGroup\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(0,\s*0\.85fr\);/
    );
    expect(panelStyles).toMatch(
      /\.selectValue\s*\{[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    );
    // Must use custom listbox (button trigger), not native <select>.
    expect(panelStyles).toMatch(/Custom listbox \(not native <select>\)/);
    expect(panelStyles).toMatch(/\.segmentedControl\s*\{/);
    expect(panelStyles).toMatch(/\.autoSummary\s*\{/);
    expect(panelStyles).toMatch(
      /\.statusText\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    );
  });

  it('keeps provider options selectable and hints unavailability when availability is all false', () => {
    const onProviderChange = vi.fn();
    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'qwen',
          effectiveProvider: null,
          resolutionSource: 'unavailable',
          availability: {
            qwen: false,
          },
        }}
        settingsKeyPrefix="settings.basic.promptEnhancer"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        fallbackProvider="qwen"
        onProviderChange={onProviderChange}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const providerRoot = screen.getByTestId('ai-feature-provider-select');
    const trigger = within(providerRoot).getByRole('button');
    expect((trigger as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(trigger);
    const options = within(providerRoot).getAllByRole('option');
    expect(options.length).toBe(1);
    options.forEach((opt) => {
      expect((opt as HTMLButtonElement).disabled).toBe(false);
      // Availability hint is informational only — never gates selection.
      expect(opt.textContent ?? '').toMatch(/providerUnavailable/);
    });

    fireEvent.click(within(providerRoot).getByRole('option', {
      name: /^qwen/i,
    }));
    expect(onProviderChange).toHaveBeenCalledWith('qwen');
  });

  it('calls provider callback from manual mode selector', () => {
    const onProviderChange = vi.fn();

    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'qwen',
          effectiveProvider: 'qwen',
          resolutionSource: 'manual',
        }}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={onProviderChange}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    const providerRoot = screen.getByTestId('ai-feature-provider-select');
    fireEvent.click(within(providerRoot).getByRole('button'));
    fireEvent.click(within(providerRoot).getByRole('option', {
      name: /^qwen/i,
    }));

    expect(onProviderChange).toHaveBeenCalledWith('qwen');
  });

  it('calls model change callback from model selector in manual mode', () => {
    const onModelChange = vi.fn();

    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: 'qwen',
          effectiveProvider: 'qwen',
          resolutionSource: 'manual',
        }}
        settingsKeyPrefix="settings.commit.providerModel"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={onModelChange}
        onResetToDefault={vi.fn()}
      />
    );

    const modelRoot = screen.getByTestId('ai-feature-model-select');
    fireEvent.click(within(modelRoot).getByRole('button'));
    fireEvent.click(within(modelRoot).getByRole('option', { name: /Qwen3-Coder-Flash/i }));

    expect(onModelChange).toHaveBeenCalledWith('qwen3-coder-flash');
  });

  it('shows unavailable summary in auto mode when no provider is effective', () => {
    render(
      <AiFeatureProviderModelPanel
        config={{
          ...config,
          provider: null,
          effectiveProvider: null,
          resolutionSource: 'unavailable',
          availability: {
            qwen: false,
          },
        }}
        settingsKeyPrefix="settings.basic.promptEnhancer"
        providerKeyPrefix="settings.basic.promptEnhancer.provider"
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        onResetToDefault={vi.fn()}
      />
    );

    expect(screen.getByTestId('ai-feature-auto-summary')).toBeTruthy();
    expect(screen.getByText('settings.basic.promptEnhancer.autoUnavailable')).toBeTruthy();
  });
});
