import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/core';

interface Props {
  editor: Editor | null;
  /** The scrollable wrapper around <EditorContent>. Must be `position: relative`. */
  scrollRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}

/**
 * Microsoft-Word-style smooth caret ("animated typing").
 *
 * The native caret is hidden (see `.mn-smooth-caret .ProseMirror` in index.css)
 * and replaced by a small overlay that *glides* to the new position on every
 * keystroke / selection change instead of teleporting. It stays solid while
 * the caret is moving and only starts blinking after a short pause, exactly
 * like Word.
 *
 * Performance notes (this is why the earlier implementation felt laggy on
 * phones and was disabled there):
 *   - No React state. Positions are written straight to the DOM inside a
 *     single requestAnimationFrame, so typing never re-renders the editor.
 *   - The overlay lives *inside* the scroll container in content coordinates
 *     (viewport coords + scroll offset), so scrolling moves it for free and
 *     ancestor transforms (drawers, sheets) can't knock it out of place.
 *   - Movement uses a GPU-composited `transform`, never `top`/`left`.
 *   - IME composition (Android / CJK keyboards) temporarily restores the native
 *     caret so the keyboard's own inline suggestions stay accurate.
 *
 * Works on desktop, web and mobile; the user can turn it off in Settings.
 */
function SmoothCaret({ editor, scrollRef, enabled }: Props) {
  const caretRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = caretRef.current;
    const container = scrollRef.current;
    if (!editor || !el || !container || !enabled || editor.isDestroyed) return;

    const view = editor.view;
    const dom = view.dom as HTMLElement;
    container.classList.add('mn-smooth-caret');

    let raf = 0;
    let lastX = NaN;
    let lastY = NaN;
    let lastH = 0;
    let composing = false;
    let blinkTimer = 0;

    const hide = () => {
      el.style.visibility = 'hidden';
      el.classList.remove('is-blinking');
    };

    const update = () => {
      raf = 0;
      if (editor.isDestroyed) return;
      const { selection } = editor.state;
      if (!selection.empty || !view.hasFocus() || composing) {
        hide();
        return;
      }
      let coords: { left: number; top: number; bottom: number };
      try {
        coords = view.coordsAtPos(selection.head);
      } catch {
        hide();
        return;
      }
      const rect = container.getBoundingClientRect();
      const x = coords.left - rect.left + container.scrollLeft - container.clientLeft;
      const y = coords.top - rect.top + container.scrollTop - container.clientTop;
      const h = Math.max(4, coords.bottom - coords.top);
      const first = Number.isNaN(lastX);
      const moved = first || Math.abs(x - lastX) > 0.5 || Math.abs(y - lastY) > 0.5;

      if (moved) {
        // Big jumps (click far away, document switch) snap into place instead
        // of flying across the page; small hops (typing, arrow keys) glide.
        const jump = first || Math.abs(y - lastY) > rect.height * 0.6;
        el.style.transition = jump ? 'none' : '';
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        lastX = x;
        lastY = y;
      }
      if (h !== lastH) {
        el.style.height = `${h}px`;
        lastH = h;
      }
      // Solid while moving (or just re-shown); blink only once at rest.
      if (moved || el.style.visibility !== 'visible') {
        el.classList.remove('is-blinking');
        window.clearTimeout(blinkTimer);
        blinkTimer = window.setTimeout(() => el.classList.add('is-blinking'), 450);
      }
      el.style.visibility = 'visible';
    };

    // rAF is paused in background tabs/windows; fall back to a timer there so
    // the caret is already in the right place when the page becomes visible.
    let timer = 0;
    const run = () => {
      timer = 0;
      update();
    };
    const schedule = () => {
      if (raf || timer) return;
      if (document.visibilityState === 'hidden') timer = window.setTimeout(run, 0);
      else raf = requestAnimationFrame(update);
    };

    const onCompositionStart = () => {
      composing = true;
      container.classList.add('is-composing');
      hide();
    };
    const onCompositionEnd = () => {
      composing = false;
      container.classList.remove('is-composing');
      schedule();
    };

    editor.on('transaction', schedule);
    editor.on('selectionUpdate', schedule);
    // Focus/blur straight from the DOM: TipTap only emits its own focus events
    // when a focus *transaction* is dispatched, which doesn't happen for every
    // way the editor can lose focus (e.g. programmatic blur, window switches).
    dom.addEventListener('focus', schedule);
    dom.addEventListener('blur', hide);
    dom.addEventListener('compositionstart', onCompositionStart);
    dom.addEventListener('compositionend', onCompositionEnd);
    window.addEventListener('resize', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('blur', hide);
    // Font / size / line-height changes reflow the text without a transaction.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(dom);
    document.fonts?.ready.then(schedule).catch(() => {});
    schedule();

    return () => {
      editor.off('transaction', schedule);
      editor.off('selectionUpdate', schedule);
      dom.removeEventListener('focus', schedule);
      dom.removeEventListener('blur', hide);
      dom.removeEventListener('compositionstart', onCompositionStart);
      dom.removeEventListener('compositionend', onCompositionEnd);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('blur', hide);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(blinkTimer);
      container.classList.remove('mn-smooth-caret', 'is-composing');
    };
  }, [editor, scrollRef, enabled]);

  if (!enabled) return null;
  return <div ref={caretRef} className="mn-caret" aria-hidden />;
}

export default SmoothCaret;
