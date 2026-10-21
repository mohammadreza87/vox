/**
 * Image routing and retention policy (S12). Pure functions: the model only
 * answers questions; code decides what may be stored and where a reply goes.
 * Every missing answer fails closed (nothing stored, people assumed present).
 */

import { TRIAGE_TIMEOUT_MS, type Triage } from '../triage';
import type { ImageDetail } from './select';

export interface ImageTriage {
  kind: 'screenshot' | 'document' | 'receipt' | 'chart' | 'photo_of_people' | 'meme' | 'other';
  task: 'explain' | 'extract_text' | 'decide' | 'react' | 'remember' | 'unclear';
  containsPeople: number;
  containsSensitiveDocument: number;
}

/** At or above this, an image is a sensitive document and is never stored. */
export const IMAGE_SENSITIVE_THRESHOLD = 0.5;
/** Leans protective: a modest chance of people turns the extraction rule on. */
export const IMAGE_PEOPLE_THRESHOLD = 0.3;
/** A `remember` task below this confidence reads as `unclear`. */
export const IMAGE_REMEMBER_CONFIDENCE = 0.6;
/** Slow triage gets a short text acknowledgement after this long. */
export const IMAGE_ACK_AFTER_MS = 800;
export const IMAGE_TRIAGE_TIMEOUT_MS: number = TRIAGE_TIMEOUT_MS;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 5000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Tasks the fast vision model (Haiku) answers well. */
export const QUICK_IMAGE_TASKS: ReadonlySet<ImageTriage['task']> = new Set<ImageTriage['task']>(['explain', 'extract_text', 'decide', 'react']);
export const IMAGE_ACK_TEXT = { en: 'Looking at your image…', fa: 'دارم تصویرت رو نگاه می‌کنم…' } as const;

export function ackText(caption: string): string {
  return /[؀-ۿ]/.test(caption) ? IMAGE_ACK_TEXT.fa : IMAGE_ACK_TEXT.en;
}

const NEGATED_REMEMBER = /(?:do not|don't|don’t|never)\s+(?:remember|save|store|keep)|forget (?:this|that)|ذخیره نکن|به خاطر نسپار|یادت نماند|فراموش کن/iu;
const EXPLICIT_REMEMBER = /\b(?:remember|save|store|keep)\s+(?:this|that|it)\b|یادت\s*باشه|به\s*خاطر\s*بسپار|ذخیره(?:ش)?\s*کن|نگهش\s*دار/iu;

/** An explicit request in the caption to keep the information; any negation wins. */
export function explicitRemember(text: string): boolean {
  if (NEGATED_REMEMBER.test(text)) return false;
  return EXPLICIT_REMEMBER.test(text);
}

/** The PhotoSize tier the reply should see. */
export function replyDetail(triage: ImageTriage | null): ImageDetail {
  if (!triage) return 'standard';
  if (triage.task === 'extract_text' || ['screenshot', 'document', 'receipt', 'chart'].includes(triage.kind)) return 'detail';
  if ((triage.kind === 'photo_of_people' || triage.kind === 'meme') && (triage.task === 'react' || triage.task === 'unclear')) return 'low';
  return 'standard';
}

export function imagePolicy(triage: ImageTriage | null, text: string, mainLlmVisionCapable: boolean): { suppressMemory: boolean; containsPeople: boolean; forceQuick: boolean } {
  const asked = triage !== null && (triage.task === 'remember' || explicitRemember(text));
  return {
    suppressMemory: !(asked && triage !== null && triage.containsSensitiveDocument < IMAGE_SENSITIVE_THRESHOLD),
    containsPeople: triage === null || triage.kind === 'photo_of_people' || triage.containsPeople >= IMAGE_PEOPLE_THRESHOLD,
    forceQuick: !mainLlmVisionCapable || (triage !== null && QUICK_IMAGE_TASKS.has(triage.task)),
  };
}

/**
 * Routes an image reply to the fast vision model without web search. Skill
 * fields pass through untouched, so skill diagnostics stay unchanged. The
 * original result object is never mutated.
 */
export function forceQuickTriage<T extends { triage: Triage | null }>(triaged: Promise<T>): Promise<T> {
  return triaged.then((t) => ({
    ...t,
    triage: { ...(t.triage ?? { memorable: true, wantsVoice: false }), effort: 'quick' as const, needsWeb: false },
  }));
}
