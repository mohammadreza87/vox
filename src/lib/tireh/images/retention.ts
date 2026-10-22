/**
 * Image retention rules (S12). An image is never stored; memory may form from
 * an image turn only when the person asked for it and the image is not a
 * sensitive document. Unknown triage fails closed.
 */

import type { ChatMessage } from '../types';
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

/**
 * Fixed, content-free history text kept in place of a reply the model wrote
 * from a sensitive document, or from an image whose triage is unknown. The
 * reply is delivered; its text is never stored.
 */
export const IMAGE_WITHHELD_REPLY_TEXT = '(replied about a shared image; the details were not kept)';

/** True when the reply to this image must not be kept in history. Unknown triage fails closed. */
export function withholdImageReply(triage: ImageTriage | null): boolean {
  return triage === null || triage.containsSensitiveDocument >= SENSITIVE_DOCUMENT_THRESHOLD;
}

/** The content-free retention verdict stored on both rows of an image turn. */
export function imageDerivedMark(turn: { suppressMemory: boolean; containsPeople: boolean }): Required<Pick<ChatMessage, 'imageDerived'>> {
  return { imageDerived: { suppressed: turn.suppressMemory, people: turn.containsPeople } };
}

/**
 * The mark a reply inherits when it was composed with image-marked rows in its
 * context. Such a reply can repeat what the image showed (a description of the
 * people in it, or text read off a receipt), so it keeps the same content-free
 * verdict: `suppressed` keeps it out of extraction, `people` keeps the people
 * rule on while it is in the window. Undefined when no context row is marked.
 * Only assistant rows inherit it; a member's own later words are not image-derived.
 */
export function inheritedImageMark(context: ReadonlyArray<{ imageDerived?: ChatMessage['imageDerived'] }>): Required<Pick<ChatMessage, 'imageDerived'>> | undefined {
  const suppressed = context.some((m) => m.imageDerived?.suppressed === true);
  const people = context.some((m) => m.imageDerived?.people === true);
  return suppressed || people ? imageDerivedMark({ suppressMemory: suppressed, containsPeople: people }) : undefined;
}
