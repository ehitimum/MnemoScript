import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
}

/** Slim, calm top bar for the mobile shell. Stays out of the system status bar
 *  via the shell's safe-area padding. */
function MobileTopBar({ title, subtitle, left, right }: Props) {
  return (
    <header className="flex-0 h-14 flex items-center gap-2 px-3 border-b border-border/30 bg-background/80 backdrop-blur-md">
      <div className="w-10 flex justify-start">{left}</div>
      <div className="flex-1 min-w-0 text-center">
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        {subtitle && <div className="text-3xs text-muted-foreground truncate">{subtitle}</div>}
      </div>
      <div className="w-10 flex justify-end">{right}</div>
    </header>
  );
}

export default MobileTopBar;
