import type { ThemeType } from '../App';

/** The six colour themes (ids map to `body.theme-*` in index.css). */
export const THEMES: { id: ThemeType; label: string; hint: string; bg: string; accent: string }[] = [
  { id: 'dark', label: 'Midnight', hint: 'slate & periwinkle', bg: '#0e1116', accent: '#8aa0ff' },
  { id: 'light', label: 'Parchment', hint: 'warm paper', bg: '#faf8f3', accent: '#4f46e5' },
  { id: 'glass', label: 'Nebula', hint: 'deep violet', bg: '#141020', accent: '#b292ff' },
  { id: 'ocean', label: 'Ocean', hint: 'deep blue', bg: '#0a1626', accent: '#38bdf8' },
  { id: 'forest', label: 'Forest', hint: 'emerald pine', bg: '#0b1c14', accent: '#34d399' },
  { id: 'sunset', label: 'Sunset', hint: 'warm coral', bg: '#1e1210', accent: '#fb7a5c' },
];

/** Editor font choices (CSS font-family values). */
export const FONTS = [
  { value: 'Inter', label: 'Inter — clean sans' },
  { value: 'Georgia', label: 'Georgia — classic serif' },
  { value: "'Times New Roman', serif", label: 'Times — manuscript serif' },
  { value: "'Courier New', monospace", label: 'Courier — typewriter' },
];
