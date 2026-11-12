import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { wordDiff } from './diff';

/**
 * Bridge between ProseMirror positions and the plain text the AI sees. A passage is flattened to
 * text (paragraphs joined by a blank line) with the document position of every character, so a
 * revised passage can be written back word by word: unchanged words keep their marks (bold,
 * italic, links), and the whole change is one transaction — one Ctrl+Z.
 */

export interface FlatText {
  text: string;
  /** Document position of each character; -1 for the blank line between paragraphs. */
  pos: number[];
}

export function flatten(doc: PMNode, from: number, to: number): FlatText {
  let text = '';
  const pos: number[] = [];
  let started = false;
  doc.nodesBetween(from, to, (node, at) => {
    if (node.isTextblock) {
      if (started) {
        text += '\n\n';
        pos.push(-1, -1);
      }
      started = true;
      return true;
    }
    if (node.isText) {
      const s = Math.max(from, at);
      const e = Math.min(to, at + node.nodeSize);
      for (let p = s; p < e; p++) {
        text += node.text![p - at];
        pos.push(p);
      }
      return false;
    }
    if (node.type.name === 'hardBreak' && at >= from && at < to) {
      text += ' ';
      pos.push(at);
    }
    return true;
  });
  // A range that starts at the end of one paragraph yields a leading separator: drop it.
  while (text.startsWith('\n\n')) {
    text = text.slice(2);
    pos.splice(0, 2);
  }
  return { text, pos };
}

const paragraphs = (t: string) =>
  t
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

const paragraphNodes = (t: string) =>
  paragraphs(t).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }));

/** Keep a fast AI response separate from both preceding and subsequent typing. */
function isolatedEdit(editor: Editor, edit: () => boolean): boolean {
  editor.view.dispatch(closeHistory(editor.state.tr));
  try {
    return edit();
  } finally {
    editor.view.dispatch(closeHistory(editor.state.tr));
  }
}

/**
 * Replace [from, to) with `next`. Word-level when the paragraph structure is unchanged (keeps
 * formatting); otherwise the range is replaced with plain paragraphs. Returns false if the range
 * no longer matches `expected` (the writer edited it meanwhile) and `force` is not set.
 */
export function applyRewrite(editor: Editor, from: number, to: number, next: string, expected?: string, force = false): boolean {
  const { state } = editor;
  const flat = flatten(state.doc, from, to);
  if (expected != null && flat.text !== expected && !force) return false;

  const ops = wordDiff(flat.text, next);
  const structural =
    paragraphs(flat.text).length !== paragraphs(next).length ||
    ops.some((o) => o.type !== 'eq' && o.text.includes('\n')) ||
    flat.text !== (expected ?? flat.text);

  if (structural) {
    // Plain paragraphs; ProseMirror splits/joins the surrounding blocks as needed.
    const nodes = paragraphNodes(next);
    const single = nodes.length === 1 && state.doc.resolve(from).sameParent(state.doc.resolve(to));
    return isolatedEdit(editor, () => editor
      .chain()
      .insertContentAt({ from, to }, single ? nodes[0].content : nodes.length ? nodes : '')
      .run());
  }

  const chunks: { a: number; b: number; text: string }[] = [];
  let cur: { a: number; b: number; text: string } | null = null;
  let i = 0;
  for (const op of ops) {
    if (op.type === 'eq') {
      if (cur) chunks.push(cur);
      cur = null;
      i += op.text.length;
      continue;
    }
    cur ??= { a: i, b: i, text: '' };
    if (op.type === 'del') {
      i += op.text.length;
      cur.b = i;
    } else {
      cur.text += op.text;
    }
  }
  if (cur) chunks.push(cur);
  if (!chunks.length) return true;

  const tr = state.tr;
  for (const c of chunks.reverse()) {
    if (c.a < c.b) {
      const start = flat.pos[c.a];
      const end = flat.pos[c.b - 1] + 1;
      if (c.text) tr.insertText(c.text, start, end);
      else tr.delete(start, end);
    } else {
      const at = c.a > 0 ? flat.pos[c.a - 1] + 1 : flat.pos[c.a];
      tr.insertText(c.text, at);
    }
  }
  return isolatedEdit(editor, () => {
    editor.view.dispatch(tr);
    return true;
  });
}

/** "Continue writing": new paragraphs after the paragraph that contains `at`. */
export function insertParagraphsAfter(editor: Editor, at: number, text: string): boolean {
  const $at = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
  const after = $at.depth > 0 ? $at.after($at.depth) : editor.state.doc.content.size;
  const nodes = paragraphNodes(text);
  if (!nodes.length) return false;
  return isolatedEdit(editor, () => editor.chain().insertContentAt(after, nodes).run());
}
