'use client';

import { useEffect, useRef } from 'react';
import { backButton } from './telegram';

export interface SheetProps {
  title: string;
  body?: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}

/**
 * A permission or confirm sheet (design §6.1, §9.4 rule 3): built for Peek first, a title of at most two lines, a body
 * of at most four, and two buttons of the same size (decline is never smaller, never hidden). Telegram's BackButton and
 * Escape decline. Nothing in it scrolls; its first sentence is the reason.
 */
export function Sheet({ title, body, yes, no, onYes, onNo }: SheetProps) {
  const first = useRef<HTMLButtonElement>(null);
  const noRef = useRef(onNo);
  noRef.current = onNo;
  useEffect(() => {
    first.current?.focus();
    return backButton(() => noRef.current());
  }, []);
  return (
    <div className="pet-sheet" role="dialog" aria-modal="true" aria-labelledby="pet-sheet-t" onKeyDown={(e) => { if (e.key === 'Escape') onNo(); }}>
      <b id="pet-sheet-t">{title}</b>
      {body && <p>{body}</p>}
      <div className="pet-sheet-row">
        <button ref={first} type="button" className="pet-sheet-yes" onClick={onYes}>{yes}</button>
        <button type="button" onClick={onNo}>{no}</button>
      </div>
    </div>
  );
}
