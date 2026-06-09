import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { grammarService, type LTMatch } from './grammar-service';

// Add this near the top of LinguisticCheck.ts
export const linguisticPluginKey = new PluginKey('linguisticCheck');

declare module '@tiptap/core' {
  interface Storage {
    linguisticCheck: {
      matches: LTMatch[];
    };
  }
}

/**
 * Robustly maps flat string positions back to dynamic structural ProseMirror absolute coordinates
 * by properly following text blocks and matching structural block positions.
 */
function mapTextPosToDocPos(doc: ProsemirrorNode, targetFlatOffset: number): number {
  let textOffsetCounter = 0;
  let resolvedDocPosition = 1; // Default fallback index starts inside the root block element

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const currentTextNodeLength = node.text.length;

      // Check if our targeted LanguageTool flat string offset sits inside this text node chunk
      if (targetFlatOffset >= textOffsetCounter && targetFlatOffset <= textOffsetCounter + currentTextNodeLength) {
        const structuralNodeDifference = targetFlatOffset - textOffsetCounter;
        resolvedDocPosition = pos + structuralNodeDifference;
        return false; // Found match! Break the descendants iteration loop early
      }
      textOffsetCounter += currentTextNodeLength;
    } else if (node.isBlock && pos > 0) {
      // If we encounter a new block wrapper node boundary (like switching to a new <p> or <li> block),
      // LanguageTool treats this break as a single implicit white space character separator.
      textOffsetCounter += 1;
    }
  });

  return resolvedDocPosition;
}

export const LinguisticCheck = Extension.create({
  name: 'linguisticCheck',

  addStorage() {
    return {
      matches: [] as LTMatch[],
    };
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
            // Instantly display updated API matches when they are dispatched via transaction metadata
            const meta = tr.getMeta('linguisticUpdate');
            if (meta) return meta;

            // Map and keep tracking previous highlights perfectly when users are typing locally
            return oldDecorationSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return linguisticPluginKey.getState(state);
          },
        },
        view(view) {
          let timeout: ReturnType<typeof setTimeout> | null = null;

          return {
            update(view, prevState) {
              const changed = !prevState.doc.eq(view.state.doc);
              if (changed) {
                if (timeout) clearTimeout(timeout);

                timeout = setTimeout(async () => {
                  const doc = view.state.doc;
                  
                  // Construct a text string that matches block element separations with implicit spaces
                  let text = '';
                  doc.descendants((node) => {
                    if (node.isText && node.text) {
                      text += node.text;
                    } else if (node.isBlock && text.length > 0) {
                      text += ' '; // Keeps plain string matching length equivalent to the structure tokens 
                    }
                  });

                  if (!text.trim()) {
                    editor.storage.linguisticCheck.matches = [];
                    view.dispatch(view.state.tr.setMeta('linguisticUpdate', DecorationSet.empty));
                    return;
                  }

                  const matches = await grammarService.checkText(text);
                  const decorations: Decoration[] = [];

                  matches.forEach((match) => {
                    const fromPos = mapTextPosToDocPos(doc, match.offset);
                    const toPos = mapTextPosToDocPos(doc, match.offset + match.length);

                    // Document limit safeguards to completely prevent runtime RangeErrors
                    if (fromPos >= 1 && toPos <= doc.content.size && fromPos < toPos) {
                      const isTypo = match.rule.category.id === 'TYPOS' || match.rule.category.id === 'SPELLING';
                      
                      // Tailwind configuration friendly underline/background highlighting properties
                      const className = isTypo
                        ? 'border-b-2 border-red-500 bg-red-500/10'
                        : 'border-b-2 border-blue-500 bg-blue-500/10';

                      decorations.push(
                        Decoration.inline(fromPos, toPos, {
                          class: `lt-match ${className} cursor-pointer`,
                          'data-match-id': match.rule.id,
                          title: match.message,
                        })
                      );
                    }
                  });

                  editor.storage.linguisticCheck.matches = matches;

                  // Double check document integrity state hasn't moved before dispatching async results
                  if (view.state.doc.eq(doc)) {
                    const currentDecorationSet = DecorationSet.create(view.state.doc, decorations);
                    view.dispatch(view.state.tr.setMeta('linguisticUpdate', currentDecorationSet));
                  }
                }, 800); // 800ms debounce protects backend server API call rate limits
              }
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
  
  const decos = linguisticPluginKey.getState(editor.state);
  if (!decos) return null;

  // Grab current cursor coordinates
  const { from, to } = editor.state.selection;
  
  // Find any grammar decorations at the cursor
  const found = decos.find(from, to);
  if (found.length === 0) return null;

  const decoration = found[0];
  const matchId = decoration.spec['data-match-id'];
  const matches = editor.storage.linguisticCheck.matches || [];
  const match = matches.find((m: any) => m.rule.id === matchId);

  if (!match) return null;

  return {
    match,
    from: decoration.from,
    to: decoration.to,
  };
}