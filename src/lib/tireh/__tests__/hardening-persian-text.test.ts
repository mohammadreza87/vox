/**
 * H4: the shared Persian fold (src/lib/tireh/text/persian.ts) and the S10L
 * style extractor's hostile-input guard.
 *
 * foldPersian(text, { lowercase: true }) must stay byte-identical to S06's
 * retrieval normaliser as it was at 718752e, except the heh-variant entries
 * listed in CHANGED. NORMALIZED_BEFORE was generated
 * from that code before the change and is committed here; never regenerate it
 * from the code under test. Invisible code points are written as escapes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipGraphemes, foldPersian, isArabicScriptLetter, isLatinLetter } from '../text/persian';
import { extractStyleFeatures, styleFeaturesSchema, zeroStyleFeatures, type StyleObservationInput } from '../identity/style-features';

const CORPUS: readonly string[] = [
  // English
  'Hello World',
  'The launch is on Friday, please remember the DEADLINES.',
  'deadlines access bus',
  'İstanbul ŞEHİR',
  'Straße GROSS',
  'ﬁle and ﬀ',
  'Ｆｕｌｌｗｉｄｔｈ １２３',
  'café naïve résumé',
  'cafe\u0301 deja\u0300',
  'emoji 👍🏽 and 👨\u200D👩\u200D👧',
  '\u200Etext\u200F with LRM and RLM',
  '\uFEFFBOM at the start',
  'numbers 2026-10-25 and 3.14',
  'x² and ½',
  'don’t save this',
  // Persian and Arabic script
  'سلام خوبی',
  'كيان',
  'ذخی\u0640\u0640ره نکن',
  'ذخىره نکن',
  'ک\u0650تاب',
  'كت\u0640\u0640\u0640اب',
  'مسئول',
  'أحمد إبراهيم',
  'ٱلله',
  'آب آسمان',
  'مؤسسه',
  'مدرسة',
  'خانۀ ما',
  'خانه\u0654 ما',
  'کردستانە',
  '۱۲ بهمن ۱۴۰۵',
  '٣ أيام',
  'می\u200Cروم به خانه',
  'کتاب\u200Cها و دفترهای من',
  'میروم',
  'نمیدانم',
  'کتابها',
  'میزها',
  'میدان آزادی',
  'میلیون تومان',
  'میراث فرهنگی',
  'میوه و میهمان',
  'میانگین میهن میمون میخ',
  'میل میلیارد میان میانه',
  '\uFEDB\uFE98\uFE8E\uFE8F',
  '\uFDF2',
  '\uFEFB',
  'ی\u200Dک',
  'به\u200Cخاطر نسپار',
  'ذخیره\u200Cاش کن',
  // Mixed
  'سلام hello friend',
  'Meeting با Kian در Tehran ساعت ۱۰',
  'hello، world؟',
  'ok؟؟؟',
  'Kian\u200Cها',
  'گزارش Q4 را بفرست 🙏',
  'RTL \u202Bembedding\u202C test',
  '',
  '   spaces\tand\nnewlines  ',
  'دفترهای JIRA و Docs\u200Cها',
];

const NORMALIZED_BEFORE: readonly string[] = [
  'hello world',
  'the launch is on friday, please remember the deadlines.',
  'deadlines access bus',
  'istanbul şehir',
  'straße gross',
  'file and ff',
  'fullwidth 123',
  'café naïve résumé',
  'café dejà',
  'emoji 👍🏽 and 👨👩👧',
  'text with lrm and rlm',
  'bom at the start',
  'numbers 2026-10-25 and 3.14',
  'x2 and 1⁄2',
  'don’t save this',
  'سلام خوبی',
  'کیان',
  'ذخیره نکن',
  'ذخیره نکن',
  'کتاب',
  'کتاب',
  'مسیول',
  'احمد ابراهیم',
  'الله',
  'اب اسمان',
  'موسسه',
  'مدرسه',
  'خانۀ ما',
  'خانه ما',
  'کردستانە',
  '12 بهمن 1405',
  '3 ایام',
  'می\u200Cروم به خانه',
  'کتاب\u200Cها و دفترهای من',
  'میروم',
  'نمیدانم',
  'کتابها',
  'میزها',
  'میدان ازادی',
  'میلیون تومان',
  'میراث فرهنگی',
  'میوه و میهمان',
  'میانگین میهن میمون میخ',
  'میل میلیارد میان میانه',
  'کتاب',
  'الله',
  'لا',
  'یک',
  'به\u200Cخاطر نسپار',
  'ذخیره\u200Cاش کن',
  'سلام hello friend',
  'meeting با kian در tehran ساعت 10',
  'hello، world؟',
  'ok؟؟؟',
  'kian\u200Cها',
  'گزارش q4 را بفرست 🙏',
  'rtl \u202Bembedding\u202C test',
  '',
  '   spaces\tand\nnewlines  ',
  'دفترهای jira و docs\u200Cها',
];

/**
 * The only entries whose fold changes on purpose (F139): heh with yeh above U+06C0 and ae U+06D5 now fold to
 * heh U+0647. Every other entry is byte-identical to 718752e.
 */
const CHANGED: Readonly<Record<number, string>> = {
  27: 'خانه ما',
  29: 'کردستانه',
};

describe('foldPersian', () => {
  it('has the committed 60-string corpus', () => {
    expect(CORPUS).toHaveLength(60);
    expect(NORMALIZED_BEFORE).toHaveLength(60);
  });

  it('with lowercase equals the pre-change retrieval normaliser on every corpus string', () => {
    CORPUS.forEach((text, i) => {
      expect([i, foldPersian(text, { lowercase: true })]).toEqual([i, CHANGED[i] ?? NORMALIZED_BEFORE[i]]);
    });
  });

  it('changes the heh variants only: CHANGED differs from the old output by U+06C0 and U+06D5 alone', () => {
    for (const [i, after] of Object.entries(CHANGED)) {
      const before = NORMALIZED_BEFORE[Number(i)];
      expect(before.replace(/[ۀە]/g, 'ه')).toBe(after);
      expect(before).not.toBe(after);
    }
    expect(foldPersian('خانۀ')).toBe(foldPersian('خانهٔ'));
  });

  it('without lowercase differs only by case', () => {
    CORPUS.forEach((text, i) => {
      // Lowercasing 'İ' adds a combining dot, which the fold strips only when it lowercases first (the order of 718752e).
      if (text.includes('İ')) return;
      expect([i, foldPersian(text).toLowerCase()]).toEqual([i, foldPersian(text, { lowercase: true })]);
    });
    expect(foldPersian('Kian كتاب')).toBe('Kian کتاب');
  });

  it('folds Arabic letter variants, tatweel, marks and digits, and keeps ZWNJ', () => {
    expect(foldPersian('ذخی\u0640\u0640ره نکن')).toBe('ذخیره نکن');
    expect(foldPersian('ذخىره نكن')).toBe('ذخیره نکن');
    expect(foldPersian('\uFEDB\uFE98\uFE8E\uFE8F')).toBe('کتاب');
    expect(foldPersian('ک\u0650تاب')).toBe('کتاب');
    expect(foldPersian('ذخیره\u200Cاش')).toBe('ذخیره\u200Cاش');
    expect(foldPersian('\uFEFF\u200E\u200Fی\u200Dک')).toBe('یک');
    expect(foldPersian('۱۲ ٣٤')).toBe('12 34');
  });
});

describe('script letters', () => {
  it.each([
    ['ک', true, false], ['ی', true, false], ['ي', true, false], ['\uFEDB', true, false], ['ݐ', true, false],
    ['،', false, false], ['؟', false, false], ['؛', false, false], ['\u0640', false, false],
    ['\uFEFF', false, false], ['\u0650', false, false], ['۱', false, false], ['٣', false, false],
    ['a', false, true], ['Z', false, true], ['é', false, true], ['1', false, false], ['?', false, false], ['ß', false, true],
  ])('%s: arabic %s, latin %s', (ch, arabic, latin) => {
    expect(isArabicScriptLetter(ch)).toBe(arabic);
    expect(isLatinLetter(ch)).toBe(latin);
  });
});

describe('clipGraphemes', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('never splits a letter from its marks or a ZWJ emoji sequence', () => {
    const marked = 'خانه\u0654';
    expect(clipGraphemes(`${marked} ما`, 4)).toBe(marked);
    expect(clipGraphemes('ا\u064E\u0651ب', 1)).toBe('ا\u064E\u0651');
    const family = '👨\u200D👩\u200D👧';
    expect(clipGraphemes(`${family}x`, 1)).toBe(family);
    expect(clipGraphemes('abc', 10)).toBe('abc');
    expect(clipGraphemes('abc', 0)).toBe('');
    expect(clipGraphemes('abc', -1)).toBe('');
    expect(clipGraphemes('abc', Number.NaN)).toBe('');
    expect(clipGraphemes('abc', Number.POSITIVE_INFINITY)).toBe('abc');
  });

  it('falls back to code points without Intl.Segmenter', async () => {
    vi.resetModules();
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    const fresh = await import('../text/persian');
    expect(fresh.clipGraphemes('a😀b', 2)).toBe('a😀');
    expect(fresh.clipGraphemes('abc', 5)).toBe('abc');
  });
});

describe('extractStyleFeatures hostile input (S10L verifier)', () => {
  const hostile = (patch: PropertyDescriptorMap): StyleObservationInput =>
    Object.defineProperties({ kind: 'text', text: 'سلام', edited: false, at: 0 }, patch) as unknown as StyleObservationInput;
  const boom = { get(): never { throw new Error('boom'); } };

  it('a throwing getter gives the zero feature set of the modality', () => {
    for (const key of ['text', 'edited', 'at', 'burstIndex', 'utcOffsetMinutes']) {
      const f = extractStyleFeatures(hostile({ [key]: boom }));
      expect([key, f]).toEqual([key, zeroStyleFeatures('text')]);
      expect(styleFeaturesSchema.safeParse(f).success).toBe(true);
    }
    expect(extractStyleFeatures(hostile({ kind: boom }))).toEqual(zeroStyleFeatures('text'));
    const voice = extractStyleFeatures(hostile({ kind: { value: 'voice' }, durationSec: boom }));
    expect(voice).toEqual(zeroStyleFeatures('voice'));
    expect(styleFeaturesSchema.safeParse(voice).success).toBe(true);
  });

  it('a well-behaved input is unchanged', () => {
    const f = extractStyleFeatures({ kind: 'text', text: 'سلام، خوبی؟ ok', edited: false, at: 0 });
    expect(f.persianScriptRatio).toBe(0.8);
    expect(f.latinScriptRatio).toBe(0.2);
    expect(f).not.toEqual(zeroStyleFeatures('text'));
  });
});
