/**
 * A script-ratio label for calibration buckets. It is not language
 * identification: 'fa' means mostly Arabic-script letters (Persian, Arabic and
 * Urdu all land there). Pure: only the label leaves this function.
 */

export type ScriptLanguage = 'fa' | 'en' | 'mixed' | 'unknown';

// Arabic, Arabic Supplement, Arabic Presentation Forms-A and -B; digits excluded below.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ARABIC_DIGITS = /[۰-۹٠-٩]/;
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
