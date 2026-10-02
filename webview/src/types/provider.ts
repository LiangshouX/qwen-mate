/**
 * Provider configuration type definitions (lightweight Qwen + DSH edition)
 */

// ============ Constants ============

/**
 * localStorage keys for provider-related data
 */
export const STORAGE_KEYS = {
  /** Custom Qwen model list */
  QWEN_CUSTOM_MODELS: 'qwen-custom-models',
} as const;

/**
 * Model ID validation regular expression
 * Allowed: letters, numbers, hyphens, underscores, dots, slashes, colons
 * Used to validate user-input model ID format
 */
export const MODEL_ID_PATTERN = /^[a-zA-Z0-9._\-/:]+$/;

// ============ Validation Helpers ============

/**
 * Validate whether a model ID format is valid.
 *
 * NOTE: Model ID format is intentionally NOT restricted by regex.
 * Providers use diverse model ID formats that cannot be predicted (e.g.,
 * slashes, brackets, CJK characters). Only basic sanity checks (non-empty,
 * length limit) are applied.
 * Do NOT re-add MODEL_ID_PATTERN validation here.
 *
 * @param id - Model ID
 * @returns Whether the ID is valid
 */
export function isValidModelId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return false;
  return true;
}

/**
 * Validate whether a CustomModel object is valid
 * @param model - Object to validate
 * @returns Whether it is a valid CustomModel
 */
export function isValidCustomModel(model: unknown): model is CustomModel {
  if (!model || typeof model !== 'object') return false;
  const obj = model as Record<string, unknown>;

  // id must be a valid model ID
  if (typeof obj.id !== 'string' || !isValidModelId(obj.id)) return false;

  // label must be a string
  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return false;

  // description is optional, but must be a string if present
  if (obj.description !== undefined && typeof obj.description !== 'string') return false;

  // contextWindowTokens is optional, but must fit the Java int-based usage pipeline
  if (obj.contextWindowTokens !== undefined) {
    if (
      typeof obj.contextWindowTokens !== 'number'
      || !Number.isSafeInteger(obj.contextWindowTokens)
      || obj.contextWindowTokens < 1_000
      || obj.contextWindowTokens % 1_000 !== 0
      || obj.contextWindowTokens > 2_147_483_647
    ) return false;
  }

  // pricing is optional; when present every provided field must be a non-negative number
  if (obj.pricing !== undefined) {
    if (!isValidModelPricing(obj.pricing)) return false;
  }

  return true;
}

/**
 * Validate whether a ModelPricing object is valid.
 * Every field is optional, but if present must be a finite number >= 0.
 */
export function isValidModelPricing(pricing: unknown): boolean {
  if (!pricing || typeof pricing !== 'object') return false;
  const p = pricing as Record<string, unknown>;
  const fields: (keyof ModelPricing)[] = [
    'inputCostPer1M',
    'outputCostPer1M',
    'cacheWriteCostPer1M',
    'cacheReadCostPer1M',
  ];
  for (const f of fields) {
    const v = p[f];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/**
 * Validate and filter a CustomModel array
 * @param models - Array to validate
 * @returns Array of valid CustomModel entries
 */
export function validateCustomModels(models: unknown): CustomModel[] {
  if (!Array.isArray(models)) return [];
  return models.filter(isValidCustomModel);
}

// ============ Types ============

/**
 * Per-million-token pricing for a custom model.
 *
 * All fields are optional: a missing field means "fall back to the default
 * pricing for that token kind" in the backend cost calculation. Units are
 * USD per 1,000,000 tokens, consistent with the backend `*CostPer1M` fields.
 */
export interface ModelPricing {
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  cacheWriteCostPer1M?: number;
  cacheReadCostPer1M?: number;
}

/**
 * Custom model configuration
 */
export interface CustomModel {
  /** Model ID (unique identifier) */
  id: string;
  /** Model display name */
  label: string;
  /** Model description */
  description?: string;
  /** Optional context window size in tokens for plugin usage display */
  contextWindowTokens?: number;
  /** Optional per-million-token pricing for cost calculation */
  pricing?: ModelPricing;
}

// ============ Qwen auth configuration ============

