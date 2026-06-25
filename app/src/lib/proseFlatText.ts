import { Node as ProsemirrorNode } from '@tiptap/pm/model';

export interface FlatText {
  /** The document rendered as a single plain-text string. */
  text: string;
  /**
   * `map[i]` = the ProseMirror document position immediately BEFORE flat-text
   * character `i`. Length is `text.length + 1` so the *exclusive* end offset of
   * any range (offset + length) is always mappable.
   */
  map: number[];
}

/**
 * Build the plain text of a ProseMirror document AND the flat-offset → doc-position
 * map in ONE pass.
 *
 * Producing both from the same traversal is what keeps an offset from ever drifting
 * away from its real position. This previously lived inside LinguisticCheck (grammar
 * highlighting); it is now shared so Read-Aloud can map spoken sentences/words back
 * to editor positions with the exact same coordinate system.
 *
 * A single whitespace separator is inserted between content blocks so words at block
 * edges don't get glued together (e.g. "endStart" → "end Start").
 */
export function buildFlatText(doc: ProsemirrorNode): FlatText {
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
