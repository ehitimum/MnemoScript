import { useEffect, useState } from 'react';

/**
 * Platform detection for choosing the right UI shell.
 *
 * The desktop and phone UIs are separate shells (see ARCHITECTURE.md). The
 * shell must be chosen by *platform*, not by window width alone: a desktop
 * window resized narrow should stay on the desktop shell (with collapsible
 * drawers), while a phone – Android WebView or a mobile browser – gets the
 * bottom-tab shell regardless of its exact pixel width.
 */

/** True when running inside the Tauri WebView (native backend available). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True on Android / iOS (Tauri mobile build or a phone browser). */
export const isMobileOS =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** True on Windows (used for a few OS-specific touches such as key labels). */
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

export interface ShellInfo {
  /** Render the phone shell (bottom tabs) instead of the desktop layout. */
  isMobileShell: boolean;
  /** Viewport is narrow (≤ 768px) – desktop shell collapses its panels into drawers. */
  isNarrow: boolean;
  /** Primary pointer is a finger (touch-first device). */
  isTouch: boolean;
}

/** Dev/testing override: `?shell=mobile` or `?shell=desktop` on the web build. */
const forcedShell: 'mobile' | 'desktop' | null = (() => {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('shell');
  return v === 'mobile' || v === 'desktop' ? v : null;
})();

/** The shell decision for the current environment (exported for tests). */
export function computeShell(): ShellInfo {
  const isNarrow = matches('(max-width: 768px)');
  const isTouch = matches('(pointer: coarse)');
  // Phone OS → always the mobile shell. Otherwise only a narrow *touch* viewport
  // (e.g. a phone browser with an odd UA) gets it; a narrow desktop window does not.
  const isMobileShell = forcedShell ? forcedShell === 'mobile' : isMobileOS || (isNarrow && isTouch && !isTauri);
  return { isMobileShell, isNarrow, isTouch };
}

/** Subscribe to the platform/shell decision; re-evaluates on viewport changes. */
export function useShell(): ShellInfo {
  const [info, setInfo] = useState<ShellInfo>(computeShell);
  useEffect(() => {
    const mqls = [window.matchMedia('(max-width: 768px)'), window.matchMedia('(pointer: coarse)')];
    const onChange = () => setInfo(computeShell());
    mqls.forEach((m) => m.addEventListener('change', onChange));
    return () => mqls.forEach((m) => m.removeEventListener('change', onChange));
  }, []);
  return info;
}
