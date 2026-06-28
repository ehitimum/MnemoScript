import type { CSSProperties } from 'react';

/**
 * Shared sizing/styling for the editor control groups (FormatControls,
 * ReadAloudControls, DictationControls). `sm` is the compact desktop side panel;
 * `lg` is the thumb-friendly mobile Tools sheet.
 */
export type CtlSize = 'sm' | 'lg';

export const ctlBtn = (size: CtlSize) =>
  'flex items-center justify-center rounded-xl border border-border/35 ' +
  'active:scale-95 transition-all cursor-pointer ' +
  (size === 'lg' ? 'h-12 min-w-12 text-sm' : 'h-8 text-xs');

export const ctlIcon = (size: CtlSize) => (size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5');

export const ctlLabel =
  'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';

/** Active controls fill with the theme primary; inactive sit on a faint wash. */
export function ctlStyle(active: boolean): CSSProperties {
  return active
    ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
    : { background: 'color-mix(in srgb, var(--secondary) 25%, transparent)', color: 'inherit' };
}
