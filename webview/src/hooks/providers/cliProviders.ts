import type { PermissionMode } from '../../components/ChatInputBox/types';

/** Headless CLI providers that share marker streaming (no npm SDK). */
export const CLI_ONLY_PROVIDERS = new Set(['qwen', 'dsh']);

export function isCliOnlyProvider(providerId: string | null | undefined): boolean {
  return !!providerId && CLI_ONLY_PROVIDERS.has(providerId);
}

/** Legacy CC GUI mode ids → Qwen Code CLI approval-mode ids. */
const LEGACY_MODE_ALIASES: Record<string, PermissionMode> = {
  acceptEdits: 'auto-edit',
  autoEdit: 'auto-edit',
  bypassPermissions: 'yolo',
};

/**
 * Normalize a mode selection for a headless CLI provider.
 *
 * Qwen (via @qwen-code/sdk) natively supports the full CLI approval-mode set
 * (plan / default / auto-edit / auto / yolo), so modes pass through. DSH
 * exposes neither plan mode nor a provider-native auto reviewer, so those are
 * coerced to default. Legacy pre-QwenMate ids are migrated everywhere.
 */
export function normalizeCliPermissionMode(mode: PermissionMode, provider?: string | null): PermissionMode {
  const migrated = LEGACY_MODE_ALIASES[mode] ?? mode;
  if (provider === 'qwen') {
    return migrated;
  }
  return migrated === 'plan' || migrated === 'auto' ? 'default' : migrated;
}
