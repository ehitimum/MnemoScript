import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ttsController, type TtsState } from './ttsController';

export interface UseReadAloud extends TtsState {
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: () => void;
  setRate: (rate: number) => void;
  setVoice: (voiceURI: string | null) => void;
}

/**
 * Binds the shared {@link ttsController} to an editor instance and exposes its
 * live state + controls. Safe to call from more than one component at once
 * (toolbar + sidebar) — they share the one singleton, so playback stays in sync.
 */
export function useReadAloud(editor: Editor | null): UseReadAloud {
  const [state, setState] = useState<TtsState>(() => ttsController.getState());

  useEffect(() => {
    // Re-attaching a new editor stops any speech tied to the previous document.
    ttsController.attachEditor(editor);
  }, [editor]);

  useEffect(() => ttsController.subscribe(setState), []);

  const actions = useMemo(
    () => ({
      play: () => ttsController.play(),
      pause: () => ttsController.pause(),
      resume: () => ttsController.resume(),
      stop: () => ttsController.stop(),
      toggle: () => ttsController.toggle(),
      setRate: (rate: number) => ttsController.setRate(rate),
      setVoice: (voiceURI: string | null) => ttsController.setVoice(voiceURI),
    }),
    [],
  );

  return { ...state, ...actions };
}
