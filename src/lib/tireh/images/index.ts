/**
 * Telegram image ingestion and image triage (S12, behind STUDIO_IMAGES=1).
 *
 * One photo or JPEG/PNG image document, sent to a persona in a private chat
 * with no guest audience, becomes one ephemeral image for that turn:
 *   flag/audience/provider gates (no I/O) → smallest adequate PhotoSize →
 *   bounded download → sniff + metadata strip → optional Decisions triage
 *   (persona header, caption and the image only) → reply-resolution image.
 *
 * Bytes live only in the returned object for the duration of the turn. They
 * never reach history, logs, decision or audit rows, memory or system prompt
 * blocks. Logs are fixed strings; errors, ids, captions and bytes are never
 * passed to the logger. Every failure returns null (base behaviour) or a
 * turn without triage, which stores nothing.
 */

import { tirehFlags } from '../flags';
import { isVisionCapable, VisionUnsupportedError } from '../llm-content';
import type { LLM, LLMImage } from '../llm';
import type { Decider, DecisionAnswer, DecisionQuestion } from '../triage';
import type { OrgDirectory } from '../org/directory';
import type { ChatContext, Persona } from '../types';
import type { TelegramBotClient, TelegramMessage, TelegramPhotoSize } from '../telegram/client';
import { hasGuestAudience } from '../memory/visibility';
import { toLLMImage } from './bytes';
import { IMAGE_QUESTIONS, imageTriageText, readImageTriage } from './questions';
import {
  ackText,
  IMAGE_ACK_AFTER_MS,
  IMAGE_DOWNLOAD_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_TRIAGE_TIMEOUT_MS,
  imagePolicy,
  replyDetail,
  type ImageTriage,
} from './policy';
import { IMAGE_MIN_EDGE, pickPhotoSize } from './select';

export { pickPhotoSize, IMAGE_MIN_EDGE, type ImageDetail } from './select';
export { sniffImageMime, stripImageMetadata, toLLMImage } from './bytes';
export { IMAGE_KINDS, IMAGE_QUESTION_SET_VERSION, IMAGE_QUESTIONS, IMAGE_TASKS, imageTriageText, readImageTriage } from './questions';
export {
  ackText,
  explicitRemember,
  forceQuickTriage,
  IMAGE_ACK_AFTER_MS,
  IMAGE_ACK_TEXT,
  IMAGE_DOWNLOAD_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_PEOPLE_THRESHOLD,
  IMAGE_REMEMBER_CONFIDENCE,
  IMAGE_SENSITIVE_THRESHOLD,
  IMAGE_TRIAGE_TIMEOUT_MS,
  imagePolicy,
  QUICK_IMAGE_TASKS,
  replyDetail,
  type ImageTriage,
} from './policy';

/** History text for a captionless image turn. */
export const IMAGE_PLACEHOLDER_TEXT = '(shared a photo)';

export interface ImageTurn {
  /** Exactly one image, current turn only. */
  images: LLMImage[];
  text: string;
  triage: ImageTriage | null;
  suppressMemory: boolean;
  containsPeople: boolean;
  forceQuick: boolean;
}

/** Local structural alias, identical to S09's DeciderPart; the integrator may swap it for the triage.ts import after S09 merges. */
export type ImageDeciderPart = { type: 'text'; text: string } | { type: 'image'; image: LLMImage };

export interface ImageIngestDeps {
  org: OrgDirectory;
  decider?: Decider & { decideParts?: (input: readonly ImageDeciderPart[], questions: DecisionQuestion[], timeoutMs?: number) => Promise<Record<string, DecisionAnswer>> };
  llm: LLM;
  fastLlm?: LLM;
  bot: TelegramBotClient;
  log: Pick<Console, 'warn'>;
}

const IMAGE_DOCUMENT_MIMES = new Set(['image/jpeg', 'image/png']);

type ImageSource =
  | { kind: 'photo'; sizes: readonly TelegramPhotoSize[] }
  | { kind: 'document'; fileId: string; mimeType: string; fileSize?: number };

function imageSource(message: TelegramMessage): ImageSource | null {
  if (Array.isArray(message.photo) && message.photo.length > 0) return { kind: 'photo', sizes: message.photo };
  const document = message.document;
  if (document && typeof document.file_id === 'string' && document.file_id && typeof document.mime_type === 'string' && IMAGE_DOCUMENT_MIMES.has(document.mime_type)) {
    return { kind: 'document', fileId: document.file_id, mimeType: document.mime_type, fileSize: document.file_size };
  }
  return null;
}

const tooLarge = (fileSize: unknown): boolean => typeof fileSize === 'number' && fileSize > IMAGE_MAX_BYTES;

async function download(bot: TelegramBotClient, fileId: string, declaredMime?: string): Promise<LLMImage | 'download_failed' | 'invalid'> {
  let bytes: Uint8Array;
  try {
    bytes = await bot.downloadImage(fileId, { maxBytes: IMAGE_MAX_BYTES, signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) });
  } catch {
    return 'download_failed';
  }
  return toLLMImage(bytes, declaredMime) ?? 'invalid';
}

async function triageImage(deps: ImageIngestDeps, persona: Persona, message: TelegramMessage, text: string, image: LLMImage): Promise<ImageTriage | null> {
  const decideParts = deps.decider?.decideParts;
  if (!decideParts) return null;
  let settled = false;
  const ack = setTimeout(() => {
    if (settled) return;
    deps.bot.sendMessage(message.chat.id, ackText(text), { replyTo: message.message_id })
      .catch(() => deps.log.warn('image_ack_failed'));
  }, IMAGE_ACK_AFTER_MS);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      decideParts.call(deps.decider, [{ type: 'text', text: imageTriageText(persona, text) }, { type: 'image', image }], IMAGE_QUESTIONS, IMAGE_TRIAGE_TIMEOUT_MS),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('image_triage_timeout')), IMAGE_TRIAGE_TIMEOUT_MS + 250); }),
    ]);
    const triage = readImageTriage(answers);
    if (!triage) deps.log.warn('image_triage_failed');
    return triage;
  } catch {
    deps.log.warn('image_triage_failed');
    return null;
  } finally {
    settled = true;
    clearTimeout(ack);
    if (deadline !== undefined) clearTimeout(deadline);
  }
}

async function ingest(deps: ImageIngestDeps, persona: Persona, chat: ChatContext, speakerId: string, message: TelegramMessage, text: string): Promise<ImageTurn | null> {
  // (1) Gates that need no I/O.
  if (!tirehFlags().images) return null;
  const source = imageSource(message);
  if (!source) return null;
  if (chat.kind !== 'private' || chat.personId !== speakerId) return null;
  if (hasGuestAudience(deps.org, chat)) return null;

  // (2) Only an approved vision provider may receive the image.
  const target = deps.fastLlm ?? deps.llm;
  try {
    if (!isVisionCapable(target)) throw new VisionUnsupportedError(target.identity?.provider ?? 'unknown');
  } catch (error) {
    if (error instanceof VisionUnsupportedError) {
      deps.log.warn('image_vision_unsupported');
      return null;
    }
    throw error;
  }

  // (3)-(5) The first image: small for triage, ordinary otherwise.
  const canTriage = typeof deps.decider?.decideParts === 'function';
  let fileId: string;
  let declaredMime: string | undefined;
  if (source.kind === 'photo') {
    const size = pickPhotoSize(source.sizes, canTriage ? IMAGE_MIN_EDGE.low : IMAGE_MIN_EDGE.standard);
    if (!size || tooLarge(size.file_size)) {
      deps.log.warn('image_invalid');
      return null;
    }
    fileId = size.file_id;
  } else {
    if (tooLarge(source.fileSize)) {
      deps.log.warn('image_invalid');
      return null;
    }
    fileId = source.fileId;
    declaredMime = source.mimeType;
  }
  const first = await download(deps.bot, fileId, declaredMime);
  if (first === 'download_failed' || first === 'invalid') {
    deps.log.warn(first === 'download_failed' ? 'image_download_failed' : 'image_invalid');
    return null;
  }

  // (6) Triage, with an acknowledgement when it is slow.
  const triage = canTriage ? await triageImage(deps, persona, message, text, first) : null;

  // (7) A photo is re-fetched at the resolution its task needs.
  let image = first;
  if (source.kind === 'photo') {
    const wanted = pickPhotoSize(source.sizes, IMAGE_MIN_EDGE[replyDetail(triage)]);
    if (wanted && wanted.file_id !== fileId) {
      const detailed = tooLarge(wanted.file_size) ? 'download_failed' : await download(deps.bot, wanted.file_id);
      if (detailed === 'download_failed' || detailed === 'invalid') deps.log.warn('image_detail_download_failed');
      else image = detailed;
    }
  }

  // (8) Code-owned retention and routing.
  return {
    images: [image],
    text: text.trim() ? text : IMAGE_PLACEHOLDER_TEXT,
    triage,
    ...imagePolicy(triage, text, isVisionCapable(deps.llm)),
  };
}

/** Never throws. Null means the turn proceeds exactly as without images. */
export async function ingestTelegramImage(deps: ImageIngestDeps, persona: Persona, chat: ChatContext, speakerId: string, message: TelegramMessage, text: string): Promise<ImageTurn | null> {
  try {
    return await ingest(deps, persona, chat, speakerId, message, text);
  } catch {
    try { deps.log.warn('image_ingest_failed'); } catch { /* logging must not break the turn */ }
    return null;
  }
}
