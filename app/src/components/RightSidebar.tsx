interface RightSidebarProps {
  editor: any | null;
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
  if (!isOpen) return null;

  return (
    <aside className="text-controller-sidebar">
      <div className="right-sidebar-header">
        {/* ICON REF UPGRADE: Replaces old header configurations with requested technical settings icon symbol alignment */}
        <span className="controller-header-icon">🔧</span>
        <span className="controller-header-title">TEXT & EDITOR CONTROLLER</span>
      </div>

      <div className="sidebar-section-body">
        {editor && (
          <div className="control-group">
            <h4 className="sidebar-group-title">Text Formatting</h4>
            <div className="format-buttons-grid" style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <button 
                className={`format-btn ${editor.isActive('bold') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold (Ctrl+B)"
                style={{ padding: '6px 10px', background: editor.isActive('bold') ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', cursor: 'pointer', borderRadius: '4px' }}
              ><strong>B</strong></button>
              <button 
                className={`format-btn ${editor.isActive('italic') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
                style={{ padding: '6px 10px', background: editor.isActive('italic') ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', cursor: 'pointer', borderRadius: '4px' }}
              ><em>I</em></button>
              <button 
                className={`format-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet List"
                style={{ padding: '6px 10px', background: editor.isActive('bulletList') ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', cursor: 'pointer', borderRadius: '4px' }}
              >• List</button>
              <button 
                className={`format-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
                style={{ padding: '6px 10px', background: editor.isActive('orderedList') ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', cursor: 'pointer', borderRadius: '4px' }}
              >1. List</button>
            </div>
            <div className="format-headings-row" style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  className={`format-btn ${editor.isActive('heading', { level }) ? 'active' : ''}`}
                  onClick={() => editor.chain().focus().toggleHeading({ level: level as any }).run()}
                  title={`Heading ${level} (Ctrl+${level})`}
                  style={{ flex: 1, padding: '4px', background: editor.isActive('heading', { level }) ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', cursor: 'pointer', borderRadius: '4px', fontSize: '0.75rem' }}
                >H{level}</button>
              ))}
            </div>
          </div>
        )}

        <div className="control-group">
          <h4 className="sidebar-group-title">Typography Configuration</h4>
          
          <div className="control-field">
            <label>Font Size Slider Dimensions ({editorSize}px)</label>
            <div className="control-slider-row">
              <input 
                type="range" min="12" max="24" 
                value={editorSize} onChange={(e) => setEditorSize(parseInt(e.target.value))}
              />
            </div>
          </div>

          <div className="control-field" style={{ marginTop: '10px' }}>
            <label>Font Family Selection</label>
            <select 
              className="sidebar-select"
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value)}
            >
              <option value="Inter">Inter (Engine Default)</option>
              <option value="Outfit">Outfit (Geometric Smooth)</option>
              <option value="Georgia">Georgia (Classic Text Serif)</option>
              <option value="Courier New">Courier New (Technical Monospace)</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default RightSidebar;