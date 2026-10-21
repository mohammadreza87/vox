/**
 * Content-free communication-style features of ONE message
 * (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.9, "Communication style").
 *
 * The output holds only quantized ratios, small buckets and booleans: never the
 * text, never tokens, never n-grams or hashes of text (hashed fragments are
 * dictionary-attackable and therefore not content-free). The function is pure,
 * never throws and never retains its input.
 */
import { z } from 'zod';

export const STYLE_FEATURES_VERSION = 1 as const;
export const MAX_ANALYSED_GRAPHEMES = 4096;
export const FOLLOW_ON_GAP_MS = 60_000;
/** Raw UTF-16 code units considered before normalization; far above MAX_ANALYSED_GRAPHEMES for real text. */
const MAX_RAW_CODE_UNITS = MAX_ANALYSED_GRAPHEMES * 16;

/** Lowercased Persian-in-Latin (Finglish) tokens that are not English words. Fixed; never learned from members. */
export const FINGLISH_MARKERS: ReadonlySet<string> = Object.freeze(new Set([
  'salam', 'merci', 'mersi', 'khobi', 'khoobi', 'chetori', 'chetor', 'mamnoon', 'mamnun', 'mikham',
  'mikhay', 'mikhad', 'nemidoonam', 'nemidonam', 'midoonam', 'midonam', 'begoo', 'begu', 'kojaei', 'kojai',
  'chera', 'alan', 'farda', 'dige', 'hamin', 'behet', 'behem', 'bashe', 'khob', 'khoshhal',
]));

export type LengthBucket = 0 | 1 | 2 | 3 | 4 | 5;
export type HourBucket = 0 | 1 | 2 | 3 | 4 | 5;
/** 0 none, 1 ASCII, 2 Persian (U+06F0-06F9), 3 Arabic-Indic (U+0660-0669), 4 mixed. */
export type DigitScript = 0 | 1 | 2 | 3 | 4;
export type VoiceDurationBucket = 0 | 1 | 2 | 3;

/** Every ratio is quantize()d to a 0.05 grid in [0,1]. */
export interface TextStyleFeatures {
  readonly lengthBucket: LengthBucket;
  readonly persianScriptRatio: number;
  readonly latinScriptRatio: number;
  readonly finglishRatio: number;
  readonly punctuationRate: number;
  readonly emoticonRate: number;
  readonly zwnjRate: number;
  readonly arabicVariantRatio: number;
  readonly repeatedCharRate: number;
  readonly uppercaseRatio: number;
  readonly terminalPunctuation: boolean;
  readonly digitScript: DigitScript;
}

export interface StyleFeatures {
  readonly version: typeof STYLE_FEATURES_VERSION;
  readonly modality: 'text' | 'voice';
  readonly hourBucket: HourBucket;
  /** Message splitting: within FOLLOW_ON_GAP_MS of the same speaker's previous message. */
  readonly followOn: boolean;
  readonly edited: boolean;
  /** Present iff modality === 'text'. */
  readonly text?: TextStyleFeatures;
  /** Present iff modality === 'voice'. */
  readonly voiceDurationBucket?: VoiceDurationBucket;
}

export interface StyleFeatureInput {
  readonly modality: 'text' | 'voice';
  readonly text?: string;
  readonly voiceDurationSec?: number;
  readonly at: number;
  readonly previousAt?: number;
  readonly edited?: boolean;
  readonly timeZone?: string;
}

const GRID = 20;
const onGrid = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1 && Math.abs(x * GRID - Math.round(x * GRID)) < 1e-9;
const ratioSchema = z.number().min(0).max(1).refine(onGrid, { message: 'off_grid' });

const textFeaturesSchema = z.object({
  lengthBucket: z.literal([0, 1, 2, 3, 4, 5]),
  persianScriptRatio: ratioSchema,
  latinScriptRatio: ratioSchema,
  finglishRatio: ratioSchema,
  punctuationRate: ratioSchema,
  emoticonRate: ratioSchema,
  zwnjRate: ratioSchema,
  arabicVariantRatio: ratioSchema,
  repeatedCharRate: ratioSchema,
  uppercaseRatio: ratioSchema,
  terminalPunctuation: z.boolean(),
  digitScript: z.literal([0, 1, 2, 3, 4]),
}).strict();

const commonFeatureShape = {
  version: z.literal(STYLE_FEATURES_VERSION),
  hourBucket: z.literal([0, 1, 2, 3, 4, 5]),
  followOn: z.boolean(),
  edited: z.boolean(),
};

/** Strict at every level: `text` must be the feature block (never a string) and presence must match the modality. */
export const styleFeaturesSchema: z.ZodType<StyleFeatures> = z.discriminatedUnion('modality', [
  z.object({ ...commonFeatureShape, modality: z.literal('text'), text: textFeaturesSchema }).strict(),
  z.object({ ...commonFeatureShape, modality: z.literal('voice'), voiceDurationBucket: z.literal([0, 1, 2, 3]) }).strict(),
]);

/** Clamp to [0,1] and round to the 0.05 grid; non-finite gives 0. */
export function quantize(x: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
  const clamped = Math.min(1, Math.max(0, x));
  return Math.round(clamped * GRID) / GRID;
}

export function lengthBucket(graphemes: number): LengthBucket {
  if (!Number.isFinite(graphemes) || graphemes <= 3) return 0;
  if (graphemes <= 10) return 1;
  if (graphemes <= 30) return 2;
  if (graphemes <= 80) return 3;
  if (graphemes <= 200) return 4;
  return 5;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    if (hourFormatters.size >= 64) hourFormatters.clear();
    hourFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** floor(local hour / 4); an invalid or absent time zone falls back to UTC. */
export function hourBucket(at: number, timeZone?: string): HourBucket {
  if (typeof at !== 'number' || !Number.isFinite(at)) return 0;
  let hour: number;
  try {
    hour = localHour(at, typeof timeZone === 'string' && timeZone ? timeZone : 'UTC');
  } catch (error) {
    if (!(error instanceof RangeError)) return 0;
    try { hour = localHour(at, 'UTC'); } catch { return 0; }
  }
  const bucket = Math.floor(hour / 4);
  return (bucket >= 0 && bucket <= 5 ? bucket : 0) as HourBucket;
}

function localHour(at: number, timeZone: string): number {
  const part = hourFormatter(timeZone).formatToParts(at).find(p => p.type === 'hour');
  const hour = part ? Number.parseInt(part.value, 10) : 0;
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/** <5 s, <15 s, <60 s, >=60 s or unknown. */
export function voiceDurationBucket(seconds: number | undefined): VoiceDurationBucket {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 3;
  if (seconds < 5) return 0;
  if (seconds < 15) return 1;
  if (seconds < 60) return 2;
  return 3;
}

const LONE_OR_PAIRED_SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g; // non-u on purpose
const LETTER = /\p{L}/u;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const UPPERCASE = /\p{Lu}/u;
const PUNCTUATION = /\p{P}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const WHITESPACE_ONLY = /^\s*$/u;
const ASCII_EMOTICON = /(?:[:;=8][-'^]?[)(DPpOo3\]\[|*]|<3|\^_\^)/g;
const PAREN_RUN = /\){2,}|\({2,}/g;
const REPEATED_LETTER = /(\p{L})\1{2,}/gu;
const TERMINAL = new Set(['.', '!', '?', '…', '؟', '۔']);

let graphemeSegmenter: Intl.Segmenter | undefined;
let wordSegmenter: Intl.Segmenter | undefined;

function analysedText(raw: string): string {
  const bounded = raw.length > MAX_RAW_CODE_UNITS ? raw.slice(0, MAX_RAW_CODE_UNITS) : raw;
  const wellFormed = bounded.replace(LONE_OR_PAIRED_SURROGATE, m => (m.length === 2 ? m : '�'));
  const normalized = wellFormed.normalize('NFKC');
  graphemeSegmenter ??= new Intl.Segmenter('und', { granularity: 'grapheme' });
  let out = '';
  let count = 0;
  for (const { segment } of graphemeSegmenter.segment(normalized)) {
    if (count >= MAX_ANALYSED_GRAPHEMES) break;
    out += segment;
    count++;
  }
  return out;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? quantize(numerator / denominator) : 0;
}

function textFeatures(raw: string): TextStyleFeatures {
  const text = analysedText(raw);
  graphemeSegmenter ??= new Intl.Segmenter('und', { granularity: 'grapheme' });
  wordSegmenter ??= new Intl.Segmenter('und', { granularity: 'word' });

  const graphemes: string[] = [];
  for (const { segment } of graphemeSegmenter.segment(text)) graphemes.push(segment);
  const visible = graphemes.filter(g => !WHITESPACE_ONLY.test(g));
  const trimmed = text.trim();
  const trimmedGraphemes = [...graphemeSegmenter.segment(trimmed)].length;

  let letters = 0, arabic = 0, latin = 0, latinUpper = 0, zwnj = 0, yehKafArabic = 0, yehKafPersian = 0;
  let ascii = false, persianDigits = false, arabicIndicDigits = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x200c) zwnj++;
    else if (cp === 0x064a || cp === 0x0643) yehKafArabic++;
    else if (cp === 0x06cc || cp === 0x06a9) yehKafPersian++;
    if (cp >= 0x30 && cp <= 0x39) ascii = true;
    else if (cp >= 0x06f0 && cp <= 0x06f9) persianDigits = true;
    else if (cp >= 0x0660 && cp <= 0x0669) arabicIndicDigits = true;
    if (!LETTER.test(ch)) continue;
    letters++;
    if (ARABIC_SCRIPT.test(ch)) arabic++;
    else if (LATIN_SCRIPT.test(ch)) {
      latin++;
      if (UPPERCASE.test(ch)) latinUpper++;
    }
  }

  let words = 0, arabicWords = 0, latinWords = 0, finglishWords = 0;
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike) continue;
    words++;
    const word = segment.toLowerCase();
    if (ARABIC_SCRIPT.test(word)) arabicWords++;
    else if (LATIN_SCRIPT.test(word)) {
      latinWords++;
      if (FINGLISH_MARKERS.has(word)) finglishWords++;
    }
  }

  let emoticons = visible.filter(g => PICTOGRAPHIC.test(g)).length;
  const consumed = new Set<number>();
  for (const match of text.matchAll(ASCII_EMOTICON)) {
    emoticons++;
    const start = match.index ?? 0;
    for (let i = start; i < start + match[0].length; i++) consumed.add(i);
  }
  for (const match of text.matchAll(PAREN_RUN)) {
    const start = match.index ?? 0;
    let overlaps = false;
    for (let i = start; i < start + match[0].length; i++) if (consumed.has(i)) { overlaps = true; break; }
    if (!overlaps) emoticons++;
  }
  const repeated = [...text.matchAll(REPEATED_LETTER)].length;
  const punctuation = visible.filter(g => PUNCTUATION.test(g)).length;
  const digitKinds = Number(ascii) + Number(persianDigits) + Number(arabicIndicDigits);
  const digitScript: DigitScript = digitKinds === 0 ? 0 : digitKinds > 1 ? 4 : ascii ? 1 : persianDigits ? 2 : 3;
  const last = [...trimmed].pop();

  return {
    lengthBucket: lengthBucket(trimmedGraphemes),
    persianScriptRatio: ratio(arabic, letters),
    latinScriptRatio: ratio(latin, letters),
    finglishRatio: ratio(finglishWords, latinWords),
    punctuationRate: ratio(punctuation, visible.length),
    emoticonRate: ratio(Math.min(emoticons, visible.length), visible.length),
    zwnjRate: ratio(Math.min(zwnj, arabicWords), arabicWords),
    arabicVariantRatio: ratio(yehKafArabic, yehKafArabic + yehKafPersian),
    repeatedCharRate: ratio(Math.min(repeated, words), words),
    uppercaseRatio: ratio(latinUpper, latin),
    terminalPunctuation: last !== undefined && TERMINAL.has(last),
    digitScript,
  };
}

const ZERO_TEXT: TextStyleFeatures = Object.freeze({
  lengthBucket: 0, persianScriptRatio: 0, latinScriptRatio: 0, finglishRatio: 0, punctuationRate: 0,
  emoticonRate: 0, zwnjRate: 0, arabicVariantRatio: 0, repeatedCharRate: 0, uppercaseRatio: 0,
  terminalPunctuation: false, digitScript: 0,
});

function zeroFeatures(modality: 'text' | 'voice'): StyleFeatures {
  return modality === 'voice'
    ? Object.freeze({ version: STYLE_FEATURES_VERSION, modality, hourBucket: 0, followOn: false, edited: false, voiceDurationBucket: 0 })
    : Object.freeze({ version: STYLE_FEATURES_VERSION, modality, hourBucket: 0, followOn: false, edited: false, text: ZERO_TEXT });
}

/** Pure, never throws, text never retained. For voice, `text` is never read. */
export function extractStyleFeatures(input: StyleFeatureInput): StyleFeatures {
  let modality: 'text' | 'voice' = 'text';
  try {
    modality = input.modality === 'voice' ? 'voice' : 'text';
    const at = input.at;
    const previousAt = input.previousAt;
    const gap = typeof previousAt === 'number' && Number.isFinite(previousAt) && Number.isFinite(at) ? at - previousAt : NaN;
    const common = {
      version: STYLE_FEATURES_VERSION,
      modality,
      hourBucket: hourBucket(at, input.timeZone),
      followOn: gap >= 0 && gap <= FOLLOW_ON_GAP_MS,
      edited: input.edited === true,
    };
    if (modality === 'voice') {
      return Object.freeze({ ...common, voiceDurationBucket: voiceDurationBucket(input.voiceDurationSec) });
    }
    const text = typeof input.text === 'string' ? input.text : '';
    return Object.freeze({ ...common, text: Object.freeze(textFeatures(text)) });
  } catch {
    return zeroFeatures(modality);
  }
}
