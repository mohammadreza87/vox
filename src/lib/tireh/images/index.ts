/**
 * Telegram image turns (S12, server flag STUDIO_IMAGES, default off).
 *
 * A member's photo or JPEG/PNG document in a private, guest-free chat becomes
 * one ephemeral image for that turn: downloaded at a bounded size, stripped of
 * metadata, triaged with four content-free questions, and handed to the reply
 * model. Bytes never reach history, memory, logs, diagnostics or system
 * prompt blocks, and are never replayed in a later turn.
 */

import { sharedImageForModel } from '../../adaptive/prediction/image';
import { tirehFlags } from '../flags';
import { isVisionCapable, VisionUnsupportedError } from '../llm-content';
import { hasGuestAudience } from '../memory/visibility';
import type { LLM, LLMImage } from '../llm';
import type { OrgDirectory } from '../org/directory';
import type { TelegramBotClient, TelegramMessage, TelegramPhotoSize } from '../telegram/client';
import type { Decider, DeciderAuthority, DeciderPart, DecisionAnswer, DecisionQuestion, Triage } from '../triage';
import type { ChatContext, Persona } from '../types';
import {
  MAX_REPLY_IMAGE_BYTES, pickPhotoSize, replyPhotoSize, sniffImageMime, stripImageMetadata, toLLMImage,
  TRIAGE_MAX_BYTES, TRIAGE_MIN_EDGE, type ImageMime,
} from './bytes';
import { decisionLogRow, type DecisionLogSink } from '../decisions/log';
import { IMAGE_QUESTION_SET, IMAGE_TRIAGE_QUESTIONS, imageTriageInput, readImageTriage, type ImageTriage } from './questions';
import { imageAckText, imageTurnLanguage, suppressImageMemory, type ImageTextLanguage } from './retention';

export * from './bytes';
export * from './questions';
export * from './retention';

export const IMAGE_PLACEHOLDER_TEXT = '(shared a photo)';
/** IMAGE_PLACEHOLDER_TEXT for a Persian speaker (imageTurnLanguage: no caption, a 'fa' Telegram language_code). */
export const IMAGE_PLACEHOLDER_TEXT_FA = '(یک عکس فرستاد)';

/** The placeholder turn text for a captionless image, in a language. */
export function imagePlaceholderText(lang: ImageTextLanguage): string {
  return lang === 'fa' ? IMAGE_PLACEHOLDER_TEXT_FA : IMAGE_PLACEHOLDER_TEXT;
}

/** True for the placeholder text in either language. */
export function isImagePlaceholderText(text: string): boolean {
  return text === IMAGE_PLACEHOLDER_TEXT || text === IMAGE_PLACEHOLDER_TEXT_FA;
}
export const IMAGE_ACK_AFTER_MS = 1_500;
export const IMAGE_TRIAGE_TIMEOUT_MS = 2_000;
/** Each Telegram file download (getFile plus the file fetch) is bounded by this deadline. */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 5_000;
export const IMAGE_LOG_PREFIX = 'tireh_image:';

/**
 * The people rule (IMAGE_PEOPLE_RULE and the appearance filter) is on for an image the decider classed as a
 * photo of people, or whose people probability reaches this threshold, or whose triage is unknown. Ported from
 * main's S12 images/policy.ts ("leans protective"); wave A's 0.5 without the kind was weaker.
 */
export const IMAGE_PEOPLE_THRESHOLD = 0.3;

export function imageShowsPeople(triage: ImageTriage | null): boolean {
  return triage === null || triage.kind === 'photo_of_people' || triage.containsPeople >= IMAGE_PEOPLE_THRESHOLD;
}

export type ImageLogCode = 'vision_unsupported' | 'download_failed' | 'download_timeout' | 'authority_changed' | 'unsupported_type' | 'too_large' | 'metadata_invalid' | 'triage_failed' | 'triage_timeout' | 'ack_failed';

export interface ImageTurn {
  /** Exactly one current-turn image. */
  images: LLMImage[];
  /** The caption, or IMAGE_PLACEHOLDER_TEXT when there is none. */
  text: string;
  triage: ImageTriage | null;
  suppressMemory: boolean;
  containsPeople: boolean;
  forceQuick: boolean;
}

/** S09's single image part type (triage.ts DeciderPart). */
type ImageDeciderPart = DeciderPart;

export type ImageDecider = Decider & {
  decideParts?: (input: readonly ImageDeciderPart[], questions: DecisionQuestion[], timeoutMs?: number, authority?: DeciderAuthority) => Promise<Record<string, DecisionAnswer>>;
};

export interface ImageIngestDeps {
  org: OrgDirectory;
  decider?: ImageDecider;
  llm: LLM;
  fastLlm?: LLM;
  bot: TelegramBotClient;
  log: Pick<Console, 'warn'>;
  /**
   * The turn's authority, built by the gateway exactly as for text triage
   * (8a7dc55): `authorize` resolves to the turn's policy key while the
   * boundary is unchanged, else null. It is checked once the image has been
   * downloaded, before the acknowledgement and before triage, and is handed
   * to decideParts so the guarded transport re-checks it before the image
   * leaves the process. A withdrawn authority drops the image for the turn.
   */
  authority?: DeciderAuthority;
  /**
   * S09 decision log for the image-v1 triage call. The gateway passes its sink only while
   * TIREH_DECISION_LOG is on (read at call time); the row is content-free (decisions/log.ts).
   */
  decisionLog?: DecisionLogSink;
}

const FORCED_TASKS: ReadonlyArray<ImageTriage['task']> = ['explain', 'extract_text', 'decide', 'react'];
const DOCUMENT_MIMES: ReadonlyArray<string> = ['image/jpeg', 'image/png'];

type ImageSource =
  | { kind: 'photo'; sizes: TelegramPhotoSize[] }
  | { kind: 'document'; fileId: string; mime: ImageMime };

function imageSource(message: TelegramMessage): ImageSource | null {
  if (Array.isArray(message.photo) && message.photo.length > 0) return { kind: 'photo', sizes: message.photo };
  const doc = message.document;
  if (doc && typeof doc.file_id === 'string' && doc.file_id && doc.mime_type && DOCUMENT_MIMES.includes(doc.mime_type)
    && (doc.file_size === undefined || doc.file_size <= MAX_REPLY_IMAGE_BYTES)) {
    return { kind: 'document', fileId: doc.file_id, mime: doc.mime_type as ImageMime };
  }
  return null;
}

function hasImageSource(message: TelegramMessage): boolean {
  return imageSource(message) !== null;
}

/** Cheap, I/O-free check the gateway uses before any image work. */
export function imageIngestionWanted(message: TelegramMessage, chat: ChatContext): boolean {
  return tirehFlags().images && chat.kind === 'private' && hasImageSource(message);
}

/** Routes an image reply to the fast model: quick effort, no web search; skill routing is kept. */
export function forceQuickTriage<T extends { triage: Triage | null }>(triaged: Promise<T>): Promise<T> {
  return triaged.then((outcome) => ({
    ...outcome,
    triage: {
      ...(outcome.triage ?? { effort: 'quick', needsWeb: false, memorable: true, wantsVoice: false }),
      effort: 'quick',
      needsWeb: false,
    },
  }));
}

function logCode(log: Pick<Console, 'warn'>, code: ImageLogCode): void {
  try { log.warn(`${IMAGE_LOG_PREFIX}${code}`); } catch { /* logging never affects the turn */ }
}

type Fetched = { ok: true; image: LLMImage } | { ok: false; code: ImageLogCode };

/** Download, verify the magic bytes against the expected type, and strip metadata. */
async function fetchImage(deps: ImageIngestDeps, fileId: string, maxBytes: number, expected?: ImageMime): Promise<Fetched> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.bot.downloadImage(fileId, { maxBytes, signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    // Structural: TelegramApiError carries code 'file_too_large' for an oversize file (no message matching).
    if ((error as { code?: unknown } | null)?.code === 'file_too_large') return { ok: false, code: 'too_large' };
    // Structural check (no instanceof across bundles): AbortSignal.timeout rejects with a TimeoutError.
    return { ok: false, code: (error as { name?: unknown } | null)?.name === 'TimeoutError' ? 'download_timeout' : 'download_failed' };
  }
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength > maxBytes) return { ok: false, code: 'too_large' };
  const mime = sniffImageMime(bytes);
  if (!mime || (expected && mime !== expected)) return { ok: false, code: 'unsupported_type' };
  try {
    return { ok: true, image: toLLMImage(stripImageMetadata(bytes, mime), mime) };
  } catch {
    return { ok: false, code: 'metadata_invalid' };
  }
}

async function stillAuthorized(authority: DeciderAuthority): Promise<boolean> {
  try {
    if (authority.authorizeNow && !authority.authorizeNow()) return false;
    return await authority.authorize() !== null;
  } catch {
    return false;
  }
}

async function runTriage(deps: ImageIngestDeps, persona: Persona, caption: string, image: LLMImage): Promise<ImageTriage | null> {
  const decider = deps.decider;
  if (!decider?.decideParts) return null;
  let triageImage: LLMImage;
  try {
    // The seam's own contract: <=512 px, <=64 KiB, baseline JPEG/PNG, no metadata.
    triageImage = sharedImageForModel(`data:${image.mimeType};base64,${image.data}`);
  } catch {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), IMAGE_TRIAGE_TIMEOUT_MS); });
  const started = performance.now();
  const asked = Promise.resolve()
    .then(() => decider.decideParts!(
      [{ type: 'text', text: imageTriageInput(persona, caption) }, { type: 'image', image: triageImage }],
      [...IMAGE_TRIAGE_QUESTIONS],
      IMAGE_TRIAGE_TIMEOUT_MS,
      deps.authority,
    ))
    .then((answers) => ({ answers }), () => 'failed' as const);
  try {
    const result = await Promise.race([asked, timeout]);
    const elapsedMs = Math.round(performance.now() - started);
    if (result === 'timeout') {
      logCode(deps.log, 'triage_timeout');
      logTriageRow(deps, persona, caption, elapsedMs, { detail: { answers: {}, elapsedMs, outcome: 'unknown', unknownReason: 'timeout' } });
      return null;
    }
    if (result === 'failed') { logCode(deps.log, 'triage_failed'); logTriageRow(deps, persona, caption, elapsedMs, { failed: true }); return null; }
    logTriageRow(deps, persona, caption, elapsedMs, { answers: result.answers });
    return readImageTriage(result.answers);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One content-free S09 decision-log row for an image-v1 triage call (answered, failed or timed out),
 * only when the gateway handed over its sink (TIREH_DECISION_LOG on). The row holds catalogue names,
 * catalogue values and probabilities: never the caption (it feeds only the script-ratio label), the
 * image or any person id. `triage: null` makes routeTaken 'untriaged' by construction: an image turn's
 * reply route is settled by text triage and forceQuickTriage, not by these answers. Never affects the turn.
 */
function logTriageRow(deps: ImageIngestDeps, persona: Persona, caption: string, elapsedMs: number,
  outcome: Pick<Parameters<typeof decisionLogRow>[0], 'answers' | 'detail' | 'failed'>): void {
  const sink = deps.decisionLog;
  if (!sink) return;
  try {
    const row = decisionLogRow({ set: IMAGE_QUESTION_SET, questions: [...IMAGE_TRIAGE_QUESTIONS], ...outcome, triage: null, elapsedMs,
      webSearchAvailable: false, fastModel: !!deps.fastLlm, personaId: persona.id, chatKind: 'private', latestMessage: caption, at: new Date() });
    if (row) sink.record(row);
  } catch { /* the decision log never affects the turn */ }
}

/**
 * The image for this turn, or null when the turn should be handled exactly as
 * before (flag off, not a private member chat, a guest audience, no usable
 * image, a non-Anthropic model, or a failed download). Never throws for
 * ordinary failures; logs only fixed `tireh_image:<code>` strings.
 */
export async function ingestTelegramImage(
  deps: ImageIngestDeps,
  persona: Persona,
  chat: ChatContext,
  speakerId: string,
  message: TelegramMessage,
  text: string,
): Promise<ImageTurn | null> {
  // (a) No I/O unless this is a private, guest-free chat with its own member.
  if (!tirehFlags().images || chat.kind !== 'private' || hasGuestAudience(deps.org, chat) || speakerId !== chat.personId) return null;
  const source = imageSource(message);
  if (!source) return null;

  // (b) Both possible reply models must be approved for vision before any download.
  try {
    if (!isVisionCapable(deps.llm)) throw new VisionUnsupportedError(deps.llm.identity?.provider ?? 'unknown');
    if (deps.fastLlm && !isVisionCapable(deps.fastLlm)) throw new VisionUnsupportedError(deps.fastLlm.identity?.provider ?? 'unknown');
  } catch {
    logCode(deps.log, 'vision_unsupported');
    return null;
  }

  // (c) The triage-sized image.
  const triageSize = source.kind === 'photo' ? pickPhotoSize(source.sizes, TRIAGE_MIN_EDGE) : null;
  if (source.kind === 'photo' && !triageSize) { logCode(deps.log, 'unsupported_type'); return null; }
  const first = source.kind === 'photo'
    ? await fetchImage(deps, triageSize!.file_id, TRIAGE_MAX_BYTES)
    : await fetchImage(deps, source.fileId, MAX_REPLY_IMAGE_BYTES, source.mime);
  if (!first.ok) { logCode(deps.log, first.code); return null; }

  // The turn's authority may have moved during the download (consent withdrawn,
  // person removed, /forgetall): then the image is dropped before it is
  // acknowledged or exported anywhere.
  if (deps.authority && !await stillAuthorized(deps.authority)) { logCode(deps.log, 'authority_changed'); return null; }

  // (e) One fixed acknowledgement when triage and the reply download are slow.
  let finished = false;
  let ack: Promise<unknown> | undefined;
  const ackTimer = setTimeout(() => {
    if (finished || ack) return;
    ack = Promise.resolve()
      .then(() => deps.bot.sendMessage(message.chat.id, imageAckText(text, message.from?.language_code), { replyTo: message.message_id }))
      .catch(() => logCode(deps.log, 'ack_failed'));
  }, IMAGE_ACK_AFTER_MS);

  let triage: ImageTriage | null = null;
  let image: LLMImage = first.image;
  try {
    // (d) Content-free image triage, only through a decider that takes image parts.
    triage = await runTriage(deps, persona, text, first.image);

    // (f) The reply image at the resolution the task needs. The turn's authority (the image capability
    // included) is read again first: no reply-tier byte is fetched after a withdrawal during triage.
    if (source.kind === 'photo') {
      const size = replyPhotoSize(source.sizes, triage);
      if (size && size.file_id !== triageSize!.file_id) {
        if (deps.authority && !await stillAuthorized(deps.authority)) { logCode(deps.log, 'authority_changed'); return null; }
        const reply = await fetchImage(deps, size.file_id, MAX_REPLY_IMAGE_BYTES);
        if (reply.ok) image = reply.image;
        else logCode(deps.log, reply.code);
      }
    }
  } finally {
    finished = true;
    clearTimeout(ackTimer);
    // Keep the acknowledgement ahead of the reply when it was already sent.
    if (ack) await ack;
  }

  // (g)
  const turnText = text.trim() ? text : imagePlaceholderText(imageTurnLanguage(text, message.from?.language_code));
  return {
    images: [image],
    text: turnText,
    triage,
    suppressMemory: suppressImageMemory(triage, turnText),
    containsPeople: imageShowsPeople(triage),
    forceQuick: !!triage && FORCED_TASKS.includes(triage.task),
  };
}
