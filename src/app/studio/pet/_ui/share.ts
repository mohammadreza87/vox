'use client';

/**
 * P7's share card (design §6.2): drawn on this device, offline, from the character on screen and the moment's line.
 * Nothing from the chats, no needs, no name of the person. Loaded only when the person taps Share.
 *
 * Telegram's own share calls cannot take an image made on the device: shareToStory needs an HTTPS media URL and
 * shareMessage a message the bot prepared (savePreparedInlineMessage), both server work. So: the device's share sheet
 * with the card image where it can share files; else Telegram's chat picker (t.me/share/url) with the line and the
 * agent's link; else the line is copied.
 */

import type { PetLang } from './strings';
import { t, type PetStringKey } from './strings';
import { shareLink } from './telegram-more';

export type MomentKind = 'stage' | 'bloom' | 'season';
export type ShareResult = 'shared' | 'telegram' | 'copied' | 'failed';

/** The card's one line, in the system voice (others read it). */
export function cardLine(kind: MomentKind, name: string, lang: PetLang, id?: string): string {
  if (kind === 'bloom') return t('book.page.bloom', undefined, lang);
  if (kind === 'season' && (id === 'yalda' || id === 'suri' || id === 'nowruz')) return t(`book.page.${id}` as PetStringKey, undefined, lang);
  return t('perm.P7.card', { name }, lang);
}

const W = 720, H = 900;

/** The character's SVG as an image (inline: no network), or null. */
async function characterImage(root: HTMLElement | null): Promise<HTMLImageElement | null> {
  const svg = root?.querySelector<SVGSVGElement>('.pet-char svg');
  if (!svg || typeof XMLSerializer === 'undefined' || typeof Image === 'undefined') return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The card as a PNG, or null where the device has no canvas. */
export async function renderCard(root: HTMLElement | null, line: string, color: string, rtl: boolean): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext?.('2d');
  if (!g) return null;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, color); bg.addColorStop(1, '#0E1013');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const img = await characterImage(root);
  if (img) g.drawImage(img, (W - 460) / 2, 110, 460, 460);
  g.fillStyle = '#F4F6F8';
  g.textAlign = 'center';
  g.direction = rtl ? 'rtl' : 'ltr';
  g.font = '600 40px system-ui, sans-serif';
  // two lines at most: the card never shrinks the words to fit
  const words = line.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (g.measureText(next).width > W - 120 && cur) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur);
  lines.slice(0, 2).forEach((l, i) => g.fillText(l, W / 2, 680 + i * 54));
  g.fillStyle = '#ffffff80';
  g.font = '500 26px system-ui, sans-serif';
  g.fillText('Vox', W / 2, H - 60);
  return new Promise((resolve) => { try { c.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); } });
}

/**
 * Get the share ready while the sheet is open (the card drawn ahead), so the tap on Share calls the device's sheet within
 * the tap's own activation. `run` shares the card, or the line with the agent's link, or copies the line.
 */
export async function prepareShare(o: { root: HTMLElement | null; line: string; link: string; color: string; rtl: boolean }): Promise<{ run(): Promise<ShareResult> }> {
  const nav = typeof navigator === 'undefined' ? null : navigator as unknown as { canShare?(d: ShareData): boolean; share?(d: ShareData): Promise<void>; clipboard?: Clipboard };
  let file: File | null = null;
  try {
    const blob = nav?.share && nav.canShare ? await renderCard(o.root, o.line, o.color, o.rtl) : null;
    file = blob && typeof File !== 'undefined' ? new File([blob], 'moment.png', { type: 'image/png' }) : null;
    if (file && !nav?.canShare?.({ files: [file] })) file = null;
  } catch { file = null; }
  return {
    async run() {
      if (file) {
        try { await nav!.share!({ files: [file], text: o.line }); return 'shared'; } catch (e) {
          // the person closed the device's sheet: that is their answer, not a failure to fall back from
          if (e instanceof DOMException && e.name === 'AbortError') return 'failed';
        }
      }
      if (shareLink(o.link, o.line)) return 'telegram';
      try { if (!nav?.clipboard) return 'failed'; await nav.clipboard.writeText(o.line); return 'copied'; } catch { return 'failed'; }
    },
  };
}
