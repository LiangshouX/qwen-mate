import { act, renderHook } from '@testing-library/react';
import type { Attachment } from '../types.js';
import { usePasteAndDrop } from './usePasteAndDrop.js';

function createEditable(): HTMLDivElement {
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  document.body.appendChild(editable);
  return editable;
}

function placeCaretAtEnd(editable: HTMLDivElement): void {
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function createPasteEvent(text: string): React.ClipboardEvent {
  return {
    clipboardData: {
      items: [{ kind: 'string', type: 'text/plain' }],
      getData: (type: string) => type === 'text/plain' ? text : '',
    },
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent;
}

function setupPasteHook(editable: HTMLDivElement) {
  const pathMappingRef = { current: new Map<string, string>() };
  const renderFileTags = vi.fn();
  const hook = renderHook(() => usePasteAndDrop({
    editableRef: { current: editable },
    pathMappingRef,
    getTextContent: () => editable.textContent ?? '',
    adjustHeight: vi.fn(),
    renderFileTags,
    setHasContent: vi.fn(),
    setInternalAttachments: vi.fn() as unknown as React.Dispatch<React.SetStateAction<Attachment[]>>,
    onInput: vi.fn(),
    closeAllCompletions: vi.fn(),
    handleInput: vi.fn(),
    flushInput: vi.fn(),
  }));

  return { ...hook, pathMappingRef, renderFileTags };
}

describe('usePasteAndDrop file references', () => {
  beforeEach(() => {
    // happy-dom does not implement the deprecated command used by the
    // production helper; returning false exercises its Range fallback.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'execCommand');
    delete window.getClipboardFilePath;
  });

  it('registers and normalizes multiple explicit paths with spaces', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result, pathMappingRef } = setupPasteHook(editable);

    result.current.handlePaste(createPasteEvent(
      '@C:\\Program Files\\demo\\view file.xml @/workspace/src/index.vue'
    ));

    expect(editable.textContent).toBe(
      '@C:\\Program Files\\demo\\view file.xml @/workspace/src/index.vue '
    );
    expect(pathMappingRef.current.get('view file.xml'))
      .toBe('C:\\Program Files\\demo\\view file.xml');
    expect(pathMappingRef.current.get('/workspace/src/index.vue'))
      .toBe('/workspace/src/index.vue');
  });

  it('keeps mixed ordinary text unchanged and does not register its @ text', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result, pathMappingRef } = setupPasteHook(editable);
    const mixedText = 'const email = "user@example.com"; @/workspace/src/index.vue';

    result.current.handlePaste(createPasteEvent(mixedText));

    expect(editable.textContent).toBe(mixedText);
    expect(pathMappingRef.current.size).toBe(0);
  });

  it('keeps trailing prose after an absolute-looking reference unchanged', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result, pathMappingRef } = setupPasteHook(editable);
    const mixedText = '@C:\\workspace\\view.xml please review';

    result.current.handlePaste(createPasteEvent(mixedText));

    expect(editable.textContent).toBe(mixedText);
    expect(pathMappingRef.current.size).toBe(0);
  });

  it('registers a pasted line reference with a spaced path', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result, pathMappingRef } = setupPasteHook(editable);

    result.current.handlePaste(createPasteEvent(
      '@C:\\Program Files\\src\\Main.java#L10-12'
    ));

    expect(editable.textContent).toBe('@C:\\Program Files\\src\\Main.java#L10-12 ');
    expect(pathMappingRef.current.get('C:\\Program Files\\src\\Main.java#L10-12'))
      .toBe('C:\\Program Files\\src\\Main.java');
  });

  it('registers a real clipboard file returned by the Java bridge', async () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result, pathMappingRef } = setupPasteHook(editable);
    window.getClipboardFilePath = vi.fn().mockResolvedValue(
      'C:\\Program Files\\demo\\view file.xml'
    );
    const event = {
      clipboardData: {
        items: [{ kind: 'file', type: 'application/xml' }],
        getData: () => '',
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      result.current.handlePaste(event);
      await Promise.resolve();
    });

    expect(editable.textContent).toBe('@C:\\Program Files\\demo\\view file.xml ');
    expect(pathMappingRef.current.get('view file.xml'))
      .toBe('C:\\Program Files\\demo\\view file.xml');
  });

  it('inserts a file reference from the Java-side paste event', async () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { pathMappingRef, renderFileTags } = setupPasteHook(editable);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('java-paste-file-path', {
        detail: { path: 'C:\\Program Files\\demo\\shot.png' },
      }));
      // renderFileTags runs inside requestAnimationFrame
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editable.textContent).toBe('@C:\\Program Files\\demo\\shot.png ');
    expect(pathMappingRef.current.get('shot.png'))
      .toBe('C:\\Program Files\\demo\\shot.png');
    expect(renderFileTags).toHaveBeenCalled();
  });

  it('ignores the Java-side paste event when the path is empty', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const { result } = setupPasteHook(editable);

    act(() => {
      window.dispatchEvent(new CustomEvent('java-paste-file-path', {
        detail: { path: '   ' },
      }));
    });

    expect(editable.textContent).toBe('');
    expect(result.current).toBeDefined();
  });

  it('creates an attachment with file name and source path from the Java image event', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const setInternalAttachments = vi.fn() as unknown as React.Dispatch<React.SetStateAction<Attachment[]>>;
    const pathMappingRef = { current: new Map<string, string>() };
    renderHook(() => usePasteAndDrop({
      editableRef: { current: editable },
      pathMappingRef,
      getTextContent: () => editable.textContent ?? '',
      adjustHeight: vi.fn(),
      renderFileTags: vi.fn(),
      setHasContent: vi.fn(),
      setInternalAttachments,
      onInput: vi.fn(),
      closeAllCompletions: vi.fn(),
      handleInput: vi.fn(),
      flushInput: vi.fn(),
    }));

    act(() => {
      window.dispatchEvent(new CustomEvent('java-paste-image', {
        detail: {
          base64: 'aGk=',
          mediaType: 'image/png',
          fileName: 'MIUI02.png',
          sourcePath: 'D:\\Pics\\MIUI02.png',
        },
      }));
    });

    expect(setInternalAttachments).toHaveBeenCalledTimes(1);
    const updater = (setInternalAttachments as unknown as { mock: { calls: [[React.Dispatch<React.SetStateAction<Attachment[]>>]] } }).mock.calls[0][0] as (prev: Attachment[]) => Attachment[];
    const created = updater([])[0];
    expect(created.fileName).toBe('MIUI02.png');
    expect(created.sourcePath).toBe('D:\\Pics\\MIUI02.png');
    expect(created.mediaType).toBe('image/png');
    expect(created.data).toBe('aGk=');
  });

  it('keeps the generated pasted-image name when the Java event has no file name', () => {
    const editable = createEditable();
    placeCaretAtEnd(editable);
    const setInternalAttachments = vi.fn() as unknown as React.Dispatch<React.SetStateAction<Attachment[]>>;
    const pathMappingRef = { current: new Map<string, string>() };
    renderHook(() => usePasteAndDrop({
      editableRef: { current: editable },
      pathMappingRef,
      getTextContent: () => editable.textContent ?? '',
      adjustHeight: vi.fn(),
      renderFileTags: vi.fn(),
      setHasContent: vi.fn(),
      setInternalAttachments,
      onInput: vi.fn(),
      closeAllCompletions: vi.fn(),
      handleInput: vi.fn(),
      flushInput: vi.fn(),
    }));

    act(() => {
      window.dispatchEvent(new CustomEvent('java-paste-image', {
        detail: { base64: 'aGk=', mediaType: 'image/png' },
      }));
    });

    const updater = (setInternalAttachments as unknown as { mock: { calls: [[React.Dispatch<React.SetStateAction<Attachment[]>>]] } }).mock.calls[0][0] as (prev: Attachment[]) => Attachment[];
    const created = updater([])[0];
    expect(created.fileName).toMatch(/^pasted-image-\d+\.png$/);
    expect(created.sourcePath).toBeUndefined();
  });
});
