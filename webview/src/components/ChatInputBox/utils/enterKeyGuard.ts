import type { MutableRefObject } from 'react';
import type { SendShortcut } from '../types.js';

/**
 * How long after compositionend a plain Enter may still be the IME's own
 * confirmation key rather than a request to send.
 */
export const COMPOSITION_END_GUARD_MS = 100;

/**
 * Per-press Enter bookkeeping. JCEF may deliver one physical press to the
 * native capture listeners, to React's delegated handlers, or to both, so both
 * layers share these refs and judge each press exactly once.
 */
export interface EnterKeyRefs {
  /** The current press is spoken for (sent or swallowed); repeats and beforeinput stay quiet. */
  submittedOnEnterRef: MutableRefObject<boolean>;
  /** The current press picked a completion item instead of sending. */
  completionSelectedRef: MutableRefObject<boolean>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndTimeRef: MutableRefObject<number>;
}

interface EnterKeyModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** The slice of a keyboard event the guard needs; native and React events both satisfy it. */
export interface EnterKeyEvent extends EnterKeyModifiers {
  repeat: boolean;
  preventDefault: () => void;
}

export type EnterKeyDownVerdict = 'swallowed' | 'awaitingIme' | 'open';

export function isEnterKey(key: string, keyCode: number | undefined): boolean {
  return key === 'Enter' || keyCode === 13;
}

export function isSendKey(sendShortcut: SendShortcut, e: EnterKeyModifiers): boolean {
  return sendShortcut === 'cmdEnter' ? e.metaKey || e.ctrlKey : !e.shiftKey;
}

export function isImeStillComposing(
  refs: Pick<EnterKeyRefs, 'isComposingRef' | 'lastCompositionEndTimeRef'>,
  eventIsComposing: boolean,
): boolean {
  // JCEF may leave the browser's isComposing bit set after a commit, so once a
  // compositionend has been seen only our own composition events are trusted.
  // Before the first compositionend no stale bit is possible, so the browser's
  // bit still covers a dropped compositionstart.
  return refs.isComposingRef.current ||
    (eventIsComposing && refs.lastCompositionEndTimeRef.current === 0);
}

/**
 * Live composition owns Enter under both shortcuts. Right after compositionend
 * only an actual Cmd/Ctrl+Enter is trusted: a plain Enter may still be the IME
 * confirming its candidate, whatever shortcut the user configured.
 */
export function isImeStillHoldingEnter(
  sendShortcut: SendShortcut,
  refs: Pick<EnterKeyRefs, 'isComposingRef' | 'lastCompositionEndTimeRef'>,
  eventIsComposing: boolean,
  hasSendModifier: boolean,
  now = Date.now(),
): boolean {
  if (isImeStillComposing(refs, eventIsComposing)) return true;
  if (sendShortcut === 'cmdEnter' && hasSendModifier) return false;
  return now - refs.lastCompositionEndTimeRef.current < COMPOSITION_END_GUARD_MS;
}

function isExplicitNewlineKey(sendShortcut: SendShortcut, e: EnterKeyModifiers): boolean {
  if (!e.shiftKey) return false;
  // Shift+Enter is the explicit newline gesture in Enter mode. In Cmd/Ctrl+Enter
  // mode it remains a newline unless the send modifier is held as well.
  return sendShortcut === 'enter' || !(e.metaKey || e.ctrlKey);
}

/**
 * Bookkeeping every Enter keydown runs before anyone acts on it.
 *
 * A fresh press forgets the previous one, so a keyup that never arrived cannot
 * wedge the input. Holding the key repeats keydown: a held send key or a held
 * completion confirmation is swallowed so it cannot turn into a send once the
 * IME commits or the menu closes, while a held newline key keeps repeating.
 */
export function triageEnterKeyDown(
  e: EnterKeyEvent,
  eventIsComposing: boolean,
  sendShortcut: SendShortcut,
  refs: EnterKeyRefs,
): EnterKeyDownVerdict {
  if (!e.repeat) {
    refs.submittedOnEnterRef.current = false;
    refs.completionSelectedRef.current = false;
  } else if (
    isSendKey(sendShortcut, e) ||
    refs.completionSelectedRef.current ||
    refs.submittedOnEnterRef.current
  ) {
    claimEnterPress(e, refs);
    return 'swallowed';
  }

  // An explicit Shift+Enter newline is never an IME confirmation. In Cmd/Ctrl
  // mode, Cmd/Ctrl+Shift+Enter is still a send key and remains guarded.
  if (
    !isExplicitNewlineKey(sendShortcut, e) &&
    isImeStillHoldingEnter(sendShortcut, refs, eventIsComposing, e.metaKey || e.ctrlKey)
  ) {
    // Let the IME confirm, but keep the held key from becoming a new action after commit.
    refs.submittedOnEnterRef.current = true;
    return 'awaitingIme';
  }
  return 'open';
}

/**
 * Speak for the current press: cancel the browser default and silence repeats
 * and beforeinput. The React handler skips a `defaultPrevented` keydown, so one
 * claim is enough for both layers and the event keeps propagating normally.
 */
export function claimEnterPress(
  e: { preventDefault: () => void },
  refs: Pick<EnterKeyRefs, 'submittedOnEnterRef'>,
): void {
  e.preventDefault();
  refs.submittedOnEnterRef.current = true;
}

/** Forget the current press; keyup and blur both end it. */
export function releaseEnterPress(
  refs: Pick<EnterKeyRefs, 'submittedOnEnterRef' | 'completionSelectedRef'>,
): void {
  refs.submittedOnEnterRef.current = false;
  refs.completionSelectedRef.current = false;
}

/**
 * Every Enter keyup ends the press, even when the modifier was released first;
 * otherwise a Cmd/Ctrl+Enter would leave the press claimed and block later input.
 */
export function releaseEnterKeyUp(
  e: EnterKeyModifiers & { preventDefault: () => void },
  sendShortcut: SendShortcut,
  refs: Pick<EnterKeyRefs, 'submittedOnEnterRef' | 'completionSelectedRef'>,
): void {
  if (isSendKey(sendShortcut, e)) e.preventDefault();
  releaseEnterPress(refs);
}

/**
 * Judge an `insertParagraph` that reached beforeinput. In Enter-to-send mode a
 * plain Enter never inserts a paragraph: it sends, unless keydown already spoke
 * for this press, the IME still owns it, or it was spent on a completion menu.
 * JCEF sometimes delivers beforeinput with no keydown at all, so a send from
 * here is deliberately not recorded as a claim: nothing would ever release it.
 */
export function catchStrayEnter(
  ev: { inputType: string; isComposing: boolean; preventDefault: () => void },
  sendShortcut: SendShortcut,
  refs: EnterKeyRefs,
  anyCompletionOpen: boolean,
  onSubmit: () => void,
): void {
  if (ev.inputType === 'insertLineBreak') {
    // Shift does not give a consumed Enter another action: JCEF can still emit
    // this event after a completion selection or a Cmd/Ctrl+Shift+Enter send.
    if (refs.submittedOnEnterRef.current || refs.completionSelectedRef.current) {
      ev.preventDefault();
    }
    return;
  }
  if (ev.inputType !== 'insertParagraph') return;

  // A composition confirmation can arrive as beforeinput after keydown. Keep
  // it out of the editable DOM even in CmdEnter mode, where ordinary plain
  // Enter is intentionally allowed to insert a newline.
  if (isImeStillHoldingEnter(sendShortcut, refs, ev.isComposing, false)) {
    ev.preventDefault();
    return;
  }

  if (sendShortcut === 'cmdEnter') {
    // CmdEnter keeps ordinary paragraphs, but a paragraph generated by a
    // completion-owned or already-submitted Enter must not leak through after
    // the keyboard handler has consumed the press.
    if (
      refs.submittedOnEnterRef.current ||
      refs.completionSelectedRef.current ||
      anyCompletionOpen
    ) {
      ev.preventDefault();
    }
    return;
  }

  ev.preventDefault();
  if (refs.submittedOnEnterRef.current) return;
  if (refs.completionSelectedRef.current || anyCompletionOpen) return;
  onSubmit();
}
