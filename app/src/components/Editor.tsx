import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import type { Level } from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Document } from '../types';

function Editor({ projectId, document }: { projectId: string; document: Document }) {
  const [wordCount, setWordCount] = useState(0);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

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
    content: document.content,
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const words = text.trim().split(/\s+/).filter(word => word.length > 0);
      setWordCount(words.length);
    },
  });

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!autoSaveEnabled || !editor) return;

    const interval = setInterval(() => {
      saveDocument();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoSaveEnabled, editor]);

  const saveDocument = async () => {
    if (!editor) return;
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
        setLastSaved(new Date().toLocaleTimeString());
      } else {
        console.error('Failed to save document:', response.error);
      }
    } catch (error) {
      console.error('Error saving document:', error);
    }
  };

  const handleBold = () => editor?.chain().focus().toggleBold().run();
  const handleItalic = () => editor?.chain().focus().toggleItalic().run();
  const handleHeading = (level: Level) => editor?.chain().focus().toggleHeading({ level }).run();
  const handleBulletList = () => editor?.chain().focus().toggleBulletList().run();
  const handleOrderedList = () => editor?.chain().focus().toggleOrderedList().run();

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className="editor">
      <div className="toolbar">
        <button onClick={handleBold} className={editor.isActive('bold') ? 'active' : ''}>
          Bold
        </button>
        <button onClick={handleItalic} className={editor.isActive('italic') ? 'active' : ''}>
          Italic
        </button>
        <button onClick={() => handleHeading(1)} className={editor.isActive('heading', { level: 1 }) ? 'active' : ''}>
          H1
        </button>
        <button onClick={() => handleHeading(2)} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}>
          H2
        </button>
        <button onClick={() => handleHeading(3)} className={editor.isActive('heading', { level: 3 }) ? 'active' : ''}>
          H3
        </button>
        <button onClick={handleBulletList} className={editor.isActive('bulletList') ? 'active' : ''}>
          Bullet List
        </button>
        <button onClick={handleOrderedList} className={editor.isActive('orderedList') ? 'active' : ''}>
          Numbered List
        </button>
        <button onClick={saveDocument}>Save Now</button>
        <label>
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(e) => setAutoSaveEnabled(e.target.checked)}
          />
          Auto-save (30s)
        </label>
      </div>
      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
      <div className="status-bar">
        <span>Words: {wordCount}</span>
        {lastSaved && <span>Last saved: {lastSaved}</span>}
      </div>
    </div>
  );
}

export default Editor;