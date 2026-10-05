import { sendBridgeEvent } from '../utils/bridge';
import { isValidPermissionMode } from '../components/ChatInputBox/types';
import type { PermissionMode } from '../components/ChatInputBox/types';
import { normalizeCliPermissionMode } from './providers/cliProviders';

/**
 * Module-level pure helpers for useModelProviderState. Each function carries
 * one provider-branch decision so the orchestrator hook stays flat.
 */

/** Per-provider selected-model snapshot, keyed by provider id. */
export interface ProviderModelSelection {
  qwen: string;
}

/** Per-provider permission-mode snapshot, keyed by provider id. */
export interface ProviderPermissionModes {
  qwen: PermissionMode;
}

/** Model shown for the active provider; unknown ids fall back to Qwen. */
export function selectedModelForProvider(_providerId: string, models: ProviderModelSelection): string {
  return models.qwen;
}

/**
 * Mode to activate when switching to `providerId`: the provider's saved mode,
 * normalized through the CLI rules.
 */
export function resolveProviderPermissionMode(
  providerId: string,
  modes: ProviderPermissionModes,
): PermissionMode {
  return normalizeCliPermissionMode(modes.qwen, providerId);
}

/**
 * Model to activate when switching to `providerId`.
 */
export function resolveProviderModel(
  _providerId: string,
  models: ProviderModelSelection,
): string {
  return models.qwen;
}

/** State setters consumed by applyCliModeSelect. */
export interface CliModeSelectActions {
  setPermissionMode: (mode: PermissionMode) => void;
  setQwenPermissionMode: (mode: PermissionMode) => void;
}

/**
 * Applies a mode selection for a headless CLI provider: normalizes the mode,
 * mirrors it into the provider slice, and pushes it over the bridge.
 */
export function applyCliModeSelect(
  providerId: string,
  mode: PermissionMode,
  actions: CliModeSelectActions,
): void {
  const cliMode = normalizeCliPermissionMode(mode, providerId);
  actions.setPermissionMode(cliMode);
  actions.setQwenPermissionMode(cliMode);
  if (isValidPermissionMode(cliMode)) {
    sendBridgeEvent('set_mode', cliMode);
  }
}

/** Setters consumed by applyModelSelect. */
export interface ModelSelectActions {
  setSelectedQwenModel: (modelId: string) => void;
}

/**
 * Applies a model selection for the active provider. Every provider stores
 * and forwards the id verbatim; stale ids are corrected by catalog
 * auto-select once the fetch lands (or kept as custom ids).
 */
export function applyModelSelect(
  _providerId: string,
  modelId: string,
  actions: ModelSelectActions,
): void {
  actions.setSelectedQwenModel(modelId);
  sendBridgeEvent('set_model', modelId);
}
