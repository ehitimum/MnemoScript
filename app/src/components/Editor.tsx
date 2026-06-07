import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import listIcon1 from '../assets/microphone.png';

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
  
  const editor = useEditor({
    extensions: [
      // FIX: Leave default extensions unblocked so their internal schema rules interconnect seamlessly
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
    ],
    content: doc?.content || '<h2></h2><p></p>',
    editorProps: {
      attributes: {
        spellcheck: spellcheckActive ? 'true' : 'false',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateDocumentContent(editor.getHTML());
    }
  });

  // Reactive sync for spellcheck attribute on the editable DOM element
  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: {
          attributes: {
            spellcheck: spellcheckActive ? 'true' : 'false',
          },
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
      const targetContent = doc.content || '<h2></h2><p></p>';
      if (editor.getHTML() !== targetContent) {
        editor.commands.setContent(targetContent, { emitUpdate: false });
      }
    }
  }, [doc, editor]);

  useEffect(() => {
    if (manualSaveRequested > 0 && editor) {
      onSaveSuccess(new Date().toLocaleTimeString());
    }
  }, [manualSaveRequested, editor, onSaveSuccess]);

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
        }}
      >
        <EditorContent editor={editor} />
        
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
            caret-color: var(--editor-text-color);
            outline: none;
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
            tab-size: 4px;
          }
          
          .ProseMirror blockquote {
            border-left: 3px solid rgba(255,255,255,0.1);
            padding-left: 1rem;
          }
        `}</style>
      </div>
    </div>
  );
}

export default Editor;