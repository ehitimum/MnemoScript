import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';

/**
 * Karaoke-style highlight for Read-Aloud (TTS). A ProseMirror decoration plugin
 * (same pattern as LinguisticCheck) that paints:
 *   - `.tts-sentence` over the sentence currently being spoken, and
 *   - `.tts-word`     over the word currently being spoken (when the speech
 *                     engine emits boundary events).
 *
 * The TTS controller drives it imperatively via `setReadAloudHighlight(...)`,
 * which dispatches a metadata-only transaction (no document change). The active
 * sentence node is scrolled into view as it changes.
 */

export const readAloudPluginKey = new PluginKey('readAloudHighlight');

export interface ReadAloudRange {
  /** Sentence span (ProseMirror positions). null clears all highlight. */
  sentence: { from: number; to: number } | null;
  /** Optional finer word span within the sentence. */
  word?: { from: number; to: number } | null;
}

const EMPTY: ReadAloudRange = { sentence: null, word: null };

function buildDecorations(doc: ProsemirrorNode, range: ReadAloudRange): DecorationSet {
  const decos: Decoration[] = [];
  const size = doc.content.size;

  if (range.sentence) {
    const from = Math.max(1, range.sentence.from);
    const to = Math.min(size, range.sentence.to);
    if (from < to) {
      decos.push(Decoration.inline(from, to, { class: 'tts-sentence' }));
    }
  }
  if (range.word) {
    const from = Math.max(1, range.word.from);
    const to = Math.min(size, range.word.to);
    if (from < to) {
      decos.push(Decoration.inline(from, to, { class: 'tts-word' }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export const ReadAloudHighlight = Extension.create({
  name: 'readAloudHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: readAloudPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldSet) {
            const meta = tr.getMeta(readAloudPluginKey) as ReadAloudRange | undefined;
            if (meta) {
              return buildDecorations(tr.doc, meta);
            }
            // Keep the highlight aligned while the user (or dictation) edits.
            return oldSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return readAloudPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Imperatively set (or clear, with EMPTY) the read-aloud highlight + auto-scroll. */
export function setReadAloudHighlight(editor: Editor | null, range: ReadAloudRange): void {
  if (!editor || editor.isDestroyed) return;
  const { view } = editor;
  view.dispatch(view.state.tr.setMeta(readAloudPluginKey, range));

  // Scroll the start of the active sentence/word into view (centered-ish).
  const target = range.word?.from ?? range.sentence?.from;
  if (target != null) {
    try {
      const { node } = view.domAtPos(target);
      const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      /* position may be transiently invalid mid-edit; ignore */
    }
  }
}

export function clearReadAloudHighlight(editor: Editor | null): void {
  setReadAloudHighlight(editor, EMPTY);
}
