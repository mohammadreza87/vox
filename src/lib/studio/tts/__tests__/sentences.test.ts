import { describe, expect, it } from 'vitest';
import { MAX_PIECE_CHARS, MIN_PIECE_CHARS, SOFT_BREAK_CHARS, splitSentences } from '../sentences';

const rejoin = (pieces: string[]) => pieces.join(' ');
const squash = (text: string) => text.trim().replace(/\s+/g, ' ');

describe('splitSentences: English', () => {
  it('cuts at . ! ? and … followed by a space or the end', () => {
    expect(splitSentences('I watered the seed this morning. It is already taller! Do you want to see it? Maybe after lunch, then…', 'en')).toEqual([
      'I watered the seed this morning.', 'It is already taller!', 'Do you want to see it?', 'Maybe after lunch, then…',
    ]);
  });

  it('never cuts after abbreviations, initials, or inside decimals, versions and URLs', () => {
    expect(splitSentences('Bring something small, e.g. a cookie or a ball. The release is 3.5 times bigger than v2.1 was.', 'en')).toEqual([
      'Bring something small, e.g. a cookie or a ball.', 'The release is 3.5 times bigger than v2.1 was.',
    ]);
    expect(splitSentences('Dr. Rahimi signed off with J. Smith at 9 a.m. today. See https://vox.example/docs/a.b for more.', 'en')).toEqual([
      'Dr. Rahimi signed off with J. Smith at 9 a.m. today.', 'See https://vox.example/docs/a.b for more.',
    ]);
  });

  it('keeps a quoted sentence whole and takes closing quotes with the end mark', () => {
    expect(splitSentences('She said “Stop. Think first.” and then we planned the launch together. That was the whole plan for today.', 'en')).toEqual([
      'She said “Stop. Think first.” and then we planned the launch together.', 'That was the whole plan for today.',
    ]);
    expect(splitSentences('He told me "ship it today!" Then he left for the long weekend away.', 'en')).toEqual([
      'He told me "ship it today!"', 'Then he left for the long weekend away.',
    ]);
  });

  it('merges pieces under MIN_PIECE_CHARS so prosody does not chop', () => {
    expect(splitSentences('Hi there! How are you doing? I hope the standup went well today.', 'en')).toEqual([
      'Hi there! How are you doing?', 'I hope the standup went well today.',
    ]);
    expect(splitSentences('Hi! How are you? I hope the standup went well.', 'en')).toEqual(['Hi! How are you? I hope the standup went well.']);
    expect(splitSentences('That was a long and lovely day together. Yes!', 'en')).toEqual(['That was a long and lovely day together. Yes!']);
    expect(splitSentences('Okay.', 'en')).toEqual(['Okay.']);
  });

  it('caps a run-on sentence at MAX_PIECE_CHARS, preferring a clause mark, and loses no words', () => {
    const long = Array.from({ length: 30 }, (_, i) => `clause number ${i}, with more words`).join(' ') + '.';
    const pieces = splitSentences(long, 'en');
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(MAX_PIECE_CHARS);
    for (const p of pieces.slice(0, -1)) expect(p.endsWith(',')).toBe(true);
    expect(rejoin(pieces)).toBe(squash(long));
  });

  it('returns nothing for empty text', () => {
    expect(splitSentences('   ', 'en')).toEqual([]);
  });
});

describe('splitSentences: Persian', () => {
  it('cuts at . ! ؟ and keeps Persian decimals and dates whole', () => {
    expect(splitSentences('امروز سبزه‌مون یه ذره قد کشید. فردا هم آبش بدیم؟ قدش الان ۳.۵ سانته! چه خوب شد که با هم کاشتیمش.', 'fa')).toEqual([
      'امروز سبزه‌مون یه ذره قد کشید.', 'فردا هم آبش بدیم؟ قدش الان ۳.۵ سانته!', 'چه خوب شد که با هم کاشتیمش.',
    ]);
    expect(splitSentences('نوروز ۱۴۰۶ ه.ش. با هفت‌سین شروع می‌شه و ما هم آماده‌ایم. سبزه رو چیدیم و منتظر سال نوییم!', 'fa')).toEqual([
      'نوروز ۱۴۰۶ ه.ش. با هفت‌سین شروع می‌شه و ما هم آماده‌ایم.', 'سبزه رو چیدیم و منتظر سال نوییم!',
    ]);
  });

  it('keeps «…» quotes whole', () => {
    expect(splitSentences('مادربزرگ همیشه می‌گفت «صبر کن. عجله نکن.» و من هنوز یادمه. حالا نوبت توئه که بگی.', 'fa')).toEqual([
      'مادربزرگ همیشه می‌گفت «صبر کن. عجله نکن.» و من هنوز یادمه.', 'حالا نوبت توئه که بگی.',
    ]);
  });

  it('uses ، as a soft cut only in a sentence longer than SOFT_BREAK_CHARS', () => {
    const short = 'امروز کلی کار کردیم، جلسه داشتیم، برنامهٔ انتشار رو نوشتیم و آخرش هم با هم چای خوردیم.';
    expect(short.length).toBeLessThan(SOFT_BREAK_CHARS);
    expect(splitSentences(short, 'fa')).toEqual([short]);

    const clause = 'امروز با تیم دربارهٔ برنامهٔ انتشار نسخهٔ تازه حرف زدیم';
    const long = `${Array.from({ length: 5 }, () => clause).join('، ')}.`;
    expect(long.length).toBeGreaterThan(SOFT_BREAK_CHARS);
    const pieces = splitSentences(long, 'fa');
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(SOFT_BREAK_CHARS);
      expect(p.length).toBeGreaterThanOrEqual(MIN_PIECE_CHARS);
    }
    for (const p of pieces.slice(0, -1)) expect(p.endsWith('،')).toBe(true);
    expect(rejoin(pieces)).toBe(long);
  });

  it('handles mixed Persian and English in one reply', () => {
    expect(splitSentences('جلسهٔ standup ساعت ده بود. Then we shipped v1.2 to the team! خیلی خوش گذشت؟', 'fa')).toEqual([
      'جلسهٔ standup ساعت ده بود.', 'Then we shipped v1.2 to the team! خیلی خوش گذشت؟',
    ]);
  });
});
