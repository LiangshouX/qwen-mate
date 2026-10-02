import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useKeyboardHandler } from './useKeyboardHandler.js';
import type { UseKeyboardHandlerOptions } from './useKeyboardHandler.js';

function keyboardOptions(overrides: Partial<UseKeyboardHandlerOptions> = {}): UseKeyboardHandlerOptions {
  const closed = { isOpen: false, handleKeyDown: vi.fn(() => false) };
  return {
    isComposingRef: { current: false },
    lastCompositionEndTimeRef: { current: Date.now() - 1000 },
    sendShortcut: 'enter',
    fileCompletion: closed,
    commandCompletion: closed,
    agentCompletion: closed,
    promptCompletion: closed,
    dollarCommandCompletion: closed,
    handleMacCursorMovement: vi.fn(() => false),
    handleHistoryKeyDown: vi.fn(() => false),
    completionSelectedRef: { current: false },
    submittedOnEnterRef: { current: false },
    handleSubmit: vi.fn(),
    ...overrides,
  };
}

function reactKeyEvent({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  isComposing = false,
  defaultPrevented = false,
  repeat = false,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  repeat?: boolean;
}) {
  const e = {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    repeat,
    nativeEvent: { isComposing, key, repeat },
    defaultPrevented,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as React.KeyboardEvent<HTMLDivElement>;
}

describe('useKeyboardHandler', () => {
  it('recovers a fresh Enter after the previous keyup was lost', () => {
    const options = keyboardOptions({
      submittedOnEnterRef: { current: true },
      completionSelectedRef: { current: true },
    });
    const { result } = renderHook(() => useKeyboardHandler(options));

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));

    expect(options.handleSubmit).toHaveBeenCalledTimes(1);
    expect(options.completionSelectedRef.current).toBe(false);
  });

  it('does not send a repeated Enter after a completion was selected', () => {
    const options = keyboardOptions({
      fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
    });
    const { result, rerender } = renderHook(() => useKeyboardHandler(options));
    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    options.fileCompletion = { isOpen: false, handleKeyDown: vi.fn(() => false) };
    rerender();

    const repeat = reactKeyEvent({ key: 'Enter', repeat: true });
    result.current.onKeyDown(repeat);
    expect(repeat.preventDefault).toHaveBeenCalled();
    expect(options.handleSubmit).not.toHaveBeenCalled();

    result.current.onKeyUp(reactKeyEvent({ key: 'Enter' }));
    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    expect(options.handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send the repeated IME confirmation Enter after the time guard expires', () => {
    const options = keyboardOptions({ isComposingRef: { current: true } });
    const { result } = renderHook(() => useKeyboardHandler(options));
    result.current.onKeyDown(reactKeyEvent({ key: 'Enter', isComposing: true }));
    options.isComposingRef.current = false;
    options.lastCompositionEndTimeRef.current = Date.now() - 101;

    const repeat = reactKeyEvent({ key: 'Enter', repeat: true });
    result.current.onKeyDown(repeat);
    expect(repeat.preventDefault).toHaveBeenCalled();
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it.each(['enter', 'cmdEnter'] as const)(
    'keeps plain IME confirmation out of completion in %s mode',
    (sendShortcut) => {
      const completionKeyDown = vi.fn(() => true);
      const options = keyboardOptions({
        sendShortcut,
        lastCompositionEndTimeRef: { current: Date.now() },
        fileCompletion: { isOpen: true, handleKeyDown: completionKeyDown },
      });
      const { result } = renderHook(() => useKeyboardHandler(options));

      result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));

      expect(completionKeyDown).not.toHaveBeenCalled();
      expect(options.handleSubmit).not.toHaveBeenCalled();
    },
  );

  it.each([
    { sendShortcut: 'enter' as const, shiftKey: true },
    { sendShortcut: 'cmdEnter' as const, shiftKey: false },
  ])('preserves repeated newline Enter in $sendShortcut mode', ({ sendShortcut, shiftKey }) => {
    const options = keyboardOptions({ sendShortcut });
    const { result } = renderHook(() => useKeyboardHandler(options));
    const event = reactKeyEvent({ key: 'Enter', shiftKey, repeat: true });

    result.current.onKeyDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it.each(['ArrowDown', 'ArrowUp', 'Tab', 'Escape', 'Home'])(
    'leaves %s to the IME instead of navigating or selecting an application completion',
    (key) => {
      const options = keyboardOptions({
        isComposingRef: { current: true },
        fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
      });
      const { result } = renderHook(() => useKeyboardHandler(options));
      const event = reactKeyEvent({ key, isComposing: true });

      result.current.onKeyDown(event);

      expect(options.handleMacCursorMovement).not.toHaveBeenCalled();
      expect(options.fileCompletion.handleKeyDown).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it.each(['enter', 'cmdEnter'] as const)(
    'leaves Shift+Enter to the browser while composing in %s mode',
    (sendShortcut) => {
      const options = keyboardOptions({
        sendShortcut,
        isComposingRef: { current: true },
        fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
      });
      const { result } = renderHook(() => useKeyboardHandler(options));
      const event = reactKeyEvent({ key: 'Enter', shiftKey: true, isComposing: true });

      result.current.onKeyDown(event);

      expect(options.fileCompletion.handleKeyDown).not.toHaveBeenCalled();
      expect(options.handleHistoryKeyDown).not.toHaveBeenCalled();
      expect(options.handleSubmit).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('leaves inline completion and input history alone while composing', () => {
    const applySuggestion = vi.fn(() => true);
    const options = keyboardOptions({
      isComposingRef: { current: true },
      inlineCompletion: { applySuggestion },
    });
    const { result } = renderHook(() => useKeyboardHandler(options));

    result.current.onKeyDown(reactKeyEvent({ key: 'Tab', isComposing: true }));
    result.current.onKeyDown(reactKeyEvent({ key: 'ArrowUp', isComposing: true }));

    expect(applySuggestion).not.toHaveBeenCalled();
    expect(options.handleHistoryKeyDown).not.toHaveBeenCalled();
  });

  it('guards non-Enter keys when only the initial browser composing bit is available', () => {
    const options = keyboardOptions({
      lastCompositionEndTimeRef: { current: 0 },
      fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
    });
    const { result } = renderHook(() => useKeyboardHandler(options));

    result.current.onKeyDown(reactKeyEvent({ key: 'Tab', isComposing: true }));

    expect(options.fileCompletion.handleKeyDown).not.toHaveBeenCalled();
  });

  it('allows completion navigation after composition despite a stale browser composing bit', () => {
    const options = keyboardOptions({
      fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
    });
    const { result } = renderHook(() => useKeyboardHandler(options));
    const event = reactKeyEvent({ key: 'ArrowDown', isComposing: true });

    result.current.onKeyDown(event);

    expect(options.fileCompletion.handleKeyDown).toHaveBeenCalledExactlyOnceWith(event.nativeEvent);
  });

  it('sends on Enter (enter mode) when allowed', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(submittedOnEnterRef.current).toBe(true);
  });

  it('does not send when completion handles Enter', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(completionSelectedRef.current).toBe(true);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('does not send when native capture already handled the keydown', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: true };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter', defaultPrevented: true });
    result.current.onKeyDown(e);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('does not send while composition is active or just ended', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };
    const isComposingRef = { current: true };
    const lastCompositionEndTimeRef = { current: 0 };

    const { result, rerender } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef,
        lastCompositionEndTimeRef,
        sendShortcut: 'enter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter', isComposing: true }));
    expect(handleSubmit).not.toHaveBeenCalled();

    isComposingRef.current = false;
    lastCompositionEndTimeRef.current = Date.now();
    rerender();
    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('sends Cmd+Enter immediately after composition ends', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() },
        sendShortcut: 'cmdEnter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter', metaKey: true }));

    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('releases the submit guard when Cmd+Enter keyup loses its modifier', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: true };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'cmdEnter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyUp(e);

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(submittedOnEnterRef.current).toBe(false);
  });

  it('resets submit refs on key up', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: true };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyUp(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(submittedOnEnterRef.current).toBe(false);
  });
});
