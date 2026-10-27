'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { backButton, tg } from './telegram';
import './extras.css';

export interface SheetProps {
  title: string;
  body?: string;
  /** a phrase of the body that names another page (UX-02's "Privacy and memory"): drawn and working as a link */
  link?: { text: string; href: string };
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
  /** a link row under the body (P1's "Choose moments" and its switches) */
  children?: ReactNode;
}

/**
 * Keyboard or pointer, as the browser's :focus-visible decides it: a sheet that opens after a key press puts focus on
 * its first button (and its ring shows); one that opens after a tap focuses the dialog itself, so a touch user never
 * sees a ring they did not ask for (P-25). Module-level: one pair of listeners for every sheet.
 */
let keyboard = false;
let watching = false;
function watchModality() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) keyboard = true; }, true);
  window.addEventListener('pointerdown', () => { keyboard = false; }, true);
}

/** Opens a page of this site outside the pet: Telegram's in-app browser where there is one, else a new tab. */
function openPage(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  const app = tg();
  if (!app?.initData || !app.openLink) return;
  e.preventDefault();
  try { app.openLink(new URL(href, location.href).href); } catch { /* an old client: the plain link stands */ }
}

/**
 * A permission or confirm sheet (design §6.1, §9.4 rule 3): built for Peek first, a title of at most three lines (the
 * ask is never cut), a body of at most four, and two one-line buttons of the same size (decline is never smaller, never
 * hidden). While any sheet is open the whole bottom stack (rail, dock, pill) steps back, the same rule for every sheet
 * (P-29): the sheet is modal. Telegram's BackButton and Escape decline. Nothing in it scrolls; its first sentence is the
 * reason.
 */
export function Sheet({ title, body, link, yes, no, onYes, onNo, children }: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const noRef = useRef(onNo);
  noRef.current = onNo;
  useEffect(() => {
    watchModality();
    const el = box.current;
    (keyboard ? first.current : el)?.focus();
    const root = el?.closest('.pet-root');
    root?.setAttribute('data-sheet', '');
    const offBack = backButton(() => noRef.current());
    return () => {
      offBack();
      if (root && ![...root.querySelectorAll('.pet-sheet')].some((s) => s !== el)) root.removeAttribute('data-sheet');
    };
  }, []);
  const at = body && link ? body.indexOf(link.text) : -1;
  return (
    <div ref={box} className="pet-sheet" role="dialog" aria-modal="true" aria-labelledby="pet-sheet-t" tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') onNo(); }}>
      <b id="pet-sheet-t">{title}</b>
      {body && (at < 0 || !link ? <p>{body}</p> : (
        <p>{body.slice(0, at)}<a href={link.href} target="_blank" rel="noopener noreferrer" onClick={(e) => openPage(e, link.href)}>{link.text}</a>{body.slice(at + link.text.length)}</p>
      ))}
      {children}
      <div className="pet-sheet-row">
        <button ref={first} type="button" className="pet-sheet-yes" onClick={onYes}>{yes}</button>
        <button type="button" onClick={onNo}>{no}</button>
      </div>
    </div>
  );
}
