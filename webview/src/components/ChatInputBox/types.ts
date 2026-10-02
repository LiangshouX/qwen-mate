/**
 * Input box component type definitions
 * Feature: 004-refactor-input-box
 */

// ============================================================
// Core Entity Types
// ============================================================

/**
 * File tag information for backend context injection (Codex mode)
 */
export interface FileTagInfo {
  /** Display path (as shown in tag) */
  displayPath: string;
  /** Absolute path (for file reading) */
  absolutePath: string;
}

/**
 * File attachment
 */
export interface Attachment {
  /** Unique identifier */
  id: string;
  /** Original filename */
  fileName: string;
  /** MIME type */
  mediaType: string;
  /** Base64 encoded content */
  data: string;
}

/**
 * Code snippet (from editor selection)
 */
export interface CodeSnippet {
  /** Unique identifier */
  id: string;
  /** File path (relative) */
  filePath: string;
  /** Start line number */
  startLine?: number;
  /** End line number */
  endLine?: number;
}

/**
 * Image media type constants
 */
export const IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * Check if attachment is an image
 */
export function isImageAttachment(attachment: Attachment): boolean {
  return IMAGE_MEDIA_TYPES.includes(attachment.mediaType as ImageMediaType);
}

// ============================================================
// Completion System Types
// ============================================================

/**
 * Completion item type
 */
export type CompletionType =
  | 'file'
  | 'directory'
  | 'command'
  | 'agent'
  | 'prompt'
  | 'terminal'
  | 'service'
  | 'info'
  | 'separator'
  | 'section-header';

/**
 * Dropdown menu item data
 */
export interface DropdownItemData {
  /** Unique identifier */
  id: string;
  /** Display text */
  label: string;
  /** Description text */
  description?: string;
  /** Icon class name */
  icon?: string;
  /** Item type */
  type: CompletionType;
  /** Semantic command content type, used by the Codex picker */
  contentType?: 'command' | 'skill';
  /** Whether selected (for selectors) */
  checked?: boolean;
  /** Associated data */
  data?: Record<string, unknown>;
}

/**
 * File item (returned from Java)
 */
export interface FileItem {
  /** Filename */
  name: string;
  /** Relative path */
  path: string;
  /** Absolute path (optional) */
  absolutePath?: string;
  /** Type */
  type: 'file' | 'directory' | 'terminal' | 'service';
  /** Extension */
  extension?: string;
}

/**
 * Command item (returned from Java)
 */
export interface CommandItem {
  /** Command identifier */
  id: string;
  /** Display name */
  label: string;
  /** Description */
  description?: string;
  /** Category */
  category?: string;
  /** Semantic content type used to choose the invocation prefix */
  contentType?: 'command' | 'skill';
}

/**
 * Dropdown menu position
 */
export interface DropdownPosition {
  /** Top coordinate (px) */
  top: number;
  /** Left coordinate (px) */
  left: number;
  /** Width (px) */
  width: number;
  /** Height (px) */
  height: number;
}

/**
 * Trigger query information
 */
export interface TriggerQuery {
  /** Trigger symbol ('@', '/', '#', '!' or '$') */
  trigger: string;
  /** Search keyword */
  query: string;
  /** Character offset position of trigger symbol */
  start: number;
  /** Character offset position of query end */
  end: number;
}

/**
 * Selected agent information
 */
export interface SelectedAgent {
  id: string;
  name: string;
  prompt?: string;
}

// ============================================================
// Mode and Model Types
// ============================================================

/**
 * Permission mode for conversations.
 *
 * The union literals are the static modes known to the Java backend
 * (SessionState.VALID_PERMISSION_MODES). The `(string & {})` tail keeps
 * literal autocomplete while allowing dynamic model-role ids discovered at
 * runtime — those are NEVER sent as `set_mode` (use isValidPermissionMode to
 * gate that); the role travels via `set_model` instead.
 */
export type PermissionMode =
  | 'plan'
  | 'default'
  | 'auto-edit'
  | 'auto'
  | 'yolo'
  | (string & {});

/**
 * Mode information
 */
export interface ModeInfo {
  id: PermissionMode;
  label: string;
  icon: string;
  disabled?: boolean;
  tooltip?: string;
  description?: string;
}

/**
 * Available permission modes — mirrors the Qwen Code CLI approval modes
 * (plan / default / auto-edit / auto / yolo), same order as the CLI's
 * Shift+Tab cycle.
 */
export const AVAILABLE_MODES: ModeInfo[] = [
  {
    id: 'plan',
    label: 'Plan',
    icon: 'codicon-tasklist',
    tooltip: 'Plan mode - read-only analysis',
    description: 'Read-only analysis only; no file edits or shell commands',
  },
  {
    id: 'default',
    label: 'Ask Permission',
    icon: 'codicon-comment-discussion',
    tooltip: 'Ask Permission - confirm every change',
    description: 'Requires manual approval before file edits and shell commands',
  },
  {
    id: 'auto-edit',
    label: 'Auto-Edit',
    icon: 'codicon-robot',
    tooltip: 'Auto-Edit - file edits auto-approved',
    description: 'Auto-approves file edits (edit / write_file / notebook_edit); shell commands still ask',
  },
  {
    id: 'auto',
    label: 'Auto',
    icon: 'codicon-shield',
    tooltip: 'Auto - classifier-reviewed approvals',
    description: 'A classifier reviews each shell command and edit, approving safe operations automatically',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    icon: 'codicon-zap',
    tooltip: 'YOLO - approve everything',
    description: 'Automatically approves all tool calls, including file edits and shell commands [use with caution]',
  },
];

/**
 * Set of valid permission mode IDs, derived from AVAILABLE_MODES.
 * Use isValidPermissionMode() for validation instead of inline checks.
 */
export const VALID_PERMISSION_MODE_IDS: ReadonlySet<string> = new Set(
  AVAILABLE_MODES.map((m) => m.id)
);

/**
 * Check whether a string is a recognized PermissionMode.
 */
export function isValidPermissionMode(mode: string | undefined | null): mode is PermissionMode {
  return typeof mode === 'string' && VALID_PERMISSION_MODE_IDS.has(mode);
}

/**
 * Where a model entry came from. Used by the model dropdown to group entries
 * so the CLI config and the user's custom models stay primary.
 */
export type ModelSource = 'cli-config' | 'custom';

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
  /** Catalog origin for dropdown grouping; absent for runtime/host catalogs. */
  source?: ModelSource;
  /** Declared context window (tokens), e.g. from CLI modelProviders config. */
  contextWindowTokens?: number;
}

/**
 * Empty id = "Default (follow CLI config)": never override the model the user
 * configured in `~/.qwen/settings.json`. This is both the fallback when nothing
 * valid is saved and the id of the first model-selector entry — the empty id
 * travels over the bridge verbatim (ai-bridge omits an empty model so the CLI
 * configuration decides). Never derive a concrete model id here.
 */
export const DEFAULT_QWEN_MODEL_ID = '';

/**
 * Retired model IDs -> their current-generation replacement. Without an entry
 * here a saved retired model is kept verbatim (custom ids are accepted as-is);
 * an empty/invalid value falls back to DEFAULT_QWEN_MODEL_ID (follow CLI).
 */
const LEGACY_QWEN_MODEL_ID_ALIASES: Record<string, string> = {
  'qwen3-coder': 'qwen3-coder-plus',
  'qwen-coder-plus': 'qwen3-coder-plus',
  'qwen3-max-preview': 'qwen-max',
};

/**
 * Map a saved/legacy Qwen model id to its canonical form. The empty id is the
 * explicit "follow CLI config" selection and passes through unchanged; only
 * `null`/`undefined` (nothing saved at all) normalize to DEFAULT_QWEN_MODEL_ID.
 */
export function normalizeQwenModelId(modelId: string | undefined | null): string {
  if (modelId == null) {
    return DEFAULT_QWEN_MODEL_ID;
  }
  return LEGACY_QWEN_MODEL_ID_ALIASES[modelId] ?? modelId;
}

/**
 * Qwen model list (Qwen DashScope / Bailian catalog) — a convenience shortcut
 * only. Qwen's model configuration is free-form: the model picker shows, in
 * order, the "follow CLI config" entry (empty id), the models configured in
 * `~/.qwen/settings.json`, the custom models configured in Settings, and only
 * then these built-ins (see resolveProviderModels).
 */
export const QWEN_MODELS: ModelInfo[] = [
  {
    id: 'qwen3-coder-plus',
    label: 'Qwen3-Coder-Plus',
    description: 'Qwen3-Coder-Plus · Coding flagship · Use the default model',
  },
  {
    id: 'qwen3-coder-flash',
    label: 'Qwen3-Coder-Flash',
    description: 'Qwen3-Coder-Flash · Fast coding model for quick answers',
  },
  {
    id: 'qwen-max',
    label: 'Qwen-Max',
    description: 'Qwen-Max · Strongest general capability',
  },
  {
    id: 'qwen-plus',
    label: 'Qwen-Plus',
    description: 'Qwen-Plus · Balanced intelligence and cost',
  },
  {
    id: 'qwen-turbo',
    label: 'Qwen-Turbo',
    description: 'Qwen-Turbo · Optimized for cost-sensitive workloads',
  },
];

/**
 * DSH default: skip `session.selectModel` so the host serves whatever the DSH
 * Web UI configured. The runtime catalog (`provider/model` ids) is fetched
 * from the host via `llm.models` — this static entry is the offline fallback.
 */
export const DSH_DEFAULT_MODEL_ID = 'auto';

export const DSH_MODELS: ModelInfo[] = [
  {
    id: DSH_DEFAULT_MODEL_ID,
    label: 'DSH Auto',
    description: 'Use the model configured in the DSH Web UI',
  },
];

/** No DSH agent preset: use the default headless composition. */
export const DSH_PRESET_NONE = '';

export interface DshPresetOption {
  id: string;
  label?: string;
  labelKey?: string;
  descriptionKey?: string;
}

export const DSH_PRESETS: DshPresetOption[] = [
  { id: DSH_PRESET_NONE, labelKey: 'dshPresets.none.label', descriptionKey: 'dshPresets.none.description' },
  { id: 'standard', labelKey: 'dshPresets.standard.label', descriptionKey: 'dshPresets.standard.description' },
  { id: 'code', labelKey: 'dshPresets.code.label', descriptionKey: 'dshPresets.code.description' },
  { id: 'minimal', labelKey: 'dshPresets.minimal.label', descriptionKey: 'dshPresets.minimal.description' },
  { id: 'cordis', labelKey: 'dshPresets.cordis.label', descriptionKey: 'dshPresets.cordis.description' },
];

export const getUserDshPresetOptions = (): DshPresetOption[] => {
  const injected = window.__INITIAL_DSH_PRESETS__;
  if (!Array.isArray(injected)) return [];
  const curated = new Set(DSH_PRESETS.map((preset) => preset.id));
  return injected
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '' && !curated.has(id))
    .map((id) => ({ id, label: id, descriptionKey: 'dshPresets.user.description' }));
};

export type DshPreset = string;

export const isValidDshPreset = (value: unknown): value is DshPreset =>
  typeof value === 'string'
  && (DSH_PRESETS.some((preset) => preset.id === value)
    || getUserDshPresetOptions().some((preset) => preset.id === value));

/**
 * Available models (backward compatibility)
 */
export const AVAILABLE_MODELS = QWEN_MODELS;

/**
 * AI provider information
 */
export interface ProviderInfo {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  /** When true, show a Beta badge and first-click notice dialog. */
  beta?: boolean;
}

/**
 * Available AI providers
 */
export const AVAILABLE_PROVIDERS: ProviderInfo[] = [
  { id: 'qwen', label: 'Qwen Code', icon: 'codicon-terminal', enabled: true },
  { id: 'dsh', label: 'DeepSeek Harness', icon: 'codicon-terminal', enabled: true, beta: true },
];

/**
 * Reasoning Effort (thinking depth)
 * Controls the depth of reasoning for AI models
 * API values: low, medium, high, xhigh, max
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Which key combination sends the message: plain Enter, or Cmd/Ctrl+Enter. */
export type SendShortcut = 'enter' | 'cmdEnter';

/**
 * Reasoning level information
 */
export interface ReasoningInfo {
  id: ReasoningEffort;
  label: string;
  icon: string;
  description?: string;
}

/**
 * Available reasoning levels
 */
export const REASONING_LEVELS: ReasoningInfo[] = [
  {
    id: 'low',
    label: 'Low',
    icon: 'codicon-circle-small',
    description: 'Quick responses with basic reasoning',
  },
  {
    id: 'medium',
    label: 'Medium',
    icon: 'codicon-circle-filled',
    description: 'Balanced thinking with moderate token savings',
  },
  {
    id: 'high',
    label: 'High',
    icon: 'codicon-circle-large-filled',
    description: 'Deep reasoning for complex tasks (default)',
  },
  {
    id: 'xhigh',
    label: 'XHigh',
    icon: 'codicon-flame',
    description: 'Extra deep reasoning for demanding tasks',
  },
  {
    id: 'max',
    label: 'Max',
    icon: 'codicon-rocket',
    description: 'Maximum reasoning depth',
  },
];

// ============================================================
// Usage Types
// ============================================================

/**
 * Usage information
 */
export interface UsageInfo {
  /** Usage percentage (0-100) */
  percentage: number;
  /** Used amount */
  used?: number;
  /** Total amount */
  total?: number;
}

// ============================================================
// Component Ref Handle Types
// ============================================================

/**
 * ChatInputBox imperative API
 * Used for performance optimization - uncontrolled mode with imperative access
 */
export interface ChatInputBoxHandle {
  /** Get current input text content */
  getValue: () => string;
  /** Set input text content */
  setValue: (value: string) => void;
  /** Focus the input element */
  focus: () => void;
  /** Clear input content */
  clear: () => void;
  /** Check if input has content */
  hasContent: () => boolean;
  /** Get file tags from input (for Codex context injection) */
  getFileTags: () => FileTagInfo[];
}

// ============================================================
// Component Props Types
// ============================================================

/**
 * ChatInputBox component props
 */
export interface ChatInputBoxProps {
  /** Whether loading */
  isLoading?: boolean;
  /** Current model */
  selectedModel?: string;
  /** Current permission mode */
  permissionMode?: PermissionMode;
  /** Current provider */
  currentProvider?: string;
  /** Usage percentage */
  usagePercentage?: number;
  /** Used context tokens */
  usageUsedTokens?: number;
  /** Maximum context tokens */
  usageMaxTokens?: number;
  /** Whether to show usage */
  showUsage?: boolean;
  /** Whether always thinking is enabled */
  alwaysThinkingEnabled?: boolean;
  /** Attachment list */
  attachments?: Attachment[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether disabled */
  disabled?: boolean;
  /** Controlled mode: input content */
  value?: string;

  /** Current active file */
  activeFile?: string;
  /** Selected lines info (e.g., "L10-20") */
  selectedLines?: string;

  /** Clear context callback */
  onClearContext?: () => void;
  /** Remove code snippet callback */
  onRemoveCodeSnippet?: (id: string) => void;

  // Event callbacks
  /** Submit message */
  onSubmit?: (content: string, attachments?: Attachment[]) => void;
  /** Stop generation */
  onStop?: () => void;
  /** Input change */
  onInput?: (content: string) => void;
  /** Add attachment */
  onAddAttachment?: (files: FileList) => void;
  /** Remove attachment */
  onRemoveAttachment?: (id: string) => void;
  /** Switch mode */
  onModeSelect?: (mode: PermissionMode) => void;
  /** Switch model */
  onModelSelect?: (modelId: string) => void;
  /** Switch provider */
  onProviderSelect?: (providerId: string) => void;
  /** Current reasoning effort */
  reasoningEffort?: ReasoningEffort;
  /** Switch reasoning effort callback */
  onReasoningChange?: (effort: ReasoningEffort) => void;
  /** DSH agent preset */
  dshPreset?: string;
  /** Switch DSH agent preset callback */
  onDshPresetChange?: (preset: string) => void;
  /** Toggle thinking mode */
  onToggleThinking?: (enabled: boolean) => void;
  /** Whether streaming is enabled */
  streamingEnabled?: boolean;
  /** Toggle streaming */
  onStreamingEnabledChange?: (enabled: boolean) => void;

  /** Send shortcut setting: 'enter' = Enter sends | 'cmdEnter' = Cmd/Ctrl+Enter sends */
  sendShortcut?: SendShortcut;

  /** Currently selected agent */
  selectedAgent?: SelectedAgent | null;
  /** Select agent callback */
  onAgentSelect?: (agent: SelectedAgent | null) => void;
  /** Clear agent callback */
  onClearAgent?: () => void;
  /** Open agent settings callback */
  onOpenAgentSettings?: () => void;
  /** Open prompt settings callback */
  onOpenPromptSettings?: () => void;
  /** Open model settings (navigate to provider management to add models) */
  onOpenModelSettings?: () => void;
  /** Open CLI management settings (Settings → Providers → CLI) */
  onOpenCliSettings?: () => void;

  /** Whether StatusPanel is expanded */
  statusPanelExpanded?: boolean;
  /** Toggle StatusPanel expand/collapse */
  onToggleStatusPanel?: () => void;

  /** SDK installed status (disable input when not installed) */
  sdkInstalled?: boolean;
  /** SDK status loading state */
  sdkStatusLoading?: boolean;
  /** SDK status query failed; chat remains available until the user retries */
  sdkStatusError?: boolean;
  /** Retry SDK status query callback */
  onRetrySdkStatus?: () => void;
  /** Go to install SDK callback */
  onInstallSdk?: () => void;
  /** Show toast message */
  addToast?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;

  /** Message queue items */
  messageQueue?: QueuedMessage[];
  /** Remove message from queue callback */
  onRemoveFromQueue?: (id: string) => void;
  /** Reorder message queue callback (orderedIds[0] executes first) */
  onReorderQueue?: (orderedIds: string[]) => void;

  /** Whether auto open file is enabled */
  autoOpenFileEnabled?: boolean;
  /** Toggle auto open file enabled */
  onAutoOpenFileEnabledChange?: (enabled: boolean) => void;
}

/**
 * ButtonArea component props
 */
export interface ButtonAreaProps {
  /** Whether submit disabled */
  disabled?: boolean;
  /** Whether has input content */
  hasInputContent?: boolean;
  /** Whether in conversation */
  isLoading?: boolean;
  /** Whether enhancing prompt */
  isEnhancing?: boolean;
  /** Current model */
  selectedModel?: string;
  /** Current mode */
  permissionMode?: PermissionMode;
  /** Current provider */
  currentProvider?: string;
  /** Current reasoning effort */
  reasoningEffort?: ReasoningEffort;
  /** DSH agent preset */
  dshPreset?: string;

  // Event callbacks
  onSubmit?: () => void;
  onStop?: () => void;
  onModeSelect?: (mode: PermissionMode) => void;
  onModelSelect?: (modelId: string) => void;
  onProviderSelect?: (providerId: string) => void;
  /** Switch reasoning effort callback */
  onReasoningChange?: (effort: ReasoningEffort) => void;
  /** Switch DSH agent preset callback */
  onDshPresetChange?: (preset: string) => void;
  /** Enhance prompt callback */
  onEnhancePrompt?: () => void;
  /** Whether always thinking enabled */
  alwaysThinkingEnabled?: boolean;
  /** Toggle thinking mode */
  onToggleThinking?: (enabled: boolean) => void;
  /** Whether streaming enabled */
  streamingEnabled?: boolean;
  /** Toggle streaming */
  onStreamingEnabledChange?: (enabled: boolean) => void;
  /** Currently selected agent */
  selectedAgent?: SelectedAgent | null;
  /** Agent selection callback */
  onAgentSelect?: (agent: SelectedAgent) => void;
  /** Clear agent callback */
  onClearAgent?: () => void;
  /** Open agent settings callback */
  onOpenAgentSettings?: () => void;
  /** Navigate to model management to add models */
  onAddModel?: () => void;
  /** Open CLI management settings (Settings → Providers → CLI) */
  onOpenCliSettings?: () => void;
}

/**
 * Dropdown component props
 */
export interface DropdownProps {
  /** Whether visible */
  isVisible: boolean;
  /** Position information */
  position: DropdownPosition | null;
  /** Width */
  width?: number;
  /** Y offset */
  offsetY?: number;
  /** X offset */
  offsetX?: number;
  /** Selected index */
  selectedIndex?: number;
  /** Close callback */
  onClose?: () => void;
  /** Children */
  children: React.ReactNode;
}

/**
 * TokenIndicator component props
 */
export interface TokenIndicatorProps {
  /** Percentage (0-100) */
  percentage: number;
  /** Size */
  size?: number;
  /** Used context tokens */
  usedTokens?: number;
  /** Maximum context tokens */
  maxTokens?: number;
}

/**
 * AttachmentList component props
 */
export interface AttachmentListProps {
  /** Attachment list */
  attachments: Attachment[];
  /** Remove attachment callback */
  onRemove?: (id: string) => void;
  /** Preview image callback */
  onPreview?: (attachment: Attachment) => void;
}

/**
 * DropdownItem component props
 */
export interface DropdownItemProps {
  /** Item data */
  item: DropdownItemData;
  /** Whether highlighted */
  isActive?: boolean;
  /** Click callback */
  onClick?: () => void;
  /** Mouse enter callback */
  onMouseEnter?: () => void;
}

// ============================================================
// Message Queue Types
// ============================================================

/**
 * Queued message item
 * When AI is processing (loading), new messages are queued here
 */
export interface QueuedMessage {
  /** Unique identifier */
  id: string;
  /** Message content */
  content: string;
  /** Attachments (optional) */
  attachments?: Attachment[];
  /** Timestamp when queued */
  queuedAt: number;
}
