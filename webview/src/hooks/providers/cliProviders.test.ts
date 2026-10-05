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
    // Migration is provider-independent (the provider arg is optional).
    expect(normalizeCliPermissionMode('autoEdit')).toBe('auto-edit');
    expect(normalizeCliPermissionMode('bypassPermissions')).toBe('yolo');
  });
});

describe('isCliOnlyProvider', () => {
  it('recognizes qwen as a CLI-only provider', () => {
    expect(isCliOnlyProvider('qwen')).toBe(true);
    expect(isCliOnlyProvider('unknown')).toBe(false);
    expect(isCliOnlyProvider(undefined)).toBe(false);
  });
});
