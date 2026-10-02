import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChatInputBoxHandle } from '../types.js';
import { useChatInputTextPipeline } from './useChatInputTextPipeline.js';
import { useChatInputImperativeHandle } from './useChatInputImperativeHandle.js';

function createEditable() {
  const el = document.createElement('div');
  document.body.appendChild(el);

  if (typeof (el as unknown as { innerText?: unknown }).innerText === 'undefined') {
    Object.defineProperty(el, 'innerText', {
      get() {
        return this.textContent ?? '';
      },
      set(value: string) {
        this.textContent = value;
      },
      configurable: true,
    });
  }

  return el as HTMLDivElement;
}

describe('useChatInputImperativeHandle', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels pending input when setValue replaces the text', () => {
    vi.useFakeTimers();
    const editable = createEditable();
    const editableRef = { current: editable };
    const refObj: { current: ChatInputBoxHandle | null } = { current: null };
    const setHasContent = vi.fn();
    const onInput = vi.fn();
    const { result } = renderHook(() => {
      const pipeline = useChatInputTextPipeline({
        editableRef,
        setHasContent,
        onInput,
        currentProvider: 'qwen',
      });
      useChatInputImperativeHandle({
        ref: refObj,
        editableRef,
        getTextContent: pipeline.getTextContent,
        invalidateCache: pipeline.invalidateCache,
        cancelPendingInput: pipeline.cancelPendingInput,
        setHasContent,
        adjustHeight: pipeline.adjustHeight,
        focusInput: vi.fn(),
        clearInput: pipeline.clearInput,
        hasContent: false,
        extractFileTags: pipeline.extractFileTags,
      });
      return pipeline;
    });

    act(() => {
      editable.innerText = 'old draft';
      result.current.handleInput();
      refObj.current!.setValue('replacement');
      result.current.flushPendingInput();
    });
    expect(editable.innerText).toBe('replacement');
    expect(onInput).not.toHaveBeenCalled();

    act(() => {
      editable.innerText = 'replacement!';
      result.current.handleInput();
      result.current.flushPendingInput();
    });
    expect(onInput).toHaveBeenCalledExactlyOnceWith('replacement!');
  });

  it('exposes getValue/setValue/hasContent', () => {
    const editable = createEditable();
    const refObj: { current: ChatInputBoxHandle | null } = { current: null };
    const invalidateCache = vi.fn();
    const setHasContent = vi.fn();
    const adjustHeight = vi.fn();
    const focusInput = vi.fn();
    const clearInput = vi.fn();
    const cancelPendingInput = vi.fn();

    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    renderHook(() =>
      useChatInputImperativeHandle({
        ref: refObj,
        editableRef: { current: editable },
        getTextContent: () => editable.innerText,
        invalidateCache,
        cancelPendingInput,
        setHasContent,
        adjustHeight,
        focusInput,
        clearInput,
        hasContent: false,
        extractFileTags: () => [],
      })
    );

    expect(refObj.current).not.toBeNull();
    refObj.current!.setValue('abc');
    expect(cancelPendingInput).toHaveBeenCalledOnce();
    expect(editable.innerText).toBe('abc');
    expect(setHasContent).toHaveBeenCalledWith(true);
    expect(adjustHeight).toHaveBeenCalled();

    const v = refObj.current!.getValue();
    expect(invalidateCache).toHaveBeenCalled();
    expect(v).toBe('abc');

    expect(refObj.current!.hasContent()).toBe(false);
    refObj.current!.focus();
    expect(focusInput).toHaveBeenCalled();
    refObj.current!.clear();
    expect(clearInput).toHaveBeenCalled();
  });
});

