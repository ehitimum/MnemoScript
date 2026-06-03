import { useState } from 'react';
import type { Project, Document } from '../types';

interface HeaderProps {
  selectedProject: Project | null;
  selectedDocument: Document | null;
  onCloseProject: () => void;
  onSaveDocument?: () => void;
  isSaved?: boolean;
  theme: 'dark' | 'light' | 'glass';
  setTheme: (theme: 'dark' | 'light' | 'glass') => void;
  isLeftSidebarOpen: boolean;
  setIsLeftSidebarOpen: (open: boolean) => void;
  isRightSidebarOpen: boolean;
  setIsRightSidebarOpen: (open: boolean) => void;
  onOpenCreateModal: () => void;
  onOpenProjectFolder: () => void;
  onCopyText: () => void;
  onOpenSettings: () => void;
  autoSaveEnabled: boolean;
  onChangeAutoSave: (enabled: boolean) => void;
}

function Header({
  selectedProject,
  selectedDocument,
  onCloseProject,
  onSaveDocument,
  isSaved = true,
  theme,
  setTheme,
  isLeftSidebarOpen,
  setIsLeftSidebarOpen,
  isRightSidebarOpen,
  setIsRightSidebarOpen,
  onOpenCreateModal,
  onOpenProjectFolder,
  onCopyText,
  onOpenSettings,
  autoSaveEnabled,
  onChangeAutoSave,
}: HeaderProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const menuItems = [
    {
      label: 'File',
      options: [
        { label: '✨ New Project', action: onOpenCreateModal },
        { label: '📂 Open Project Folder', action: onOpenProjectFolder },
        { label: '💾 Save Document', action: onSaveDocument, disabled: !selectedDocument },
        { label: '🚪 Close Project', action: onCloseProject, disabled: !selectedProject },
      ],
    },
    {
      label: 'Edit',
      options: [
        { label: '📋 Copy Plain Text', action: onCopyText, disabled: !selectedDocument },
      ],
    },
    {
      label: 'View',
      options: [
        { label: isLeftSidebarOpen ? '📁 Collapse Explorer' : '📁 Expand Explorer', action: () => setIsLeftSidebarOpen(!isLeftSidebarOpen), disabled: !selectedProject },
        { label: isRightSidebarOpen ? '⚙️ Collapse Controller' : '⚙️ Expand Controller', action: () => setIsRightSidebarOpen(!isRightSidebarOpen), disabled: !selectedDocument },
      ],
    },
    {
      label: 'Tools',
      options: [
        { label: '⚙️ Settings Tab', action: onOpenSettings },
        { label: autoSaveEnabled ? '☑️ Auto-Save Active' : '⬜ Enable Auto-Save', action: () => onChangeAutoSave(!autoSaveEnabled), disabled: !selectedDocument },
      ],
    },
    {
      label: 'Theme',
      options: [
        { label: '🌌 Midnight Dark', action: () => setTheme('dark') },
        { label: '📜 Parchment Light', action: () => setTheme('light') },
        { label: '🔮 Nebula Glass', action: () => setTheme('glass') },
      ],
    },
    {
      label: 'Help',
      options: [
        { label: 'ℹ️ About MnemoScript', action: () => alert('MnemoScript v2.0.0\nA modern distraction-free software for writers, developed with Tauri and React.') },
      ],
    },
  ];

  return (
    <header className="vscode-header">
      <div className="header-left">
        {/* Dropdown Menu Links */}
        <div className="vscode-menubar">
          {menuItems.map((menu) => (
            <div
              key={menu.label}
              className="menubar-item-container"
              onMouseEnter={() => activeMenu && setActiveMenu(menu.label)}
            >
              <button
                className={`menubar-btn ${activeMenu === menu.label ? 'active' : ''}`}
                onClick={() => setActiveMenu(activeMenu === menu.label ? null : menu.label)}
              >
                {menu.label}
              </button>

              {activeMenu === menu.label && (
                <div 
                  className="menubar-dropdown"
                  onMouseLeave={() => setActiveMenu(null)}
                >
                  {menu.options.map((option, idx) => (
                    <button
                      key={idx}
                      className="dropdown-option-btn"
                      onClick={() => {
                        if (option.action && !option.disabled) {
                          option.action();
                        }
                        setActiveMenu(null);
                      }}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Center Label for Document Name */}
      <div className="header-center">
        {selectedProject && (
          <span className="header-filename-tag">
            {selectedProject.name} {selectedDocument ? `— ${selectedDocument.title}` : ''}
          </span>
        )}
      </div>

      <div className="header-right">
        {/* Toggle Toggles */}
        {selectedProject && (
          <button 
            className={`sidebar-toggle-btn ${isLeftSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
            title={isLeftSidebarOpen ? "Toggle Explorer (Left)" : "Toggle Explorer (Left)"}
          >
            <span className="toggle-icon-layout left-sidebar-icon"></span>
          </button>
        )}

        {selectedProject && selectedDocument && (
          <button 
            className={`sidebar-toggle-btn ${isRightSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
            title={isRightSidebarOpen ? "Toggle Text Controller (Right)" : "Toggle Text Controller (Right)"}
          >
            <span className="toggle-icon-layout right-sidebar-icon"></span>
          </button>
        )}

        <button 
          className="header-btn settings-btn" 
          onClick={onOpenSettings} 
          title="Open Settings Tab"
        >
          ⚙️ Settings
        </button>

        {selectedProject && (
          <button 
            className="header-btn close-project-btn" 
            onClick={onCloseProject}
            title="Close Active Project Workspace"
          >
            🚪 Close
          </button>
        )}

        {selectedProject && selectedDocument && (
          <span className={`save-badge ${isSaved ? 'saved' : 'unsaved'}`}>
            {isSaved ? '●' : '○'}
          </span>
        )}
      </div>
    </header>
  );
}

export default Header;
