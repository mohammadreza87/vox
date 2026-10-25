/**
 * Test helpers for S12 image turns. Offline only: no provider, no network.
 */

import { vi } from 'vitest';
import { FakeLLM, fakeBot } from './fixtures';
import { crc32 } from '../images/bytes';
import type { TelegramPhotoSize, TelegramUpdate } from '../telegram/client';
import type { DeciderAuthority, DecisionAnswer, DecisionQuestion } from '../triage';
import type { LLMImage } from '../llm';

export const IMAGE_CANARIES = {
  /** Planted in EXIF/APP1 and PNG tEXt; must never leave the process. */
  exif: 'EXIFCANARY-GPS-51.50071N-0.12463W',
  /** Planted in captions; may reach the model, never a log line. */
  caption: 'CAPTIONCANARY-7f3a91',
} as const;

/** An Anthropic-identified fake (vision approved). */
export class VisionFakeLLM extends FakeLLM {
  constructor(readonly model = 'claude-haiku-5-5') { super(); }
  get identity() { return { provider: 'anthropic', model: this.model }; }
}

/** A Gemini-identified fake (vision not approved for Telegram image turns). */
export class GeminiFakeLLM extends FakeLLM {
  constructor(readonly model = 'gemini-2.5-flash') { super(); }
  get identity() { return { provider: 'gemini', model: this.model }; }
}

const ascii = (text: string) => Array.from(Buffer.from(text, 'latin1'));
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/** A structurally valid baseline JPEG (SOI, APP0, optional APP1/COM, SOF0, SOS, EOI). */
export function tinyJpeg(width: number, height: number, opts: { exifCanary?: string; comment?: string; app14?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  const jfif = [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  bytes.push(0xff, 0xe0, ...u16(jfif.length + 2), ...jfif);
  if (opts.exifCanary) {
    const exif = [...ascii('Exif'), 0, 0, ...ascii(opts.exifCanary)];
    bytes.push(0xff, 0xe1, ...u16(exif.length + 2), ...exif);
  }
  if (opts.app14) {
    const adobe = [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1];
    bytes.push(0xff, 0xee, ...u16(adobe.length + 2), ...adobe);
  }
  if (opts.comment) {
    const comment = ascii(opts.comment);
    bytes.push(0xff, 0xfe, ...u16(comment.length + 2), ...comment);
  }
  bytes.push(0xff, 0xc0, 0x00, 0x0b, 0x08, ...u16(height), ...u16(width), 0x01, 0x01, 0x11, 0x00);
  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  bytes.push(0x00, 0x00, 0x00, 0x00);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

function pngChunk(kind: string, data: number[]): number[] {
  const body = Uint8Array.from([...ascii(kind), ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** A structurally valid PNG with correct CRCs and an optional tEXt canary. */
export function tinyPng(width: number, height: number, opts: { textCanary?: string } = {}): Uint8Array {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(...pngChunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]));
  if (opts.textCanary) bytes.push(...pngChunk('tEXt', [...ascii('Comment'), 0, ...ascii(opts.textCanary)]));
  bytes.push(...pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]));
  bytes.push(...pngChunk('IEND', []));
  return Uint8Array.from(bytes);
}

/** fakeBot() plus a scripted, size-checked downloadImage. */
export function imageBot(files: Record<string, Uint8Array>) {
  const bot = fakeBot();
  const downloadImage = vi.fn(async (fileId: string, options: { maxBytes: number; signal?: AbortSignal }) => {
    const file = files[fileId];
    if (!file) throw new Error('Telegram getFile failed: not found');
    if (file.byteLength > options.maxBytes) throw new Error('Telegram getFile failed: file too large');
    return file.slice();
  });
  return Object.assign(bot, { downloadImage });
}
export type ImageBot = ReturnType<typeof imageBot>;

let updateId = 700_000;
let messageId = 70_000;

export function privatePhoto(fromTg: number, sizes: TelegramPhotoSize[], caption?: string): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTg, is_bot: false, first_name: 'x' },
      chat: { id: fromTg, type: 'private' },
      date: 0,
      photo: sizes,
      ...(caption !== undefined ? { caption } : {}),
    },
  };
}

export function privateDocument(fromTg: number, doc: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }, caption?: string): TelegramUpdate {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from: { id: fromTg, is_bot: false, first_name: 'x' },
      chat: { id: fromTg, type: 'private' },
      date: 0,
      document: doc,
      ...(caption !== undefined ? { caption } : {}),
    },
  };
}

type Answers = Record<string, DecisionAnswer>;
type ImageParts = ReadonlyArray<{ type: 'text'; text: string } | { type: 'image'; image: LLMImage }>;

/** Text triage answers in the v1 shape. */
export function textAnswers(opts: { effort?: 'quick' | 'thoughtful'; memorable?: number } = {}): Answers {
  return {
    effort: { type: 'choice', choice: opts.effort ?? 'thoughtful', confidence: 0.9 },
    live_info: { type: 'predicate', probability: 0.05 },
    memorable: { type: 'predicate', probability: opts.memorable ?? 0.9 },
    wants_voice: { type: 'predicate', probability: 0.01 },
  };
}

/** Image triage answers in the image-v1 shape. */
export function imageAnswers(opts: { kind?: string; task?: string; taskConfidence?: number; people?: number; sensitive?: number } = {}): Answers {
  return {
    image_kind: { type: 'choice', choice: opts.kind ?? 'other', confidence: 0.9 },
    image_task: { type: 'choice', choice: opts.task ?? 'react', confidence: opts.taskConfidence ?? 0.9 },
    contains_people: { type: 'predicate', probability: opts.people ?? 0.1 },
    contains_sensitive_document: { type: 'predicate', probability: opts.sensitive ?? 0.1 },
  };
}

/** decide and decideParts are recorded vi.fn; `parts: false` omits decideParts. */
export function scriptedDecider(script: { text?: Answers; image?: Answers | (() => Promise<Answers>); parts?: boolean } = {}) {
  const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number, authority?: DeciderAuthority) => Promise<Answers>>(async () => script.text ?? {});
  const decideParts = vi.fn<(input: ImageParts, questions: DecisionQuestion[], timeoutMs?: number, authority?: DeciderAuthority) => Promise<Answers>>(async () =>
    typeof script.image === 'function' ? script.image() : script.image ?? {});
  return script.parts === false ? { decide } : { decide, decideParts };
}

/** Telegram-like size ladder; each id maps to a valid JPEG of that size. */
export function photoLadder(prefix = 'p', exifCanary: string | undefined = IMAGE_CANARIES.exif) {
  const dims: Array<[number, number]> = [[90, 67], [320, 240], [800, 600], [1280, 960]];
  const sizes: TelegramPhotoSize[] = dims.map(([width, height], i) => ({ file_id: `${prefix}-${width}`, file_unique_id: `${prefix}-u${i}`, width, height }));
  const files: Record<string, Uint8Array> = Object.fromEntries(dims.map(([width, height]) => [`${prefix}-${width}`, tinyJpeg(width, height, { exifCanary })]));
  return { sizes, files };
}

export function containsBytes(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));
}
