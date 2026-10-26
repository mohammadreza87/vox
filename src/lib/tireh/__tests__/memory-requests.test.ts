/**
 * The shared "do not keep this" rule (memory/requests.ts): the gateway and S12
 * image retention read the same negation, and any negation wins over a request.
 */
import { describe, expect, it } from 'vitest';
import { explicitMemoryRequest, NEGATED_MEMORY_REQUEST, negatedMemoryRequest } from '../memory/requests';
import { explicitRememberRequest, IMAGE_NO_MEMORY } from '../images/retention';

describe('memory requests', () => {
  it.each([
    "don't keep this", 'never save this', 'dont save this', "please don't ever save this", 'do not remember that', 'no need to store it',
    'forget this', 'ذخیره نکن', 'ذخیره‌اش نکن', 'ذخيره نکن', 'به‌خاطر نسپار', 'یادت نمونه', 'نگهش ندار', 'فراموش کن',
  ])('"%s" is a negation and never an explicit request', (text) => {
    expect(negatedMemoryRequest(text)).toBe(true);
    expect(IMAGE_NO_MEMORY.test(text)).toBe(true);
    expect(explicitMemoryRequest(text)).toBe(false);
    expect(explicitRememberRequest(text)).toBe(false);
  });

  it.each(['remember this', 'please save it', 'keep that', 'ذخیره‌اش کن', 'یادت باشه', 'به خاطر بسپار', 'نگهش دار', "I don't know, save this"])(
    '"%s" is an explicit request', (text) => {
      expect(negatedMemoryRequest(text)).toBe(false);
      expect(explicitMemoryRequest(text)).toBe(true);
    });

  it('a negation anywhere in the text wins over a request', () => {
    expect(explicitMemoryRequest("remember this, actually no, don't save it")).toBe(false);
  });

  // H4 (F257): the functions also read the text after the shared Persian fold.
  it.each([
    ['tatweel', 'ذخی\u0640\u0640ره نکن'],
    ['alef maksura U+0649', 'ذخ\u0649ره نکن'],
    ['Arabic yeh and kaf', 'ذخيره نكن'],
    ['presentation forms', '\uFEAB\uFEA7\uFEF4\uFEAE\uFEE9 \uFEE7\uFEDC\uFEE6'],
    ['harakat', 'ذ\u064Eخیره ن\u064Eک\u064Fن'],
    ['tatweel in a ZWNJ form', 'ذخی\u0640\u0640ره\u200Cاش نکن'],
    ['tatweel in "forget it"', 'فرام\u0640\u0640وشش کن'],
    ['tatweel in "do not keep"', 'نگه\u0640\u0640ش ندار'],
  ])('%s: "%s" is a negation and never an explicit request', (_label, text) => {
    expect(negatedMemoryRequest(text)).toBe(true);
    expect(explicitMemoryRequest(text)).toBe(false);
  });

  it.each([
    ['tatweel', 'ذخی\u0640\u0640ره\u200Cاش کن'],
    ['alef maksura U+0649', 'ذخ\u0649ره\u200Cاش کن'],
    ['Arabic kaf', 'ذخیره\u200Cاش كن'],
    ['presentation forms', '\uFEAB\uFEA7\uFEF4\uFEAE\uFEE9\u200C\uFE8D\uFEB5 \uFEDB\uFEE6'],
    ['tatweel and Arabic yeh', 'يادت باش\u0640\u0640ه'],
    ['harakat', 'ن\u0650گ\u064Eهش دار'],
  ])('%s: "%s" is an explicit request', (_label, text) => {
    expect(negatedMemoryRequest(text)).toBe(false);
    expect(explicitMemoryRequest(text)).toBe(true);
  });

  it.each(['فراموش نکن', 'فرام\u0640\u0640وش نکن', 'فراموش نكن', 'فراموش ن\u064Eکن'])('"%s" (do not forget) stays a non-negation', (text) => {
    expect(negatedMemoryRequest(text)).toBe(false);
  });

  it('a raw match still counts and the exported regexes are unchanged', () => {
    // The presentation-form, tatweel and U+0649 cases above match only after the fold.
    expect(NEGATED_MEMORY_REQUEST.test('\uFEAB\uFEA7\uFEF4\uFEAE\uFEE9 \uFEE7\uFEDC\uFEE6')).toBe(false);
    expect(NEGATED_MEMORY_REQUEST.test('ذخی\u0640\u0640ره نکن')).toBe(false);
    expect(NEGATED_MEMORY_REQUEST.test('ذخ\u0649ره نکن')).toBe(false);
    expect(negatedMemoryRequest('ذخیره نکن')).toBe(true);
    expect(explicitMemoryRequest('remember this')).toBe(true);
    expect(negatedMemoryRequest('remember this')).toBe(false);
    expect(explicitMemoryRequest('hello there')).toBe(false);
    // The regexes themselves still read raw text; only the functions fold.
    expect(IMAGE_NO_MEMORY.test('ذخیره نکن')).toBe(true);
  });
});
