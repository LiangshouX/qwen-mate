import { describe, expect, it } from 'vitest';
import { isCliOnlyProvider, normalizeCliPermissionMode } from './cliProviders';

describe('normalizeCliPermissionMode', () => {
  it('preserves the full CLI approval-mode set for the qwen provider', () => {
    expect(normalizeCliPermissionMode('plan', 'qwen')).toBe('plan');
    expect(normalizeCliPermissionMode('default', 'qwen')).toBe('default');
    expect(normalizeCliPermissionMode('auto-edit', 'qwen')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('auto', 'qwen')).toBe('auto');
    expect(normalizeCliPermissionMode('yolo', 'qwen')).toBe('yolo');
  });

  it('migrates legacy CC GUI ids to the CLI approval-mode ids', () => {
    expect(normalizeCliPermissionMode('acceptEdits', 'qwen')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('autoEdit', 'qwen')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('bypassPermissions', 'qwen')).toBe('yolo');
    expect(normalizeCliPermissionMode('autoEdit', 'dsh')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('bypassPermissions', 'dsh')).toBe('yolo');
  });

  it('keeps coercing unsupported plan/auto modes to default for the dsh provider', () => {
    expect(normalizeCliPermissionMode('plan', 'dsh')).toBe('default');
    expect(normalizeCliPermissionMode('auto', 'dsh')).toBe('default');
    expect(normalizeCliPermissionMode('auto-edit', 'dsh')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('default', 'dsh')).toBe('default');
  });

  it('coerces unsupported plan/auto modes to default when no provider is given (legacy callers)', () => {
    expect(normalizeCliPermissionMode('plan')).toBe('default');
    expect(normalizeCliPermissionMode('auto')).toBe('default');
    expect(normalizeCliPermissionMode('default')).toBe('default');
    expect(normalizeCliPermissionMode('yolo')).toBe('yolo');
  });
});

describe('isCliOnlyProvider', () => {
  it('recognizes qwen and dsh as CLI-only providers', () => {
    expect(isCliOnlyProvider('qwen')).toBe(true);
    expect(isCliOnlyProvider('dsh')).toBe(true);
    expect(isCliOnlyProvider('unknown')).toBe(false);
    expect(isCliOnlyProvider(undefined)).toBe(false);
  });
});
