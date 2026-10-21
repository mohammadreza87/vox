import { describe, expect, it } from 'vitest';
import {
  extractStyleFeatures, FINGLISH_MARKERS, hourBucket, lengthBucket, MAX_ANALYSED_GRAPHEMES, quantize, styleFeaturesSchema,
  voiceDurationBucket, type StyleFeatures, type TextStyleFeatures,
} from '../style-features';

const AT = Date.UTC(2026, 9, 20, 9, 0);
const text = (value: string, extra: Partial<{ previousAt: number; timeZone: string; edited: boolean }> = {}): TextStyleFeatures => {
  const features = extractStyleFeatures({ modality: 'text', text: value, at: AT, ...extra });
  expect(features.modality).toBe('text');
  return features.text!;
};
const RATIO_KEYS = ['persianScriptRatio', 'latinScriptRatio', 'finglishRatio', 'punctuationRate', 'emoticonRate', 'zwnjRate',
  'arabicVariantRatio', 'repeatedCharRate', 'uppercaseRatio'] as const;
const onGrid = (x: number) => Math.abs(x * 20 - Math.round(x * 20)) < 1e-9 && x >= 0 && x <= 1;

describe('extractStyleFeatures: Persian', () => {
  it('measures script, ZWNJ, emoticon runs and Persian punctuation', () => {
    const f = text('سلام، می‌خواهم بیام)))');
    expect(f.persianScriptRatio).toBe(1);
    expect(f.latinScriptRatio).toBe(0);
    expect(f.zwnjRate).toBeGreaterThan(0);
    expect(f.emoticonRate).toBeGreaterThan(0);
    expect(f.punctuationRate).toBeGreaterThan(0);
    expect(f.digitScript).toBe(0);
    // The ')))' run counts once, like a single emoticon.
    const once = text('سلام، می‌خواهم بیام)');
    expect(once.emoticonRate).toBe(0);
    expect(text('سلام، می‌خواهم بیام))').emoticonRate).toBe(f.emoticonRate);
  });

  it('classifies digit scripts', () => {
    expect(text('ساعت ۱۲۳').digitScript).toBe(2);
    expect(text('ساعت ١٢٣').digitScript).toBe(3);
    expect(text('at 123').digitScript).toBe(1);
    expect(text('at 1 و ۲').digitScript).toBe(4);
    expect(text('no digits').digitScript).toBe(0);
  });

  it('measures Arabic versus Persian yeh and kaf', () => {
    expect(text('كتاب علي').arabicVariantRatio).toBe(1);
    expect(text('کتاب علی').arabicVariantRatio).toBe(0);
  });

  it('normalizes presentation forms and combining marks via NFKC', () => {
    // U+FEDB ARABIC LETTER KAF INITIAL FORM -> U+0643 (Arabic kaf).
    const f = text('ﻛتاب');
    expect(f.persianScriptRatio).toBe(1);
    expect(f.arabicVariantRatio).toBe(1);
    const combined = text('été');
    expect(combined.latinScriptRatio).toBe(1);
    expect(combined).toEqual(text('été'));
  });

  it('detects repeated letters in both scripts', () => {
    expect(text('سلاممممم').repeatedCharRate).toBeGreaterThan(0);
    expect(text('sooooo').repeatedCharRate).toBeGreaterThan(0);
    expect(text('so good').repeatedCharRate).toBe(0);
  });
});

describe('extractStyleFeatures: English and Finglish', () => {
  it('measures Finglish markers', () => {
    const f = text('salam khoobi? merci');
    expect(f.latinScriptRatio).toBe(1);
    expect(f.finglishRatio).toBeGreaterThanOrEqual(0.6);
    expect(f.terminalPunctuation).toBe(false);
  });

  it('measures English punctuation and capitals', () => {
    const f = text('Hello there, how are you?');
    expect(f.finglishRatio).toBe(0);
    expect(f.terminalPunctuation).toBe(true);
    expect(f.uppercaseRatio).toBeGreaterThan(0);
    expect(f.persianScriptRatio).toBe(0);
  });

  it('counts ASCII emoticons and pictographs', () => {
    expect(text('ok :)').emoticonRate).toBeGreaterThan(0);
    expect(text('ok 🙂').emoticonRate).toBeGreaterThan(0);
    expect(text('ok').emoticonRate).toBe(0);
  });

  it('has a fixed, frozen Finglish marker set of 30 tokens', () => {
    expect(FINGLISH_MARKERS.size).toBe(30);
    expect(Object.isFrozen(FINGLISH_MARKERS)).toBe(true);
    for (const word of FINGLISH_MARKERS) expect(word).toBe(word.toLowerCase());
  });
});

describe('extractStyleFeatures: Unicode safety and bounds', () => {
  it('treats a ZWJ family emoji as one grapheme', () => {
    expect(text('👨‍👩‍👧').lengthBucket).toBe(0);
  });

  it('does not throw on lone surrogates', () => {
    expect(() => extractStyleFeatures({ modality: 'text', text: '\uD800abc', at: AT })).not.toThrow();
    expect(() => extractStyleFeatures({ modality: 'text', text: 'abc\uDC00', at: AT })).not.toThrow();
    expect(text('\uD800abc').latinScriptRatio).toBe(1);
  });

  it('gives zeros for empty or whitespace-only text', () => {
    for (const value of ['', '   \n\t ']) {
      const f = text(value);
      for (const key of RATIO_KEYS) expect(f[key]).toBe(0);
      expect(f.lengthBucket).toBe(0);
      expect(f.terminalPunctuation).toBe(false);
    }
  });

  it('bounds the work on a 100k-character input', () => {
    const big = 'سلام دنیا hello world :) '.repeat(4000).slice(0, 100_000);
    const start = performance.now();
    const f = text(big);
    expect(performance.now() - start).toBeLessThan(200);
    expect(f.lengthBucket).toBe(5);
    // Only the first MAX_ANALYSED_GRAPHEMES graphemes are analysed: equal to analysing that prefix.
    const prefix = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(big)].slice(0, MAX_ANALYSED_GRAPHEMES).map(s => s.segment).join('');
    expect(f).toEqual(text(prefix));
  });

  it('puts every ratio on the 0.05 grid', () => {
    for (const value of ['سلام، می‌خواهم بیام)))', 'Hello there, how are you?', 'salam khoobi? merci', 'a'.repeat(37) + '!!', 'كتاب ک ی ي 😀😀 :) ;)']) {
      const f = text(value);
      for (const key of RATIO_KEYS) expect(onGrid(f[key])).toBe(true);
    }
    expect(quantize(0.333)).toBe(0.35);
    expect(quantize(Number.NaN)).toBe(0);
    expect(quantize(7)).toBe(1);
    expect(quantize(-1)).toBe(0);
  });

  it('never throws on hostile input and returns a frozen zero vector of the modality', () => {
    const hostile = { get modality() { return 'text' as const; }, get text(): string { throw new Error('boom'); }, at: AT };
    const f = extractStyleFeatures(hostile);
    expect(f.modality).toBe('text');
    expect(f.text?.lengthBucket).toBe(0);
    expect(Object.isFrozen(f)).toBe(true);
    expect(extractStyleFeatures(null as never).modality).toBe('text');
  });

  it('returns frozen objects without strings except the modality', () => {
    const f = extractStyleFeatures({ modality: 'text', text: 'سلام PRIVATE_TEXT', at: AT });
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.text)).toBe(true);
    const strings: string[] = [];
    JSON.stringify(f, (_k, v) => { if (typeof v === 'string') strings.push(v); return v; });
    expect(strings).toEqual(['text']);
  });
});

describe('buckets, timing and modality', () => {
  it('maps lengths to buckets', () => {
    expect([0, 3, 4, 10, 11, 30, 31, 80, 81, 200, 201].map(lengthBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it('buckets the local hour and falls back to UTC', () => {
    expect(hourBucket(Date.UTC(2026, 9, 20, 20, 0), 'Asia/Tehran')).toBe(5);
    expect(hourBucket(Date.UTC(2026, 9, 20, 20, 0), 'Not/AZone')).toBe(5);
    expect(hourBucket(Date.UTC(2026, 9, 20, 3, 0), 'Not/AZone')).toBe(0);
    expect(hourBucket(Date.UTC(2026, 9, 20, 9, 0))).toBe(2);
    expect(hourBucket(Number.NaN)).toBe(0);
  });

  it('marks follow-on messages within 60 s only', () => {
    const at = (previousAt: number) => extractStyleFeatures({ modality: 'text', text: 'x', at: AT, previousAt }).followOn;
    expect(at(AT - 59_000)).toBe(true);
    expect(at(AT - 61_000)).toBe(false);
    expect(at(AT + 1_000)).toBe(false);
    expect(extractStyleFeatures({ modality: 'text', text: 'x', at: AT }).followOn).toBe(false);
  });

  it('never reads text for voice and buckets the duration', () => {
    const withText = extractStyleFeatures({ modality: 'voice', text: 'PRIVATE TRANSCRIPT', voiceDurationSec: 12, at: AT });
    const without = extractStyleFeatures({ modality: 'voice', voiceDurationSec: 12, at: AT });
    expect(withText).toEqual(without);
    expect(withText.text).toBeUndefined();
    const reader = { modality: 'voice' as const, at: AT, get text(): string { throw new Error('text was read'); } };
    expect(extractStyleFeatures(reader).voiceDurationBucket).toBe(3);
    expect([0, 4.99, 5, 14.99, 15, 59.99, 60, undefined, -1, Number.NaN].map(voiceDurationBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
  });

  it('records the edit flag', () => {
    expect(extractStyleFeatures({ modality: 'text', text: 'x', at: AT, edited: true }).edited).toBe(true);
    expect(extractStyleFeatures({ modality: 'text', text: 'x', at: AT }).edited).toBe(false);
  });
});

describe('styleFeaturesSchema', () => {
  const valid = extractStyleFeatures({ modality: 'text', text: 'Hello :)', at: AT });
  const voice = extractStyleFeatures({ modality: 'voice', voiceDurationSec: 3, at: AT });

  it('accepts extracted features', () => {
    expect(styleFeaturesSchema.safeParse(valid).success).toBe(true);
    expect(styleFeaturesSchema.safeParse(voice).success).toBe(true);
  });

  it('rejects extra keys, raw text and mismatched modality blocks', () => {
    const cases: unknown[] = [
      { ...valid, raw: 'secret' },
      { ...valid, text: 'secret' },
      { ...valid, text: { ...valid.text, raw: 'secret' } },
      { ...valid, text: undefined },
      { version: 1, modality: 'text', hourBucket: 0, followOn: false, edited: false },
      { ...valid, voiceDurationBucket: 1 },
      { ...voice, text: valid.text },
      { ...valid, text: { ...valid.text, emoticonRate: 0.123 } },
      { ...valid, hourBucket: 6 },
      { ...valid, version: 2 },
    ];
    for (const value of cases) expect(styleFeaturesSchema.safeParse(value).success).toBe(false);
  });

  it('types the parsed result as StyleFeatures', () => {
    const parsed: StyleFeatures = styleFeaturesSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });
});
