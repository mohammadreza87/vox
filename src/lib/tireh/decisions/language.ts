/**
 * A script-ratio label for decision-log calibration buckets. It is not
 * language identification: 'fa' means mostly Arabic-script letters (Persian,
 * Arabic and Urdu all land there). Pure: the text is never stored or returned,
 * only the label leaves this function.
 *
 * Only letters count (text/persian.ts): Arabic-script letters and Latin
 * letters. Punctuation (، ؛ ؟), tatweel, the BOM, marks and digits of any
 * script are ignored (F181).
 */

import { isArabicScriptLetter, isLatinLetter } from '../text/persian';

export type ScriptLanguage = 'fa' | 'en' | 'mixed' | 'unknown';

const SHARE = 0.8;

/** The letter counts scriptLanguage reads: Arabic-script and Latin letters only. Pure; only the counts leave. */
export function scriptLetterCounts(text: string): { arabic: number; latin: number } {
  let arabic = 0, latin = 0;
  for (const ch of text) {
    if (isLatinLetter(ch)) latin++;
    else if (isArabicScriptLetter(ch)) arabic++;
  }
  return { arabic, latin };
}

export function scriptLanguage(text: string): ScriptLanguage {
  const { arabic, latin } = scriptLetterCounts(text);
  const total = arabic + latin;
  if (total === 0) return 'unknown';
  if (arabic / total >= SHARE) return 'fa';
  if (latin / total >= SHARE) return 'en';
  return 'mixed';
}
