import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { dictationController, type DictationState } from './dictation/dictationController';

export interface UseDictation extends DictationState {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  setDenoise: (value: boolean) => void;
}

/** Insert a recognized segment at the caret, spacing it from existing text. */
function insertDictated(editor: Editor, text: string) {
  const { from } = editor.state.selection;
  const before = from > 1 ? editor.state.doc.textBetween(from - 1, from, ' ', ' ') : '';
  const needsSpace = before !== '' && !/\s/.test(before);
  editor
    .chain()
    .focus()
    .insertContent((needsSpace ? ' ' : '') + text + ' ')
    .run();
}

/**
 * Binds the shared {@link dictationController} to an editor and exposes its live
 * state + controls. Recognized segments are inserted at the caret of whichever
 * text document is active.
 */
export function useDictation(editor: Editor | null): UseDictation {
  const [state, setState] = useState<DictationState>(() => dictationController.getState());

  useEffect(() => dictationController.subscribe(setState), []);

  useEffect(() => {
    dictationController.onText = (text) => {
      if (editor && !editor.isDestroyed) insertDictated(editor, text);
    };
    return () => {
      dictationController.onText = undefined;
    };
  }, [editor]);

  // Stop capturing when the active document goes away (editor unmounts/switches).
  useEffect(() => {
    if (!editor) void dictationController.stop();
  }, [editor]);

  const actions = useMemo(
    () => ({
      start: () => void dictationController.start(),
      stop: () => void dictationController.stop(),
      toggle: () => void dictationController.toggle(),
      setDenoise: (value: boolean) => dictationController.setDenoise(value),
    }),
    [],
  );

  return { ...state, ...actions };
}
