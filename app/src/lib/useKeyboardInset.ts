import { useEffect, useState } from 'react';

/**
 * Height (px) of the on-screen keyboard that overlaps the layout viewport. 0 when the WebView
 * already resizes for the keyboard (Android `adjustResize`) or no keyboard is shown. With
 * edge-to-edge Android WebViews the page is *not* resized, so a bottom-pinned composer must be
 * lifted by this amount or the keyboard would cover it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(overlap > 80 ? Math.round(overlap) : 0); // ignore toolbar wobble
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
