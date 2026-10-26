import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { micSheet, PRIVACY_HREF } from './Extras';
import { Sheet } from './Sheet';
import { loadStrings, t, type PetLang, type PetStringKey } from './strings';

beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; });

const EXTRAS = readFileSync(join(process.cwd(), 'src/app/studio/pet/_ui/extras.css'), 'utf8');

/**
 * Sheets never cut their ask (visual QA P-01): the title may take three lines (extras.css clamps there as a safety net
 * only), and every title must fit three lines at 320 px wide, the smallest phone, in both languages. jsdom cannot lay
 * text out, so this is a character budget: the sheet is 296 px wide there with 18 px padding, so the title has 260 px;
 * the display face runs ~12.3 px a character in English (Unbounded 600 18 px, measured on the QA screenshot: 26
 * characters in 319 px) and ~9.2 in Persian (Vazirmatn at the same size). Words wrap whole, as the browser does.
 */
const TITLE_PX = 320 - 24 - 36;
const PER_CHAR: Record<PetLang, number> = { en: 12.3, fa: 9.2 };
function lines(text: string, lang: PetLang): number {
  const per = Math.floor(TITLE_PX / PER_CHAR[lang]);
  let n = 1, at = 0;
  for (const w of text.replace(/[‌⁨⁩]/g, '').split(/\s+/)) {
    const l = [...w].length;
    if (at === 0) at = l;
    else if (at + 1 + l <= per) at += 1 + l;
    else { n++; at = l; }
  }
  return n;
}
/** every key a Sheet takes as its title (Asks.tsx, Extras.tsx, ClosetRoom.tsx, BookRoom.tsx) */
const TITLE_KEYS: PetStringKey[] = ['ci.paused.title', 'perm.P1.title', 'perm.P1.forming.title', 'perm.P2.title', 'perm.P3b.title', 'perm.P7.title',
  'perm.P8.title', 'perm.P9.title', 'perm.P10.title', 'closet.warning', 'growth.confirm.title'];
const VARS = { name: 'Mochi', first: 'Sara', group: 'HOOR family' };

describe('sheet titles never truncate the ask (P-01)', () => {
  it('extras.css allows three title lines, balanced, and keeps the buttons to one line', () => {
    expect(EXTRAS).toMatch(/\.pet-sheet b \{[^}]*text-wrap: balance;[^}]*-webkit-line-clamp: 3;/);
    expect(EXTRAS).toMatch(/\.pet-sheet-row button \{[^}]*white-space: nowrap;/);
  });

  for (const lang of ['en', 'fa'] as const) {
    it(`${lang}: every sheet title fits three lines at 320 px`, () => {
      const vars = lang === 'fa' ? { ...VARS, name: 'موچی', first: 'سارا' } : VARS;
      for (const k of TITLE_KEYS) expect(lines(t(k, vars, lang), lang), `${k}: ${t(k, vars, lang)}`).toBeLessThanOrEqual(3);
      expect(lines(micSheet(lang, undefined).title, lang)).toBeLessThanOrEqual(3);
    });
  }
});

describe('Sheet', () => {
  const root = () => {
    const main = document.createElement('main');
    main.className = 'pet-root';
    document.body.appendChild(main);
    return main;
  };

  it('opened after a tap: the dialog takes focus, so no ring shows on the primary button (P-25)', () => {
    const main = root();
    fireEvent.pointerDown(window);
    render(<Sheet title="Ask" yes="Yes" no="No" onYes={vi.fn()} onNo={vi.fn()} />, { container: main });
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Ask' }));
    main.remove();
  });

  it('opened after a key press: the primary button takes focus (its ring is the keyboard user\'s)', () => {
    const main = root();
    fireEvent.keyDown(window, { key: 'Tab' });
    render(<Sheet title="Ask" yes="Yes" no="No" onYes={vi.fn()} onNo={vi.fn()} />, { container: main });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.pointerDown(window);
    main.remove();
  });

  it('one rule for every sheet (P-29): the page is marked while any sheet is open, so the bottom stack steps back', () => {
    const main = root();
    const { unmount } = render(<Sheet title="Ask" yes="Yes" no="No" onYes={vi.fn()} onNo={vi.fn()} />, { container: main });
    expect(main).toHaveAttribute('data-sheet');
    expect(EXTRAS).toMatch(/\.pet-root\[data-sheet\] \.pet-bottom \{ visibility: hidden; \}/);
    // a sheet drawn inside the bottom stack (the Closet's, the Life Book's) still shows
    expect(EXTRAS).toMatch(/\.pet-sheet \{[^}]*visibility: visible;/);
    unmount();
    expect(main).not.toHaveAttribute('data-sheet');
    main.remove();
  });

  it('the UX-02 body names Privacy and memory as a link to the Vox privacy page (P-25), in both languages', () => {
    for (const lang of ['en', 'fa'] as const) {
      const c = micSheet(lang, undefined);
      const { unmount } = render(<Sheet {...c} onYes={vi.fn()} onNo={vi.fn()} />);
      const a = screen.getByRole('link', { name: lang === 'en' ? 'Privacy and memory' : 'حریم خصوصی و حافظه' });
      expect(a).toHaveAttribute('href', PRIVACY_HREF);
      // the legal text itself is unchanged: the link is only how part of it is drawn
      expect(screen.getByRole('dialog').querySelector('p')!.textContent).toBe(c.body);
      unmount();
    }
    // with every launch fact resolved, the sentence names the providers and there is no link
    expect(micSheet('en', { providers: 'P', locations: 'L', retention: 'R.' } as never).link).toBeUndefined();
  });
});
