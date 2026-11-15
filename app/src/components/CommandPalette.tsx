import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, CornerDownLeft } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  onClose: () => void;
  commands: Command[];
}

/**
 * Desktop ⌘K command palette — the spine of the reshaped desktop UX. Fuzzy-ish
 * (substring) filter, full keyboard nav. Replaces most of the old menubar.
 * Mount only while open (App renders it conditionally), so state starts fresh.
 */
function CommandPalette({ onClose, commands }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = commands.filter((c) => !c.disabled);
    if (!q) return list;
    return list.filter((c) => (c.label + ' ' + (c.group ?? '')).toLowerCase().includes(q));
  }, [commands, query]);

  // Focus the input on mount (no setState — safe inside an effect).
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const onQuery = (value: string) => {
    setQuery(value);
    setActive(0);
  };

  const choose = (cmd?: Command) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'color-mix(in srgb, var(--background) 55%, transparent)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div className="mn-palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 px-4 h-13 border-b border-border/40">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none text-sm py-3.5 placeholder:text-muted-foreground/60"
          />
          <kbd className="text-3xs text-muted-foreground/70 border border-border/50 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} className="overflow-y-auto py-2">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">No matching commands</div>
          )}
          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(cmd)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === active ? 'bg-primary/12' : ''
                }`}
              >
                {Icon && <Icon className={`w-4 h-4 shrink-0 ${i === active ? 'text-primary' : 'text-muted-foreground'}`} />}
                <span className="flex-1 text-sm text-foreground/90 truncate">{cmd.label}</span>
                {cmd.group && <span className="text-3xs text-muted-foreground/60">{cmd.group}</span>}
                {i === active && <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground/60" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
