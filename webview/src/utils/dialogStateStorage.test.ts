import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDialogDraft, readDialogDraft, writeDialogDraft } from './dialogStateStorage';

interface SampleDraft {
  deadlineMs?: number;
  value?: string;
}

// Spying on Storage.prototype does not survive earlier tests in this file
// (happy-dom's storage methods stop resolving through the prototype), so the
// opaque-origin case is simulated by making every sessionStorage access throw.
// Returns the restore function.
function withoutSessionStorage(): () => void {
  const original = window.sessionStorage;
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('opaque origin');
    },
  });
  return () => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
  };
}

describe('dialogStateStorage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.name = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.name = '';
  });

  it('round-trips a draft through write/read/clear', () => {
    writeDialogDraft('permission', 'ch-1', { deadlineMs: 5_000, value: 'x' });

    expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 5_000)?.value).toBe('x');

    clearDialogDraft('permission', 'ch-1');

    expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 5_000)).toBeNull();
  });

  it('rejects a draft left behind by another deadline generation', () => {
    writeDialogDraft('permission', 'ch-1', { deadlineMs: 5_000, value: 'stale' });

    expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 9_000)).toBeNull();
  });

  it('treats a draft without a deadline as generation zero', () => {
    writeDialogDraft('permission', 'ch-1', { value: 'legacy' });

    expect(readDialogDraft<SampleDraft>('permission', 'ch-1')?.value).toBe('legacy');
    expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 9_000)).toBeNull();
  });

  it('falls back to the window.name store when sessionStorage is unavailable', () => {
    const restore = withoutSessionStorage();
    try {
      writeDialogDraft('permission', 'ch-1', { deadlineMs: 5_000, value: 'fallback' });

      expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 5_000)?.value).toBe('fallback');
      expect(window.name.startsWith('ccgui.dialog-drafts:')).toBe(true);
    } finally {
      restore();
    }
  });

  it('keeps drafts isolated when the request id and deadline are reused', () => {
    writeDialogDraft('permission', 'C', { dialogToken: 'old', deadlineMs: 5_000, value: 'old' });
    writeDialogDraft('permission', 'C', { dialogToken: 'new', deadlineMs: 5_000, value: 'new' });
    clearDialogDraft('permission', 'C', 'old');
    expect(readDialogDraft<SampleDraft>('permission', 'C', 5_000, 'old')).toBeNull();
    expect(readDialogDraft<SampleDraft>('permission', 'C', 5_000, 'new')?.value).toBe('new');
  });

  it('does not replace an unrelated window name while clearing session storage', () => {
    window.name = 'existing-window-name';
    clearDialogDraft('permission', 'C');
    expect(window.name).toBe('existing-window-name');
  });

  it('self-heals a corrupted window.name store on the next write', () => {
    window.name = 'ccgui.dialog-drafts:{broken';
    const restore = withoutSessionStorage();
    try {
      writeDialogDraft('permission', 'ch-1', { deadlineMs: 5_000, value: 'after-corruption' });

      expect(readDialogDraft<SampleDraft>('permission', 'ch-1', 5_000)?.value).toBe('after-corruption');
      expect(readDialogDraft<SampleDraft>('permission', 'ch-2', 5_000)).toBeNull();
    } finally {
      restore();
    }
  });
});
