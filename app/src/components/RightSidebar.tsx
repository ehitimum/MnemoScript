import type { ThemeType } from '../App';
import listIcon1 from '../assets/list.png'; 
import listIcon2 from '../assets/list1.png';// Path relative to the .tsx file

interface RightSidebarProps {
  editor: any | null;
  isOpen: boolean;
  theme: ThemeType;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
}

function RightSidebar({
  editor,
  isOpen,
  theme,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
}: RightSidebarProps) {
  if (!isOpen) return null;

  // Theme-aware button styling logic
  const getBtnStyle = (isActive: boolean) => {
    const isLight = theme === 'light';
    const activeBg = isLight ? '#0078d4' : 'rgba(66, 153, 225, 0.6)';
    const activeColor = '#fff';
    const baseBg = isLight ? '#f0f0f0' : 'rgba(255,255,255,0.05)';
    const baseBorder = isLight ? '#d0d0d0' : 'rgba(255,255,255,0.1)';
    const textColor = isLight && !isActive ? '#333' : 'inherit';

    return {
      padding: '8px 12px',
      background: isActive ? activeBg : baseBg,
      border: `1px solid ${isActive ? 'transparent' : baseBorder}`,
      color: isActive ? activeColor : textColor,
      cursor: 'pointer',
      borderRadius: '8px',
      transition: 'all 0.2s ease',
      fontWeight: isActive ? 'bold' : 'normal'
    };
  };

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
                style={getBtnStyle(editor.isActive('bold'))}
              ><strong>B</strong></button>
              <button 
                className={`format-btn ${editor.isActive('italic') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
                style={getBtnStyle(editor.isActive('italic'))}
              ><em>I</em></button>
              <button 
                className={`format-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet List"
                style={getBtnStyle(editor.isActive('bulletList'))}
              ><img src={listIcon1} alt="Bullet List" style={{ width: '14px' }} /></button>
              <button 
                className={`format-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
                style={getBtnStyle(editor.isActive('orderedList'))}
              ><img src={listIcon2} alt="Bullet List" style={{ width: '14px' }} /></button>
            </div>
            <div className="format-headings-row" style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  className={`format-btn ${editor.isActive('heading', { level }) ? 'active' : ''}`}
                  onClick={() => editor.chain().focus().toggleHeading({ level: level as any }).run()}
                  title={`Heading ${level} (Ctrl+${level})`}
                  style={{ ...getBtnStyle(editor.isActive('heading', { level })), flex: 1, fontSize: '0.75rem', padding: '4px' }}
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