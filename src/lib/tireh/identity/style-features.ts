/**
 * Content-free communication-style features of ONE message (S10L,
 * docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9).
 *
 * Privacy contract: the raw text is read only inside extractStyleFeatures and
 * never returned, cached, logged or kept in a closure. The result holds only
 * small integers, booleans, null, ratios quantised to multiples of 0.05, the
 * literal `version: 1` and the message kind. No word, token, character n-gram,
 * hash of text or matched lexicon entry ever leaves the function. Character
 * n-grams are deliberately excluded.
 *
 * Pure, synchronous and side-effect free; never throws on hostile Unicode.
 */
import { z } from 'zod';
import type { StyleFeatures } from './types';

export interface StyleObservationInput {
  readonly kind: 'text' | 'voice';
  readonly text?: string;              // read transiently; never retained; ignored for voice
  readonly edited: boolean;
  readonly at: number;                 // epoch ms
  readonly utcOffsetMinutes?: number;  // default 0, clamped [-840, 840]
  readonly burstIndex?: number;        // from nextBurstIndex; default 1
  readonly durationSec?: number;       // voice only
}

/** Messages sent within this window of the previous one count as one burst (message splitting). */
export const SPLIT_WINDOW_MS = 90_000;

/** Upper bound on the text inspected; every band saturates long before it. */
const MAX_TEXT_CHARS = 16_384;

export const STYLE_FEATURE_KEYS: readonly (keyof StyleFeatures)[] = Object.freeze([
  'version', 'kind', 'lengthBucket', 'wordBucket', 'persianScriptRatio', 'latinScriptRatio',
  'finglishRatio', 'zwnjPerWord', 'persianDigitShare', 'arabicVariantShare', 'latinUpperShare',
  'punctuationPer100', 'persianQuestionShare', 'repeatedPunctuation', 'endsWithPunctuation',
  'emojiCount', 'emoticonCount', 'burstIndex', 'edited', 'hourBucket', 'voiceDurationBucket',
] as const);

export const STYLE_VECTOR_KEYS: readonly string[] = Object.freeze([
  'kindVoice', 'lengthBucket', 'wordBucket', 'persianScriptRatio', 'latinScriptRatio',
  'finglishRatio', 'zwnjPerWord', 'persianDigitShare', 'arabicVariantShare', 'latinUpperShare',
  'punctuationPer100', 'persianQuestionShare', 'repeatedPunctuation', 'endsWithPunctuation',
  'emojiCount', 'emoticonCount', 'burstIndex', 'edited', 'hourSin', 'hourCos', 'voiceDurationBucket',
]);

export const STYLE_VECTOR_DIM = 21;

/** Indexes of the 0/1 dims in STYLE_VECTOR_KEYS: kindVoice, repeatedPunctuation, endsWithPunctuation, edited. */
export const BINARY_VECTOR_DIMS: readonly number[] = Object.freeze([0, 12, 13, 17]);

/**
 * Unambiguous romanised Persian words. A fixed code constant: it is matched
 * against lowercase Latin words inside the extractor and only a ratio leaves.
 * Ambiguous English words (to, man, are, na, in, ...) are excluded.
 */
export const FINGLISH_LEXICON: ReadonlySet<string> = new Set([
  'salam', 'merci', 'mersi', 'mamnoon', 'mamnun', 'mamnoonam', 'mamnunam', 'chetori', 'chetorin',
  'khobi', 'khoobi', 'khubi', 'khobam', 'khoobam', 'khubam', 'kheili', 'kheyli', 'khaili', 'khob',
  'khoob', 'dige', 'alan', 'farda', 'emrooz', 'emruz', 'dirooz', 'diruz', 'mikham', 'mikhay',
  'mikhaym', 'nemikham', 'nemidoonam', 'nemidunam', 'midoonam', 'midunam', 'bashe', 'baashe',
  'begoo', 'begu', 'chera', 'chikar', 'chekar', 'kojaee', 'kojaei', 'koja', 'hamin', 'vali',
  'vaghean', 'vaghan', 'lotfan', 'akhe', 'areh', 'mishe', 'nemishe', 'ghorboonet', 'ghorbunet',
  'azizam', 'joon', 'baram', 'barat', 'behet', 'behem', 'bebin', 'bebakhshid', 'bebakhshin',
  'bale', 'dorost', 'khodafez', 'khodahafez', 'inja', 'unja', 'oonja', 'chiz', 'kar', 'pas', 'ham',
]);

const DIGIT_AS_LETTER = /^[a-z]*[a-z][2378][a-z]+$/i;
const WORD = /[\p{L}\p{M}\p{N}‌]+/gu;
const LETTER = /\p{L}/u;
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /\p{Script=Latin}/u;
const UPPER = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;
const PUNCT = /\p{P}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL_PAIR = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const REPEATED_PUNCT = /(\p{P})\1+/u;
const MARK = /\p{M}/u;
const EMOTICON_RE = /(?:^|\s)(?::-?\)+|:-?\(+|:-?[DPp]|;-?\)+|[xX]D+|\^_\^|<3+|=\)+)(?=\s|$)/g;

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

function graphemeSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

function isRegionalIndicator(cp: string): boolean {
  const code = cp.codePointAt(0) ?? 0;
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

function isSkinTone(cp: string): boolean {
  const code = cp.codePointAt(0) ?? 0;
  return code >= 0x1f3fb && code <= 0x1f3ff;
}

/** Code-point fallback that keeps marks, ZWJ sequences, skin tones and flag pairs together. */
function fallbackGraphemes(text: string): string[] {
  const out: string[] = [];
  let joinNext = false;
  for (const cp of Array.from(text)) {
    const last = out.length - 1;
    if (last >= 0 && (joinNext || MARK.test(cp) || cp === '‍' || isSkinTone(cp) ||
        (isRegionalIndicator(cp) && Array.from(out[last]).length === 1 && isRegionalIndicator(out[last])))) {
      out[last] += cp;
    } else {
      out.push(cp);
    }
    joinNext = cp === '‍';
  }
  return out;
}

function graphemes(text: string): string[] {
  const seg = graphemeSegmenter();
  if (seg) {
    try {
      const out: string[] = [];
      for (const part of seg.segment(text)) out.push(part.segment);
      return out;
    } catch {
      // fall through to the code-point fallback
    }
  }
  return fallbackGraphemes(text);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? clamp(x, 0, 1) : 0;
}

/** Every ratio is a multiple of 0.05. */
function q(x: number): number {
  return Math.round(clamp01(x) * 20) / 20;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? q(numerator / denominator) : null;
}

function band(value: number, upperBounds: readonly number[]): number {
  for (let i = 0; i < upperBounds.length; i++) if (value <= upperBounds[i]) return i;
  return upperBounds.length;
}

const LENGTH_BANDS = [0, 4, 15, 40, 100, 250] as const;   // 0 | 1-4 | 5-15 | 16-40 | 41-100 | 101-250 | 251+
const WORD_BANDS = [0, 1, 3, 7, 15, 31] as const;         // 0 | 1 | 2-3 | 4-7 | 8-15 | 16-31 | 32+

function hourBucketOf(at: number, utcOffsetMinutes: number | undefined): number {
  const offset = typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes)
    ? clamp(Math.round(utcOffsetMinutes), -840, 840) : 0;
  const date = new Date(typeof at === 'number' && Number.isFinite(at) ? at : 0);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (!Number.isFinite(minutes)) return 0;
  const local = (((minutes + offset) % 1440) + 1440) % 1440;
  return clamp(Math.floor(local / 180), 0, 7);
}

function voiceDurationBucketOf(durationSec: number | undefined): number | null {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec)) return null;
  if (durationSec < 5) return 0;
  if (durationSec < 15) return 1;
  if (durationSec < 45) return 2;
  if (durationSec < 120) return 3;
  return 4;
}

function burstOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), 1, 10) : 1;
}

function safeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
  try {
    const wellFormed = (text as unknown as { toWellFormed?: () => string }).toWellFormed;
    if (typeof wellFormed === 'function') text = wellFormed.call(text);
  } catch {
    // keep the raw slice; every later step tolerates lone surrogates
  }
  try {
    text = text.normalize('NFC');
  } catch {
    // keep the un-normalised text
  }
  return text;
}

/** Content-free features of one message. Never throws; never returns or retains text. */
export function extractStyleFeatures(input: StyleObservationInput): StyleFeatures {
  const kind: 'text' | 'voice' = input?.kind === 'voice' ? 'voice' : 'text';
  const edited = input?.edited === true;
  const burstIndex = burstOf(input?.burstIndex);
  const hourBucket = hourBucketOf(input?.at, input?.utcOffsetMinutes);

  if (kind === 'voice') {
    return {
      version: 1, kind, lengthBucket: 0, wordBucket: 0,
      persianScriptRatio: null, latinScriptRatio: null, finglishRatio: null, zwnjPerWord: null,
      persianDigitShare: null, arabicVariantShare: null, latinUpperShare: null,
      punctuationPer100: null, persianQuestionShare: null,
      repeatedPunctuation: false, endsWithPunctuation: false, emojiCount: 0, emoticonCount: 0,
      burstIndex, edited, hourBucket, voiceDurationBucket: voiceDurationBucketOf(input?.durationSec),
    };
  }

  const text = safeText(input?.text);
  const clusters = graphemes(text);

  let letters = 0, arabicLetters = 0, latinLetters = 0, latinUpper = 0;
  let digits = 0, persianDigits = 0, arabicVariants = 0, variantBase = 0;
  let zwnj = 0, persianQ = 0, latinQ = 0;
  for (const cp of Array.from(text)) {
    const code = cp.codePointAt(0) ?? 0;
    if (code === 0x200c) zwnj++;
    else if (code === 0x061f) persianQ++;
    else if (code === 0x3f) latinQ++;
    if (code === 0x064a || code === 0x0643) { arabicVariants++; variantBase++; }
    else if (code === 0x06cc || code === 0x06a9) variantBase++;
    if (LETTER.test(cp)) {
      letters++;
      if (ARABIC.test(cp)) arabicLetters++;
      else if (LATIN.test(cp)) {
        latinLetters++;
        if (UPPER.test(cp)) latinUpper++;
      }
    } else if (DIGIT.test(cp)) {
      digits++;
      if ((code >= 0x06f0 && code <= 0x06f9) || (code >= 0x0660 && code <= 0x0669)) persianDigits++;
    }
  }

  let words = 0, arabicWords = 0, latinWords = 0, finglishWords = 0;
  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    let wordLetters = 0, wordArabic = 0, wordLatin = 0, wordDigits = 0;
    for (const cp of Array.from(word)) {
      if (LETTER.test(cp)) {
        wordLetters++;
        if (ARABIC.test(cp)) wordArabic++;
        else if (LATIN.test(cp)) wordLatin++;
      } else if (DIGIT.test(cp)) wordDigits++;
    }
    if (wordLetters === 0 && wordDigits === 0) continue;
    words++;
    if (wordArabic > 0) arabicWords++;
    if (wordLetters >= 2 && wordLatin === wordLetters) {
      latinWords++;
      const lower = word.toLowerCase();
      if (FINGLISH_LEXICON.has(lower) || DIGIT_AS_LETTER.test(lower)) finglishWords++;
    }
  }

  let punctuation = 0, emoji = 0;
  for (const cluster of clusters) {
    if (PUNCT.test(cluster)) punctuation++;
    if (PICTOGRAPHIC.test(cluster) || REGIONAL_PAIR.test(cluster)) emoji++;
  }
  let lastVisible: string | undefined;
  for (let i = clusters.length - 1; i >= 0; i--) {
    if (clusters[i].trim().length > 0) { lastVisible = clusters[i]; break; }
  }
  const emoticons = (text.match(EMOTICON_RE) ?? []).length;

  return {
    version: 1, kind,
    lengthBucket: band(clusters.length, LENGTH_BANDS),
    wordBucket: band(words, WORD_BANDS),
    persianScriptRatio: ratio(arabicLetters, letters),
    latinScriptRatio: ratio(latinLetters, letters),
    finglishRatio: ratio(finglishWords, latinWords),
    zwnjPerWord: arabicWords > 0 ? q(zwnj / arabicWords) : null,
    persianDigitShare: ratio(persianDigits, digits),
    arabicVariantShare: ratio(arabicVariants, variantBase),
    latinUpperShare: ratio(latinUpper, latinLetters),
    punctuationPer100: clusters.length > 0 ? clamp(Math.round((punctuation * 100) / clusters.length), 0, 50) : null,
    persianQuestionShare: ratio(persianQ, persianQ + latinQ),
    repeatedPunctuation: REPEATED_PUNCT.test(text),
    endsWithPunctuation: lastVisible !== undefined && PUNCT.test(lastVisible),
    emojiCount: clamp(emoji, 0, 5),
    emoticonCount: clamp(emoticons, 0, 5),
    burstIndex, edited, hourBucket, voiceDurationBucket: null,
  };
}

/** Burst position from timestamps only: +1 within SPLIT_WINDOW_MS of the previous message, otherwise 1. */
export function nextBurstIndex(previous: { at: number; burstIndex: number } | undefined, at: number): number {
  if (!previous || !Number.isFinite(previous.at) || !Number.isFinite(at) || !Number.isFinite(previous.burstIndex)) return 1;
  const dt = at - previous.at;
  return dt >= 0 && dt <= SPLIT_WINDOW_MS ? previous.burstIndex + 1 : 1;
}

function unit(x: number | null): number | null {
  return x === null ? null : clamp01(x);
}

/** 21 dims in STYLE_VECTOR_KEYS order, each in [0, 1] or null. */
export function styleVector(f: StyleFeatures): (number | null)[] {
  const bit = (value: boolean): number => (value ? 1 : 0);
  const angle = (2 * Math.PI * f.hourBucket) / 8;
  return [
    bit(f.kind === 'voice'),
    unit(f.lengthBucket / 6),
    unit(f.wordBucket / 6),
    unit(f.persianScriptRatio),
    unit(f.latinScriptRatio),
    unit(f.finglishRatio),
    unit(f.zwnjPerWord),
    unit(f.persianDigitShare),
    unit(f.arabicVariantShare),
    unit(f.latinUpperShare),
    f.punctuationPer100 === null ? null : unit(f.punctuationPer100 / 50),
    unit(f.persianQuestionShare),
    bit(f.repeatedPunctuation),
    bit(f.endsWithPunctuation),
    unit(f.emojiCount / 5),
    unit(f.emoticonCount / 5),
    unit((f.burstIndex - 1) / 9),
    bit(f.edited),
    unit((Math.sin(angle) + 1) / 2),
    unit((Math.cos(angle) + 1) / 2),
    f.voiceDurationBucket === null ? null : unit(f.voiceDurationBucket / 4),
  ];
}

const QUANTUM = 1e-9;
const quantised = z.number().min(0).max(1).refine((v) => Math.abs(v * 20 - Math.round(v * 20)) < QUANTUM * 20);
const ratioField = quantised.nullable();
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Strict: anything that is not exactly a feature set (e.g. a `text` key) is rejected. */
export const styleFeaturesSchema: z.ZodType<StyleFeatures> = z.object({
  version: z.literal(1),
  kind: z.enum(['text', 'voice']),
  lengthBucket: int(0, 6),
  wordBucket: int(0, 6),
  persianScriptRatio: ratioField,
  latinScriptRatio: ratioField,
  finglishRatio: ratioField,
  zwnjPerWord: ratioField,
  persianDigitShare: ratioField,
  arabicVariantShare: ratioField,
  latinUpperShare: ratioField,
  punctuationPer100: int(0, 50).nullable(),
  persianQuestionShare: ratioField,
  repeatedPunctuation: z.boolean(),
  endsWithPunctuation: z.boolean(),
  emojiCount: int(0, 5),
  emoticonCount: int(0, 5),
  burstIndex: int(1, 10),
  edited: z.boolean(),
  hourBucket: int(0, 7),
  voiceDurationBucket: int(0, 4).nullable(),
}).strict();
