import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SlashItem } from './extensions/slashItems';

interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export interface SlashMenuRef {
  onKeyDown: (args: { event: KeyboardEvent }) => boolean;
}

const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return (
      <div className="slash-menu">
        <div className="px-3 py-2 text-xs text-muted-foreground/70 italic">No matching blocks</div>
      </div>
    );
  }

  return (
    <div className="slash-menu">
      {items.map((item, i) => {
        const Icon = item.icon;
        const active = i === selected;
        return (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
            className={`flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'text-foreground/90 hover:bg-secondary/50'
            }`}
          >
            <span
              className={`w-7 h-7 flex items-center justify-center rounded-md border ${
                active ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'border-border/40 bg-secondary/40'
              }`}
            >
              <Icon className="w-4 h-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">{item.title}</span>
              <span className={`text-[11px] ${active ? 'text-primary-foreground/75' : 'text-muted-foreground/70'}`}>
                {item.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';

export default SlashMenu;
