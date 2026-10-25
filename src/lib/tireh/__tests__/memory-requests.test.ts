/**
 * The shared "do not keep this" rule (memory/requests.ts): the gateway and S12
 * image retention read the same negation, and any negation wins over a request.
 */
import { describe, expect, it } from 'vitest';
import { explicitMemoryRequest, negatedMemoryRequest } from '../memory/requests';
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
});
