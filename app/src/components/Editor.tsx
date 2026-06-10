import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useState } from 'react';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import listIcon1 from '../assets/microphone.png';
import { LinguisticCheck, getActiveGrammarError } from './LinguisticCheck';

interface CaretCoords {
  top: number;
  left: number;
  height: number;
  visible: boolean;
}

interface EditorProps {
  projectId: string;
  document: Document | null;
  autoSaveEnabled: boolean;
  onChangeAutoSave: (enabled: boolean) => void;
  manualSaveRequested: number;
  onSaveSuccess: (lastSaved: string) => void;
  onContentDirty: () => void;
  onUpdateDocumentContent: (updatedText: string) => void;
  onEditorReady: (editor: any) => void;
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
}

function Editor({
  document: doc,
  manualSaveRequested,
  onSaveSuccess,
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
}: EditorProps) {
  const [grammarError, setGrammarError] = useState<any>(null);
  const [caretCoords, setCaretCoords] = useState<CaretCoords>({ top: 0, left: 0, height: 20, visible: false });

  const updateCaret = (editorInstance: any) => {
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
            
            // NESTED INDENTATION HOOKS: Wire up structural tab actions directly with the active schema chain
            'Tab': () => {
              if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) {
                return this.editor.commands.sinkListItem('listItem');
              }
              return false; // Let standard layout tabs function outside of list states
            },
            'Shift-Tab': () => {
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
      LinguisticCheck,
    ],
    content: doc?.content || '<h2></h2><p></p>',
    editorProps: {
      attributes: {
        spellcheck: spellcheckActive ? 'true' : 'false',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateDocumentContent(editor.getHTML());
      updateCaret(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      updateCaret(editor);
      const errorData = getActiveGrammarError(editor);
      
      if (errorData) {
        try{
          const coords = editor.view.coordsAtPos(errorData.from);
        
          setGrammarError({
            ...errorData,
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
            focus: (view) => { updateCaret({ state: view.state, view }); return false; },
            blur: () => { setCaretCoords(prev => ({ ...prev, visible: false })); return false; },
          }
        },
      });
    }
  }, [editor, spellcheckActive]);

  useEffect(() => {
    if (editor) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && doc) {
      // OPTIMIZATION: Only update content if the editor isn't focused or the ID changed.
      const targetContent = doc.content || '<h2></h2><p></p>';
      const currentContent = editor.getHTML();
      
      if (currentContent !== targetContent && !editor.isFocused) {
        editor.commands.setContent(targetContent, { emitUpdate: false });
      }
    }
  }, [doc?.id, editor]); 

  useEffect(() => {
    if (manualSaveRequested > 0 && editor) {
      onSaveSuccess(new Date().toLocaleTimeString());
    }
  }, [manualSaveRequested, editor, onSaveSuccess]);

  const applyGrammarFix = (replacement: string) => {
    if (!grammarError || !editor) return;
    
    editor
      .chain()
      .focus()
      // Replaces the specific range of the error with the new suggestion
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
      <div className="editor-workspace" style={{ overflowY: 'auto' }}>
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span>⚙️ Settings Preferences Configuration</span>
          </div>
        </div>
        
        <div className="settings-tab-workspace">
          <h2 className="settings-pane-title">Global IDE Settings</h2>
          
          <div className="settings-grid-layout">
            <div className="settings-card-block" style={{ borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
              <h3>Workspace Color Scheme Theme Profile</h3>
              <select 
                className="sidebar-select" 
                value={theme} 
                onChange={(e) => setTheme(e.target.value as ThemeType)}
              >
                <option value="dark">Midnight Dark (Technical)</option>
                <option value="light">Parchment Light (High Contrast)</option>
                <option value="glass">Nebula Glass (Translucent)</option>
                <option value="ocean">Deep Ocean (Calm Blue)</option>
                <option value="forest">Emerald Forest (Natural)</option>
                <option value="sunset">Crimson Sunset (Warm)</option>
              </select>
            </div>

            <div className="settings-card-block" style={{ borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
              <h3>Typography Layout Tuning</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label>Line Height Index Ratio ({lineHeight})</label>
                <input 
                  type="range" min="1" max="2" step="0.1" 
                  value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} 
                />
                <label>Workspace Structural Horizontal Margin Padding ({editorPadding}px)</label>
                <input 
                  type="range" min="10" max="100" step="5" 
                  value={editorPadding} onChange={(e) => setEditorPadding(parseInt(e.target.value))} 
                />
              </div>
            </div>

            <div className="settings-card-block" style={{ borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
              <h3>Background Automated Engine Loop</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={spellcheckActive} onChange={(e) => setSpellcheckActive(e.target.checked)} />
                  <span>Activate Realtime Spellcheck Highlighting Rules</span>
                </label>
                <label>Storage Flushing Sync Sequence Delays</label>
                <select className="sidebar-select" value={autoSaveInterval} onChange={(e) => setAutoSaveInterval(parseInt(e.target.value))}>
                  <option value={15}>15 Seconds Window Execution</option>
                  <option value={30}>30 Seconds Window Execution</option>
                  <option value={60}>60 Seconds Window Execution</option>
                </select>
              </div>
            </div>

            <div className="settings-card-block" style={{ borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
              <h3>Repository Default Registration File Path Location</h3>
              <input 
                type="text" className="settings-input-text" 
                value={defaultSavePath} onChange={(e) => setDefaultSavePath(e.target.value)} 
              />
            </div>
          </div>
          
          <div style={{ marginTop: '20px' }}>
            <button className="settings-done-btn" onClick={onCloseSettings}>
              Commit Persistent Changes & Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-workspace" onClick={handleWrapperAreaClick}>
      {doc && (
        <div className="editor-tab-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="editor-tab active">
            <span className="tab-icon">📄</span>
            <span className="tab-title">{doc.title}</span>
          </div>
          <div className="editor-actions active">
            <button className="editor-action speechtotext-btn" title="Speech-to-Text Dictation (Experimental)" onClick={() => alert('Speech-to-Text Dictation feature is currently in development. Stay tuned for updates!')}>
              <img src={listIcon1} alt="Speech-to-Text" style={{ width: '16px' }} />
            </button>  
          </div>
        </div>
      )}

      <div 
        className="editor-body-scroll-container"
        style={{
          fontFamily: editorFont,
          fontSize: `${editorSize}px`,
          lineHeight: lineHeight,
          paddingLeft: `${editorPadding}px`,
          paddingRight: `${editorPadding}px`,
          transition: 'padding 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), font-size 0.2s ease',
          scrollBehavior: 'smooth',
        }}
      >
        <EditorContent editor={editor} />
        
        {/* Native MS Word Style Smooth Caret */}
        {editor && caretCoords.visible && (
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

        {/* Native React Popover Menu */}
        {editor && grammarError && spellcheckActive && (
          <div 
            className="grammar-popover"
            style={{
              position: 'fixed',
              top: `${grammarError.coords.top}px`,
              left: `${grammarError.coords.left}px`,
              zIndex: 9999,
              background: theme === 'light' ? '#ffffff' : '#1e1e1e',
              border: `1px solid ${theme === 'light' ? '#e5e7eb' : '#333'}`,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxWidth: '320px',
              // Prevent the menu from disappearing if the user clicks inside it
              pointerEvents: 'auto', 
            }}
            // Stop clicks inside the menu from unfocusing the editor
            onMouseDown={(e) => e.preventDefault()} 
          >
            {/* The Error Reason */}
            <span style={{ fontSize: '0.85rem', color: theme === 'light' ? '#4b5563' : '#a1a1aa', lineHeight: '1.4', fontWeight: '500' }}>
              {grammarError.match.message}
            </span>
            
            {/* The Suggestion Buttons */}
            {grammarError.match.replacements.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {grammarError.match.replacements.slice(0, 5).map((rep: any, idx: number) => (
                  <button
                    key={idx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyGrammarFix(rep.value);
                    }}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#3b82f6',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#3b82f6';
                      e.currentTarget.style.color = '#ffffff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.color = '#3b82f6';
                    }}
                  >
                    {rep.value}
                  </button>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', fontStyle: 'italic', color: '#9ca3af' }}>No quick fixes available.</span>
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
              '#e0e0e0'
            };
          }

          .ProseMirror ::selection {
            background-color: var(--selection-color) !important;
          }

          .ProseMirror {
            color: var(--editor-text-color);
            caret-color: transparent !important;
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
          
          /* Visual color depth indicators for nested bullet levels */
          .ProseMirror ul li { color: inherit; }
          .ProseMirror ul ul li { color: #58a6ff; }     /* Level 2 nested: Blue */
          .ProseMirror ul ul ul li { color: #7ee787; }  /* Level 3 nested: Green */
          
          /* Ensure child levels maintain standard numeric progression styles */
          .ProseMirror ol {
            list-style-type: decimal;
          }
          .ProseMirror ol ol {
            list-style-type: lower-alpha; /* Changes nested numbers to a/b/c style for visibility */
          }
          .ProseMirror ol ol ol {
            list-style-type: lower-roman; /* Level 3 nested: i/ii/iii style */
          }
          
          .ProseMirror p {
            margin-bottom: 1.25em;
            tab-size: 4;
            transition: all 0.2s ease;
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