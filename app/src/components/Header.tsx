import { useState, useRef, useEffect } from 'react';
import type { Project, Document } from '../types';

interface HeaderProps {
  selectedProject: Project | null;
  selectedDocument: Document | null;
  onCloseProject: () => void;
  onSaveDocument?: () => void;
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
  const menubarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menubarRef.current && !menubarRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const toggleMenu = (menuName: string) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  const handleMenuHover = (menuName: string) => {
    if (activeMenu !== null) {
      setActiveMenu(menuName);
    }
  };

  const executeAction = (action: () => void) => {
    action();
    setActiveMenu(null);
  };

  const menuItems = [
    {
      label: 'File',
      options: [
        { label: 'New Project', action: onOpenCreateModal, enabled: true },
        { label: 'Open Project Folder', action: onOpenProjectFolder, enabled: true },
        { label: 'Save File', action: onSaveDocument || (() => {}), enabled: !!selectedDocument },
        { label: 'Close Project Workspace', action: onCloseProject, enabled: !!selectedProject },
      ],
    },
    {
      label: 'Edit',
      options: [
        { label: 'Copy Document Text', action: onCopyText, enabled: !!selectedDocument },
      ],
    },
    {
      label: 'View',
      options: [
        { label: 'Toggle Left Explorer', action: () => setIsLeftSidebarOpen(!isLeftSidebarOpen), enabled: true },
        { label: 'Toggle Right Controller', action: () => setIsRightSidebarOpen(!isRightSidebarOpen), enabled: true },
      ],
    },
    {
      label: 'Tools',
      options: [
        { label: autoSaveEnabled ? 'Disable Auto-Save' : 'Enable Auto-Save', action: () => onChangeAutoSave(!autoSaveEnabled), enabled: true },
        { label: 'Preferences / Custom Config', action: onOpenSettings, enabled: true },
      ],
    },
    {
      label: 'Theme',
      options: [
        { label: 'Midnight Dark', action: () => setTheme('dark'), enabled: true },
        { label: 'Parchment Light', action: () => setTheme('light'), enabled: true },
        { label: 'Nebula Glass', action: () => setTheme('glass'), enabled: true },
      ],
    },
    {
      label: 'Help',
      options: [
        { label: 'Quick Guide & Version Info', action: () => alert('MnemoScript IDE v2.0.0 - VSCode Core Architecture Upgrade'), enabled: true },
      ],
    },
  ];

  return (
    <nav className="vscode-menubar" ref={menubarRef}>
      <div className="menubar-left">
        {menuItems.map((menu) => (
          <div key={menu.label} className={`menu-item-wrapper ${activeMenu === menu.label ? 'active' : ''}`}>
            <button
              className="menu-trigger"
              onClick={() => toggleMenu(menu.label)}
              onMouseEnter={() => handleMenuHover(menu.label)}
            >
              {menu.label}
            </button>
            {activeMenu === menu.label && (
              <ul className="menu-dropdown-list">
                {menu.options.map((opt, i) => (
                  <li key={i}>
                    <button
                      className="dropdown-item-btn"
                      disabled={!opt.enabled}
                      onClick={() => executeAction(opt.action)}
                    >
                      <span>{opt.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="menubar-right">
        <button 
          className={`layout-toggle-btn ${isLeftSidebarOpen ? 'active' : ''}`}
          onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
          title="Toggle Left Explorer"
        >
          📂
        </button>
        <button 
          className={`layout-toggle-btn ${isRightSidebarOpen ? 'active' : ''}`}
          onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
          title="Toggle Right Controller"
        >
          ⚙️
        </button>
      </div>
    </nav>
  );
}

export default Header;