/**
 * Placement for floating editor windows (grammar suggestions, the inline AI card and menu, the
 * slash menu). They must stay fully on screen, never cover the text they are about, and sit
 * towards the middle of the writing area instead of hugging an edge — writers often work on the
 * last line, right above the bottom of the window or the phone keyboard.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Height cap so a tall window still fits the visible area. */
  maxHeight: number;
  side: 'below' | 'above' | 'middle';
}

/**
 * `center`: the window is centred in the visible area (AI card). `target`: centred on the text
 * it belongs to, then kept inside the area (grammar popover, menus).
 */
export type Align = 'center' | 'target';

const MARGIN = 8;

/**
 * Where to put a `width`×`height` window for `target` (the text, in viewport coordinates) inside
 * `area` (the visible part of the editor). Below the text when it fits, else above it, else in
 * the middle of the area.
 */
export function placeFloating(target: Box, width: number, height: number, area: Box, align: Align = 'target', gap = 8): Placement {
  const areaW = Math.max(0, area.right - area.left);
  const areaH = Math.max(0, area.bottom - area.top);
  const w = Math.min(width, Math.max(0, areaW - MARGIN * 2));
  const cx = align === 'center' ? area.left + areaW / 2 : (target.left + target.right) / 2;
  const left = clamp(cx - w / 2, area.left + MARGIN, area.right - MARGIN - w);

  const maxHeight = Math.max(0, areaH - MARGIN * 2);
  const h = Math.min(height, maxHeight);
  const middle: Placement = { left, top: area.top + (areaH - h) / 2, maxHeight, side: 'middle' };
  // The text has scrolled out of view: there is nothing to sit next to.
  if (target.bottom < area.top || target.top > area.bottom) return middle;
  const below = target.bottom + gap;
  const above = target.top - gap - h;
  if (below + h <= area.bottom - MARGIN) return { left, top: below, maxHeight, side: 'below' };
  if (above >= area.top + MARGIN) return { left, top: above, maxHeight, side: 'above' };
  return middle;
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/**
 * The part of `el` (the editor's scroll box) that is actually visible: clipped to the window
 * and, on phones, to the visual viewport so the soft keyboard is not counted as free space.
 */
export function visibleArea(el: Element | null): Box {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const screen: Box = vv
    ? { top: vv.offsetTop, left: vv.offsetLeft, bottom: vv.offsetTop + vv.height, right: vv.offsetLeft + vv.width }
    : { top: 0, left: 0, bottom: vh, right: vw };
  const r = el?.getBoundingClientRect();
  if (!r || r.width === 0 || r.height === 0) return screen;
  const box = {
    top: Math.max(r.top, screen.top),
    left: Math.max(r.left, screen.left),
    bottom: Math.min(r.bottom, screen.bottom),
    right: Math.min(r.right, screen.right),
  };
  return box.bottom - box.top < 120 || box.right - box.left < 200 ? screen : box;
}

/** Writes a placement onto a `position: fixed` element (no React state, so no re-render). */
/**
 * `reserve`: plan for at least this height, for windows that grow while open (the AI card streams
 * its text), so they do not jump from below the text to above it halfway through.
 */
export function applyPlacement(
  el: HTMLElement,
  target: Box,
  area: Box,
  opts: { width: number; align?: Align; maxHeight?: number; reserve?: number },
): Placement {
  const width = Math.min(opts.width, Math.max(0, area.right - area.left - MARGIN * 2));
  el.style.width = `${width}px`;
  const cap = opts.maxHeight ?? Infinity;
  el.style.maxHeight = Number.isFinite(cap) ? `${cap}px` : ''; // measure the natural height
  const p = placeFloating(target, width, Math.min(Math.max(el.offsetHeight || 0, opts.reserve ?? 0), cap), area, opts.align);
  el.style.position = 'fixed';
  el.style.left = `${Math.round(p.left)}px`;
  el.style.top = `${Math.round(p.top)}px`;
  el.style.bottom = 'auto';
  el.style.right = 'auto';
  el.style.maxHeight = `${Math.round(Math.min(p.maxHeight, cap))}px`;
  el.dataset.side = p.side;
  return p;
}
