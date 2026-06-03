interface RightSidebarProps {
  editor: any | null;
  isOpen: boolean;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
}

function RightSidebar({
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