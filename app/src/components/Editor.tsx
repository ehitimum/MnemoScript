import { useEditor, EditorContent, Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  onStatsUpdate: (words: number, chars: number) => void;
  isEditingSettings: boolean;
  onCloseSettings: () => void;
  // Sizing & typography settings
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
  // Modifiable app configuration
  lineHeight: number;
  setLineHeight: (lh: number) => void;
  editorPadding: number;
  setEditorPadding: (pad: number) => void;
  autoSaveInterval: number;
  setAutoSaveInterval: (sec: number) => void;
  spellcheckActive: boolean;
  setSpellcheckActive: (active: boolean) => void;
  theme: 'dark' | 'light' | 'glass';
  setTheme: (theme: 'dark' | 'light' | 'glass') => void;
}

function Editor({
  projectId,
  document,
  autoSaveEnabled,
  onChangeAutoSave,
  manualSaveRequested,
  onSaveSuccess,
  onContentDirty,
  onEditorReady,
  onStatsUpdate,
  isEditingSettings,
  onCloseSettings,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
  lineHeight,
  setLineHeight,
  editorPadding,
  setEditorPadding,
  autoSaveInterval,
  setAutoSaveInterval,
  spellcheckActive,
  setSpellcheckActive,
  theme,
  setTheme,
}: EditorProps) {
  const isDirtyRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Heading.configure({ levels: [1, 2, 3] }),
      Bold,
      Italic,
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: document?.content || '',
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;
      const chars = text.length;

      onStatsUpdate(words, chars);

      if (!isDirtyRef.current) {
        isDirtyRef.current = true;
        onContentDirty();
      }
    },
  });

  // Expose editor ready event
  useEffect(() => {
    if (editor) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Load new document content when active document changes
  useEffect(() => {
    if (editor && document) {
      editor.commands.setContent(document.content);
      
      const text = editor.getText();
      const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;
      const chars = text.length;
      
      onStatsUpdate(words, chars);
      isDirtyRef.current = false;
    }
  }, [document?.id, editor]);

  // Save implementation
  const saveDocument = useCallback(async () => {
    if (!editor || !document) return;
    const content = editor.getHTML();
    const updatedDoc: Document = {
      ...document,
      content,
      updated_at: new Date().toISOString(),
    };
    try {
      const response = await invoke<{ success: boolean; error?: string }>('save_document', {
        projectId,
        document: updatedDoc,
      });
      if (response.success) {
        isDirtyRef.current = false;
        const savedTime = new Date().toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        onSaveSuccess(savedTime);
      } else {
        console.error('Failed to save document:', response.error);
      }
    } catch (error) {
      console.error('Error saving document:', error);
    }
  }, [editor, projectId, document, onSaveSuccess]);

  // React to manual save triggers from parent
  useEffect(() => {
    if (manualSaveRequested > 0) {
      saveDocument();
    }
  }, [manualSaveRequested, saveDocument]);

  // Auto-save logic
  useEffect(() => {
    if (!autoSaveEnabled || !editor) return;

    const interval = setInterval(() => {
      if (isDirtyRef.current) {
        saveDocument();
      }
    }, autoSaveInterval * 1000);

    return () => clearInterval(interval);
  }, [autoSaveEnabled, editor, saveDocument, autoSaveInterval]);

  // Handle keyboard shortcut Ctrl+S
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDocument();
    }
  };

  if (isEditingSettings) {
    return (
      <div className="editor-workspace">
        {/* Settings Tab Header */}
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span className="tab-icon">⚙️</span>
            <span className="tab-title">Settings</span>
            <button className="tab-close-btn" onClick={onCloseSettings} title="Close Settings Tab">
              &times;
            </button>
          </div>
        </div>

        {/* Visual Settings Workspace */}
        <div className="settings-tab-workspace">
          <div className="settings-header">
            <h2>⚙️ Preferences: App Settings</h2>
            <p className="settings-subtext">Configure editor behaviors, typography customizers, and save operations.</p>
          </div>

          <div className="settings-body-grid">
            {/* Visual Interface Section */}
            <div className="settings-card-group">
              <h3>🎨 Workspace Appearance</h3>
              
              <div className="settings-field">
                <label>Active Theme</label>
                <div className="theme-pills-row">
                  <button 
                    className={`theme-pill-select dark ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    Midnight Dark
                  </button>
                  <button 
                    className={`theme-pill-select light ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    Parchment Light
                  </button>
                  <button 
                    className={`theme-pill-select glass ${theme === 'glass' ? 'active' : ''}`}
                    onClick={() => setTheme('glass')}
                  >
                    Nebula Glass
                  </button>
                </div>
              </div>
            </div>

            {/* Typography Configuration */}
            <div className="settings-card-group">
              <h3>✍️ Custom Typography</h3>

              <div className="settings-field">
                <label>Font Family</label>
                <select
                  value={editorFont}
                  onChange={(e) => setEditorFont(e.target.value)}
                  className="settings-input-control"
                >
                  <option value="Outfit">Outfit (Geometric & Sans-Serif)</option>
                  <option value="Inter">Inter (Technical & Clean)</option>
                  <option value="Georgia">Georgia (Classic Literary Serif)</option>
                  <option value="Courier New">Courier New (Typewriter Monospace)</option>
                </select>
              </div>

              <div className="settings-field">
                <label>Font Size ({editorSize}px)</label>
                <input
                  type="range"
                  min="12"
                  max="28"
                  value={editorSize}
                  onChange={(e) => setEditorSize(Number(e.target.value))}
                  className="settings-slider-control"
                />
              </div>

              <div className="settings-field">
                <label>Line Height ({lineHeight})</label>
                <select
                  value={lineHeight}
                  onChange={(e) => setLineHeight(Number(e.target.value))}
                  className="settings-input-control"
                >
                  <option value="1.4">1.4 (Compact)</option>
                  <option value="1.6">1.6 (Standard)</option>
                  <option value="1.8">1.8 (Spacious)</option>
                  <option value="2.0">2.0 (Double)</option>
                </select>
              </div>

              <div className="settings-field">
                <label>Editor Side Padding ({editorPadding}px)</label>
                <input
                  type="range"
                  min="16"
                  max="80"
                  step="8"
                  value={editorPadding}
                  onChange={(e) => setEditorPadding(Number(e.target.value))}
                  className="settings-slider-control"
                />
              </div>
            </div>

            {/* Automations and Syncing */}
            <div className="settings-card-group">
              <h3>🤖 Automations & Helpers</h3>

              <div className="settings-field inline-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoSaveEnabled}
                    onChange={(e) => onChangeAutoSave(e.target.checked)}
                  />
                  <span>Enable Auto-Save Operations</span>
                </label>
              </div>

              {autoSaveEnabled && (
                <div className="settings-field">
                  <label>Auto-Save Frequency</label>
                  <select
                    value={autoSaveInterval}
                    onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                    className="settings-input-control"
                  >
                    <option value="10">Every 10 seconds</option>
                    <option value="30">Every 30 seconds</option>
                    <option value="60">Every 60 seconds</option>
                  </select>
                </div>
              )}

              <div className="settings-field inline-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={spellcheckActive}
                    onChange={(e) => setSpellcheckActive(e.target.checked)}
                  />
                  <span>Enable Spellcheck Highlights</span>
                </label>
              </div>
            </div>
          </div>
          
          <div className="settings-footer-actions">
            <button className="settings-done-btn" onClick={onCloseSettings}>
              Save and Exit Settings
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
    <div className="editor-workspace" onKeyDown={handleKeyDown}>
      {/* Editor Active Tab */}
      {document && (
        <div className="editor-tab-bar">
          <div className="editor-tab active">
            <span className="tab-icon">📄</span>
            <span className="tab-title">{document.title}</span>
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div 
        className="editor-body"
        style={{
          lineHeight: lineHeight,
          paddingLeft: `${editorPadding}px`,
          paddingRight: `${editorPadding}px`,
        }}
      >
        <EditorContent 
          editor={editor} 
          spellCheck={spellcheckActive}
        />
      </div>
    </div>
  );
}

export default Editor;