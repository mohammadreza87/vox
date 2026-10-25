/**
 * A script-ratio label for decision-log calibration buckets. It is not
 * language identification: 'fa' means mostly Arabic-script letters (Persian,
 * Arabic and Urdu all land there). Pure: the text is never stored or returned,
 * only the label leaves this function.
 */

export type ScriptLanguage = 'fa' | 'en' | 'mixed' | 'unknown';

// Arabic, Arabic Supplement, Arabic Presentation Forms-A and -B.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
// Arabic-Indic and Persian digits are excluded.
const ARABIC_DIGITS = /[٠-٩۰-۹]/;
const LATIN = /[A-Za-z]/;
const SHARE = 0.8;

export function scriptLanguage(text: string): ScriptLanguage {
  let arabic = 0, latin = 0;
  for (const ch of text) {
    if (LATIN.test(ch)) latin++;
    else if (ARABIC_SCRIPT.test(ch) && !ARABIC_DIGITS.test(ch)) arabic++;
  }
  const total = arabic + latin;
  if (total === 0) return 'unknown';
  if (arabic / total >= SHARE) return 'fa';
  if (latin / total >= SHARE) return 'en';
  return 'mixed';
}
