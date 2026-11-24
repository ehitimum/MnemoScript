import { Extension, InputRule, type Editor } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Storage {
    smartQuotes: { enabled: boolean };
  }
}

/** Turns the replacement on or off for this editor (Settings → Smart quotes). */
export function setSmartQuotes(editor: Editor, enabled: boolean): void {
  const s = editor.storage.smartQuotes;
  if (s) s.enabled = enabled;
}

/** Characters after which a quote opens rather than closes. */
const OPENERS = '\\s([{\\u2014\\u2013\\u2018\\u201C/-';

/** The curly form of a straight quote typed after `prev` ('' = start of the paragraph). */
export function curlyQuote(quote: '"' | "'", prev: string): string {
  const opening = prev === '' || new RegExp(`[${OPENERS}]`).test(prev);
  if (quote === '"') return opening ? '“' : '”';
  return opening ? '‘' : '’'; // ’ is also the apostrophe (don’t, writers’)
}

/**
 * Typing " or ' inserts “ ” or ‘ ’, like a word processor. Settings → Editor → Smart quotes
 * turns it off (`editor.storage.smartQuotes.enabled`). Backspace right after the replacement
 * gives the straight quote back (TipTap's undoInputRule). Code blocks and inline code keep
 * straight quotes.
 */
export const SmartQuotes = Extension.create({
  name: 'smartQuotes',

  addStorage() {
    return { enabled: true };
  },

  addInputRules() {
    const storage = this.storage;
    const rule = (quote: '"' | "'") =>
      new InputRule({
        // The character before the quote (if any) decides opening vs closing.
        find: new RegExp(`(^|[\\s\\S])${quote}$`),
        handler: ({ state, range, match }) => {
          if (!storage.enabled) return null;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.spec.code)) return null;
          const prev = match[1] ?? '';
          const at = range.from + prev.length;
          state.tr.insertText(curlyQuote(quote, prev), at, range.to);
        },
      });
    return [rule('"'), rule("'")];
  },
});
