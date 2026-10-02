import {
  COMPOSITION_END_GUARD_MS,
  catchStrayEnter,
  isImeStillHoldingEnter,
  releaseEnterKeyUp,
  triageEnterKeyDown,
} from './enterKeyGuard.js';
import type { EnterKeyEvent, EnterKeyRefs } from './enterKeyGuard.js';

function makeRefs({
  submitted = false,
  selected = false,
  composing = false,
  lastCompositionEnd = Date.now() - 1000,
}: {
  submitted?: boolean;
  selected?: boolean;
  composing?: boolean;
  lastCompositionEnd?: number;
} = {}): EnterKeyRefs {
  return {
    submittedOnEnterRef: { current: submitted },
    completionSelectedRef: { current: selected },
    isComposingRef: { current: composing },
    lastCompositionEndTimeRef: { current: lastCompositionEnd },
  };
}

function keyEvent(overrides: Partial<EnterKeyEvent> = {}) {
  return {
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function paragraph(inputType = 'insertParagraph', isComposing = false) {
  return { inputType, isComposing, preventDefault: vi.fn() };
}

describe('isImeStillHoldingEnter', () => {
  it('blocks Enter while composition is live under both shortcuts', () => {
    expect(isImeStillHoldingEnter('enter', makeRefs({ composing: true }), false, false)).toBe(true);
    expect(isImeStillHoldingEnter('cmdEnter', makeRefs({ lastCompositionEnd: 0 }), true, true)).toBe(true);
  });

  it('lets only an actual Cmd/Ctrl+Enter bypass the commit guard', () => {
    const justEnded = Date.now();
    const refs = makeRefs({ lastCompositionEnd: justEnded });
    expect(isImeStillHoldingEnter('enter', refs, false, false, justEnded)).toBe(true);
    expect(isImeStillHoldingEnter('cmdEnter', refs, false, false, justEnded)).toBe(true);
    expect(isImeStillHoldingEnter('cmdEnter', refs, false, true, justEnded)).toBe(false);
    expect(
      isImeStillHoldingEnter('enter', refs, false, false, justEnded + COMPOSITION_END_GUARD_MS)
    ).toBe(false);
  });

  it('ignores a stale composing bit after a known composition ended', () => {
    const justEnded = Date.now() - COMPOSITION_END_GUARD_MS - 1;
    const refs = makeRefs({ lastCompositionEnd: justEnded });

    expect(isImeStillHoldingEnter('enter', refs, true, false, Date.now())).toBe(false);
  });
});

describe('triageEnterKeyDown', () => {
  it('lets a fresh press forget a lost keyup', () => {
    const refs = makeRefs({ submitted: true, selected: true });
    const e = keyEvent();

    expect(triageEnterKeyDown(e, false, 'enter', refs)).toBe('open');
    expect(refs.submittedOnEnterRef.current).toBe(false);
    expect(refs.completionSelectedRef.current).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('swallows a held send key and keeps the press spoken for', () => {
    const refs = makeRefs();
    const e = keyEvent({ repeat: true });

    expect(triageEnterKeyDown(e, false, 'enter', refs)).toBe('swallowed');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(refs.submittedOnEnterRef.current).toBe(true);
  });

  it('swallows a held completion confirmation even when it is not a send key', () => {
    const refs = makeRefs({ selected: true });
    const e = keyEvent({ repeat: true });

    expect(triageEnterKeyDown(e, false, 'cmdEnter', refs)).toBe('swallowed');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('lets a held newline key keep repeating', () => {
    const refs = makeRefs();
    const shiftEnter = keyEvent({ repeat: true, shiftKey: true });
    const plainEnterInCmdMode = keyEvent({ repeat: true });

    expect(triageEnterKeyDown(shiftEnter, false, 'enter', refs)).toBe('open');
    expect(triageEnterKeyDown(plainEnterInCmdMode, false, 'cmdEnter', refs)).toBe('open');
    expect(shiftEnter.preventDefault).not.toHaveBeenCalled();
    expect(plainEnterInCmdMode.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves Enter to the IME while composing or right after commit', () => {
    const composing = keyEvent();
    expect(
      triageEnterKeyDown(composing, true, 'enter', makeRefs({ lastCompositionEnd: 0 }))
    ).toBe('awaitingIme');

    const justCommitted = keyEvent();
    const refs = makeRefs({ lastCompositionEnd: Date.now() });
    expect(triageEnterKeyDown(justCommitted, false, 'cmdEnter', refs)).toBe('awaitingIme');
    expect(justCommitted.preventDefault).not.toHaveBeenCalled();
    expect(refs.submittedOnEnterRef.current).toBe(true);
  });

  it.each([
    { sendShortcut: 'enter' as const, metaKey: false, ctrlKey: false },
    { sendShortcut: 'cmdEnter' as const, metaKey: false, ctrlKey: false },
  ])('keeps explicit Shift+Enter available after composition in $sendShortcut mode', ({ sendShortcut, ...modifiers }) => {
    const refs = makeRefs({ composing: true, lastCompositionEnd: Date.now() });
    const event = keyEvent({ shiftKey: true, ...modifiers });

    expect(triageEnterKeyDown(event, true, sendShortcut, refs)).toBe('open');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(refs.submittedOnEnterRef.current).toBe(false);
  });

  it('keeps Cmd/Ctrl+Shift+Enter guarded in CmdEnter mode', () => {
    const refs = makeRefs({ composing: true, lastCompositionEnd: Date.now() });
    const event = keyEvent({ shiftKey: true, ctrlKey: true });

    expect(triageEnterKeyDown(event, true, 'cmdEnter', refs)).toBe('awaitingIme');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});


describe('releaseEnterKeyUp', () => {
  it('ends the press even when the modifier was released first', () => {
    const refs = makeRefs({ submitted: true, selected: true });
    const e = keyEvent();

    releaseEnterKeyUp(e, 'cmdEnter', refs);

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(refs.submittedOnEnterRef.current).toBe(false);
    expect(refs.completionSelectedRef.current).toBe(false);
  });

  it('cancels the keyup of a send key', () => {
    const e = keyEvent();
    releaseEnterKeyUp(e, 'enter', makeRefs({ submitted: true }));
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('catchStrayEnter', () => {
  it('swallows an IME insertParagraph during and right after composition without sending', () => {
    const onSubmit = vi.fn();
    const refs = makeRefs({ composing: true });

    const live = paragraph('insertParagraph', true);
    catchStrayEnter(live, 'enter', refs, false, onSubmit);

    refs.isComposingRef.current = false;
    refs.lastCompositionEndTimeRef.current = Date.now();
    const justCommitted = paragraph();
    catchStrayEnter(justCommitted, 'enter', refs, false, onSubmit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(live.preventDefault).toHaveBeenCalledTimes(1);
    expect(justCommitted.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('swallows an IME paragraph in CmdEnter mode but leaves ordinary newline input alone', () => {
    const onSubmit = vi.fn();
    const refs = makeRefs({ composing: true });
    const composingParagraph = paragraph('insertParagraph', true);

    catchStrayEnter(composingParagraph, 'cmdEnter', refs, false, onSubmit);
    expect(composingParagraph.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    refs.isComposingRef.current = false;
    refs.lastCompositionEndTimeRef.current = Date.now() - 1000;
    const ordinaryParagraph = paragraph();
    catchStrayEnter(ordinaryParagraph, 'cmdEnter', refs, false, onSubmit);
    expect(ordinaryParagraph.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not send when a completion or an earlier keydown owns the press', () => {
    const onSubmit = vi.fn();

    catchStrayEnter(paragraph(), 'enter', makeRefs({ selected: true }), false, onSubmit);
    catchStrayEnter(paragraph(), 'enter', makeRefs(), true, onSubmit);
    catchStrayEnter(paragraph(), 'enter', makeRefs({ submitted: true }), false, onSubmit);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks CmdEnter paragraphs owned by a send or completion', () => {
    const onSubmit = vi.fn();

    const selectedParagraph = paragraph();
    catchStrayEnter(
      selectedParagraph,
      'cmdEnter',
      makeRefs({ selected: true }),
      false,
      onSubmit,
    );
    expect(selectedParagraph.preventDefault).toHaveBeenCalledTimes(1);

    const openCompletionParagraph = paragraph();
    catchStrayEnter(openCompletionParagraph, 'cmdEnter', makeRefs(), true, onSubmit);
    expect(openCompletionParagraph.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['enter', 'cmdEnter'] as const)(
    'blocks line breaks from an already claimed Enter in %s mode',
    (sendShortcut) => {
      const onSubmit = vi.fn();
      const submittedLineBreak = paragraph('insertLineBreak');
      const completionLineBreak = paragraph('insertLineBreak');

      catchStrayEnter(submittedLineBreak, sendShortcut, makeRefs({ submitted: true }), false, onSubmit);
      catchStrayEnter(completionLineBreak, sendShortcut, makeRefs({ selected: true }), false, onSubmit);

      expect(submittedLineBreak.preventDefault).toHaveBeenCalledTimes(1);
      expect(completionLineBreak.preventDefault).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it('ignores line breaks and paragraphs under the Cmd/Ctrl+Enter shortcut', () => {
    const onSubmit = vi.fn();
    const lineBreak = paragraph('insertLineBreak');
    const cmdModeParagraph = paragraph();

    catchStrayEnter(lineBreak, 'enter', makeRefs(), false, onSubmit);
    catchStrayEnter(cmdModeParagraph, 'cmdEnter', makeRefs(), false, onSubmit);

    expect(lineBreak.preventDefault).not.toHaveBeenCalled();
    expect(cmdModeParagraph.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends keydown-less paragraphs one after another without leaving a claim behind', () => {
    const onSubmit = vi.fn();
    const refs = makeRefs();

    catchStrayEnter(paragraph(), 'enter', refs, false, onSubmit);
    catchStrayEnter(paragraph(), 'enter', refs, false, onSubmit);

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(refs.submittedOnEnterRef.current).toBe(false);
  });
});
