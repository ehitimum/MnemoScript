import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { applyRewrite, flatten } from '../lib/ai/rewrite';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const make = (html: string) => (editor = new Editor({ extensions: [StarterKit], content: html }));

/** The range covering the paragraphs from the one starting with `first` to the end. */
function from(ed: Editor, first: string) {
  let start = -1;
  ed.state.doc.descendants((n, p) => {
    if (start < 0 && n.isTextblock && n.textContent.startsWith(first)) start = p + 1;
  });
  return { from: start, to: ed.state.doc.content.size - 1 };
}

describe('inline AI word edits (regression, PR #1 review item 2)', () => {
  // A word added at the start of the second or a later paragraph of the selection used the
  // paragraph separator's position (-1) + 1 = 0 and landed at the top of the document.
  it('inserts a word at the start of a later paragraph where it belongs', () => {
    const ed = make('<p>Intro para.</p><p>Hello.</p><p>world is big</p>');
    const r = from(ed, 'Hello');
    const before = flatten(ed.state.doc, r.from, r.to).text;
    expect(before).toBe('Hello.\n\nworld is big');
    expect(applyRewrite(ed, r.from, r.to, 'Hello.\n\nThe world is big', before)).toBe(true);
    expect(ed.getHTML()).toBe('<p>Intro para.</p><p>Hello.</p><p>The world is big</p>');
  });

  it('keeps formatting of the next word and still undoes in one step', () => {
    const ed = make('<p>Intro.</p><p>First line.</p><p><strong>Second</strong> line.</p>');
    const r = from(ed, 'First');
    const before = flatten(ed.state.doc, r.from, r.to).text;
    expect(applyRewrite(ed, r.from, r.to, 'First line.\n\nAnd Second line.', before)).toBe(true);
    expect(ed.getHTML()).toBe('<p>Intro.</p><p>First line.</p><p>And <strong>Second</strong> line.</p>');
    ed.commands.undo();
    expect(ed.getHTML()).toBe('<p>Intro.</p><p>First line.</p><p><strong>Second</strong> line.</p>');
  });

  it('still appends at the end of a paragraph and at the start of the first one', () => {
    const ed = make('<p>Intro.</p><p>Alpha</p><p>Beta</p>');
    const r = from(ed, 'Alpha');
    const before = flatten(ed.state.doc, r.from, r.to).text;
    expect(applyRewrite(ed, r.from, r.to, 'So Alpha ends\n\nBeta', before)).toBe(true);
    expect(ed.getHTML()).toBe('<p>Intro.</p><p>So Alpha ends</p><p>Beta</p>');
  });
});
