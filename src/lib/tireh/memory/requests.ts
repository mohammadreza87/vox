/**
 * Deterministic memory requests in a person's own words (English and Persian).
 *
 * One rule for "do not keep this": the gateway (group memory, relationship
 * observation) and S12 image retention both read NEGATED_MEMORY_REQUEST, so a
 * negation recognised in one place is recognised in the other. Any negation
 * wins over a remember request in the same text. The Persian patterns accept
 * the standard orthography as typed: ZWNJ or a space between parts, and the
 * Arabic yeh/kaf code points (U+064A, U+0643) as well as the Persian ones.
 */

const GAP = String.raw`[\s‌]*`;
const YEH = '[یي]';
const KAF = '[کك]';

/** "don't keep this", "never save this", "dont save this", "forget that", "ذخیره‌اش نکن", ... */
export const NEGATED_MEMORY_REQUEST = new RegExp([
  String.raw`\b(?:do\s*not|don['’]?t|never|no\s+need\s+to)\s+(?:\w+\s+){0,2}?(?:remember|save|store|keep)\b`,
  String.raw`\bforget\s+(?:this|that)\b`,
  `ذخ${YEH}ره${GAP}(?:اش${GAP})?ن${KAF}ن`,
  `به${GAP}خاطر${GAP}نسپار`,
  `${YEH}ادت${GAP}(?:نماند|نمونه)`,
  `نگهش${GAP}ندار`,
  `فراموش${GAP}${KAF}ن`,
].join('|'), 'iu');

/** An explicit request to keep what was shared: "remember this", "save it", "ذخیره‌اش کن", ... */
export const MEMORY_REQUEST = new RegExp([
  String.raw`\b(?:remember|save|keep|store)\s+(?:this|that|it)\b`,
  `${YEH}ادت${GAP}(?:باشه|بمونه|بماند)`,
  `به${GAP}خاطر${GAP}بسپار`,
  `ذخ${YEH}ره${GAP}(?:اش${GAP})?${KAF}ن`,
  `نگهش${GAP}دار`,
].join('|'), 'iu');

/** True when the text asks not to keep it. */
export function negatedMemoryRequest(text: string): boolean {
  return NEGATED_MEMORY_REQUEST.test(text);
}

/** True when the text explicitly asks to keep it and no negation is present. */
export function explicitMemoryRequest(text: string): boolean {
  return !NEGATED_MEMORY_REQUEST.test(text) && MEMORY_REQUEST.test(text);
}
