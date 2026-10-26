/**
 * H4 (F093): retrieval.ts tokenize() before and after the stemmer change.
 *
 * TOKENS_BEFORE was generated from the code at 718752e before the change and
 * is committed here; never regenerate it from the code under test. The only
 * allowed differences are the false stems listed in STEMMER_CHANGES: the
 * plural suffix and the verbal prefix are no longer stacked (میزها gave زها)
 * and the FA_MI_NOUNS nouns keep their می (میدان gave دان); and the two
 * heh-variant words of FOLD_CHANGES (U+06C0 and U+06D5 now fold to heh).
 */
import { describe, expect, it } from 'vitest';
import { tokenize } from '../memory/retrieval';

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

const TOKENS_BEFORE: readonly (readonly string[])[] = [
  ['hello', 'world'],
  ['launch', 'friday', 'remember', 'deadlines', 'deadline'],
  ['deadlines', 'deadline', 'access', 'bus'],
  ['istanbul', 'şehir'],
  ['straße', 'gross'],
  ['file'],
  ['fullwidth', '123'],
  ['café', 'naïve', 'résumé'],
  ['café', 'dejà'],
  ['emoji'],
  ['text', 'lrm', 'rlm'],
  ['bom', 'start'],
  ['numbers', 'number', '2026', '10', '25', '14'],
  [],
  ['don', 'save'],
  ['سلام', 'خوبی'],
  ['کیان'],
  ['ذخیره', 'نکن'],
  ['ذخیره', 'نکن'],
  ['کتاب'],
  ['کتاب'],
  ['مسیول'],
  ['احمد', 'ابراهیم'],
  ['الله'],
  ['اب', 'اسمان'],
  ['موسسه'],
  ['مدرسه'],
  ['خانۀ'],
  ['خانه'],
  ['کردستانە'],
  ['12', 'بهمن', '1405'],
  ['ایام'],
  ['روم', 'خانه'],
  ['کتاب', 'دفترهای', 'دفتر'],
  ['میروم', 'روم'],
  ['نمیدانم', 'دانم'],
  ['کتابها', 'کتاب'],
  ['میزها', 'میز', 'زها'],
  ['میدان', 'دان', 'ازادی'],
  ['میلیون', 'لیون', 'تومان'],
  ['میراث', 'راث', 'فرهنگی'],
  ['میوه', 'میهمان'],
  ['میانگین', 'انگین', 'میهن', 'میمون', 'مون', 'میخ'],
  ['میل', 'میلیارد', 'لیارد', 'میان', 'میانه', 'انه'],
  ['کتاب'],
  ['الله'],
  ['لا'],
  [],
  ['بهخاطر', 'نسپار'],
  ['ذخیره'],
  ['سلام', 'hello', 'friend'],
  ['meeting', 'kian', 'tehran', 'ساعت', '10'],
  ['hello', 'world'],
  [],
  ['kian'],
  ['گزارش', 'بفرست'],
  ['rtl', 'embedding', 'test'],
  [],
  ['spaces', 'space', 'newlines', 'newline'],
  ['دفترهای', 'دفتر', 'jira', 'docs'],
];

/** Corpus index → tokens after the change (each only drops false stems). */
const STEMMER_CHANGES: Readonly<Record<number, readonly string[]>> = {
  37: ['میزها', 'میز'],
  38: ['میدان', 'ازادی'],
  39: ['میلیون', 'تومان'],
  40: ['میراث', 'فرهنگی'],
  42: ['میانگین', 'میهن', 'میمون', 'میخ'],
  43: ['میل', 'میلیارد', 'میان', 'میانه'],
};

/** Corpus index → tokens after the heh fold (F139: U+06C0 and U+06D5 fold to heh U+0647). */
const FOLD_CHANGES: Readonly<Record<number, readonly string[]>> = {
  27: ['خانه'],
  29: ['کردستانه'],
};

describe('tokenize before and after the H4 stemmer change', () => {
  it('has the committed 60-string corpus', () => {
    expect(CORPUS).toHaveLength(60);
    expect(TOKENS_BEFORE).toHaveLength(60);
  });

  it('is identical on the corpus except the listed stemmer words and the two heh-fold words', () => {
    CORPUS.forEach((text, i) => {
      expect([i, tokenize(text)]).toEqual([i, STEMMER_CHANGES[i] ?? FOLD_CHANGES[i] ?? TOKENS_BEFORE[i]]);
    });
  });

  it('matches the heh variants lexically', () => {
    expect(tokenize('خانۀ')).toEqual(tokenize('خانهٔ'));
    expect(tokenize('خانۀ')).toEqual(['خانه']);
  });

  it('every listed change only removes tokens', () => {
    for (const [i, after] of Object.entries(STEMMER_CHANGES)) {
      const before = TOKENS_BEFORE[Number(i)];
      expect(after.every((t) => before.includes(t))).toBe(true);
      expect(after.length).toBeLessThan(before.length);
    }
  });

  it('gives no false stem for می nouns', () => {
    expect(tokenize('میدان')).toEqual(['میدان']);
    expect(tokenize('میلیون')).toEqual(['میلیون']);
    expect(tokenize('میراث')).toEqual(['میراث']);
    expect(tokenize('میدان میزها')).toEqual(['میدان', 'میزها', 'میز']);
  });

  it('keeps the verbal prefix and plural stems', () => {
    expect(tokenize('میروم')).toEqual(['میروم', 'روم']);
    expect(tokenize('نمیدانم')).toEqual(['نمیدانم', 'دانم']);
    expect(tokenize('کتابها')).toEqual(['کتابها', 'کتاب']);
    expect(tokenize('دفترهای')).toEqual(['دفترهای', 'دفتر']);
    expect(tokenize('می\u200Cروم')).toEqual(['روم']);
  });

  it('never stacks the prefix on a plural', () => {
    expect(tokenize('میوهها')).toEqual(['میوهها', 'میوه']);
    expect(tokenize('میزهای')).toEqual(['میزهای', 'میز']);
  });
});
