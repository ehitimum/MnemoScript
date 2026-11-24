/**
 * Regressions for the 2.2.0 writer feedback round (see DEVLOG 2026-11-24):
 * the phone "+" button scrolling away, chapter order flipping (1, 2, 4, 3), suggestion windows
 * hugging the screen edges, grammar flags that would not go away, formatting in the "/" menu,
 * the smooth caret on Android keyboards, and smart quotes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Editor as CoreEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import type { Editor as TiptapEditor } from '@tiptap/react';
import Editor from '../components/Editor';
import MobileLibrary from '../components/mobile/MobileLibrary';
import { LinguisticCheck, getActiveGrammarError, linguisticPluginKey, dismissGrammarFlag } from '../components/LinguisticCheck';
import { grammarService, type LTMatch } from '../components/grammar-service';
import { SmartQuotes, curlyQuote, setSmartQuotes } from '../components/extensions/SmartQuotes';
import { getFormatSlashItems } from '../components/extensions/slashItems';
import { placeFloating } from '../lib/floating';
import { compareDocs, nextDocOrder } from '../lib/docOrder';
import { addToDictionary, ignoreMatch, resetGrammarPrefsForTests, shouldShow } from '../lib/grammarPrefs';
import { domCaret } from '../lib/domCaret';
import type { Document, Project } from '../types';

afterEach(() => {
  resetGrammarPrefsForTests();
  vi.restoreAllMocks();
});

const doc = (id: string, title: string, order: number): Document => ({ id, title, order, content: '', updated_at: '', docType: 'text' });

describe('Chapter order (regression: 1, 2, 4, 3)', () => {
  it('ties sort by natural title, never by edit time', () => {
    const docs = [doc('a', 'Chapter 4', 3), doc('b', 'Chapter 1', 0), doc('c', 'Chapter 3', 3), doc('d', 'Chapter 10', 3), doc('e', 'Chapter 2', 1)];
    expect([...docs].sort(compareDocs).map((d) => d.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 10']);
  });

  it('a new document goes after the highest order, not at the count (which a delete makes reuse an index)', () => {
    // Chapter 3 (order 2) was deleted earlier: three documents remain, the highest at order 3.
    const docs = [doc('a', 'Chapter 1', 0), doc('b', 'Chapter 2', 1), doc('c', 'Chapter 4', 3)];
    expect(nextDocOrder(docs)).toBe(4);
    expect(nextDocOrder(docs, 2)).toBe(6);
    expect(nextDocOrder([])).toBe(0);
  });
});

describe('Phone library "+" button (regression: it scrolled with the list)', () => {
  it('is outside the scrolling document list', () => {
    const noop = () => {};
    render(
      <MobileLibrary
        selectedProject={{ id: 'p', name: 'Novel' } as Project}
        projects={[]}
        documents={Array.from({ length: 30 }, (_, i) => doc(`d${i}`, `Chapter ${i + 1}`, i))}
        folders={[]}
        onOpenProject={noop}
        onCloseProject={noop}
        onNewProject={noop}
        onSelectDocument={noop}
        onCreateDocument={noop}
        onCreateFolder={noop}
        onRenameDocument={noop}
        onDeleteDocuments={noop}
        onDuplicateDocuments={noop}
        onMoveDocuments={noop}
      />,
    );
    const list = screen.getByTestId('mobile-doc-list');
    const fab = screen.getByTitle('New document');
    expect(list.contains(fab)).toBe(false);
    expect(list.className).toContain('overflow-y-auto');
    // Listed in chapter order.
    expect(list.textContent!.indexOf('Chapter 2')).toBeLessThan(list.textContent!.indexOf('Chapter 10'));
  });
});

describe('Floating windows (regression: they hugged the edges, or fell off on the last line)', () => {
  const area = { top: 0, left: 0, right: 1000, bottom: 800 };
  it('sits below the text when it fits, centred', () => {
    const p = placeFloating({ top: 100, bottom: 120, left: 40, right: 60 }, 400, 200, area, 'center');
    expect(p.side).toBe('below');
    expect(p.left).toBe(300);
    expect(p.top).toBe(128);
  });

  it('goes above the last line instead of off the bottom', () => {
    const p = placeFloating({ top: 760, bottom: 780, left: 900, right: 990 }, 300, 200, area, 'target');
    expect(p.side).toBe('above');
    expect(p.top + 200).toBeLessThanOrEqual(760);
    expect(p.left + 300).toBeLessThanOrEqual(992); // kept off the right edge
  });

  it('stays on screen when its text has scrolled out of view', () => {
    const p = placeFloating({ top: -300, bottom: -280, left: 40, right: 60 }, 400, 200, area, 'center');
    expect(p.side).toBe('middle');
    expect(p.top).toBe(300);
  });

  it('uses the middle of the area when neither side has room (phone with keyboard open)', () => {
    const small = { top: 0, left: 0, right: 400, bottom: 360 };
    const p = placeFloating({ top: 170, bottom: 190, left: 10, right: 30 }, 380, 300, small, 'center');
    expect(p.side).toBe('middle');
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + Math.min(300, p.maxHeight)).toBeLessThanOrEqual(352);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});

const match = (over: Partial<LTMatch> = {}): LTMatch => ({
  message: 'Possible spelling mistake',
  shortMessage: 'Spelling',
  offset: 0,
  length: 5,
  replacements: [{ value: 'Arwen' }],
  rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS', name: 'Typos' } },
  ...over,
});

function grammarEditor(html: string) {
  return new CoreEditor({ element: document.createElement('div'), extensions: [StarterKit, LinguisticCheck], content: html });
}

function flag(editor: CoreEditor, from: number, to: number, m: LTMatch) {
  const set = DecorationSet.create(editor.state.doc, [Decoration.inline(from, to, { class: 'lt-match' }, { match: m })]);
  editor.view.dispatch(editor.state.tr.setMeta('linguisticUpdate', set));
}

describe('Grammar checking (regression: too strict, and flags stayed after a fix)', () => {
  it('drops the flag as soon as the flagged word is edited', () => {
    const editor = grammarEditor('<p>Teh tavern.</p>');
    try {
      flag(editor, 1, 4, match({ length: 3 }));
      editor.commands.setTextSelection(2);
      expect(getActiveGrammarError(editor)).not.toBeNull();
      editor.commands.insertContentAt({ from: 1, to: 4 }, 'The');
      editor.commands.setTextSelection(2);
      expect(getActiveGrammarError(editor)).toBeNull();
      expect(linguisticPluginKey.getState(editor.state)!.find().length).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it('keeps flags elsewhere in the text, and Ignore removes just that one', () => {
    const editor = grammarEditor('<p>Teh tavern was lowd.</p>');
    try {
      flag(editor, 1, 4, match({ length: 3 }));
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.');
      expect(linguisticPluginKey.getState(editor.state)!.find().length).toBe(1);
      dismissGrammarFlag(editor, 1, 4);
      expect(linguisticPluginKey.getState(editor.state)!.find().length).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it('asks for mistakes only (no "picky" level, style checks off)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ matches: [] })));
    await grammarService.checkText('Some text.');
    const body = String(fetchMock.mock.calls[0][1]!.body);
    expect(body).not.toContain('picky');
    expect(body).toContain('disabledCategories=STYLE');
  });

  it('never flags a dictionary word again, and Ignore lasts for the session', () => {
    expect(shouldShow(match(), 'Arwyn')).toBe(true);
    addToDictionary('Arwyn');
    expect(shouldShow(match(), 'arwyn')).toBe(false);
    const comma = match({ rule: { id: 'COMMA_RULE', category: { id: 'PUNCTUATION', name: 'Punctuation' } } });
    ignoreMatch(comma, 'however');
    expect(shouldShow(comma, 'however')).toBe(false);
    expect(shouldShow(comma, 'meanwhile')).toBe(true);
    expect(shouldShow(match({ rule: { id: 'X', category: { id: 'STYLE', name: 'Style' } } }), 'very')).toBe(false);
  });
});

function typeText(editor: CoreEditor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

describe('Smart quotes', () => {
  it('chooses opening and closing forms by the character before', () => {
    expect(curlyQuote('"', '')).toBe('“');
    expect(curlyQuote('"', ' ')).toBe('“');
    expect(curlyQuote('"', 'd')).toBe('”');
    expect(curlyQuote("'", 'n')).toBe('’');
    expect(curlyQuote("'", '(')).toBe('‘');
  });

  it('replaces typed quotes, and stays straight when turned off or in code', () => {
    const editor = new CoreEditor({ element: document.createElement('div'), extensions: [StarterKit, SmartQuotes], content: '<p></p>' });
    try {
      editor.commands.focus('end');
      typeText(editor, `"Don't," she said.`);
      expect(editor.state.doc.textContent).toBe('“Don’t,” she said.');

      setSmartQuotes(editor, false);
      typeText(editor, ' "x"');
      expect(editor.state.doc.textContent.endsWith(' "x"')).toBe(true);

      setSmartQuotes(editor, true);
      editor.commands.setContent('<pre><code></code></pre>');
      editor.commands.setTextSelection(1); // inside the code block (a paragraph follows it)
      typeText(editor, '"a"');
      expect(editor.state.doc.firstChild!.type.name).toBe('codeBlock');
      expect(editor.state.doc.firstChild!.textContent).toBe('"a"');
    } finally {
      editor.destroy();
    }
  });
});

describe('"/" menu formatting', () => {
  it('lists Bold, Italic, Underline … under Format and applies them', () => {
    const items = getFormatSlashItems();
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining(['Bold', 'Italic', 'Underline', 'Strikethrough', 'Clear formatting', 'Align center']));
    expect(items.every((i) => i.group === 'format')).toBe(true);

    const editor = new CoreEditor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p>Hello /bo</p>' });
    try {
      const end = editor.state.doc.content.size - 1;
      editor.commands.setTextSelection(end);
      items.find((i) => i.title === 'Bold')!.action(editor, { from: end - 3, to: end });
      expect(editor.state.doc.textContent).toBe('Hello ');
      editor.commands.insertContent('bold');
      expect(editor.getHTML()).toContain('<strong>bold</strong>');
    } finally {
      editor.destroy();
    }
  });
});

describe('Smooth caret on phone keyboards (regression: hidden while Android composes every word)', () => {
  it('stays on, following the browser caret, during IME composition', async () => {
    const onEditorReady = vi.fn();
    render(
      <Editor
        projectId="p"
        document={doc('d', 'Chapter 1', 0)}
        onUpdateDocumentContent={vi.fn()}
        onEditorReady={onEditorReady}
        editorFont="Inter"
        editorSize={16}
        lineHeight={1.6}
        editorPadding={30}
        spellcheckActive={false}
        smoothCaret
        chrome="mobile"
      />,
    );
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0][0] as TiptapEditor;
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([{ left: 120, top: 40, bottom: 60, right: 120, width: 0, height: 20 }] as unknown as DOMRectList);
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    act(() => {
      editor.commands.focus('end');
    });
    const caret = document.querySelector<HTMLElement>('.mn-caret')!;
    act(() => {
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart'));
    });
    await waitFor(() => expect(caret.style.visibility).toBe('visible'));
    expect(document.querySelector('.mn-editor-scroll')).not.toHaveClass('is-composing');
    expect(domCaret(editor.view.dom as HTMLElement)).toEqual({ left: 120, top: 40, bottom: 60 });
  });
});
