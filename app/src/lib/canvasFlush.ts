/**
 * Canvases (mind map, fantasy map) debounce their updates by ~400 ms. Before the AI reads or
 * rewrites a document, `flushCanvases()` pushes any pending edit through `onUpdateContent` right
 * away, so nothing the writer just did is read stale or overwritten.
 */
const flushers = new Set<() => void>();

export function registerCanvasFlush(flush: () => void): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export function flushCanvases(): void {
  for (const f of [...flushers]) f();
}

/** Next free `n<k>` id for a mind map (ids of deleted nodes leave gaps, so length+1 can collide). */
export function nextMindNodeIndex(nodes: { id: string }[]): number {
  let max = 0;
  for (const n of nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Math.max(max, nodes.length) + 1;
}
