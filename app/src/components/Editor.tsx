import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { Editor as CoreEditor, Range } from '@tiptap/core';
import type { Document } from '../types';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Volume2, Square, Mic, MicOff } from 'lucide-react';
import { LinguisticCheck, getActiveGrammarError } from './LinguisticCheck';
import { ReadAloudHighlight } from './extensions/ReadAloudHighlight';
import { SlashCommand } from './extensions/SlashCommand';
import { ImageWithAsset } from './extensions/ImageWithAsset';
import SmoothCaret from './SmoothCaret';
import { api } from '../lib/api';
import { useReadAloud } from '../lib/speech/useReadAloud';
import { useDictation } from '../lib/speech/useDictation';
import type { LTMatch } from './grammar-service';

interface GrammarErrorData {
  match: LTMatch;
  from: number;
  to: number;
  coords: { top: number; left: number };
}

export interface EditorProps {
  projectId: string;
  document: Document;
  onUpdateDocumentContent: (updatedText: string) => void;
  /** Called with the live editor on mount and `null` on unmount. */
  onEditorReady: (editor: TiptapEditor | null) => void;
  editorFont: string;
  editorSize: number;
  lineHeight: number;
  editorPadding: number;
  spellcheckActive: boolean;
  /** Word-style gliding caret (see SmoothCaret). */
  smoothCaret: boolean;
  /** 'mobile' hides the desktop toolbar; the mobile shell provides its own chrome. */
  chrome?: 'desktop' | 'mobile';
}

/** A fresh document: an (empty) title heading followed by a paragraph. */
export const EMPTY_DOC = '<h2></h2><p></p>';

/**
 * Rich-text editor for Notes / Chapters / Scenes.
 *
 * Mount it keyed by `document.id` (App and MobileShell both do): each document
 * gets its own TipTap instance, so undo history, grammar decorations and the
 * read-aloud highlight never bleed from one document into another.
 *
 * All static styling lives in index.css (`.mn-editor-scroll`, `.ProseMirror…`);
 * only the user's typography choices are applied inline. Nothing in here
 * re-renders on a keystroke — the smooth caret is a ref-driven overlay and the
 * parent receives the HTML through a callback.
 */
function Editor({
  projectId,
  document: doc,
  onEditorReady,
  onUpdateDocumentContent,
  editorFont,
  editorSize,
  lineHeight,
  editorPadding,
  spellcheckActive,
  smoothCaret,
  chrome = 'desktop',
}: EditorProps) {
  const isMobileChrome = chrome === 'mobile';
  const [grammarError, setGrammarError] = useState<GrammarErrorData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The HTML we last handed to the parent. The parent echoes it back as a new
  // `document` prop, and the sync effect below must ignore that echo (else we'd
  // serialise + compare the whole document on every keystroke).
  const lastEmittedRef = useRef<string | null>(null);

  // "/image": remove the slash text, open the native picker, then embed the file.
  const handleSlashImage = async (ed: CoreEditor, range: Range) => {
    ed.chain().focus().deleteRange(range).run();
    try {
      const path = await api.importImage(projectId);
      if (path) ed.chain().focus().setImage({ src: path }).run();
    } catch (e) {
      console.error('Image import failed:', e);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }).extend({
        addKeyboardShortcuts() {
          return {
            'Mod-1': () => this.editor.commands.toggleHeading({ level: 1 }),
            'Mod-2': () => this.editor.commands.toggleHeading({ level: 2 }),
            'Mod-3': () => this.editor.commands.toggleHeading({ level: 3 }),
            Tab: () => {
              if (this.editor.isActive('taskList')) return this.editor.commands.sinkListItem('taskItem');
              if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) {
                return this.editor.commands.sinkListItem('listItem');
              }
              return false;
            },
            'Shift-Tab': () => {
              if (this.editor.isActive('taskList')) return this.editor.commands.liftListItem('taskItem');
              if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) {
                return this.editor.commands.liftListItem('listItem');
              }
              return false;
            },
          };
        },
      }),
      Placeholder.configure({
        placeholder: ({ node, pos }) => {
          if (node.type.name === 'heading' && node.attrs.level === 2 && pos === 0) return 'Title…';
          if (node.type.name === 'paragraph' && pos <= 4) return 'Start writing, or type / for blocks…';
          return '';
        },
        showOnlyCurrent: false,
        includeChildren: false,
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // "/todo" task lists — nestable checkbox items, serialised as HTML like any block.
      TaskList,
      TaskItem.configure({ nested: true }),
      LinguisticCheck,
      // Karaoke highlight for Read-Aloud (TTS). Driven imperatively by ttsController.
      ReadAloudHighlight,
      ImageWithAsset,
      SlashCommand.configure({ onImage: handleSlashImage }),
    ],
    content: doc.content || EMPTY_DOC,
    editorProps: {
      attributes: { spellcheck: spellcheckActive ? 'true' : 'false' },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      lastEmittedRef.current = html;
      onUpdateDocumentContent(html);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const errorData = getActiveGrammarError(ed);
      if (!errorData) {
        setGrammarError(null);
        return;
      }
      try {
        const coords = ed.view.coordsAtPos(errorData.from);
        setGrammarError({
          match: errorData.match,
          from: errorData.from,
          to: errorData.to,
          coords: { top: coords.bottom + 6, left: coords.left },
        });
      } catch {
        setGrammarError(null);
      }
    },
  });

  // Spellcheck attribute follows the setting.
  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: { spellcheck: spellcheckActive ? 'true' : 'false' } } });
  }, [editor, spellcheckActive]);

  // Read-Aloud (TTS) + Voice-to-Text. Toolbar buttons are quick toggles; full
  // controls live in the RightSidebar / mobile Tools sheet.
  const readAloud = useReadAloud(editor ?? null);
  const dictation = useDictation(editor ?? null);

  useEffect(() => {
    if (!editor) return;
    onEditorReady(editor as TiptapEditor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  // Keep the editor in sync with external content changes (e.g. a document
  // reloaded from disk) while ignoring the echo of our own edits.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const target = doc.content || EMPTY_DOC;
    if (target === lastEmittedRef.current) return;
    if (editor.getHTML() === target) {
      lastEmittedRef.current = target;
      return;
    }
    editor.commands.setContent(target, { emitUpdate: false });
    lastEmittedRef.current = target;
  }, [doc.content, editor]);

  const applyGrammarFix = (replacement: string) => {
    if (!grammarError || !editor) return;
    editor.chain().focus().insertContentAt({ from: grammarError.from, to: grammarError.to }, replacement).run();
    setGrammarError(null);
  };

  // Clicking the blank page below the text drops the caret at the end, like a
  // word processor, instead of doing nothing.
  const onPageMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editor) return;
    const t = e.target as HTMLElement;
    if (t === e.currentTarget || t.classList.contains('mn-page')) {
      e.preventDefault();
      editor.commands.focus('end');
    }
  };

  const pageStyle = {
    fontFamily: editorFont,
    fontSize: `${editorSize}px`,
    lineHeight,
    '--mn-page-pad': `${editorPadding}px`,
  } as CSSProperties;

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative min-h-0">
      {!isMobileChrome && (
        <div className="h-10 bg-secondary/20 border-b border-border/30 flex justify-between items-center pl-4 pr-3 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0 text-xs font-medium text-foreground/85">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
            <span className="truncate">{doc.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className={`w-7 h-7 flex items-center justify-center rounded-md active:scale-95 transition-all duration-150 ${
                readAloud.supported
                  ? 'cursor-pointer hover:bg-secondary/60 text-foreground/80 hover:text-primary'
                  : 'opacity-30 cursor-not-allowed text-foreground/50'
              } ${readAloud.status !== 'idle' ? 'text-primary bg-primary/10 animate-pulse' : ''}`}
              title={
                !readAloud.supported
                  ? 'Read Aloud is not available on this device'
                  : readAloud.status === 'idle'
                    ? 'Read Aloud (select text to read just that part)'
                    : 'Stop reading'
              }
              disabled={!readAloud.supported}
              onClick={() => (readAloud.status === 'idle' ? readAloud.play() : readAloud.stop())}
            >
              {readAloud.status === 'idle' ? <Volume2 className="w-4 h-4" /> : <Square className="w-3.5 h-3.5 fill-current" />}
            </button>

            <button
              className={`relative w-7 h-7 flex items-center justify-center rounded-md active:scale-95 transition-all duration-150 ${
                dictation.supported ? 'cursor-pointer hover:bg-secondary/60 text-foreground/80 hover:text-primary' : 'opacity-30 cursor-not-allowed'
              } ${dictation.status === 'listening' ? 'bg-red-500/15 ring-1 ring-red-500/50' : ''} ${
                dictation.status === 'loading' ? 'animate-pulse' : ''
              }`}
              title={
                !dictation.supported
                  ? 'Dictation is not available on this device'
                  : dictation.error
                    ? dictation.error
                    : dictation.status === 'loading'
                      ? `Loading speech model… ${Math.round(dictation.loadProgress * 100)}%`
                      : dictation.status === 'listening'
                        ? 'Stop dictation'
                        : 'Dictate (speech to text)'
              }
              disabled={!dictation.supported}
              onClick={() => dictation.toggle()}
            >
              {dictation.status === 'listening' ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4" />}
              {dictation.status === 'listening' && dictation.speaking && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-ping" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Scrollable page. The smooth caret is positioned inside this box. */}
      <div
        ref={scrollRef}
        className={`mn-editor-scroll flex-1 min-h-0 overflow-y-auto relative ${isMobileChrome ? 'is-mobile' : ''} ${
          spellcheckActive ? '' : 'spellcheck-off'
        }`}
        style={pageStyle}
        onMouseDown={onPageMouseDown}
      >
        <div className="mn-page">
          <EditorContent editor={editor} />
        </div>

        <SmoothCaret editor={editor ?? null} scrollRef={scrollRef} enabled={smoothCaret} />

        {editor && grammarError && spellcheckActive && (
          <div
            className="grammar-popover bg-popover text-popover-foreground border border-border/45 shadow-2xl rounded-xl p-4 flex flex-col gap-3 max-w-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
            style={{ position: 'fixed', top: grammarError.coords.top, left: grammarError.coords.left, zIndex: 9999 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="text-xs font-medium text-foreground/90 leading-relaxed">{grammarError.match.message}</span>
            {grammarError.match.replacements.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {grammarError.match.replacements.slice(0, 5).map((rep, idx) => (
                  <button
                    key={idx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyGrammarFix(rep.value);
                    }}
                    className="bg-primary/10 border border-primary/20 hover:bg-primary hover:text-primary-foreground text-primary font-semibold text-xs px-2.5 py-1 rounded-md cursor-pointer transition-all duration-200"
                  >
                    {rep.value}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs italic text-muted-foreground/60">No quick fixes available.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Editor;
