export type DialogDraftKind = 'permission' | 'askUserQuestion' | 'planApproval';

const DIALOG_DRAFT_PREFIX = 'ccgui.dialog-draft.';
const WINDOW_NAME_PREFIX = 'ccgui.dialog-drafts:';

function storageKey(kind: DialogDraftKind, requestId: string, dialogToken?: string): string {
  return `${DIALOG_DRAFT_PREFIX}${kind}.${dialogToken ?? requestId}`;
}

function readWindowNameStore(): Record<string, string> {
  if (!window.name.startsWith(WINDOW_NAME_PREFIX)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(window.name.slice(WINDOW_NAME_PREFIX.length));
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    // A corrupted store must not poison write/clear (both read-modify-write):
    // returning {} lets the next write overwrite window.name and self-heal.
    return {};
  }
}

function writeWindowNameStore(store: Record<string, string>): void {
  window.name = WINDOW_NAME_PREFIX + JSON.stringify(store);
}

/** Isolates drafts for requests sharing an ID so replay cannot restore another request's input. */
export function readDialogDraft<T extends { deadlineMs?: number }>(
  kind: DialogDraftKind,
  requestId: string,
  payloadDeadlineMs?: number,
  dialogToken?: string,
): T | null {
  const key = storageKey(kind, requestId, dialogToken);
  const draft = readDraftPayload<T>(key);
  if (draft === null || (draft.deadlineMs ?? 0) !== (payloadDeadlineMs ?? 0)) {
    return null;
  }
  return draft;
}

function readDraftPayload<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // Fall through to the same-window store when the page has no storage origin.
  }
  try {
    const raw = readWindowNameStore()[key];
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function writeDialogDraft(
  kind: DialogDraftKind,
  requestId: string,
  draft: { dialogToken?: string; [key: string]: unknown },
): void {
  const key = storageKey(kind, requestId, draft.dialogToken);
  const serialized = JSON.stringify(draft);
  try {
    window.sessionStorage.setItem(key, serialized);
    return;
  } catch {
    // The same-window store below covers opaque JCEF pages without a storage origin.
  }
  try {
    writeWindowNameStore({ ...readWindowNameStore(), [key]: serialized });
  } catch {
    // Draft persistence is best-effort.
  }
}

export function clearDialogDraft(kind: DialogDraftKind, requestId: string, dialogToken?: string): void {
  const key = storageKey(kind, requestId, dialogToken);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The same-window store may still be available.
  }
  try {
    const store = readWindowNameStore();
    if (key in store) {
      delete store[key];
      writeWindowNameStore(store);
    }
  } catch {
    // Draft persistence is best-effort.
  }
}
