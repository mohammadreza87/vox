'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the "Undo · Beanie" pill stays up after a change (interaction §4.3). */
export const UNDO_MS = 4000;
const DEPTH = 20;

export interface UndoEntry<T> { label: string; before: T }

/**
 * In-step undo: every change pushes what it replaced. The pill shows the top
 * entry for 4 s after each change or undo; undo pops and hands back `before`.
 */
export function useUndoStack<T>() {
  const stack = useRef<UndoEntry<T>[]>([]);
  const [shown, setShown] = useState<{ entry: UndoEntry<T>; n: number } | null>(null);
  const n = useRef(0);

  const show = useCallback(() => {
    const top = stack.current[stack.current.length - 1];
    setShown(top ? { entry: top, n: ++n.current } : null);
  }, []);

  const push = useCallback((label: string, before: T) => {
    stack.current = [...stack.current.slice(1 - DEPTH), { label, before }];
    show();
  }, [show]);

  const undo = useCallback((): UndoEntry<T> | null => {
    const top = stack.current[stack.current.length - 1];
    if (!top) return null;
    stack.current = stack.current.slice(0, -1);
    show();
    return top;
  }, [show]);

  const dismiss = useCallback(() => setShown(null), []);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [shown]);

  return { push, undo, dismiss, pill: shown?.entry ?? null, pillKey: shown?.n ?? 0 };
}
