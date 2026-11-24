/**
 * The browser's caret position inside `root` (viewport coordinates), or null when there is no
 * collapsed selection there or it cannot be measured. Used by the smooth caret while a keyboard
 * composes a word (Android), when ProseMirror's own selection lags the text on screen.
 */
export function domCaret(root: HTMLElement): { left: number; top: number; bottom: number } | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!r || (r.top === 0 && r.bottom === 0 && r.left === 0)) return null;
  return { left: r.left, top: r.top, bottom: r.bottom };
}
