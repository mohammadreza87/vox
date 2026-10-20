/**
 * Test-only helpers for S12 image ingestion. Offline: no provider, no network.
 * fixtures.ts stays untouched; this module builds on its fakes.
 */

import { vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import type { LLM, LLMImage } from '../llm';
import type { DecisionAnswer, DecisionQuestion } from '../triage';
import type { TelegramBotClient, TelegramPhotoSize, TelegramUpdate } from '../telegram/client';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { ImageDeciderPart, ImageTriage } from '../images';
import { FakeLLM, fakeBot, testOrg } from './fixtures';

export const EXIF_CANARY = 'S12_EXIF_GPS_CANARY_51.5007N_0.1246W';
export const COMMENT_CANARY = 'S12_JPEG_COMMENT_CANARY';
export const PNG_TEXT_CANARY = 'S12_PNG_TEXT_CANARY';

export class VisionFakeLLM extends FakeLLM {
  readonly identity = { provider: 'anthropic', model: 'claude-haiku-5-5' };
}

export class GeminiFakeLLM extends FakeLLM {
  readonly identity = { provider: 'gemini', model: 'gemini-2.5-flash' };
}

const ascii = (text: string): number[] => [...Buffer.from(text, 'latin1')];
const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function segment(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...u16(payload.length + 2), ...payload];
}

/** A structurally valid baseline JPEG: SOI, [APP1 Exif], [COM], DQT, SOF0 320x240, DHT, SOS, scan, EOI. */
export function jpegBytes(options: { withExif?: boolean; withComment?: boolean; canary?: string } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  parts.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (options.withExif) parts.push(...segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii(EXIF_CANARY)]));
  if (options.withComment) parts.push(...segment(0xfe, ascii(COMMENT_CANARY)));
  parts.push(...segment(0xdb, [0, ...Array.from({ length: 64 }, (_, i) => (i % 15) + 1)]));
  parts.push(...segment(0xc0, [8, ...u16(240), ...u16(320), 1, 1, 0x11, 0]));
  parts.push(...segment(0xc4, [0x00, 1, ...Array(15).fill(0), 0]));
  parts.push(...segment(0xda, [1, 1, 0x00, 0, 63, 0]));
  parts.push(...ascii(options.canary ?? 'scan-data'), 0x12, 0x34, 0x56);
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: number[]): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function pngChunk(type: string, data: number[]): number[] {
  const body = [...ascii(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A structurally valid PNG: IHDR 1x1, [tEXt, eXIf], pHYs, IDAT, IEND. */
export function pngBytes(options: { withText?: boolean } = {}): Uint8Array {
  const parts: number[] = [...PNG_SIGNATURE];
  parts.push(...pngChunk('IHDR', [...u32(1), ...u32(1), 8, 2, 0, 0, 0]));
  if (options.withText) {
    parts.push(...pngChunk('tEXt', [...ascii('Comment'), 0, ...ascii(PNG_TEXT_CANARY)]));
    parts.push(...pngChunk('eXIf', [...ascii('MM'), 0, 42, ...ascii(EXIF_CANARY)]));
  }
  parts.push(...pngChunk('pHYs', [...u32(2835), ...u32(2835), 1]));
  parts.push(...pngChunk('IDAT', [0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00]));
  parts.push(...pngChunk('IEND', []));
  return new Uint8Array(parts);
}

export function photoSizes(): TelegramPhotoSize[] {
  return [
    { file_id: 'photo-90', file_unique_id: 'u90', width: 90, height: 67, file_size: 1_200 },
    { file_id: 'photo-320', file_unique_id: 'u320', width: 320, height: 240, file_size: 14_000 },
    { file_id: 'photo-800', file_unique_id: 'u800', width: 800, height: 600, file_size: 61_000 },
    { file_id: 'photo-1280', file_unique_id: 'u1280', width: 1280, height: 960, file_size: 120_000 },
  ];
}

let updateId = 90_000;
let messageId = 9_000;

export function privatePhoto(fromTelegramId: number, options: { caption?: string; sizes?: TelegramPhotoSize[]; chatId?: number; chatType?: 'private' | 'supergroup' } = {}): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      chat: { id: options.chatId ?? fromTelegramId, type: options.chatType ?? 'private', ...(options.chatType === 'supergroup' ? { title: 'g' } : {}) },
      date: 0,
      photo: options.sizes ?? photoSizes(),
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
    },
  };
}

export function privateImageDocument(fromTelegramId: number, options: { mime: string; caption?: string; fileId?: string; fileSize?: number }): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTelegramId, is_bot: false, first_name: 'x' },
      chat: { id: fromTelegramId, type: 'private' },
      date: 0,
      document: { file_id: options.fileId ?? 'doc-1', file_name: 'image', mime_type: options.mime, ...(options.fileSize !== undefined ? { file_size: options.fileSize } : {}) },
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
    },
  };
}

export type ImageAnswers = Record<string, DecisionAnswer>;

export function imageAnswers(input: { kind: ImageTriage['kind']; task: ImageTriage['task']; taskConfidence?: number; people: number; sensitive: number }): ImageAnswers {
  return {
    image_kind: { type: 'choice', choice: input.kind, confidence: 0.9 },
    image_task: { type: 'choice', choice: input.task, confidence: input.taskConfidence ?? 0.9 },
    contains_people: { type: 'predicate', probability: input.people },
    contains_sensitive_document: { type: 'predicate', probability: input.sensitive },
  };
}

/** Text-triage answers for the base questions (effort, live_info, memorable, wants_voice). */
export function textAnswers(input: { effort?: 'quick' | 'thoughtful'; live?: number; memorable?: number } = {}): ImageAnswers {
  return {
    effort: { type: 'choice', choice: input.effort ?? 'thoughtful', confidence: 1 },
    live_info: { type: 'predicate', probability: input.live ?? 0 },
    memorable: { type: 'predicate', probability: input.memorable ?? 1 },
    wants_voice: { type: 'predicate', probability: 0 },
  };
}

export function scriptedImageDecider(answers: ImageAnswers | (() => Promise<ImageAnswers>), text: ImageAnswers = {}) {
  return {
    decide: vi.fn(async (_input: string, _questions: DecisionQuestion[], _timeoutMs?: number): Promise<ImageAnswers> => text),
    decideParts: vi.fn(async (_input: readonly ImageDeciderPart[], _questions: DecisionQuestion[], _timeoutMs?: number): Promise<ImageAnswers> =>
      typeof answers === 'function' ? answers() : answers),
  };
}
export type ScriptedImageDecider = ReturnType<typeof scriptedImageDecider>;

/** Distinct bytes per photo size so tests can tell which file was used. */
export function defaultImageFiles(): Map<string, Uint8Array> {
  return new Map(photoSizes().map((size) => [size.file_id, jpegBytes({ canary: `SCAN_${size.file_id}` })] as const));
}

export const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const imageOf = (bytes: Uint8Array, mimeType: LLMImage['mimeType'] = 'image/jpeg'): LLMImage => ({ mimeType, data: base64Of(bytes) });

export function imageBot(files: Map<string, Uint8Array> = defaultImageFiles()) {
  const bot = fakeBot();
  return Object.assign(bot, {
    files,
    downloadImage: vi.fn(async (fileId: string, _options: { maxBytes: number; signal?: AbortSignal }): Promise<Uint8Array> => {
      const bytes = files.get(fileId);
      if (!bytes) throw new Error('no such file');
      return bytes;
    }),
  });
}
export type ImageBot = ReturnType<typeof imageBot>;

export function makeImageGateway(options: { llm?: LLM & FakeLLM; fastLlm?: LLM & FakeLLM; decider?: ScriptedImageDecider | { decide: ScriptedImageDecider['decide'] }; logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }; stageTimings?: boolean; files?: Map<string, Uint8Array> } = {}) {
  const org = testOrg();
  const llm = options.llm ?? new VisionFakeLLM();
  const fastLlm = options.fastLlm;
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const offers = new InMemoryShareOfferStore();
  const history = new InMemoryChatHistoryStore(epochs);
  const bot = imageBot(options.files);
  const logger = options.logger ?? { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new PersonaGateway({
    org,
    llm,
    ...(fastLlm ? { fastLlm } : {}),
    ...(options.decider ? { decider: options.decider } : {}),
    memories,
    offers,
    history,
    deduper: new InMemoryUpdateDeduper(),
    voice: null,
    botFor: () => bot as unknown as TelegramBotClient,
    logger,
    now: () => new Date('2026-10-19T10:00:00Z'),
    ...(options.stageTimings ? { stageTimings: true } : {}),
  });
  return { org, llm, fastLlm, memories, offers, history, bot, gateway, logger, decider: options.decider };
}

/** Every stored history row, across chats. */
export function historyRows(history: InMemoryChatHistoryStore) {
  return [...history.chats.values()].flat();
}
