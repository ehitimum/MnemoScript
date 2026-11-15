import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, it, vi } from 'vitest';
import { applyRewrite, flatten, insertParagraphsAfter } from '../lib/ai/rewrite';

it.each(['word rewrite', 'structural rewrite', 'continuation'])('%s has its own undo group even with an immediate response', (mode) => {
  // CI is fast enough for the response and surrounding typing to fall within the same
  // ProseMirror history interval. Freeze time so this never depends on machine speed.
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit],
    content: '<p>The tavern was <strong>very loud</strong>.</p>',
  });
  try {
    const original = editor.getHTML();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Tonight.');
    const beforeAi = editor.getHTML();
    if (mode === 'continuation') {
      expect(insertParagraphsAfter(editor, editor.state.doc.content.size - 1, 'Mara entered.')).toBe(true);
    } else {
      const end = editor.state.doc.content.size;
      const expected = flatten(editor.state.doc, 0, end).text;
      expect(applyRewrite(editor, 0, end, mode === 'word rewrite'
        ? 'The tavern was loud. Tonight.' : 'The tavern was loud.\n\nMara entered.', expected)).toBe(true);
    }
    const afterAi = editor.getHTML();
    expect(afterAi).not.toBe(beforeAi);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More typing.');
    editor.commands.undo();
    expect(editor.getHTML()).toBe(afterAi); // Later typing must also have its own group.
    editor.commands.undo();
    expect(editor.getHTML()).toBe(beforeAi); // Keep the writer's immediately preceding edit.
    editor.commands.redo();
    expect(editor.getHTML()).toBe(afterAi);
    editor.commands.undo();
    expect(editor.getHTML()).toBe(beforeAi);
    editor.commands.undo();
    expect(editor.getHTML()).toBe(original);
  } finally {
    editor.destroy();
  }
});
