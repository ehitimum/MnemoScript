import { Library, PenLine, SlidersHorizontal, Settings, Sparkles } from 'lucide-react';

export type MobileTab = 'library' | 'write' | 'ai' | 'settings';

interface Props {
  tab: MobileTab;
  onTab: (tab: MobileTab) => void;
  onTools: () => void;
  toolsActive: boolean;
  /** Write needs any open document; Tools needs an editable text document; AI needs a project. */
  canWrite: boolean;
  canTools: boolean;
  canAi: boolean;
}

/** Bottom navigation — the spine of the mobile UX. 56px thumb targets. */
function MobileTabBar({ tab, onTab, onTools, toolsActive, canWrite, canTools, canAi }: Props) {
  return (
    <nav className="mn-tabbar">
      <button className={`mn-tab ${tab === 'library' ? 'is-active' : ''}`} onClick={() => onTab('library')}>
        <Library className="w-5 h-5" />
        Library
      </button>
      <button
        className={`mn-tab ${tab === 'write' ? 'is-active' : ''} ${!canWrite ? 'opacity-40' : ''}`}
        onClick={() => onTab('write')}
        disabled={!canWrite}
      >
        <PenLine className="w-5 h-5" />
        Write
      </button>
      <button
        className={`mn-tab ${tab === 'ai' ? 'is-active' : ''} ${!canAi ? 'opacity-40' : ''}`}
        onClick={() => onTab('ai')}
        disabled={!canAi}
      >
        <Sparkles className="w-5 h-5" />
        AI
      </button>
      <button
        className={`mn-tab ${toolsActive ? 'is-active' : ''} ${!canTools ? 'opacity-40' : ''}`}
        onClick={onTools}
        disabled={!canTools}
      >
        <SlidersHorizontal className="w-5 h-5" />
        Tools
      </button>
      <button className={`mn-tab ${tab === 'settings' ? 'is-active' : ''}`} onClick={() => onTab('settings')}>
        <Settings className="w-5 h-5" />
        Settings
      </button>
    </nav>
  );
}

export default MobileTabBar;
