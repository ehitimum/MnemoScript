import { useEditor, EditorContent, Editor as TipTapEditor } from '@tiptap/react';
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
  onEditorReady: (editor: TipTapEditor) => void;
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
        heading: false,
        bold: false,
        italic: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Heading.configure({ levels: [1, 2, 3] }),
      Bold,
      Italic,
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: doc ? doc.content : '',
  });

  useEffect(() => {
    if (editor) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && doc) {
      if (editor.getText() !== doc.content) {
        editor.commands.setContent(doc.content);
      }
    }
  }, [doc, editor]);

  useEffect(() => {
    if (manualSaveRequested > 0 && editor) {
      onSaveSuccess(new Date().toLocaleTimeString());
    }
  }, [manualSaveRequested, editor, onSaveSuccess]);

  if (isEditingSettings) {
    return (
      <div className="editor-workspace" style={{ overflowY: 'auto' }}>
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span>⚙️ Settings Configuration Workspace</span>
          </div>
        </div>
        
        <div className="settings-tab-workspace">
          <h2 className="settings-pane-title">Global Workspace Settings</h2>
          
          <div className="settings-grid-layout">
            <div className="settings-card-block">
              <h3>Theme Profile</h3>
              <select 
                className="sidebar-select" 
                value={theme} 
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTheme(e.target.value as 'dark' | 'light' | 'glass')}
              >
                <option value="dark">Midnight Dark</option>
                <option value="light">Parchment Light</option>
                <option value="glass">Nebula Glass</option>
              </select>
            </div>

            <div className="settings-card-block">
              <h3>Typography Core</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label>Line Height Scaling</label>
                <input 
                  type="range" min="1" max="2" step="0.1" 
                  value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} 
                />
                <label>Workspace Horizontal Padding (px)</label>
                <input 
                  type="range" min="10" max="100" step="5" 
                  value={editorPadding} onChange={(e) => setEditorPadding(parseInt(e.target.value))} 
                />
              </div>
            </div>

            <div className="settings-card-block">
              <h3>Automations & Sync</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={spellcheckActive} onChange={(e) => setSpellcheckActive(e.target.checked)} />
                  <span>Enable Real-time Spellcheck Highlights</span>
                </label>
                <label>Sync Engine Save Delay Sequence</label>
                <select className="sidebar-select" value={autoSaveInterval} onChange={(e) => setAutoSaveInterval(parseInt(e.target.value))}>
                  <option value={15}>15 Seconds Cycle</option>
                  <option value={30}>30 Seconds Cycle</option>
                  <option value={60}>60 Seconds Cycle</option>
                </select>
              </div>
            </div>

            <div className="settings-card-block">
              <h3>Platform Paths</h3>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px' }}>Default Save Path Target Location</label>
              <input 
                type="text" className="settings-input-text" 
                value={defaultSavePath} onChange={(e) => setDefaultSavePath(e.target.value)} 
              />
            </div>
          </div>
          
          <div style={{ marginTop: '20px' }}>
            <button className="settings-done-btn" onClick={onCloseSettings}>
              Accept Changes & Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!editor) {
    return <div className="editor-loading">Loading rich text workspace...</div>;
  }

  return (
    <div className="editor-workspace">
      {doc && (
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span className="tab-icon">📄</span>
            <span className="tab-title">{doc.title}</span>
          </div>
        </div>
      )}

      <div 
        className="editor-body"
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