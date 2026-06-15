import { useState, useRef, useEffect } from 'react';
import type { Project, Document } from '../types';
import type { ThemeType } from '../App';
import { PanelLeft, PanelRight, ChevronDown } from 'lucide-react';

interface HeaderProps {
  selectedProject: Project | null;
  selectedDocument: Document | null;
  onCloseProject: () => void;
  onSaveDocument?: () => void;
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
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
        { label: 'Close Project', action: onCloseProject, enabled: !!selectedProject },
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
        { label: 'Preferences', action: onOpenSettings, enabled: true },
      ],
    },
    {
      label: 'Theme',
      options: [
        { label: 'Midnight Dark', action: () => setTheme('dark'), enabled: true },
        { label: 'Parchment Light', action: () => setTheme('light'), enabled: true },
        { label: 'Nebula Glass', action: () => setTheme('glass'), enabled: true },
        { label: 'Deep Ocean', action: () => setTheme('ocean'), enabled: true },
        { label: 'Emerald Forest', action: () => setTheme('forest'), enabled: true },
        { label: 'Crimson Sunset', action: () => setTheme('sunset'), enabled: true },
      ],
    },
    {
      label: 'Help',
      options: [
        { label: 'Quick Guide & Version Info', action: () => alert('MnemoScript Studio v2.0.0 - Built with Tauri + React'), enabled: true },
      ],
    },
  ];

  return (
    <nav 
      className="h-10 bg-secondary/30 border-b border-border/30 flex items-center justify-between px-4 select-none z-1000 relative backdrop-blur-md transition-colors duration-200" 
      ref={menubarRef}
    >
      <div className="flex items-center gap-1">
        {menuItems.map((menu) => (
          <div key={menu.label} className="relative">
            <button
              className={`px-3 py-1.5 text-xs font-medium rounded hover:bg-secondary/60 hover:text-foreground cursor-pointer flex items-center gap-1 transition-all duration-200 ${
                activeMenu === menu.label ? 'bg-secondary text-foreground' : 'text-muted-foreground'
              }`}
              onClick={() => toggleMenu(menu.label)}
              onMouseEnter={() => handleMenuHover(menu.label)}
            >
              {menu.label}
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${activeMenu === menu.label ? 'rotate-180 text-primary' : 'opacity-60'}`} />
            </button>
            
            {activeMenu === menu.label && (
              <ul className="absolute top-full left-0 mt-1.5 bg-popover text-popover-foreground border border-border/40 shadow-xl rounded-lg min-width-[190px] p-1.5 z-1010 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150 backdrop-blur-lg">
                {menu.options.map((opt, i) => (
                  <li key={i}>
                    <button
                      className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground/90 px-3 py-2 rounded-md font-medium cursor-pointer transition-all duration-150 flex justify-between"
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

      <div className="flex items-center gap-3">
        <button 
          className={`w-7 h-7 flex items-center justify-center rounded transition-all cursor-pointer ${
            isLeftSidebarOpen 
              ? 'bg-primary/15 text-primary border border-primary/25' 
              : 'text-muted-foreground hover:bg-secondary/65 hover:text-foreground border border-transparent'
          }`}
          onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
          title="Toggle Left Explorer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        <button 
          className={`w-7 h-7 flex items-center justify-center rounded transition-all cursor-pointer ${
            isRightSidebarOpen 
              ? 'bg-primary/15 text-primary border border-primary/25' 
              : 'text-muted-foreground hover:bg-secondary/65 hover:text-foreground border border-transparent'
          }`}
          onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
          title="Toggle Right Controller"
        >
          <PanelRight className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}

export default Header;