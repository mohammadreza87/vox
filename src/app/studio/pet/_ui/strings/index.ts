/**
 * Every word the pet page shows, by key (docs/design/PET_COPY_KEYS_2026_10_26.md), in English and Persian.
 *
 * - The language: Telegram's `language_code` (fa… → Persian, as Circles does), unless the person picked one
 *   (`setPetLang`, for a future Settings toggle; kept in localStorage under a key the legacy snapshot sweep never touches).
 * - The catalogues load lazily, one chunk per language (`loadStrings`, `useStrings`); until then the page paints
 *   from CORE, the few English lines the first frame needs. A Persian key with no copy yet falls back to English.
 * - Placeholders in Persian sit inside Unicode isolates (U+2068 … U+2069) so a Latin name never flips the line;
 *   numbers in system-voice Persian become Persian digits. Pet-voice lines are never converted (they carry none).
 */

import { useEffect, useState } from 'react';
import { tg } from '../telegram';
import { CORE } from './core';
import type { PetStringKey } from './keys';
import type { PetString } from './types';
import type { PetVoice } from './voice';

export type { PetStringKey } from './keys';
export type { PetString } from './types';
export type PetLang = 'en' | 'fa';
export type PetVars = Partial<Record<string, string | number>>;

type Catalog = Partial<Record<PetStringKey, PetString>>;
const loaded: { en?: Catalog; fa?: Catalog; voiceOf?: (k: PetStringKey) => PetVoice } = {};
const pending: Partial<Record<PetLang, Promise<void>>> = {};

/** The person's language override (a future Settings toggle). Not `vox-pet:…`: that prefix is swept on open. */
export const LANG_KEY = 'vox.pet.lang';

export const langOf = (code?: string | null): PetLang => (/^fa\b/i.test(code ?? '') ? 'fa' : 'en');

/** Persian when the person chose it, or when Telegram's language_code starts with `fa`. */
export function petLang(): PetLang {
  try {
    const o = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANG_KEY);
    if (o === 'en' || o === 'fa') return o;
  } catch { /* private mode, blocked storage */ }
  return langOf(tg()?.initDataUnsafe?.user?.language_code);
}

/** Pick a language for this device (null: follow Telegram again). */
export function setPetLang(lang: PetLang | null) {
  try {
    if (lang) localStorage.setItem(LANG_KEY, lang);
    else localStorage.removeItem(LANG_KEY);
  } catch { /* private mode */ }
}

export const dir = (lang: PetLang = petLang()): 'rtl' | 'ltr' => (lang === 'fa' ? 'rtl' : 'ltr');

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-zÀ-ɏ]/g;
/** The direction of a free text (a model reply): right-to-left when Persian letters outnumber Latin ones. */
export function textDir(text: string): 'rtl' | 'ltr' {
  const fa = text.match(ARABIC)?.length ?? 0;
  return fa > 0 && fa >= (text.match(LATIN)?.length ?? 0) ? 'rtl' : 'ltr';
}

/** Latin digits as Persian ones (۰-۹, never Arabic-Indic ٠-٩). System voice only. */
export const faDigits = (s: string | number): string => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** Load the catalogue chunk(s) for a language (English always, as the fallback). Safe to call often. */
export function loadStrings(lang: PetLang = petLang()): Promise<void> {
  pending.en ??= import('./en').then((m) => { loaded.en = m.EN; });
  if (lang === 'en') return pending.en;
  pending.fa ??= import('./fa').then((m) => { loaded.fa = m.FA; loaded.voiceOf = m.voiceOf; });
  return Promise.all([pending.en, pending.fa]).then(() => {});
}

export const stringsReady = (lang: PetLang = petLang()) => !!loaded.en && (lang === 'en' || !!loaded.fa);

/** True once the language's catalogue is in (loading it if needed): gate the first painted words on it. */
export function useStrings(lang: PetLang = petLang()): boolean {
  const [ready, setReady] = useState(() => stringsReady(lang));
  useEffect(() => {
    if (stringsReady(lang)) { setReady(true); return; }
    let live = true;
    // a chunk that fails to load (offline) still lets the page paint, in English from CORE
    void loadStrings(lang).catch(() => {}).then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [lang]);
  return ready;
}

/** The raw catalogue value and the language it is really in (a Persian gap falls back to English). */
function lookup(key: PetStringKey, lang: PetLang): [PetString, PetLang] {
  const fa = lang === 'fa' ? loaded.fa?.[key] : undefined;
  if (fa !== undefined) return [fa, 'fa'];
  return [loaded.en?.[key] ?? CORE[key] ?? key, 'en'];
}

const FSI = '⁨', PDI = '⁩';

function format(key: PetStringKey, text: string, vars: PetVars | undefined, lang: PetLang): string {
  const system = lang === 'fa' && (loaded.voiceOf?.(key) ?? 'system') === 'system';
  const template = system ? faDigits(text) : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    if (typeof v === 'number') return system ? faDigits(v) : String(v);
    return lang === 'fa' ? `${FSI}${persianText(v)}${PDI}` : v;
  });
}

/** Arabic-keyboard ي/ك in a name typed by the person, shown as Persian ی/ک (voice guide §4.7). */
const persianText = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک');

/** A string by key, `{name}` / `{first}` / `{group}`… filled in. Variants: the first one. */
export function t(key: PetStringKey, vars?: PetVars, lang: PetLang = petLang()): string {
  const [v, real] = lookup(key, lang);
  return format(key, typeof v === 'string' ? v : v[0], vars, real);
}

const lastPick = new Map<PetStringKey, number>();
/** One of a key's variants for `seed`, never the same one twice in a row. A plain key is just `t`. */
export function pick(key: PetStringKey, seed: number, vars?: PetVars, lang: PetLang = petLang()): string {
  const [v, real] = lookup(key, lang);
  if (typeof v === 'string') return format(key, v, vars, real);
  let i = ((Math.floor(seed) % v.length) + v.length) % v.length;
  if (v.length > 1 && lastPick.get(key) === i) i = (i + 1) % v.length;
  lastPick.set(key, i);
  return format(key, v[i], vars, real);
}

/** Every variant of a key (the haft-sin labels, tests). */
export function variants(key: PetStringKey, lang: PetLang = petLang()): readonly string[] {
  const [v] = lookup(key, lang);
  return typeof v === 'string' ? [v] : v;
}

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
/**
 * The person's Telegram first name, fit for "Hi {first}!" (voice guide §5.1): emoji stripped; empty, digits-only or
 * over 20 characters means no name (the nameless line is used instead).
 */
export function cleanFirst(name?: string | null): string | undefined {
  const s = (name ?? '').replace(EMOJI, '').trim();
  if (!s || s.length > 20 || /^[\p{N}\s]+$/u.test(s)) return undefined;
  return s;
}
