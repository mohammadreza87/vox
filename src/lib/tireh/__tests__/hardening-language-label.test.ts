/**
 * H4 (F181): the decision-log script label counts letters only.
 * Punctuation (، ؛ ؟), tatweel, the BOM, marks and digits never count.
 */
import { describe, expect, it } from 'vitest';
import { scriptLanguage } from '../decisions/language';

describe('scriptLanguage counts letters only', () => {
  it.each([
    ['hello\u060C world\u061F', 'en'],
    ['ok\u061F\u061F\u061F', 'en'],
    ['\uFEFF', 'unknown'],
    ['\u0640\u0640\u0640', 'unknown'],
    ['\u060C\u061B\u061F', 'unknown'],
    ['\u064E\u0650', 'unknown'],
    ['۱۲۳ ٤٥ 678', 'unknown'],
    ['\uFEFFhello', 'en'],
    ['سلام دوستم\u0640\u0640\u0640 hi', 'fa'],
    ['\uFEDB\uFE98\uFE8E\uFE8F', 'fa'],
    ['\u0750\u0751', 'fa'],
    ['café résumé', 'en'],
  ])('%s gives %s', (text, expected) => {
    expect(scriptLanguage(text)).toBe(expected);
  });

  it('keeps the recorded labels for ordinary text', () => {
    expect(scriptLanguage('سلام خوبی')).toBe('fa');
    expect(scriptLanguage('hello there')).toBe('en');
    expect(scriptLanguage('سلام hello friend')).toBe('mixed');
    expect(scriptLanguage('سلام hello there friend')).toBe('en');
    expect(scriptLanguage('')).toBe('unknown');
  });
});
