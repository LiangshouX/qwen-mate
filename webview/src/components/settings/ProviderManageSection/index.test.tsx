import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderManageSection from './index';
import type { ProviderConfigSnapshot, ProviderStep } from '../../../types/providerConfig';

const translations: Record<string, string> = {
  'settings.pm.pageDesc': 'Visually configure model providers',
  'settings.pm.reload': 'Reload',
  'settings.pm.loading': 'Loading provider configuration…',
  'settings.pm.parseError': 'settings.json cannot be parsed:',
  'settings.pm.projectOverride': 'project override',
  'settings.pm.groupAlibaba': 'Alibaba ModelStudio',
  'settings.pm.groupThirdParty': 'Third-party Providers',
  'settings.pm.groupCustom': 'Custom Provider',
  'settings.pm.groupCustomBuckets': 'Custom Provider Buckets',
  'settings.pm.groupUnassigned': 'Standalone Models',
  'settings.pm.unassignedDesc': 'not claimed by presets',
  'settings.pm.customBucketDesc': 'custom bucket',
  'settings.pm.notConfigured': 'Not configured',
  'settings.pm.modelsCount': '{{count}} models',
  'settings.pm.noModels': 'No models yet',
  'settings.pm.expandModels': 'Models',
  'settings.pm.collapseModels': 'Collapse',
  'settings.pm.configure': 'Configure',
  'settings.pm.connect': 'Connect',
  'settings.pm.activeModel': 'Active',
  'settings.pm.addModel': 'Add model',
  'settings.pm.keySet': 'API key configured',
  'settings.pm.keyPlaceholder': 'Env variable reference',
  'settings.pm.keyProcess': 'From shell environment',
  'settings.pm.keyUnset': 'Not set',
  'settings.pm.unrouted': 'No mapping',
  'settings.pm.confirmDeleteTitle': 'Confirm deletion',
  'settings.pm.confirmDeleteBody': 'Delete "{{name}}" and its model entries?',
  'settings.pm.confirmDeleteKeyNote': 'orphaned keys are removed too',
  'settings.pm.confirmDeleteAction': 'Delete',
  'settings.pm.deleted': '{{name}} deleted',
  'settings.pm.modelDeleted': 'Model deleted',
  'settings.pm.saved': 'Saved',
  'settings.pm.errGeneric': 'Operation failed',
  'settings.pm.configureTitle': 'Configure {{name}}',
  'settings.pm.connectTitle': 'Connect {{name}}',
  'settings.pm.keyKeepPlaceholder': 'Saved — leave empty to keep',
  'settings.pm.keyNeverShown': 'Saved keys are never echoed back',
  'settings.pm.apiKey': 'API Key',
  'settings.pm.clearKey': 'Clear key',
  'settings.pm.clearKeyArmed': 'Confirm clear',
  'settings.pm.endpoint': 'Endpoint',
  'settings.pm.models': 'Models',
  'settings.pm.searchModels': 'Search model ID',
  'settings.pm.writeNote': 'JSONC format-preserving writes',
  'settings.pm.submitSave': 'Save',
  'settings.pm.submitConnect': 'Connect & write',
  'settings.pm.editModel': 'Edit model',
  'settings.pm.addModelTitle': 'Add model',
  'settings.pm.groupIdentity': 'Identity',
  'settings.pm.groupRoute': 'Route & credentials',
  'settings.pm.groupGeneration': 'Generation config',
  'settings.pm.flagsTitle': 'Purpose flags',
  'settings.pm.busy': 'Writing…',
  'settings.pm.docs': 'Docs',
  'settings.pm.getApiKey': 'Get API key',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'settings.providers': 'Model Providers',
  'settings.providersDesc': 'Manage providers',
  'settings.providerTab.qwen': 'Model Providers',
  'settings.providerTab.cli': 'CLI Tools',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const template = translations[key] ?? key;
      if (!options) return template;
      return Object.entries(options).reduce(
        (result, [token, value]) => result.replace(`{{${token}}}`, String(value)),
        template,
      );
    },
  }),
}));

const DEEPSEEK_CATALOG = {
  id: 'deepseek',
  label: 'DeepSeek API Key',
  description: 'Quick setup for DeepSeek',
  uiGroup: 'third-party' as const,
  protocol: 'openai',
  protocolOptions: null,
  baseUrl: 'https://api.deepseek.com',
  envKey: 'DEEPSEEK_API_KEY',
  envKeyGenerated: false,
  modelNamePrefix: 'DeepSeek',
  models: [
    { id: 'deepseek-v4-pro', contextWindowSize: 1000000 },
    { id: 'deepseek-v4-flash', contextWindowSize: 1000000 },
  ],
  modelsEditable: true,
  supportsModelDiscovery: false,
  showAdvancedConfig: false,
  apiKeyPlaceholder: 'sk-...',
  hasKeyValidator: false,
  documentationUrl: 'https://api-docs.deepseek.com',
  customHeaders: null,
  uiLabels: null,
  steps: ['apiKey', 'models'] as ProviderStep[],
};

const CUSTOM_CATALOG = {
  id: 'custom-openai-compatible',
  label: 'Custom Provider',
  description: 'Manually connect a local server',
  uiGroup: 'custom' as const,
  protocol: 'openai',
  protocolOptions: ['openai', 'anthropic', 'gemini'],
  baseUrl: null,
  envKey: null,
  envKeyGenerated: true,
  modelNamePrefix: null,
  models: null,
  modelsEditable: true,
  supportsModelDiscovery: false,
  showAdvancedConfig: true,
  apiKeyPlaceholder: 'sk-...',
  hasKeyValidator: false,
  documentationUrl: null,
  customHeaders: null,
  uiLabels: null,
  steps: ['protocol', 'wireApi', 'baseUrl', 'apiKey', 'models', 'advancedConfig'] as ProviderStep[],
};

function buildSnapshot(overrides: Partial<ProviderConfigSnapshot> = {}): ProviderConfigSnapshot {
  return {
    settingsPath: 'C:/Users/dev/.qwen/settings.json',
    settingsExists: true,
    parseError: null,
    catalog: [DEEPSEEK_CATALOG, CUSTOM_CATALOG],
    buckets: {
      openai: [
        {
          id: 'deepseek-v4-pro',
          name: '[DeepSeek] deepseek-v4-pro',
          envKey: 'DEEPSEEK_API_KEY',
          baseUrl: 'https://api.deepseek.com',
        },
        { id: 'hand-model', baseUrl: 'https://h.example/v1' },
      ],
      mygw: [{ id: 'm1', envKey: 'MYGW_KEY', baseUrl: 'https://gw.example/v1' }],
    },
    providerProtocol: { mygw: 'openai' },
    providers: [
      {
        kind: 'preset',
        id: 'deepseek',
        uiGroup: 'third-party',
        configured: true,
        owned: [
          { bucketId: 'openai', id: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' },
        ],
        endpoint: 'https://api.deepseek.com',
        envKeyName: 'DEEPSEEK_API_KEY',
        keyStatus: 'set',
        modelCount: 1,
        hasMetadata: true,
        metadataVersion: 'abc',
      },
      {
        kind: 'preset',
        id: 'custom-openai-compatible',
        uiGroup: 'custom',
        configured: false,
        owned: [],
        endpoint: '',
        envKeyName: null,
        keyStatus: 'unset',
        modelCount: 0,
        hasMetadata: false,
        metadataVersion: null,
      },
    ],
    customBuckets: [
      {
        kind: 'custom-bucket',
        bucketId: 'mypgw',
        protocol: 'openai',
        mapped: true,
        modelCount: 1,
        envKeyNames: ['MYGW_KEY'],
        keyStatuses: { MYGW_KEY: 'set' },
      },
    ],
    unassigned: { openai: [{ id: 'hand-model', baseUrl: 'https://h.example/v1' }] },
    env: { DEEPSEEK_API_KEY: { status: 'set', source: 'settings' } },
    selection: { name: 'deepseek-v4-pro', baseUrl: '', selectedType: 'openai' },
    aux: {},
    providerMetadata: { deepseek: { version: 'abc', baseUrl: 'https://api.deepseek.com' } },
    projectOverride: null,
    ...overrides,
  };
}

function pushSnapshot(snapshot: ProviderConfigSnapshot) {
  act(() => {
    window.updateProviderConfig?.(JSON.stringify({ ok: true, op: 'snapshot', snapshot }));
  });
}

describe('ProviderManageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sendToJava = vi.fn();
    window.updateProviderConfig = undefined;
    window.providerConfigResult = undefined;
  });

  afterEach(() => {
    window.sendToJava = undefined;
    window.updateProviderConfig = undefined;
    window.providerConfigResult = undefined;
  });

  it('requests the provider config snapshot on mount', async () => {
    render(<ProviderManageSection addToast={vi.fn()} />);
    await waitFor(() => {
      expect(window.sendToJava).toHaveBeenCalledWith('get_provider_config:');
    });
  });

  it('renders grouped provider cards with key status chips and endpoint', async () => {
    render(<ProviderManageSection addToast={vi.fn()} />);
    pushSnapshot(buildSnapshot());

    expect(screen.getByText('Third-party Providers')).toBeTruthy();
    expect(screen.getByText('DeepSeek API Key')).toBeTruthy();
    expect(screen.getByText('API key configured')).toBeTruthy();
    expect(screen.getByText('https://api.deepseek.com')).toBeTruthy();
    // Group header and card title share this label — both must render.
    expect(screen.getAllByText('Custom Provider').length).toBeGreaterThanOrEqual(2);

    // Custom bucket + standalone models sections.
    expect(screen.getByText('Custom Provider Buckets')).toBeTruthy();
    expect(screen.getByText('mypgw')).toBeTruthy();
    expect(screen.getByText(/Standalone Models/)).toBeTruthy();

    // The redacted snapshot never carries key values — nothing to render but the chip.
    expect(screen.queryByText(/sk-/)).toBeNull();
  });

  it('shows the parse-error banner and locks nothing else up', async () => {
    render(<ProviderManageSection addToast={vi.fn()} />);
    pushSnapshot(buildSnapshot({ parseError: 'Unexpected token } at offset 12' }));

    expect(screen.getByText(/settings\.json cannot be parsed/)).toBeTruthy();
    expect(screen.getByText(/Unexpected token/)).toBeTruthy();
    // Cards still render (reads stay available; writes are locked server-side).
    expect(screen.getByText('DeepSeek API Key')).toBeTruthy();
  });

  it('opens the configure dialog with an EMPTY key input (stored keys never prefilled)', async () => {
    render(<ProviderManageSection addToast={vi.fn()} />);
    pushSnapshot(buildSnapshot());

    const card = screen.getByTestId('provider-card-deepseek');
    fireEvent.click(within(card).getByText('Configure'));

    expect(await screen.findByText('Configure DeepSeek API Key')).toBeTruthy();
    const passwordInput = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(passwordInput).toBeTruthy();
    expect(passwordInput.value).toBe('');
    expect(passwordInput.getAttribute('placeholder')).toBe('Saved — leave empty to keep');
    // Status is conveyed by chip + hint, never by echoing the value.
    expect(screen.getByText('Saved keys are never echoed back')).toBeTruthy();
  });

  it('sends a deleteProvider op after confirmation and resolves the toast', async () => {
    const addToast = vi.fn();
    render(<ProviderManageSection addToast={addToast} />);
    pushSnapshot(buildSnapshot());

    const card = screen.getByTestId('provider-card-deepseek');
    fireEvent.click(within(card).getByLabelText('Delete'));

    expect(await screen.findByText('Confirm deletion')).toBeTruthy();
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(window.sendToJava).toHaveBeenCalled();
    });
    const call = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    const opCall = call.find((c) => c.startsWith('provider_config_op:'))!;
    expect(opCall).toBeTruthy();
    const payload = JSON.parse(opCall.slice('provider_config_op:'.length));
    expect(payload.op).toBe('deleteProvider');
    expect(payload.mode).toBe('preset');
    expect(payload.presetId).toBe('deepseek');
    expect(payload.requestId).toBeTruthy();

    act(() => {
      window.providerConfigResult?.(
        JSON.stringify({
          ok: true,
          op: 'deleteProvider',
          requestId: payload.requestId,
          snapshot: buildSnapshot({
            providers: [
              {
                kind: 'preset',
                id: 'deepseek',
                uiGroup: 'third-party',
                configured: false,
                owned: [],
                endpoint: 'https://api.deepseek.com',
                envKeyName: 'DEEPSEEK_API_KEY',
                keyStatus: 'unset',
                modelCount: 0,
                hasMetadata: false,
                metadataVersion: null,
              },
            ],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('DeepSeek API Key deleted', 'success');
    });
    expect(screen.getByText('Not configured')).toBeTruthy();
  });

  it('surfaces failed ops as error toasts with the backend message', async () => {
    const addToast = vi.fn();
    render(<ProviderManageSection addToast={addToast} />);
    pushSnapshot(buildSnapshot());

    const card = screen.getByTestId('provider-card-deepseek');
    fireEvent.click(within(card).getByLabelText('Delete'));
    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(window.sendToJava).toHaveBeenCalled());
    const call = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    const payload = JSON.parse(
      call.find((c) => c.startsWith('provider_config_op:'))!.slice('provider_config_op:'.length),
    );

    act(() => {
      window.providerConfigResult?.(
        JSON.stringify({
          ok: false,
          code: 'modelPurpose',
          message: 'This install would remove existing conversation models.',
          requestId: payload.requestId,
        }),
      );
    });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'This install would remove existing conversation models.',
        'error',
      );
    });
  });

  it('expands the model list and opens the model editor', async () => {
    render(<ProviderManageSection addToast={vi.fn()} />);
    pushSnapshot(buildSnapshot());

    const card = screen.getByTestId('provider-card-deepseek');
    fireEvent.click(within(card).getByText('Models'));

    expect(await screen.findByText(/deepseek-v4-pro/)).toBeTruthy();
    // Active model chip (selection matches).
    expect(screen.getByText('Active')).toBeTruthy();

    const editBtn = within(card).getByTitle('Edit');
    fireEvent.click(editBtn);

    expect(await screen.findByText('Edit model')).toBeTruthy();
    // The editor exposes the ModelConfig surface.
    expect(screen.getByText('Route & credentials')).toBeTruthy();
    expect(screen.getByText('Purpose flags')).toBeTruthy();
    expect(screen.getByText('Generation config')).toBeTruthy();
  });
});
