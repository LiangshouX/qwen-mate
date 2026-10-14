import { useImperativeHandle } from 'react';
import type { ForwardedRef } from 'react';
import type { Attachment, ChatInputBoxHandle, FileTagInfo } from '../types.js';

export interface UseChatInputImperativeHandleOptions {
  ref: ForwardedRef<ChatInputBoxHandle>;
  editableRef: React.RefObject<HTMLDivElement | null>;
  getTextContent: () => string;
  invalidateCache: () => void;
  cancelPendingInput: () => void;
  setHasContent: (hasContent: boolean) => void;
  adjustHeight: () => void;
  focusInput: () => void;
  clearInput: () => void;
  hasContent: boolean;
  extractFileTags: () => FileTagInfo[];
  /** Sync the text pipeline after a programmatic DOM write (tags, height, parent value). */
  handleInput: () => void;
  /** Merge restored attachments into the internal draft list (no-op when attachments are controlled). */
  restoreAttachments?: (attachments: Attachment[]) => void;
}

/**
 * useChatInputImperativeHandle - Exposes an imperative API for the input box
 *
 * Keeps the parent API stable without forcing additional re-renders.
 */
export function useChatInputImperativeHandle({
  ref,
  editableRef,
  getTextContent,
  invalidateCache,
  cancelPendingInput,
  setHasContent,
  adjustHeight,
  focusInput,
  clearInput,
  hasContent,
  extractFileTags,
  handleInput,
  restoreAttachments,
}: UseChatInputImperativeHandleOptions): void {
  useImperativeHandle(
    ref,
    () => ({
      getValue: () => {
        invalidateCache();
        return getTextContent();
      },
      setValue: (newValue: string) => {
        if (!editableRef.current) return;
        cancelPendingInput();
        editableRef.current.innerText = newValue;
        setHasContent(!!newValue.trim());
        adjustHeight();
        invalidateCache();

        if (newValue) {
          const range = document.createRange();
          const selection = window.getSelection();
          if (!selection) return;

          range.selectNodeContents(editableRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      },
      focus: focusInput,
      clear: clearInput,
      hasContent: () => hasContent,
      getFileTags: extractFileTags,
      restoreDraft: (value: string, attachments?: Attachment[]) => {
        const el = editableRef.current;
        if (!el) return;
        cancelPendingInput();
        invalidateCache();
        // Merge instead of replace: the user's in-progress draft and the
        // restored queue content must both survive (queued work is never
        // dropped — mirrors the CLI's "pop queue back to input" semantics).
        const current = getTextContent();
        const hasCurrent = current.replace(/[​-‍﻿]/g, '').trim().length > 0;
        const merged = hasCurrent ? `${current}\n\n${value}` : value;
        el.innerText = merged;
        setHasContent(!!merged.trim());
        adjustHeight();
        invalidateCache();

        // Caret to the end so editing starts where the restored text lands.
        try {
          const range = document.createRange();
          const selection = window.getSelection();
          if (selection) {
            range.selectNodeContents(el);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } catch {
          // Defensive: JCEF/IME edge cases can throw on DOM selection APIs.
        }

        if (attachments && attachments.length > 0) {
          restoreAttachments?.(attachments);
        }
        // Sync tags/height and the controlled `value` (draftInput) so the
        // external sync hook never overwrites the restored draft.
        handleInput();
        focusInput();
      },
    }),
    [
      getTextContent,
      invalidateCache,
      cancelPendingInput,
      editableRef,
      setHasContent,
      adjustHeight,
      focusInput,
      clearInput,
      hasContent,
      extractFileTags,
      handleInput,
      restoreAttachments,
    ]
  );
}

