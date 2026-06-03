import { useEffect, useState } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';
import type { Level } from '@tiptap/extension-heading';

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
  const [readingTime, setReadingTime] = useState(0);

  // Recalculate stats whenever editor content changes
  useEffect(() => {
    if (!editor) return;

    const updateStats = () => {
      const text = editor.getText();
      const words = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const chars = text.length;
      
      setWordCount(words);
      setCharCount(chars);
      setReadingTime(Math.ceil(words / 200));
    };

    updateStats();

    editor.on('update', updateStats);
    return () => {
      editor.off('update', updateStats);
    };
  }, [editor]);

  if (!isOpen) return null;

  const handleBold = () => editor?.chain().focus().toggleBold().run();
  const handleItalic = () => editor?.chain().focus().toggleItalic().run();
  const handleHeading = (level: Level) => editor?.chain().focus().toggleHeading({ level }).run();
  const handleBulletList = () => editor?.chain().focus().toggleBulletList().run();
  const handleOrderedList = () => editor?.chain().focus().toggleOrderedList().run();

  const isFormatActive = (name: string, attributes = {}) => {
    if (!editor) return false;
    return editor.isActive(name, attributes);
  };

  return (
    <aside className="workspace-right-sidebar">
      <div className="sidebar-section-header">
        <span className="section-title-icon">⚙️</span>
        <span className="section-label">Controller & Settings</span>
      </div>

      <div className="right-sidebar-content">
        {/* Sizing & Fonts Tab Section */}
        <div className="formatting-section">
          <h4 className="sidebar-group-title">Typography Adjustments</h4>
          
          <div className="settings-field-group">
            <label className="sidebar-field-label">Font Family</label>
            <select
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value)}
              className="sidebar-select-control"
            >
              <option value="Outfit">Outfit (Sans-Serif)</option>
              <option value="Inter">Inter (Sans-Serif)</option>
              <option value="Georgia">Georgia (Serif)</option>
              <option value="Courier New">Courier New (Monospace)</option>
            </select>
          </div>

          <div className="settings-field-group">
            <label className="sidebar-field-label">Font Size ({editorSize}px)</label>
            <div className="fontsize-stepper">
              <button 
                onClick={() => setEditorSize(Math.max(12, editorSize - 1))}
                className="stepper-btn"
                title="Decrease font size"
              >
                －
              </button>
              <input
                type="range"
                min="12"
                max="28"
                value={editorSize}
                onChange={(e) => setEditorSize(Number(e.target.value))}
                className="sidebar-slider-control"
              />
              <button 
                onClick={() => setEditorSize(Math.min(28, editorSize + 1))}
                className="stepper-btn"
                title="Increase font size"
              >
                ＋
              </button>
            </div>
          </div>
        </div>

        <div className="sidebar-divider"></div>

        {/* Text Styles Section */}
        <div className="formatting-section">
          <h4 className="sidebar-group-title">Text Styles</h4>
          <div className="formatting-grid">
            <button
              onClick={handleBold}
              className={`format-grid-btn ${isFormatActive('bold') ? 'active' : ''}`}
              title="Bold"
              disabled={!editor}
            >
              <strong>B</strong>
              <span className="btn-subtext">Bold</span>
            </button>
            <button
              onClick={handleItalic}
              className={`format-grid-btn ${isFormatActive('italic') ? 'active' : ''}`}
              title="Italic"
              disabled={!editor}
            >
              <em>I</em>
              <span className="btn-subtext">Italic</span>
            </button>
          </div>

          <h4 className="sidebar-group-title">Headers</h4>
          <div className="headings-row">
            {[1, 2, 3].map((lvl) => (
              <button
                key={lvl}
                onClick={() => handleHeading(lvl as Level)}
                className={`format-row-btn ${isFormatActive('heading', { level: lvl as Level }) ? 'active' : ''}`}
                title={`H${lvl}`}
                disabled={!editor}
              >
                H{lvl}
              </button>
            ))}
          </div>

          <h4 className="sidebar-group-title">Lists</h4>
          <div className="lists-column">
            <button
              onClick={handleBulletList}
              className={`format-list-btn ${isFormatActive('bulletList') ? 'active' : ''}`}
              disabled={!editor}
            >
              <span className="list-icon">•</span> Bullet List
            </button>
            <button
              onClick={handleOrderedList}
              className={`format-list-btn ${isFormatActive('orderedList') ? 'active' : ''}`}
              disabled={!editor}
            >
              <span className="list-icon">1.</span> Numbered List
            </button>
          </div>
        </div>

        <div className="sidebar-divider"></div>

        {/* Stats Section */}
        <div className="stats-section">
          <h4 className="sidebar-group-title">Document Stats</h4>
          <div className="stat-card">
            <div className="stat-card-row">
              <span className="stat-label">Words</span>
              <span className="stat-val">{wordCount}</span>
            </div>
            <div className="stat-card-row">
              <span className="stat-label">Characters</span>
              <span className="stat-val">{charCount}</span>
            </div>
            <div className="stat-card-row">
              <span className="stat-label">Reading Time</span>
              <span className="stat-val">{readingTime} min</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default RightSidebar;
