/**
 * Image retention rules (S12). An image is never stored; memory may form from
 * an image turn only when the person asked for it and the image is not a
 * sensitive document. Unknown triage fails closed.
 */

import type { ImageTriage } from './questions';

export const SENSITIVE_DOCUMENT_THRESHOLD = 0.5;

/** An explicit request to keep what was shared (English and Persian). */
export const IMAGE_REMEMBER_REQUEST = /\b(?:remember|save|keep|store)\s+(?:this|that|it)\b|یادت\s*(?:باشه|بمونه|بماند)|به\s*خاطر\s*بسپار|ذخیره(?:\s*اش)?\s*کن|نگهش\s*دار/iu;

/** Byte copy of gateway.ts NO_MEMORY (not exported there; gateway.ts is not edited for it). */
export const IMAGE_NO_MEMORY = /(?:do not|don't|don’t)\s+(?:remember|save|store)|forget (?:this|that)|ذخیره نکن|به خاطر نسپار|یادت نماند|فراموش کن/iu;

export function explicitRememberRequest(text: string): boolean {
  return !IMAGE_NO_MEMORY.test(text) && IMAGE_REMEMBER_REQUEST.test(text);
}

/** True when memory extraction must not run for this image turn. */
export function suppressImageMemory(triage: ImageTriage | null, text: string): boolean {
  if (IMAGE_NO_MEMORY.test(text)) return true;
  if (triage === null) return true;
  if (triage.containsSensitiveDocument >= SENSITIVE_DOCUMENT_THRESHOLD) return true;
  return !(triage.task === 'remember' || explicitRememberRequest(text));
}

/** Fixed, content-free acknowledgement sent when triage is slow. */
export function imageAckText(text: string): string {
  return /[؀-ۿ]/.test(text) ? 'یک لحظه، دارم عکس را نگاه می‌کنم.' : "One moment, I'm looking at your photo.";
}
