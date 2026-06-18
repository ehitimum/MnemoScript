import { useCallback, useRef, useState } from 'react';
import type { FantasyMapDoc } from './mapTypes';

/**
 * Undo/redo over whole-document snapshots. Mirrors the past/future-ref approach
 * used by MindMap: `snapshot(current)` is called right before a mutation so undo
 * can step back to it; any new action clears the redo stack.
 */
export function useMapHistory() {
  const past = useRef<FantasyMapDoc[]>([]);
  const future = useRef<FantasyMapDoc[]>([]);
  const [, bump] = useState(0);

  const snapshot = useCallback((current: FantasyMapDoc) => {
    past.current = [...past.current.slice(-49), clone(current)];
    future.current = [];
    bump((v) => v + 1);
  }, []);

  const undo = useCallback((current: FantasyMapDoc): FantasyMapDoc | null => {
    if (!past.current.length) return null;
    const prev = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, clone(current)];
    bump((v) => v + 1);
    return prev;
  }, []);

  const redo = useCallback((current: FantasyMapDoc): FantasyMapDoc | null => {
    if (!future.current.length) return null;
    const next = future.current[future.current.length - 1];
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, clone(current)];
    bump((v) => v + 1);
    return next;
  }, []);

  return {
    snapshot,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
