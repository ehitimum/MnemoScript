import { useEffect, useState } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface RightSidebarProps {
  editor: TipTapEditor | null;
  isOpen: boolean;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
}

function RightSidebar({
  editor,
  isOpen,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
}: RightSidebarProps) {
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const updateStats = () => {
      const text = editor.getText();
      const words = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      setWordCount(words);
      setCharCount(text.length);
    };

    updateStats();
    editor.on('update', updateStats);
    return () => {
      editor.off('update', updateStats);
    };
  }, [editor]);

  if (!isOpen) return null;

  const isFormatActive = (type: string, attributes = {}) => {
    if (!editor) return false;
    return editor.isActive(type, attributes);
  };

  return (
    <aside className="text-controller-sidebar">
      <div className="right-sidebar-header">
        <span className="controller-header-title">TEXT & EDITOR CONTROLLER</span>
      </div>

      <div className="sidebar-section-body">
        <div className="control-group">
          <h4 className="sidebar-group-title">Typography</h4>
          
          <div className="control-field">
            <label>Font Size ({editorSize}px)</label>
            <div className="control-slider-row">
              <input 
                type="range" 
                min="12" 
                max="24" 
                value={editorSize} 
                onChange={(e) => setEditorSize(parseInt(e.target.value))}
              />
            </div>
          </div>

          <div className="control-field" style={{ marginTop: '10px' }}>
            <label>Font Family</label>
            <select 
              className="sidebar-select"
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value)}
            >
              <option value="Inter">Inter (Sans)</option>
              <option value="Outfit">Outfit (Geometric)</option>
              <option value="Georgia">Georgia (Serif)</option>
              <option value="Courier New">Courier New (Mono)</option>
            </select>
          </div>
        </div>

        <div className="sidebar-divider"></div>

        <div className="control-group">
          <h4 className="sidebar-group-title">Formatting Command Engine</h4>
          <div className="formatting-grid">
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`format-action-btn ${isFormatActive('bold') ? 'active' : ''}`}
              title="Bold text"
            >
              <strong>B</strong>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`format-action-btn ${isFormatActive('italic') ? 'active' : ''}`}
              title="Italic text"
            >
              <em>I</em>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`format-action-btn ${isFormatActive('heading', { level: 1 }) ? 'active' : ''}`}
              title="Heading 1"
            >
              H1
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`format-action-btn ${isFormatActive('heading', { level: 2 }) ? 'active' : ''}`}
              title="Heading 2"
            >
              H2
            </button>
          </div>
          <div className="lists-column" style={{ marginTop: '6px' }}>
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`format-list-btn ${isFormatActive('bulletList') ? 'active' : ''}`}
            >
              • Bullet List
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              className={`format-list-btn ${isFormatActive('orderedList') ? 'active' : ''}`}
            >
              1. Numbered List
            </button>
          </div>
        </div>

        <div className="sidebar-divider"></div>

        <div className="stats-section">
          <h4 className="sidebar-group-title">Document Analysis</h4>
          <div className="stat-card">
            <div className="stat-card-row">
              <span className="stat-label">Words</span>
              <strong>{wordCount}</strong>
            </div>
            <div className="stat-card-row">
              <span className="stat-label">Characters</span>
              <strong>{charCount}</strong>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default RightSidebar;