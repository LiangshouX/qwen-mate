import type { PermissionMode } from '../../components/ChatInputBox/types';

/** Headless CLI providers that share marker streaming (no npm SDK). */
export const CLI_ONLY_PROVIDERS = new Set(['qwen']);

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
 * (plan / default / auto-edit / auto / yolo), so modes pass through. Legacy
 * pre-QwenMate ids are migrated to the current ids.
 */
export function normalizeCliPermissionMode(mode: PermissionMode, _provider?: string | null): PermissionMode {
  return LEGACY_MODE_ALIASES[mode] ?? mode;
}
