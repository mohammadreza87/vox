/**
 * Image retention rules (S12). An image is never stored; memory may form from
 * an image turn only when the person asked for it and the image is not a
 * sensitive document. Unknown triage fails closed.
 */

import { scriptLanguage, scriptLetterCounts } from '../decisions/language';
import { explicitMemoryRequest, negatedMemoryRequest, secrecyRequest } from '../memory/requests';
import type { ChatMessage } from '../types';
import type { ImageTriage } from './questions';

export const SENSITIVE_DOCUMENT_THRESHOLD = 0.5;

/** The language of an image turn's fixed, content-free texts. */
export type ImageTextLanguage = 'fa' | 'en';

const persianLanguageCode = (code: unknown): boolean => typeof code === 'string' && code.trim().toLowerCase().startsWith('fa');

/** A code-switched text ('mixed') leans Persian when it has at least as many Arabic-script letters as Latin ones. */
function leansPersian(text: string): boolean {
  const { arabic, latin } = scriptLetterCounts(text);
  return arabic > 0 && arabic >= latin;
}

/**
 * The language of the texts written before the boundary (placeholder, acknowledgement). No history is
 * read. A caption that is clearly one script decides (decisions/language.ts scriptLanguage). A code-switched
 * caption ("این PDF رو بخون", "فاکتور Amazon"), a caption with no letters, or no caption at all falls back to
 * the sender's Telegram language_code ('fa…' is Persian), and a code-switched caption then to whichever
 * script has more letters (ties Persian). Anything else is English.
 */
export function imageTurnLanguage(caption: string, languageCode?: unknown): ImageTextLanguage {
  const script = caption.trim() ? scriptLanguage(caption) : 'unknown';
  if (script === 'fa' || script === 'en') return script;
  if (persianLanguageCode(languageCode)) return 'fa';
  return script === 'mixed' && leansPersian(caption) ? 'fa' : 'en';
}

/**
 * The language of a delivered reply (or a Mini App message). A text that is clearly one script decides; a
 * code-switched one (a Persian reply naming English products) or one with no letters is Persian when the turn's
 * own imageTurnLanguage was, and otherwise when it has at least as many Arabic-script letters as Latin ones.
 */
export function textLanguage(text: string, turnLanguage?: ImageTextLanguage): ImageTextLanguage {
  const script = scriptLanguage(text);
  if (script === 'fa' || script === 'en') return script;
  if (turnLanguage === 'fa') return 'fa';
  return script === 'mixed' && leansPersian(text) ? 'fa' : 'en';
}

/**
 * True when memory extraction must not run for this image turn. A refusal or a secrecy signal in the caption
 * ("keep this between us", "پیش خودت نگهش دار") wins over everything, the decider's 'remember' task included.
 */
export function suppressImageMemory(triage: ImageTriage | null, text: string): boolean {
  if (negatedMemoryRequest(text) || secrecyRequest(text)) return true;
  if (triage === null) return true;
  if (triage.containsSensitiveDocument >= SENSITIVE_DOCUMENT_THRESHOLD) return true;
  return !(triage.task === 'remember' || explicitMemoryRequest(text));
}

/** Fixed, content-free acknowledgement sent when triage is slow, in imageTurnLanguage(text, languageCode). */
export function imageAckText(text: string, languageCode?: unknown): string {
  return imageTurnLanguage(text, languageCode) === 'fa' ? 'یک لحظه، دارم عکس را نگاه می‌کنم.' : "One moment, I'm looking at your photo.";
}

/**
 * Fixed, content-free history text kept in place of a reply the model wrote
 * from a sensitive document, or from an image whose triage is unknown. The
 * reply is delivered; its text is never stored.
 */
export const IMAGE_WITHHELD_REPLY_TEXT = '(replied about a shared image; the details were not kept)';
/** IMAGE_WITHHELD_REPLY_TEXT for a Persian reply, so a Persian conversation's history stays Persian. */
export const IMAGE_WITHHELD_REPLY_TEXT_FA = '(دربارهٔ یک عکس پاسخ داده شد؛ جزئیات نگه داشته نشد)';

/** The withheld-reply text in a language; callers pass textLanguage(delivered reply). */
export function withheldImageReplyText(lang: ImageTextLanguage): string {
  return lang === 'fa' ? IMAGE_WITHHELD_REPLY_TEXT_FA : IMAGE_WITHHELD_REPLY_TEXT;
}

/** True for the withheld-reply text in either language. */
export function isWithheldImageReplyText(text: string): boolean {
  return text === IMAGE_WITHHELD_REPLY_TEXT || text === IMAGE_WITHHELD_REPLY_TEXT_FA;
}

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
