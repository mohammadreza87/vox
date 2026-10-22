import { describe, expect, it } from 'vitest';
import {
  BINARY_VECTOR_DIMS, extractStyleFeatures, nextBurstIndex, SPLIT_WINDOW_MS, STYLE_FEATURE_KEYS,
  STYLE_VECTOR_DIM, STYLE_VECTOR_KEYS, styleFeaturesSchema, styleVector, type StyleObservationInput,
} from '../style-features';
import type { StyleFeatures } from '../types';

const AT = Date.UTC(2026, 9, 20, 12, 0);
const text = (value: string, extra: Partial<StyleObservationInput> = {}): StyleFeatures =>
  extractStyleFeatures({ kind: 'text', text: value, edited: false, at: AT, ...extra });

const RATIO_KEYS = ['persianScriptRatio', 'latinScriptRatio', 'finglishRatio', 'zwnjPerWord', 'persianDigitShare',
  'arabicVariantShare', 'latinUpperShare', 'persianQuestionShare'] as const;

describe('style features: Persian, English and Finglish', () => {
  it('(a) extracts Persian script, ZWNJ, Persian digits, the Persian question mark and one emoji', () => {
    const f = text('سلام، خوبی؟ می‌خواهم فردا ۳ تا جلسه بذاریم 🙂');
    expect(f.kind).toBe('text');
    expect(f.persianScriptRatio).toBe(1);
    expect(f.latinScriptRatio).toBe(0);
    expect(f.zwnjPerWord).toBeGreaterThan(0);
    expect(f.persianDigitShare).toBe(1);
    expect(f.persianQuestionShare).toBe(1);
    expect(f.emojiCount).toBe(1);
    expect(f.emoticonCount).toBe(0);
    expect(f.endsWithPunctuation).toBe(false);
  });

  it('(b) extracts English script, repeated punctuation and an emoticon', () => {
    const f = text('Hey, are we still on for 3pm?? :)');
    expect(f.latinScriptRatio).toBe(1);
    expect(f.persianScriptRatio).toBe(0);
    expect(f.repeatedPunctuation).toBe(true);
    expect(f.emoticonCount).toBe(1);
    expect(f.persianQuestionShare).toBe(0);
    expect(f.latinUpperShare).toBeGreaterThan(0);
    expect(f.finglishRatio).toBe(0);
    expect(f.persianDigitShare).toBe(0);
  });

  it('(c) recognises Finglish from the fixed lexicon', () => {
    expect(text('salam khobi? farda mikham biam').finglishRatio).toBeGreaterThanOrEqual(0.6);
  });

  it('(d) recognises Finglish digit-as-letter spellings', () => {
    expect(text('ma3loom').finglishRatio).toBe(1);
    expect(text('Meeting at 3pm').finglishRatio).toBe(0);
  });

  it('(e) measures Arabic-variant letters', () => {
    expect(text('كتاب علي').arabicVariantShare).toBe(1);
    expect(text('کتاب علی').arabicVariantShare).toBe(0);
    expect(text('hello').arabicVariantShare).toBeNull();
  });

  it('(f) counts a ZWJ family once and flags per pair', () => {
    expect(text('👨‍👩‍👧').emojiCount).toBe(1);
    expect(text('🇮🇷🇺🇸').emojiCount).toBe(2);
    expect(text('👍🏽 ok').emojiCount).toBe(1);
    expect(text('🙂🙂🙂🙂🙂🙂🙂').emojiCount).toBe(5);
  });
});

describe('style features: Unicode safety and bands', () => {
  it('(g) never throws on hostile Unicode and always passes the strict schema', () => {
    const mixed = Array.from({ length: 10_000 }, (_, i) => 'aب ۱1؟?‌‍́🙂‏‎'[i % 13]).join('');
    const inputs = ['', '   \n\t ', '\uD800abc', 'abc\uDC00', 'é́̂ ẹ̀', '‏‎سلام‫ hi ‬', mixed,
      '‍‍', '﻿', '‌'];
    for (const value of inputs) {
      const f = text(value);
      expect(styleFeaturesSchema.safeParse(f).success).toBe(true);
    }
    expect(text('').punctuationPer100).toBeNull();
    expect(text('').lengthBucket).toBe(0);
    expect(text('').persianScriptRatio).toBeNull();
  });

  it('(h) maps grapheme and word counts to their bands', () => {
    expect(text('abcd').lengthBucket).toBe(1);
    expect(text('a'.repeat(251)).lengthBucket).toBe(6);
    expect(text('a'.repeat(250)).lengthBucket).toBe(5);
    expect(text('🙂🙂🙂🙂').lengthBucket).toBe(1);
    expect(text('').wordBucket).toBe(0);
    expect(text('!!').wordBucket).toBe(0);
    expect(text('word').wordBucket).toBe(1);
    expect(text(Array.from({ length: 32 }, () => 'w').join(' ')).wordBucket).toBe(6);
    expect(text('one two').wordBucket).toBe(2);
  });

  it('(i) takes nothing from text for a voice note and buckets its duration', () => {
    const base = { kind: 'voice' as const, edited: false, at: AT, durationSec: 10 };
    const withText = extractStyleFeatures({ ...base, text: 'سلام Hey!! :) 🙂' });
    const withoutText = extractStyleFeatures(base);
    expect(withText).toEqual(withoutText);
    expect(withText.lengthBucket).toBe(0);
    expect(withText.wordBucket).toBe(0);
    expect(withText.emojiCount).toBe(0);
    expect(withText.emoticonCount).toBe(0);
    expect(withText.repeatedPunctuation).toBe(false);
    expect(withText.endsWithPunctuation).toBe(false);
    for (const key of RATIO_KEYS) expect(withText[key]).toBeNull();
    expect(withText.punctuationPer100).toBeNull();
    expect([4, 10, 30, 60, 200].map(durationSec =>
      extractStyleFeatures({ ...base, durationSec }).voiceDurationBucket)).toEqual([0, 1, 2, 3, 4]);
    expect(extractStyleFeatures({ ...base, durationSec: undefined }).voiceDurationBucket).toBeNull();
    expect(extractStyleFeatures({ ...base, durationSec: Number.NaN }).voiceDurationBucket).toBeNull();
    expect(styleFeaturesSchema.safeParse(withText).success).toBe(true);
  });

  it('(j) buckets the local hour by the UTC offset', () => {
    const at = Date.UTC(2026, 9, 20, 23, 30);
    expect(text('hi', { at, utcOffsetMinutes: 210 }).hourBucket).toBe(1);
    expect(text('hi', { at }).hourBucket).toBe(7);
    expect(text('hi', { at, utcOffsetMinutes: 99_999 }).hourBucket).toBe(text('hi', { at, utcOffsetMinutes: 840 }).hourBucket);
  });

  it('(k) increments the burst index only within the split window', () => {
    expect(nextBurstIndex(undefined, AT)).toBe(1);
    expect(nextBurstIndex({ at: AT, burstIndex: 2 }, AT + 30_000)).toBe(3);
    expect(nextBurstIndex({ at: AT, burstIndex: 2 }, AT + SPLIT_WINDOW_MS)).toBe(3);
    expect(nextBurstIndex({ at: AT, burstIndex: 2 }, AT + SPLIT_WINDOW_MS + 1)).toBe(1);
    expect(nextBurstIndex({ at: AT, burstIndex: 2 }, AT - 1)).toBe(1);
    expect(text('hi', { burstIndex: 40 }).burstIndex).toBe(10);
    expect(text('hi', { burstIndex: -3 }).burstIndex).toBe(1);
    expect(text('hi').burstIndex).toBe(1);
  });

  it('(l) quantises every ratio to a multiple of 0.05', () => {
    const samples = ['سلام Hello دنیا world ۱۲3', 'Mixed TEXT with some UPPER and lower', 'كي کی ي ك ی ک ?? ؟',
      'salam DUDE chetori 5 ۵ ٥', 'می‌خواهم و می‌روم و نمی‌دانم'];
    for (const sample of samples) {
      const f = text(sample);
      for (const key of RATIO_KEYS) {
        const value = f[key];
        if (value === null) continue;
        expect(Math.abs(value * 20 - Math.round(value * 20))).toBeLessThan(1e-9);
      }
    }
  });

  it('(m) maps features to a deterministic 21-dim unit vector', () => {
    expect(STYLE_VECTOR_KEYS).toHaveLength(STYLE_VECTOR_DIM);
    expect(STYLE_VECTOR_DIM).toBe(21);
    expect(BINARY_VECTOR_DIMS.map(i => STYLE_VECTOR_KEYS[i])).toEqual(['kindVoice', 'repeatedPunctuation', 'endsWithPunctuation', 'edited']);
    for (const f of [text('Hey, are we still on for 3pm?? :)'), text('سلام 🙂'), extractStyleFeatures({ kind: 'voice', edited: true, at: AT, durationSec: 30 })]) {
      const v = styleVector(f);
      expect(v).toHaveLength(21);
      for (const x of v) if (x !== null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
      expect(styleVector(f)).toEqual(v);
    }
    expect(Object.keys(text('x'))).toEqual([...STYLE_FEATURE_KEYS]);
  });

  it('rejects anything that is not exactly a feature set', () => {
    const f = text('hello there');
    expect(styleFeaturesSchema.safeParse({ ...f, text: 'hello there' }).success).toBe(false);
    expect(styleFeaturesSchema.safeParse({ ...f, latinScriptRatio: 0.33 }).success).toBe(false);
    expect(styleFeaturesSchema.safeParse({ ...f, lengthBucket: 7 }).success).toBe(false);
    expect(styleFeaturesSchema.safeParse({ ...f, version: 2 }).success).toBe(false);
    expect(styleFeaturesSchema.safeParse({ ...f, latinScriptRatio: Number.NaN }).success).toBe(false);
  });
});
