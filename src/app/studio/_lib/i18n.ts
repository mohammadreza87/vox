/**
 * App-level language and direction. One locale for the whole Studio (interaction §7.3):
 * Telegram's language_code picks the default, the You hub can override it, and it persists.
 */

export type Locale = 'en' | 'fa';
export type Dir = 'ltr' | 'rtl';

export const LOCALES: readonly Locale[] = ['en', 'fa'];
export const LOCALE_KEY = 'vx:locale';

export const dirOf = (l: Locale): Dir => (l === 'fa' ? 'rtl' : 'ltr');

/** Telegram language_code ('fa', 'fa-IR', 'FA') → Studio locale. */
export function localeFromLanguageCode(code: string | null | undefined): Locale {
  return code?.trim().toLowerCase().split(/[-_]/)[0] === 'fa' ? 'fa' : 'en';
}

/** Stored choice first, then Telegram's language. Storage can throw (private mode). */
export function initialLocale(languageCode: string | null | undefined): Locale {
  try {
    const v = typeof window === 'undefined' ? null : window.localStorage.getItem(LOCALE_KEY);
    if ((LOCALES as readonly unknown[]).includes(v)) return v as Locale;
  } catch { /* fall through to Telegram */ }
  return localeFromLanguageCode(languageCode);
}

export function persistLocale(l: Locale) {
  try { window.localStorage.setItem(LOCALE_KEY, l); } catch { /* session only */ }
}

const INTL: Record<Locale, string> = { en: 'en-US', fa: 'fa-IR' };
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Locale digits (Persian digits in fa); pair with tabular-nums in CSS. */
export function formatNumber(n: number, l: Locale, minDigits = 1): string {
  const k = `${l}:${minDigits}`;
  let f = numberFormats.get(k);
  if (!f) { f = new Intl.NumberFormat(INTL[l], { minimumIntegerDigits: minDigits, useGrouping: false }); numberFormats.set(k, f); }
  return f.format(n);
}

/** mm:ss in locale digits, for call timers. */
export const formatClock = (seconds: number, l: Locale) =>
  `${formatNumber(Math.floor(seconds / 60), l, 2)}:${formatNumber(Math.floor(seconds % 60), l, 2)}`;
