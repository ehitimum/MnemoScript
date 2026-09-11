import { useCallback, useMemo, useRef, useState } from 'react';
import type { FantasyMapDoc } from './mapTypes';

/**
 * Undo/redo over whole-document snapshots. `snapshot(current)` is called right
 * before a mutation so undo can step back to it; any new action clears the
 * redo stack. Stack depths are mirrored into state so the toolbar buttons
 * enable/disable without reading refs during render.
 */
export function useMapHistory() {
  const past = useRef<FantasyMapDoc[]>([]);
  const future = useRef<FantasyMapDoc[]>([]);
  const [depths, setDepths] = useState({ past: 0, future: 0 });

  const sync = () => setDepths({ past: past.current.length, future: future.current.length });

  const snapshot = useCallback((current: FantasyMapDoc) => {
    past.current = [...past.current.slice(-49), clone(current)];
    future.current = [];
    sync();
  }, []);

  const undo = useCallback((current: FantasyMapDoc): FantasyMapDoc | null => {
    if (!past.current.length) return null;
    const prev = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, clone(current)];
    sync();
    return prev;
  }, []);

  const redo = useCallback((current: FantasyMapDoc): FantasyMapDoc | null => {
    if (!future.current.length) return null;
    const next = future.current[future.current.length - 1];
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, clone(current)];
    sync();
    return next;
  }, []);

  return useMemo(
    () => ({ snapshot, undo, redo, canUndo: depths.past > 0, canRedo: depths.future > 0 }),
    [snapshot, undo, redo, depths],
  );
}

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
