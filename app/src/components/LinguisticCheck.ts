import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { grammarService, type LTMatch } from './grammar-service';

declare module '@tiptap/core' {
  interface Storage {
    linguisticCheck: {
      matches: LTMatch[];
    };
  }
}

export const linguisticPluginKey = new PluginKey('linguisticCheck');

interface FlatText {
  text: string;
  // map[i] = the ProseMirror document position immediately BEFORE flat-text
  // character `i`. Length is `text.length + 1` so the *exclusive* end offset of
  // any match (offset + length) is always mappable.
  map: number[];
}

/**
 * Build the plain text sent to LanguageTool AND the offset -> doc-position map
 * in ONE pass.
 *
 * This is the core correctness fix. The old code extracted text with one rule
 * (`node.isBlock && text.length > 0`) and mapped offsets with a *different* rule
 * (`node.isBlock && pos > 0`), in two independent traversals. Those rules
 * diverge for empty leading blocks (your default `<h2></h2><p></p>` shifted
 * every highlight left by one) and for nested lists/blockquotes (larger drift,
 * sometimes falling back to position 1). Producing both from the same walk makes
 * a LanguageTool `offset` impossible to drift away from its real position.
 */
function buildFlatText(doc: ProsemirrorNode): FlatText {
  let text = '';
  const map: number[] = [];
  let sawContentBlock = false;

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const t = node.text;
      for (let i = 0; i < t.length; i++) {
        map.push(pos + i); // position right before this character
      }
      text += t;
    } else if (node.isBlock) {
      // Insert a single whitespace separator between content blocks so words at
      // block edges don't get glued together (e.g. "endStart" -> "end Start").
      if (sawContentBlock && text.length > 0 && !text.endsWith(' ')) {
        map.push(pos); // separator maps to the block boundary
        text += ' ';
      }
      sawContentBlock = true;
    }
  });

  // Sentinel so that map[text.length] (an exclusive end offset) is valid.
  map.push(map.length > 0 ? map[map.length - 1] + 1 : 1);

  return { text, map };
}

export const LinguisticCheck = Extension.create({
  name: 'linguisticCheck',

  addStorage() {
    return { matches: [] as LTMatch[] };
  },

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: linguisticPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldDecorationSet) {
            const meta = tr.getMeta('linguisticUpdate');
            if (meta) return meta;
            // Keep existing decorations aligned as the user edits. Mapping
            // preserves each decoration's spec (and therefore its `match`).
            return oldDecorationSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return linguisticPluginKey.getState(state);
          },
        },
        view() {
          let timeout: ReturnType<typeof setTimeout> | null = null;

          return {
            update(view, prevState) {
              if (prevState.doc.eq(view.state.doc)) return;

              if (timeout) clearTimeout(timeout);

              timeout = setTimeout(async () => {
                // Snapshot the document this check is being run against.
                const checkedDoc = view.state.doc;
                const { text, map } = buildFlatText(checkedDoc);

                if (!text.trim()) {
                  editor.storage.linguisticCheck.matches = [];
                  view.dispatch(
                    view.state.tr.setMeta('linguisticUpdate', DecorationSet.empty)
                  );
                  return;
                }

                const matches = await grammarService.checkText(text);

                // The user may have typed while we awaited the network call. If
                // so, these offsets no longer line up with the live document, so
                // drop the result instead of decorating the wrong text. (The old
                // code stored stale matches to storage even when it skipped the
                // dispatch, which desynced the popup from what was on screen.)
                if (!view.state.doc.eq(checkedDoc)) return;

                const decorations: Decoration[] = [];

                matches.forEach((match) => {
                  const start = match.offset;
                  const end = match.offset + match.length;

                  // Guard against malformed offsets from the API.
                  if (start < 0 || end > text.length) return;

                  const fromPos = map[start];
                  const toPos = map[end];

                  if (
                    fromPos == null ||
                    toPos == null ||
                    fromPos < 1 ||
                    toPos > checkedDoc.content.size ||
                    fromPos >= toPos
                  ) {
                    return;
                  }

                  const isTypo =
                    match.rule.category.id === 'TYPOS' ||
                    match.rule.category.id === 'SPELLING';
                  const className = isTypo
                    ? 'typo-match'
                    : 'grammar-match';

                  decorations.push(
                    Decoration.inline(
                      fromPos,
                      toPos,
                      {
                        // DOM attributes (rendering only).
                        class: `lt-match ${className} cursor-pointer`,
                        title: match.shortMessage || match.message,
                      },
                      {
                        // Decoration SPEC (logic) — this is what getActiveGrammarError
                        // reads back. The old code stored the id in the DOM attrs
                        // but read it from `.spec`, so it was always undefined and
                        // the suggestion popover never appeared. Storing the match
                        // object itself also means we never have to re-look it up,
                        // and the decoration's mapped `from`/`to` stay authoritative
                        // even after the user keeps editing.
                        match,
                      }
                    )
                  );
                });

                editor.storage.linguisticCheck.matches = matches;

                view.dispatch(
                  view.state.tr.setMeta(
                    'linguisticUpdate',
                    DecorationSet.create(view.state.doc, decorations)
                  )
                );
              }, 800);
            },
            destroy() {
              if (timeout) clearTimeout(timeout);
            },
          };
        },
      }),
    ];
  },
});

export function getActiveGrammarError(editor: any) {
  if (!editor || !editor.state) return null;

  const decos: DecorationSet | undefined = linguisticPluginKey.getState(editor.state);
  if (!decos) return null;

  const { from, to } = editor.state.selection;
  const found = decos.find(from, to);
  if (found.length === 0) return null;

  // Read the match straight off the decoration spec set above. Because we use
  // the decoration's live from/to (not the stale match.offset), the fix range
  // stays correct even after subsequent edits.
  const decoration = found.find((d: any) => d.spec && d.spec.match);
  if (!decoration) return null;

  return {
    match: (decoration as any).spec.match as LTMatch,
    from: decoration.from,
    to: decoration.to,
  };
}