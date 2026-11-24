import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { InlineCommandId, ToneId } from '../../lib/ai/inline';

/**
 * Inline AI support inside the editor:
 *  - highlights the passage an inline command is working on (`.mn-ai-target`), and keeps that range
 *    mapped through any edits made meanwhile, so Accept writes to the right place;
 *  - exposes the inline AI controller (registered by `InlineAi`) through editor storage, so the
 *    slash menu, the phone Tools sheet and the Format panel can start a command;
 *  - Mod-J opens the command menu.
 */

export interface AiTargetRange {
  from: number;
  to: number;
  running: boolean;
}

export interface InlineAiController {
  start(cmd: InlineCommandId, opts?: { tone?: ToneId }): void;
  /** Desktop command menu at the selection (`tone` opens straight on the tone list). */
  openMenu(opts?: { tone?: boolean }): void;
}

/** Called by `InlineAi` on mount; returns the unregister function. */
export function registerInlineAi(editor: Editor, controller: InlineAiController): () => void {
  const storage = editor.storage.aiTarget;
  if (!storage) return () => {};
  storage.controller = controller;
  return () => {
    if (storage.controller === controller) storage.controller = null;
  };
}

export const aiTargetKey = new PluginKey<AiTargetRange | null>('aiTarget');

declare module '@tiptap/core' {
  interface Storage {
    aiTarget: { controller: InlineAiController | null };
  }
}

export const AiTarget = Extension.create<Record<string, never>, { controller: InlineAiController | null }>({
  name: 'aiTarget',

  addStorage() {
    return { controller: null };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-j': () => {
        const c = this.storage.controller;
        if (!c) return false;
        c.openMenu();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AiTargetRange | null>({
        key: aiTargetKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(aiTargetKey) as AiTargetRange | null | undefined;
            if (meta !== undefined) return meta;
            if (!value || !tr.docChanged) return value;
            const from = tr.mapping.map(value.from, 1);
            const to = Math.max(from, tr.mapping.map(value.to, -1));
            return { ...value, from, to };
          },
        },
        props: {
          decorations(state) {
            const t = aiTargetKey.getState(state);
            if (!t || t.from >= t.to) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(t.from, t.to, { class: t.running ? 'mn-ai-target is-running' : 'mn-ai-target' }),
            ]);
          },
        },
      }),
    ];
  },
});

export function setAiTarget(editor: Editor, target: AiTargetRange | null): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(aiTargetKey, target).setMeta('addToHistory', false));
}

export function getAiTarget(editor: Editor): AiTargetRange | null {
  return aiTargetKey.getState(editor.state) ?? null;
}

/** The inline AI of this editor, if one is mounted (null in tests / when AI is unavailable). */
export function inlineAi(editor: Editor | null | undefined): InlineAiController | null {
  return editor && !editor.isDestroyed ? (editor.storage.aiTarget?.controller ?? null) : null;
}
