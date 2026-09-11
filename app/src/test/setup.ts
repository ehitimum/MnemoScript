import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Shared test environment for the frontend suites.
 *
 * jsdom is missing a few browser APIs the app relies on; the polyfills below
 * are deliberately minimal (they exist so components mount, not to emulate
 * layout). Tests that care about a specific behaviour override them locally.
 */

// Layout observers: React Flow, SmoothCaret and the map stage observe sizes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

/** A matchMedia stub: nothing matches (wide, fine-pointer desktop). */
export function stubMatchMedia(match: (query: string) => boolean = () => false) {
  window.matchMedia = ((query: string) =>
    ({
      matches: match(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  stubMatchMedia();
  // The grammar checker posts to LanguageTool after a debounce; never let a
  // unit test reach the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"matches":[]}', { headers: { 'Content-Type': 'application/json' } })),
  );
  // jsdom's scrollIntoView is missing; TipTap and the read-aloud highlight call it.
  Element.prototype.scrollIntoView = () => {};
  // jsdom has no layout, so hit-testing APIs used by ProseMirror's viewport
  // plugin don't exist. Returning "nothing here" keeps the editor mountable.
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
