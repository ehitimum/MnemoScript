import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useEffect, useState } from 'react';
import type { Editor as CoreEditor, Range } from '@tiptap/core';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Volume2, Square, Mic, MicOff } from 'lucide-react';
import { LinguisticCheck, getActiveGrammarError } from './LinguisticCheck';
import { ReadAloudHighlight } from './extensions/ReadAloudHighlight';
import { SlashCommand } from './extensions/SlashCommand';
import { ImageWithAsset } from './extensions/ImageWithAsset';
import { api } from '../lib/api';
import { useReadAloud } from '../lib/speech/useReadAloud';
import { useDictation } from '../lib/speech/useDictation';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { LTMatch } from './grammar-service';

interface CaretCoords {
  top: number;
  left: number;
  height: number;
  visible: boolean;
}

interface GrammarErrorData {
  match: LTMatch;
  from: number;
  to: number;
  coords: {
    top: number;
    left: number;
  };
}

interface EditorProps {
  projectId: string;
  document: Document | null;
  onUpdateDocumentContent: (updatedText: string) => void;
  onEditorReady: (editor: TiptapEditor) => void;
  isEditingSettings: boolean;
  onCloseSettings: () => void;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
  lineHeight: number;
  setLineHeight: (lh: number) => void;
  editorPadding: number;
  setEditorPadding: (pad: number) => void;
  spellcheckActive: boolean;
  setSpellcheckActive: (active: boolean) => void;
  autoSaveInterval: number;
  setAutoSaveInterval: (interval: number) => void;
  defaultSavePath: string;
  setDefaultSavePath: (path: string) => void;
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  /** 'mobile' hides the desktop toolbar and uses the native caret; the mobile
   *  shell provides its own chrome. Defaults to 'desktop'. */
  chrome?: 'desktop' | 'mobile';
}

function Editor({
  projectId,
  document: doc,
  onEditorReady,
  onUpdateDocumentContent,
  isEditingSettings,
  onCloseSettings,
  editorFont,
  editorSize,
  lineHeight,
  setLineHeight,
  editorPadding,
  setEditorPadding,
  spellcheckActive,
  setSpellcheckActive,
  autoSaveInterval,
  setAutoSaveInterval,
  defaultSavePath,
  setDefaultSavePath,
  theme,
  setTheme,
  chrome = 'desktop',
}: EditorProps) {
  const isMobileChrome = chrome === 'mobile';
  const [grammarError, setGrammarError] = useState<GrammarErrorData | null>(null);
  const [caretCoords, setCaretCoords] = useState<CaretCoords>({ top: 0, left: 0, height: 20, visible: false });
  const isMobile = useMediaQuery('(max-width: 768px)');

  // "/image": remove the slash text, open the native picker, then embed the file.
  // `projectId` is stable for the editor's lifetime (switching projects unmounts
  // the editor), so capturing it directly here is safe.
  const handleSlashImage = async (ed: CoreEditor, range: Range) => {
    ed.chain().focus().deleteRange(range).run();
    try {
      const path = await api.importImage(projectId);
      if (path) {
        ed.chain().focus().setImage({ src: path }).run();
      }
    } catch (e) {
      console.error('Image import failed:', e);
    }
  };

  const updateCaret = (editorInstance: TiptapEditor) => {
    // Mobile uses the native caret, so skip the custom-caret state updates
    // entirely — they fire on every keystroke/selection and hurt typing latency.
    if (isMobileChrome) return;
    try {
      const { state, view } = editorInstance;
      const { selection } = state;
      if (selection.empty && view.hasFocus()) {
        const coords = view.coordsAtPos(selection.head);
        setCaretCoords({
          top: coords.top,
          left: coords.left,
          height: coords.bottom - coords.top,
          visible: true
        });
      } else {
        setCaretCoords(prev => ({ ...prev, visible: false }));
      }
    } catch {
       setCaretCoords(prev => ({ ...prev, visible: false }));
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }).extend({
        addKeyboardShortcuts() {
          return {
            'Mod-1': () => this.editor.commands.toggleHeading({ level: 1 }),
            'Mod-2': () => this.editor.commands.toggleHeading({ level: 2 }),
            'Mod-3': () => this.editor.commands.toggleHeading({ level: 3 }),
            
            'Tab': () => {
              if (this.editor.isActive('taskList')) {
                return this.editor.commands.sinkListItem('taskItem');
              }
              if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) {
                return this.editor.commands.sinkListItem('listItem');
              }
              return false;
            },
            'Shift-Tab': () => {
              if (this.editor.isActive('taskList')) {
                return this.editor.commands.liftListItem('taskItem');
              }
              if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) {
                return this.editor.commands.liftListItem('listItem');
              }
              return false;
            },
          };
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading' && node.attrs.level === 2) {
            return 'Title...';
          }
          return '';
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      // "/todo" task lists — classic checkbox to-do items. Nestable so tasks can
      // have sub-tasks; serialised to HTML in `Document.content` like every other
      // block, so they persist through the normal save path.
      TaskList,
      TaskItem.configure({ nested: true }),
      LinguisticCheck,
      // Karaoke highlight for Read-Aloud (TTS). Driven imperatively by ttsController.
      ReadAloudHighlight,
      ImageWithAsset,
      SlashCommand.configure({ onImage: handleSlashImage }),
    ],
    content: doc?.content || '<h2></h2><p></p>',
    editorProps: {
      attributes: {
        spellcheck: spellcheckActive ? 'true' : 'false',
      },
    },
    onUpdate: ({ editor: ed }) => {
      onUpdateDocumentContent(ed.getHTML());
      updateCaret(ed as TiptapEditor);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      updateCaret(ed as TiptapEditor);
      const errorData = getActiveGrammarError(ed);
      
      if (errorData) {
        try {
          const coords = ed.view.coordsAtPos(errorData.from);
          setGrammarError({
            match: errorData.match,
            from: errorData.from,
            to: errorData.to,
            coords: {
              top: coords.bottom + 5, 
              left: coords.left,
            }
          });
        } catch {
          setGrammarError(null);
        }
      } else {
        setGrammarError(null);
      }
    }
  });

  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: {
          attributes: {
            spellcheck: spellcheckActive ? 'true' : 'false',
          },
          handleDOMEvents: {
            focus: (view) => { updateCaret({ state: view.state, view } as TiptapEditor); return false; },
            blur: () => { setCaretCoords(prev => ({ ...prev, visible: false })); return false; },
          }
        },
      });
    }
  }, [editor, spellcheckActive]);

  // Read-Aloud (TTS). The toolbar button is a quick play/stop toggle; full
  // controls (voice, speed, pause) live in the RightSidebar.
  const readAloud = useReadAloud(editor ?? null);

  // Voice-to-Text dictation. Toolbar mic toggles capture; the denoise toggle +
  // model-load progress live in the RightSidebar.
  const dictation = useDictation(editor ?? null);

  useEffect(() => {
    if (editor) {
      onEditorReady(editor as TiptapEditor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && doc) {
      const targetContent = doc.content || '<h2></h2><p></p>';
      const currentContent = editor.getHTML();
      
      if (currentContent !== targetContent && !editor.isFocused) {
        editor.commands.setContent(targetContent, { emitUpdate: false });
      }
    }
  }, [doc, editor]); 

  const applyGrammarFix = (replacement: string) => {
    if (!grammarError || !editor) return;
    
    editor
      .chain()
      .focus()
      .insertContentAt({ from: grammarError.from, to: grammarError.to }, replacement) 
      .run();
  };
  
  const handleWrapperAreaClick = () => {
    if (editor && !editor.isFocused) {
      editor.commands.focus();
    }
  };

  if (isEditingSettings) {
    return (
      <div className="flex-1 flex flex-col bg-background overflow-y-auto">
        {/* Settings Tab Bar */}
        <div className="h-10 bg-secondary/25 border-b border-border/30 flex">
          <div className="flex items-center px-4 gap-2 text-xs font-semibold text-foreground bg-background border-t-2 border-primary border-r border-border/20 select-none">
            <span>⚙️ Settings</span>
          </div>
        </div>
        
        {/* Settings Workspace Grid */}
        <div className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10 flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
            <p className="text-xs text-muted-foreground">Theme, typography, auto-save, and where your work is stored.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Theme Card */}
            <div className="bg-secondary/10 border border-border/30 rounded-xl p-5 shadow-xs flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-primary">Theme</h3>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">Choose your color theme</label>
                <select 
                  className="w-full bg-secondary/40 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all duration-200" 
                  value={theme} 
                  onChange={(e) => setTheme(e.target.value as ThemeType)}
                >
                  <option value="dark">Midnight — slate & periwinkle</option>
                  <option value="light">Parchment — warm paper</option>
                  <option value="glass">Nebula — deep violet</option>
                  <option value="ocean">Ocean — deep blue</option>
                  <option value="forest">Forest — emerald pine</option>
                  <option value="sunset">Sunset — warm coral</option>
                </select>
              </div>
            </div>

            {/* Typography Tuning Card */}
            <div className="bg-secondary/10 border border-border/30 rounded-xl p-5 shadow-xs flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-primary">Typography Tuning</h3>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <label>Line Height Index</label>
                    <span className="font-mono text-primary font-medium">{lineHeight}</span>
                  </div>
                  <input 
                    type="range" min="1" max="2" step="0.1" 
                    className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
                    value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} 
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <label>Horizontal Margin Padding</label>
                    <span className="font-mono text-primary font-medium">{editorPadding}px</span>
                  </div>
                  <input 
                    type="range" min="10" max="100" step="5" 
                    className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
                    value={editorPadding} onChange={(e) => setEditorPadding(parseInt(e.target.value))} 
                  />
                </div>
              </div>
            </div>

            {/* Background Automated Loop Card */}
            <div className="bg-secondary/10 border border-border/30 rounded-xl p-5 shadow-xs flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-primary">Auto-save & Spellcheck</h3>
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer group">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                    checked={spellcheckActive}
                    onChange={(e) => setSpellcheckActive(e.target.checked)}
                  />
                  <span className="group-hover:text-primary transition-colors">Highlight spelling &amp; grammar</span>
                </label>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">Auto-save interval</label>
                  <select 
                    className="w-full bg-secondary/40 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all duration-200" 
                    value={autoSaveInterval} 
                    onChange={(e) => setAutoSaveInterval(parseInt(e.target.value))}
                  >
                    <option value={15}>15 Seconds</option>
                    <option value={30}>30 Seconds</option>
                    <option value={60}>60 Seconds</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Save Location Path Card — desktop only; mobile storage is app-private. */}
            {!isMobile && (
              <div className="bg-secondary/10 border border-border/30 rounded-xl p-5 shadow-xs flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-primary">Default Save Folder</h3>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">Where new projects are saved</label>
                  <input
                    type="text"
                    className="w-full bg-secondary/40 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50 transition-all duration-200"
                    value={defaultSavePath} onChange={(e) => setDefaultSavePath(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          
          <div className="mt-4 flex justify-end">
            <button 
              className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-lg shadow-sm hover:opacity-90 hover:shadow-md active:scale-98 cursor-pointer transition-all duration-200 text-sm" 
              onClick={onCloseSettings}
            >
              Save Changes & Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative" onClick={handleWrapperAreaClick}>
      {doc && !isMobileChrome && (
        <div className="h-10 bg-secondary/20 border-b border-border/30 flex justify-between items-center px-4 select-none">
          <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-foreground bg-background border-t-2 border-primary border-r border-border/20">
            <span className="opacity-80">📄</span>
            <span className="truncate">{doc.title}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Read Aloud (TTS) quick toggle. Disabled when the WebView has no
                speechSynthesis. Active state pulses while speaking. */}
            <button
              className={`w-7 h-7 flex items-center justify-center rounded active:scale-95 transition-all duration-150 ${
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
              {readAloud.status === 'idle' ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <Square className="w-3.5 h-3.5 fill-current" />
              )}
            </button>

            {/* Voice-to-Text dictation toggle. Loading = model warmup;
                listening pulses; a red ring shows when speech is detected. */}
            <button
              className={`relative w-7 h-7 flex items-center justify-center rounded active:scale-95 transition-all duration-150 ${
                dictation.supported
                  ? 'cursor-pointer hover:bg-secondary/60 text-foreground/80 hover:text-primary'
                  : 'opacity-30 cursor-not-allowed'
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
              {dictation.status === 'listening' ? (
                <MicOff className="w-4 h-4 text-red-500" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
              {dictation.status === 'listening' && dictation.speaking && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-ping" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div 
        className="flex-1 overflow-y-auto pt-8 pb-16 outline-none transition-all duration-300"
        style={{
          fontFamily: editorFont,
          fontSize: `${editorSize}px`,
          lineHeight: lineHeight,
          paddingLeft: `${editorPadding}px`,
          paddingRight: `${editorPadding}px`,
          scrollBehavior: 'smooth',
        }}
      >
        <EditorContent editor={editor} />
        
        {/* smooth cursor caret — desktop only; mobile uses the native caret */}
        {editor && caretCoords.visible && !isMobileChrome && (
          <div
            className="smooth-caret"
            style={{
              position: 'fixed',
              top: `${caretCoords.top}px`,
              left: `${caretCoords.left}px`,
              height: `${caretCoords.height}px`,
              width: '2px',
              backgroundColor: 'var(--accent-color)',
              transition: 'all 0.08s cubic-bezier(0.2, 0, 0, 1)',
              pointerEvents: 'none',
              zIndex: 50,
              boxShadow: '0 0 4px var(--accent-color)'
            }}
          />
        )}

        {/* Spelling Popup Menu */}
        {editor && grammarError && spellcheckActive && (
          <div 
            className="grammar-popover bg-popover text-popover-foreground border border-border/45 shadow-2xl rounded-xl p-4 flex flex-col gap-3 max-w-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
            style={{
              position: 'fixed',
              top: `${grammarError.coords.top}px`,
              left: `${grammarError.coords.left}px`,
              zIndex: 9999,
              pointerEvents: 'auto', 
            }}
            onMouseDown={(e) => e.preventDefault()} 
          >
            <span className="text-xs font-medium text-foreground/90 leading-relaxed">
              {grammarError.match.message}
            </span>
            
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

        <style>{`
          :root {
            --selection-color: ${
              theme === 'light' ? '#add6ff' : 
              theme === 'sunset' ? '#ff8c00' :
              theme === 'forest' ? '#2d5a27' :
              'rgba(66, 153, 225, 0.4)'
            };
            --editor-text-color: ${
              theme === 'light' ? '#2c2c2c' : 
              theme === 'ocean' ? '#e1efff' :
              theme === 'forest' ? '#e6f4ea' :
              theme === 'sunset' ? '#fff1e6' :
              'var(--foreground)'
            };
          }

          .ProseMirror ::selection {
            background-color: var(--selection-color) !important;
          }

          .ProseMirror {
            color: var(--editor-text-color);
            caret-color: ${isMobileChrome ? 'var(--accent-color)' : 'transparent'} !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
            font-variant-ligatures: common-ligatures;
            font-feature-settings: "kern" 1, "ss01" 1, "ss02" 1, "cv01" 1;
            outline: none;
            transition: color 0.3s ease, padding 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
            letter-spacing: -0.01em;
            word-spacing: 0.05em;
          }

          .ProseMirror ul, .ProseMirror ol {
            margin-left: 4px !important;
            padding-left: 24px;
          }
          
          .ProseMirror ul li { color: inherit; }
          .ProseMirror ul ul li { color: #58a6ff; }
          .ProseMirror ul ul ul li { color: #7ee787; }
          
          .ProseMirror ol {
            list-style-type: decimal;
          }
          .ProseMirror ol ol {
            list-style-type: lower-alpha;
          }
          .ProseMirror ol ol ol {
            list-style-type: lower-roman;
          }

          /* ── /todo task lists ─────────────────────────────────────────── */
          .ProseMirror ul[data-type="taskList"] {
            list-style: none;
            margin-left: 0 !important;
            padding-left: 2px;
          }
          .ProseMirror ul[data-type="taskList"] li {
            display: flex;
            align-items: flex-start;
            gap: 0.65em;
            margin: 0.15em 0;
            color: inherit;
          }
          .ProseMirror ul[data-type="taskList"] li > label {
            flex: 0 0 auto;
            margin-top: 0.18em;
            user-select: none;
          }
          .ProseMirror ul[data-type="taskList"] li > div {
            flex: 1 1 auto;
            min-width: 0;
          }
          .ProseMirror ul[data-type="taskList"] li > div > p {
            margin-bottom: 0.3em;
            transition: opacity 0.18s ease;
          }
          /* Nested sub-tasks tuck in under their parent. */
          .ProseMirror ul[data-type="taskList"] ul[data-type="taskList"] {
            margin-top: 0.2em;
          }
          .ProseMirror ul[data-type="taskList"] input[type="checkbox"] {
            appearance: none;
            -webkit-appearance: none;
            width: 1.05em;
            height: 1.05em;
            margin: 0;
            border: 2px solid color-mix(in srgb, var(--primary) 60%, transparent);
            border-radius: 6px;
            background: transparent;
            cursor: pointer;
            position: relative;
            flex: 0 0 auto;
            transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
          }
          .ProseMirror ul[data-type="taskList"] input[type="checkbox"]:hover {
            border-color: var(--primary);
          }
          .ProseMirror ul[data-type="taskList"] input[type="checkbox"]:active {
            transform: scale(0.9);
          }
          .ProseMirror ul[data-type="taskList"] input[type="checkbox"]:checked {
            background: var(--primary);
            border-color: var(--primary);
          }
          .ProseMirror ul[data-type="taskList"] input[type="checkbox"]:checked::after {
            content: '';
            position: absolute;
            left: 0.32em;
            top: 0.12em;
            width: 0.28em;
            height: 0.55em;
            border: solid var(--primary-foreground);
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
          }
          /* Completed tasks fade and strike through. */
          .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div {
            text-decoration: line-through;
            opacity: 0.5;
          }

          /* ── Read-Aloud karaoke highlight ─────────────────────────────────
             Driven by the ReadAloudHighlight decoration plugin. The active
             sentence gets a soft wash; the active word (where the engine emits
             boundary events) gets a stronger box. */
          .ProseMirror .tts-sentence {
            background-color: color-mix(in srgb, var(--primary) 16%, transparent);
            border-radius: 3px;
            transition: background-color 0.2s ease;
          }
          .ProseMirror .tts-word {
            background-color: color-mix(in srgb, var(--primary) 42%, transparent);
            border-radius: 3px;
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 55%, transparent);
          }

          .ProseMirror p {
            margin-bottom: 1.25em;
            tab-size: 4;
            /* No transition here: animating all properties reflows on every
               keystroke as text changes, which makes typing feel laggy. */
          }
          
          .ProseMirror blockquote {
            border-left: 3px solid rgba(255,255,255,0.1);
            padding-left: 1rem;
          }

          .ProseMirror h2.is-empty::before {
            content: attr(data-placeholder);
            float: left;
            color: var(--editor-text-color);
            opacity: 0.3;
            pointer-events: none;
            height: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s ease;
            transform: translateY(0);
          }

          .ProseMirror h2.is-empty:focus::before {
            opacity: 0.15;
            transform: translateX(4px);
          }
          
          .lt-match.typo-match {
            display: ${spellcheckActive ? 'inline' : 'initial'};
            border-bottom-width: ${spellcheckActive ? '2px' : '0px'} !important;
            background-color: ${spellcheckActive ? 'var(--color-typo-bg)' : 'transparent'} !important;
            border-bottom-style: solid !important;
            border-bottom-color: var(--color-typo) !important;
            cursor: pointer !important;
          }
          
          .lt-match.grammar-match {
            display: ${spellcheckActive ? 'inline' : 'initial'};
            border-bottom-width: ${spellcheckActive ? '2px' : '0px'} !important;
            background-color: ${spellcheckActive ? 'var(--color-grammar-bg)' : 'transparent'} !important;
            border-bottom-style: solid !important;
            border-bottom-color: var(--color-grammar) !important;
            cursor: pointer !important;
          }

          @keyframes smooth-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
          .smooth-caret {
            animation: smooth-blink 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }

        `}</style>
      </div>
    </div>
  );
}

export default Editor;