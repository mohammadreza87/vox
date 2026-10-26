/**
 * One Persian / Arabic-script text fold for matching (never for display or
 * storage). Pure: the text is never logged, cached or kept.
 *
 * foldPersian is S06's retrieval normaliser, moved here unchanged so that
 * retrieval (memory/retrieval.ts), the memory-request rules
 * (memory/requests.ts), the S12 extraction people filter and the S14
 * follow-up classifier read the same rules:
 *
 * - NFKC (presentation forms, ligatures and full-width forms unfold);
 * - optionally lowercase (retrieval tokens), before the letter map;
 * - Arabic letter variants to the Persian ones: ي ى ئ to ی, ك to ک, ة to ه,
 *   أ إ ٱ آ to ا, ؤ to و;
 * - strip combining marks (\p{M}: harakat, hamza above), tatweel U+0640,
 *   ZWJ U+200D, LRM U+200E, RLM U+200F and BOM U+FEFF; ZWNJ U+200C is kept
 *   (it carries affix boundaries; callers decide what to do with it);
 * - Persian and Arabic-Indic digits to ASCII.
 *
 * Heh variants (ۀ U+06C0, ە U+06D5) are deliberately not folded: the S06
 * memory eval gate decides that change (see S06-memory-v2-retrieval.md).
 */

const ARABIC_LETTER_MAP: Readonly<Record<string, string>> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
  'ك': 'ک',
  'ة': 'ه',
  'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', 'آ': 'ا',
  'ؤ': 'و',
};
const ARABIC_LETTERS = /[يىئكةأإٱآؤ]/g;
// Combining marks (harakat, hamza above U+0654), tatweel, ZWJ, LRM, RLM, BOM. ZWNJ is kept.
const REMOVED = /[\p{M}ـ‍‎‏﻿]/gu;
const PERSIAN_DIGITS = /[۰-۹]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;

export interface FoldOptions {
  /** Lowercase after NFKC (retrieval tokens). Default false. */
  readonly lowercase?: boolean;
}

/** The shared fold for matching; see the header. Never returns more than a folded copy of `text`. */
export function foldPersian(text: string, options: FoldOptions = {}): string {
  const nfkc = text.normalize('NFKC');
  return (options.lowercase ? nfkc.toLowerCase() : nfkc)
    .replace(ARABIC_LETTERS, (c) => ARABIC_LETTER_MAP[c] ?? c)
    .replace(REMOVED, '')
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;

/** True for one Arabic-script letter: not punctuation (، ؛ ؟), tatweel, digits, marks or the BOM. */
export function isArabicScriptLetter(ch: string): boolean {
  return ARABIC_SCRIPT.test(ch) && LETTER.test(ch);
}

/** True for one Latin-script letter (accented letters included). */
export function isLatinLetter(ch: string): boolean {
  return LATIN_SCRIPT.test(ch) && LETTER.test(ch);
}

type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };
let segmenter: GraphemeSegmenter | null | undefined;

function graphemeSegmenter(): GraphemeSegmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Ctor = (Intl as unknown as {
      Segmenter?: new (locale: string, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
    }).Segmenter;
    segmenter = Ctor ? new Ctor('fa', { granularity: 'grapheme' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/**
 * At most `max` user-perceived characters of `text`, never splitting a base
 * letter from its marks or a ZWJ emoji sequence. Falls back to code points
 * (Array.from) where Intl.Segmenter is missing or throws.
 */
export function clipGraphemes(text: string, max: number): string {
  const limit = Number.isNaN(max) ? 0 : Math.max(0, Math.floor(max));
  const seg = graphemeSegmenter();
  if (seg) {
    try {
      let out = '';
      let count = 0;
      for (const part of seg.segment(text)) {
        if (count >= limit) return out;
        out += part.segment;
        count++;
      }
      return out;
    } catch {
      // fall through to the code-point fallback
    }
  }
  return Array.from(text).slice(0, limit).join('');
}
