import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { daysTogetherText, sayText } from '../copy';
import { circleCopy } from '../circle-copy';
import { CORE } from './core';
import { EN } from './en';
import { FA, voiceOf } from './fa';
import { HERE, KEYS_DOC, LEGAL_KEYS, parseKeysDoc, render } from './generate.mjs';
import { cleanFirst, dir, faDigits, LANG_KEY, langOf, loadStrings, petLang, pick, setPetLang, t, textDir, variants, type PetStringKey } from '.';

const FSI = '⁨', PDI = '⁩';
const keys = Object.keys(EN) as PetStringKey[];
const all = (v: string | readonly string[]) => (typeof v === 'string' ? [v] : [...v]);

function telegram(language_code?: string) {
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1, first_name: 'Sara', language_code } } } };
}

/** Keys with no Persian in the keys file (a "[FA: copywriter]" cell): they show in English on a Persian page. */
const FA_MISSING = keys.filter((k) => FA[k] === undefined);

describe('the catalogue is the copy keys file', () => {
  it('has every key of docs/design/PET_COPY_KEYS_2026_10_26.md, English and the copywriter’s Persian verbatim', () => {
    const rows = parseKeysDoc(readFileSync(KEYS_DOC, 'utf8'));
    expect(keys).toEqual(rows.map((r) => r.key));
    for (const r of rows) {
      expect(EN[r.key as PetStringKey], r.key).toEqual(r.en);
      expect(FA[r.key as PetStringKey] ?? null, r.key).toEqual(r.fa);
      expect(voiceOf(r.key as PetStringKey), r.key).toBe(r.voice);
    }
    // generated files are what generate.mjs writes today (rerun it after editing the keys file)
    const files = render(rows);
    for (const name of ['keys.ts', 'en.ts', 'fa.ts', 'voice.ts', 'core.ts'] as const) {
      expect(readFileSync(join(HERE, name), 'utf8'), name).toBe(files[name]);
    }
  });

  it('leaves out only the legal-process keys (their text is the privacy doc’s)', () => {
    expect(LEGAL_KEYS).toEqual(['perm.P3.*', 'perm.P5.*']);
    for (const k of LEGAL_KEYS) expect(k in EN).toBe(false);
    expect(EN['perm.P9.title']).toBe('Let {name} learn which games you like?');
    expect(FA['perm.P9.title']).toBe('{name} یاد بگیرد کدام بازی‌ها را دوست دارید؟');
  });

  it('has Persian for every key except where the keys file has none yet (on 26 Oct 2026: none)', () => {
    const rows = parseKeysDoc(readFileSync(KEYS_DOC, 'utf8'));
    expect(FA_MISSING).toEqual(rows.filter((r) => r.fa === null).map((r) => r.key));
  });

  it('CORE (the first paint) is the English catalogue, line for line', () => {
    for (const [k, v] of Object.entries(CORE)) expect(v, k).toBe(EN[k as PetStringKey]);
    for (const k of ['room.home', 'toy.feed', 'talk.placeholder', 'quiet.offline.title', 'ui.more', 'say.hiName'] as const) expect(CORE[k]).toBeDefined();
  });
});

describe('copy rules (keys file, global rules; voice guide §4)', () => {
  it('no digits on toys, rooms or needs, in either language', () => {
    for (const k of keys.filter((k) => /^(room|toy)\./.test(k))) {
      for (const s of [...all(EN[k]), ...all(FA[k] ?? '')]) expect(s, k).not.toMatch(/[0-9۰-۹٠-٩]/);
    }
  });

  it('pet-voice lines carry no digits and no emoji (one emoji only at the end of a seasonal DM)', () => {
    const SEASONAL_DM = ['ci.C7.yalda', 'ci.C8.suri', 'ci.C9.nowruz'];
    const emoji = /\p{Extended_Pictographic}/u;
    for (const k of keys.filter((k) => voiceOf(k) === 'pet')) {
      for (const s of all(FA[k] ?? '')) {
        expect(s, k).not.toMatch(/[0-9۰-۹٠-٩]/);
        if (SEASONAL_DM.includes(k)) expect(s.replace(/ \p{Extended_Pictographic}$/u, ''), k).not.toMatch(emoji);
        else expect(s, k).not.toMatch(emoji);
      }
      for (const s of all(EN[k])) {
        expect(s, k).not.toMatch(/[0-9]/);
        expect(s, k).not.toMatch(emoji);
      }
    }
  });

  it('Persian uses Persian letters and punctuation: no Arabic ي ك ى ة, no Latin ? ; or ..., no Arabic-Indic digits', () => {
    for (const k of keys) {
      for (const s of all(FA[k] ?? '')) {
        expect(s, k).not.toMatch(/[يكىة٠-٩]/);
        expect(s, k).not.toMatch(/[?;]|\.\.\./);
      }
    }
  });

  it('placeholders never carry a suffix in Persian (voice guide §5.1)', () => {
    // a letter or ZWNJ right after the placeholder; punctuation («،» «!» «؟») is fine
    for (const k of keys) for (const s of all(FA[k] ?? '')) expect(s, k).not.toMatch(/\}[ؠ-يٱ-ۓ‌]/);
  });
});

describe('t, pick and the language', () => {
  beforeAll(() => loadStrings('fa'));
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.restoreAllMocks(); });

  it('picks Persian from Telegram’s language_code (fa…), else English; a stored choice wins', () => {
    expect(petLang()).toBe('en');
    telegram('fa-IR');
    expect(petLang()).toBe('fa');
    telegram('fr');
    expect(petLang()).toBe('en');
    setPetLang('fa');
    expect(localStorage.getItem(LANG_KEY)).toBe('fa');
    expect(petLang()).toBe('fa');
    setPetLang(null);
    expect(petLang()).toBe('en');
    expect(langOf('fa')).toBe('fa');
    expect(langOf('fas')).toBe('en');
    // the legacy snapshot sweep removes every vox-pet:* key: the choice must not live there
    expect(LANG_KEY.startsWith('vox-pet:')).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    telegram('fa');
    expect(petLang()).toBe('fa');
    expect(() => setPetLang('en')).not.toThrow();
  });

  it('fills placeholders: plain in English, inside Unicode isolates in Persian (never a flipped line)', () => {
    expect(t('talk.placeholder', { name: 'Mochi' }, 'en')).toBe('Talk to Mochi');
    expect(t('talk.placeholder', { name: 'Mochi' }, 'fa')).toBe(`با ${FSI}Mochi${PDI} حرف بزنید…`);
    expect(t('say.hiName', { first: 'Emma' }, 'fa')).toBe(`سلام ${FSI}Emma${PDI}!`);
    expect(t('perm.P10.body', { group: 'Team', name: 'Mochi' }, 'fa')).toContain(`${FSI}Team${PDI}`);
    // a name typed on an Arabic keyboard shows with Persian ی and ک
    expect(t('say.hiName', { first: 'علي' }, 'fa')).toBe(`سلام ${FSI}علی${PDI}!`);
    // an unknown placeholder stays visible rather than vanishing
    expect(t('say.hiName', {}, 'en')).toBe('Hi {first}!');
  });

  it('Persian digits for system voice only; the pet’s lines are never converted', () => {
    expect(t('chip.daysTogether', { n: 12 }, 'fa')).toBe('۱۲ روز رفاقت');
    expect(t('chip.daysTogether', { n: 12 }, 'en')).toBe('12 days together');
    expect(t('why.checkinsRule', { name: 'Mochi' }, 'fa')).toContain('۹ شب تا ۸ صبح');
    expect(faDigits('21:00')).toBe('۲۱:۰۰');
    // a pet line with a number placeholder (none exist today) keeps it as given
    expect(voiceOf('say.hiName')).toBe('pet');
    expect(t('say.hiName', { first: 'R2' }, 'fa')).toBe(`سلام ${FSI}R2${PDI}!`);
  });

  it('falls back to English (no isolates, no Persian digits) for a key with no Persian yet', () => {
    const saved = FA['chip.daysTogether'];
    delete FA['chip.daysTogether'];
    try {
      expect(t('chip.daysTogether', { n: 3 }, 'fa')).toBe('3 days together');
    } finally { FA['chip.daysTogether'] = saved; }
    expect(t('chip.daysTogether', { n: 3 }, 'fa')).toBe('۳ روز رفاقت');
  });

  it('variants: t gives the first; pick follows the seed and never repeats the same one twice in a row', () => {
    expect(t('say.ball.hit', undefined, 'en')).toBe('Got it!');
    expect(variants('season.haftsin.*', 'fa')).toEqual(['سبزه', 'سیب', 'سمنو', 'سیر', 'سرکه']);
    const a = pick('say.ball.miss', 4, undefined, 'en');
    const b = pick('say.ball.miss', 4, undefined, 'en');
    expect(a).not.toBe(b);
    expect(pick('say.yum', 7, undefined, 'fa')).toBe('به‌به!');
  });

  it('direction: rtl for Persian pages and Persian text, ltr otherwise', () => {
    expect(dir('fa')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
    expect(textDir('سلام Emma!')).toBe('rtl');
    expect(textDir('Hi سارا, how was the day?')).toBe('ltr');
    expect(textDir('12345')).toBe('ltr');
  });

  it('a first name fit for a greeting: emoji stripped; empty, digits-only or long names dropped', () => {
    expect(cleanFirst('Sara 🌸')).toBe('Sara');
    expect(cleanFirst('🌸🌸')).toBeUndefined();
    expect(cleanFirst('12345')).toBeUndefined();
    expect(cleanFirst('A'.repeat(21))).toBeUndefined();
    expect(sayText('hi', '🦄')).toBe('Hi!');
    expect(sayText('hi', 'Sara')).toBe('Hi Sara!');
    telegram('fa');
    expect(sayText('hi', 'سارا')).toBe(`سلام ${FSI}سارا${PDI}!`);
    expect(sayText('yum')).toBe('به‌به!');
    expect(daysTogetherText(1)).toBe('روز اول آشنایی');
  });

  it('Circles: Persian lists join with «، » and «و» only before the last name (copy file A.2)', () => {
    expect(circleCopy('fa').with(['سارا', 'علی', 'مینا'])).toBe('اینجا با سارا، علی و مینا');
    expect(circleCopy('fa').with(['سارا'])).toBe('اینجا با سارا');
    expect(circleCopy('en').with(['Sara', 'Ali', 'Mina'])).toBe('Here with Sara, Ali and Mina');
  });
});
