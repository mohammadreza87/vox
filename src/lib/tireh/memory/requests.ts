/**
 * Deterministic memory requests in a person's own words (English and Persian).
 *
 * One rule for "do not keep this": the gateway (group memory, relationship
 * observation) and S12 image retention both read NEGATED_MEMORY_REQUEST, so a
 * negation recognised in one place is recognised in the other. Any negation
 * wins over a remember request in the same text, so the rule leans towards
 * reading a refusal (fail closed: less memory). The Persian patterns accept
 * the standard orthography as typed: ZWNJ or a space between parts, and the
 * Arabic yeh/kaf code points (U+064A, U+0643) as well as the Persian ones.
 *
 * negatedMemoryRequest and explicitMemoryRequest also test the text after the
 * shared fold (text/persian.ts foldPersian: NFKC, so presentation forms;
 * alef maksura U+0649 and the other Arabic letter variants; tatweel U+0640,
 * harakat and the other combining marks; ZWJ, LRM, RLM, BOM). A match on the
 * raw text still counts, so both are strict supersets of the raw rule, and the
 * negation only ever fails closed (H4, F257).
 *
 * TODO(H4, not in H4's files): gateway.ts NO_MEMORY and images/retention.ts
 * IMAGE_NO_MEMORY call NEGATED_MEMORY_REQUEST.test(text) on the raw text, so
 * they do not see the fold yet. They should call negatedMemoryRequest(text).
 *
 * With every flag unset the gateway's NO_MEMORY reads this rule too, which is
 * wider than the base `do not|don't` + verb rule (recorded as a base-behaviour
 * exception in WAVE_A_ON_MAIN.md section 3): it only ever withholds memory.
 */

import { foldPersian } from '../text/persian';

const GAP = String.raw`[\s‌]*`;
const YEH = '[یي]';
const KAF = '[کك]';

/** A negation, including modal and desire negations ("shouldn't", "I don't want you to ..."). */
const NEGATION = String.raw`\b(?:do\s*not|don['’]?t|dont|never|no\s+need|rather\s+not|should\s*not|should\s*n['’]?t|must\s*not|must\s*n['’]?t|will\s+not|won['’]?t)`;
/**
 * Up to five words between the negation and the verb ("I don't want you to remember this"), never across a
 * sentence or clause mark, and never through "forget" or "lose": "don't forget to save this" asks to keep it.
 * A parenthetical set off by commas right after the negation is allowed ("do NOT, under any circumstances, keep this").
 */
const NEGATION_GAP = String.raw`\s*(?:,[^,.!?؟\n]{0,40},\s*)?(?:(?!forget\b|lose\b)[\w'’]+\s+){0,5}?`;
const VERB = String.raw`(?:remember|save|store|keep)\b`;
/** A Persian refusal ahead of the request in the same sentence: "لازم نیست ...", "نمی‌خوام ...". */
const FA_REFUSAL = `(?:لازم${GAP}ن${YEH}ست|نم${YEH}${GAP}خوا(?:م|هم|د))[^.!?؟\\n]{0,30}?`;
const FA_KEEP = `(?:${YEH}ادت|ذخ${YEH}ره|نگه|به${GAP}خاطر)`;

/** "don't keep this", "I don't want you to remember this", "you shouldn't keep this", "forget that", "ذخیره‌اش نکن", ... */
export const NEGATED_MEMORY_REQUEST = new RegExp([
  `${NEGATION}${NEGATION_GAP}${VERB}`,
  String.raw`\bforget\s+(?:this|that|it)\b`,
  `${FA_REFUSAL}${FA_KEEP}`,
  `ذخ${YEH}ره${GAP}(?:ا?ش${GAP})?ن${KAF}ن`,
  `به${GAP}خاطر${GAP}نسپار`,
  `${YEH}ادت${GAP}(?:نماند|نمونه)`,
  `نگهش${GAP}ندار`,
  // "فراموش کن" / "فراموشش کن" (forget it); never "فراموش نکن" (do not forget).
  `فراموش${GAP}(?:ش${GAP})?${KAF}ن`,
].join('|'), 'iu');

/**
 * An explicit request to keep what was shared: "remember this", "save it", "ذخیره‌اش کن", ...
 * The English verb must be in imperative position: at the start, after a clause mark, or after a polite or
 * linking word ("please", "can you", "and", "don't forget to"). A question or statement about memory ("do you remember this?",
 * "I can't remember this place") is not a request; nor is "keep it down".
 */
const IMPERATIVE_LEAD = String.raw`(?:^|[.!,;:\n—–-]\s*|\b(?:please|pls|plz|just|also|and|so|then|now|ok|okay|hey|can\s+you|could\s+you|would\s+you|will\s+you|(?:don['’]?t|dont|do\s+not|never)\s+forget\s+to)\s+)`;
export const MEMORY_REQUEST = new RegExp([
  String.raw`${IMPERATIVE_LEAD}(?:remember|save|keep|store)\s+(?:this|that|it)\b(?!\s+(?:down|up|quiet|going|simple|short|together)\b)`,
  `${YEH}ادت${GAP}(?:باشه|بمونه|بماند)`,
  `به${GAP}خاطر${GAP}بسپار`,
  `ذخ${YEH}ره${GAP}(?:ا?ش${GAP})?${KAF}ن`,
  `نگهش${GAP}دار`,
].join('|'), 'imu');

/** True when the text asks not to keep it, as typed or after the shared Persian fold. */
export function negatedMemoryRequest(text: string): boolean {
  return NEGATED_MEMORY_REQUEST.test(text) || NEGATED_MEMORY_REQUEST.test(foldPersian(text));
}

/** True when the text explicitly asks to keep it (as typed or folded) and no negation is present in either form. */
export function explicitMemoryRequest(text: string): boolean {
  return !negatedMemoryRequest(text) && (MEMORY_REQUEST.test(text) || MEMORY_REQUEST.test(foldPersian(text)));
}
