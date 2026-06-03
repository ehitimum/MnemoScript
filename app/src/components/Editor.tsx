import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { useEffect } from 'react';
import type { Document } from '../types';

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
  theme: 'dark' | 'light' | 'glass';
  setTheme: (theme: 'dark' | 'light' | 'glass') => void;
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
      StarterKit.configure({
        heading: false, bold: false, italic: false,
        bulletList: false, orderedList: false, listItem: false,
      }),
      Heading.configure({ levels: [1, 2, 3] }),
      Bold, Italic, BulletList, OrderedList, ListItem,
    ],
    content: doc ? doc.content : '',
    onUpdate: ({ editor }) => {
      // Direct notification hook down directly to root state array sequence
      onUpdateDocumentContent(editor.getHTML());
    }
  });

  useEffect(() => {
    if (editor) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && doc) {
      if (editor.getHTML() !== doc.content) {
        editor.commands.setContent(doc.content, { emitUpdate: false });
      }
    }
  }, [doc, editor]);

  useEffect(() => {
    if (manualSaveRequested > 0 && editor) {
      onSaveSuccess(new Date().toLocaleTimeString());
    }
  }, [manualSaveRequested, editor, onSaveSuccess]);

  // Click handler forwarding to trigger focus mapping directly at historical character nodes
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
            <div className="settings-card-block">
              <h3>Workspace Color Scheme Theme Profile</h3>
              <select 
                className="sidebar-select" 
                value={theme} 
                onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'glass')}
              >
                <option value="dark">Midnight Dark (Technical)</option>
                <option value="light">Parchment Light (High Contrast)</option>
                <option value="glass">Nebula Glass (Translucent)</option>
              </select>
            </div>

            <div className="settings-card-block">
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

            <div className="settings-card-block">
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

            <div className="settings-card-block">
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
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span className="tab-icon">⚙️</span>
            <span className="tab-title">{doc.title}</span>
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
        <EditorContent editor={editor} spellCheck={spellcheckActive} />
      </div>
    </div>
  );
}

export default Editor;