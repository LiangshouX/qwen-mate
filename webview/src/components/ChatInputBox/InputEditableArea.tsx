import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import type { TFunction } from 'i18next';
import { ContextMenu } from '../ContextMenu';
import {
  copySelection,
  insertNewline,
  pasteAtCursor,
} from '../../hooks/useContextMenu.js';

/** Shape of the context-menu state/handlers used by this component. */
interface InputContextMenu {
  visible: boolean;
  x: number;
  y: number;
  hasSelection: boolean;
  savedRange: Range | null;
  selectedText: string;
  open: (e: ReactMouseEvent) => void;
  close: () => void;
}

interface InputEditableAreaProps {
  editableWrapperRef: RefObject<HTMLDivElement | null>;
  editableWrapperStyle: CSSProperties;
  editableRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  placeholder: string;
  completionSuffix: string;
  handleInput: (inputType?: string) => void;
  handleKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleKeyUp: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  ctxMenu: InputContextMenu;
  onCut: () => void;
  t: TFunction;
}

/**
 * InputEditableArea - The contenteditable input region of ChatInputBox.
 *
 * Renders the editable div plus the right-click context menu overlay. Enter
 * handling is not wired here: React's onBeforeInput is synthesized from
 * textInput/keypress and never sees `insertParagraph`, so Enter-to-send lives
 * in useNativeEventCapture (native beforeinput/keydown) and useKeyboardHandler.
 * All state and handlers are owned by the parent and passed in as props.
 */
export function InputEditableArea({
  editableWrapperRef,
  editableWrapperStyle,
  editableRef,
  disabled,
  placeholder,
  completionSuffix,
  handleInput,
  handleKeyDown,
  handleKeyUp,
  handleCompositionStart,
  handleCompositionEnd,
  handlePaste,
  handleDragOver,
  handleDrop,
  ctxMenu,
  onCut,
  t,
}: InputEditableAreaProps) {
  return (
    <div
      ref={editableWrapperRef}
      className="input-editable-wrapper"
      style={editableWrapperStyle}
    >
      <div
        ref={editableRef}
        className="input-editable"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        spellCheck={false}
        data-placeholder={placeholder}
        data-completion-suffix={completionSuffix}
        onInput={(e) => {
          // JCEF may misreport isComposing. The pipeline uses composition events
          // and inputType to recover when compositionend goes missing.
          const inputType =
            'inputType' in e.nativeEvent
              ? (e.nativeEvent as InputEvent).inputType
              : undefined;
          handleInput(inputType);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={ctxMenu.open}
        suppressContentEditableWarning
      />
      {ctxMenu.visible && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={ctxMenu.close}
          items={[
            { label: t('contextMenu.copy', 'Copy'), action: () => copySelection(ctxMenu.savedRange, ctxMenu.selectedText), disabled: !ctxMenu.hasSelection },
            { label: t('contextMenu.cut', 'Cut'), action: onCut, disabled: !ctxMenu.hasSelection },
            { label: t('contextMenu.paste', 'Paste'), action: () => { if (editableRef.current) { pasteAtCursor(ctxMenu.savedRange, editableRef.current, handleInput); } } },
            { separator: true },
            { label: t('contextMenu.newline', 'Insert Newline'), action: () => { if (editableRef.current) { insertNewline(ctxMenu.savedRange, editableRef.current); handleInput(); } } },
          ]}
        />
      )}
    </div>
  );
}

export default InputEditableArea;
