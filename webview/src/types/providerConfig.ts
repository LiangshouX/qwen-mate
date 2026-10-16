/**
 * Types mirroring the settings-writer service snapshot
 * (ai-bridge/services/settings-writer-service.cjs). The snapshot is the
 * single source of truth for the provider management page — it is redacted
 * at the source: API key values never appear in any of these shapes, only
 * per-key status.
 */

export type KeyStatus = 'set' | 'placeholder' | 'process' | 'unset';

export type ProviderStep =
  | 'protocol'
  | 'wireApi'
  | 'baseUrl'
  | 'apiKey'
  | 'models'
  | 'advancedConfig';

export interface CatalogBaseUrlOption {
  id: string;
  label: string;
  url: string;
  documentationUrl?: string;
  apiKeyUrl?: string;
}

/** A model spec from the CLI's preset catalog (model template). */
export interface CatalogModelSpec {
  id: string;
  description?: string;
  contextWindowSize?: number;
  enableThinking?: boolean;
  thinkingMandatory?: boolean;
  modalities?: { image?: boolean; video?: boolean; audio?: boolean; pdf?: boolean };
  capabilities?: unknown;
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  description: string;
  uiGroup: 'alibaba' | 'third-party' | 'custom';
  protocol: string;
  protocolOptions: string[] | null;
  /** string = fixed endpoint; array = selectable options; null = free input. */
  baseUrl: string | CatalogBaseUrlOption[] | null;
  envKey: string | null;
  envKeyGenerated: boolean;
  modelNamePrefix: string | null;
  models: CatalogModelSpec[] | null;
  modelsEditable: boolean;
  supportsModelDiscovery: boolean;
  showAdvancedConfig: boolean;
  apiKeyPlaceholder: string;
  hasKeyValidator: boolean;
  documentationUrl: string | null;
  customHeaders: Record<string, string> | null;
  uiLabels: { flowTitle?: string; baseUrlStepTitle?: string } | null;
  steps: ProviderStep[];
}

export interface GenerationConfig {
  contextWindowSize?: number;
  timeout?: number;
  streamIdleTimeoutMs?: number;
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  retryErrorCodes?: number[];
  enableCacheControl?: boolean;
  schemaCompliance?: string;
  thinkingMandatory?: boolean;
  samplingParams?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    top_k?: number;
  };
  reasoning?: Record<string, unknown>;
  extra_body?: Record<string, unknown>;
  customHeaders?: Record<string, string>;
  modalities?: { image?: boolean; video?: boolean; audio?: boolean; pdf?: boolean };
  [key: string]: unknown;
}

/** A modelProviders entry (hand-written, preset-owned, or GUI-created). */
export interface ModelEntry {
  id: string;
  wireApi?: 'chat-completions' | 'responses';
  name?: string;
  description?: string;
  capabilities?: Record<string, unknown>;
  baseUrl?: string;
  envKey?: string;
  supportsImageGeneration?: boolean;
  imageOnly?: boolean;
  voiceOnly?: boolean;
  realtimeOnly?: boolean;
  visionOnly?: boolean;
  fastOnly?: boolean;
  generationConfig?: GenerationConfig;
}

export interface PresetProviderState {
  kind: 'preset';
  id: string;
  uiGroup: string;
  configured: boolean;
  owned: { bucketId: string; id: string; baseUrl: string }[];
  endpoint: string;
  envKeyName: string | null;
  keyStatus: KeyStatus;
  modelCount: number;
  hasMetadata: boolean;
  metadataVersion: string | null;
}

export interface CustomBucketState {
  kind: 'custom-bucket';
  bucketId: string;
  protocol: string | null;
  mapped: boolean;
  modelCount: number;
  envKeyNames: string[];
  keyStatuses: Record<string, KeyStatus>;
}

export interface ProviderConfigSnapshot {
  settingsPath: string;
  settingsExists: boolean;
  parseError: string | null;
  catalog: ProviderCatalogEntry[];
  buckets: Record<string, ModelEntry[]>;
  providerProtocol: Record<string, string>;
  providers: PresetProviderState[];
  customBuckets: CustomBucketState[];
  /** Builtin-bucket entries no preset claims (hand-written / "unassigned"). */
  unassigned: Record<string, ModelEntry[]>;
  env: Record<string, { status: KeyStatus; source: string | null }>;
  selection: { name: string; baseUrl: string; selectedType: string };
  aux: Record<string, string>;
  providerMetadata: Record<string, { version?: string; baseUrl?: string }>;
  projectOverride: { path: string; exists: boolean; ownsModelProviders: boolean } | null;
}

export interface ProviderConfigResult {
  ok: boolean;
  op?: string;
  snapshot?: ProviderConfigSnapshot;
  code?: string;
  message?: string;
  requestId?: string;
}

export type ProviderConfigOp = Record<string, unknown> & {
  op: string;
  requestId?: string;
};

/** What the configure dialog submits for a preset provider. */
export type SavePresetProviderInput = {
  op: 'saveProvider';
  mode: 'preset';
  presetId: string;
  baseUrl?: string;
  apiKey?: string;
  clearKey?: boolean;
  modelIds: string[];
};

/** What the configure dialog submits for Custom Provider. */
export type SaveCustomProviderInput = {
  op: 'saveProvider';
  mode: 'custom';
  protocol: 'openai' | 'anthropic' | 'gemini';
  wireApi?: 'chat-completions' | 'responses';
  baseUrl: string;
  apiKey?: string;
  clearKey?: boolean;
  modelIds: string[];
  advanced?: {
    enableThinking?: boolean;
    multimodal?: { image?: boolean; video?: boolean; audio?: boolean; pdf?: boolean };
    contextWindowSize?: number;
    maxTokens?: number;
  };
};
