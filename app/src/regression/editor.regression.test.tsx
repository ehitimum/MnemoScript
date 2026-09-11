import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import Editor, { EMPTY_DOC } from '../components/Editor';
import type { Document } from '../types';

const doc: Document = {
  id: 'd1',
  title: 'Chapter 1',
  content: '<h2>Hello</h2><p>World</p>',
  updated_at: '',
  docType: 'text',
  order: 0,
};

function makeProps(overrides: Partial<React.ComponentProps<typeof Editor>> = {}) {
  return {
    projectId: 'p1',
    document: doc,
    onUpdateDocumentContent: vi.fn(),
    onEditorReady: vi.fn(),
    editorFont: 'Inter',
    editorSize: 16,
    lineHeight: 1.6,
    editorPadding: 30,
    spellcheckActive: true,
    smoothCaret: true,
    ...overrides,
  } satisfies React.ComponentProps<typeof Editor>;
}

async function mount(overrides: Partial<React.ComponentProps<typeof Editor>> = {}) {
  const props = makeProps(overrides);
  const utils = render(<Editor {...props} />);
  await waitFor(() => expect(props.onEditorReady).toHaveBeenCalled());
  const editor = vi.mocked(props.onEditorReady).mock.calls[0][0] as TiptapEditor;
  return { ...utils, props, editor };
}

describe('Editor (regression)', () => {
  it('loads the document and hands the live editor to the parent', async () => {
    const { editor } = await mount();
    expect(editor.getHTML()).toContain('World');
    expect(document.querySelector('.ProseMirror')).toBeTruthy();
  });

  it('mounts the smooth caret overlay and hides the native caret via the container class', async () => {
    const { rerender, props } = await mount();
    expect(document.querySelector('.mn-caret')).toBeTruthy();
    expect(document.querySelector('.mn-editor-scroll')).toHaveClass('mn-smooth-caret');

    rerender(<Editor {...props} smoothCaret={false} />);
    expect(document.querySelector('.mn-caret')).toBeNull();
    expect(document.querySelector('.mn-editor-scroll')).not.toHaveClass('mn-smooth-caret');
  });

  it('reports edits to the parent and ignores the echo of its own content', async () => {
    const { editor, props, rerender } = await mount();
    act(() => {
      editor.chain().focus('end').insertContent(' more').run();
    });
    expect(props.onUpdateDocumentContent).toHaveBeenCalled();
    const html = vi.mocked(props.onUpdateDocumentContent).mock.calls.at(-1)![0] as string;
    expect(html).toContain('World more');

    // Parent stamps the document with the same HTML and re-renders: the editor
    // must not reset itself (a reset would move the caret to the start).
    const headBefore = editor.state.selection.head;
    rerender(<Editor {...props} document={{ ...doc, content: html }} />);
    expect(editor.getHTML()).toBe(html);
    expect(editor.state.selection.head).toBe(headBefore);
  });

  it('applies a genuinely external content change (e.g. reloaded from disk)', async () => {
    const { editor, props, rerender } = await mount();
    rerender(<Editor {...props} document={{ ...doc, content: '<p>External</p>' }} />);
    expect(editor.getHTML()).toContain('External');
  });

  it('falls back to a title + paragraph for an empty document', async () => {
    const { editor } = await mount({ document: { ...doc, content: '' } });
    expect(editor.getHTML()).toBe(EMPTY_DOC);
  });

  it('tells the parent when the editor goes away', async () => {
    const { props, unmount } = await mount();
    unmount();
    expect(props.onEditorReady).toHaveBeenLastCalledWith(null);
  });

  it('hides the desktop toolbar in mobile chrome', async () => {
    await mount({ chrome: 'mobile' });
    expect(document.querySelector('.mn-editor-scroll')).toHaveClass('is-mobile');
    expect(document.querySelector('button[title^="Read Aloud"]')).toBeNull();
  });
});
