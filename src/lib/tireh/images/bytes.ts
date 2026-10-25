/**
 * Pure image byte helpers for Telegram image turns (S12). No I/O, no logging.
 *
 * Only baseline-friendly JPEG and PNG are accepted. Metadata segments and
 * chunks (EXIF, GPS, XMP, comments, text chunks, ICC profiles, timestamps)
 * are removed before any byte leaves the process.
 */

import type { LLMImage } from '../llm';
import type { TelegramPhotoSize } from '../telegram/client';
import type { ImageTriage } from './questions';

export type ImageMime = 'image/jpeg' | 'image/png';

/** Smallest longest-edge used for triage (Decisions low detail). */
export const TRIAGE_MIN_EDGE = 320;
/** Triage downloads are small; anything larger is refused before fetching. */
export const TRIAGE_MAX_BYTES = 1_048_576;
/** Reply image cap (Anthropic accepts at most 5 MB base64; 3.75 MB raw stays under it). */
export const MAX_REPLY_IMAGE_BYTES = 3_750_000;
/** Text-heavy images (documents, receipts, screenshots, charts) need more pixels. */
export const REPLY_MIN_EDGE_TEXT = 1024;
export const REPLY_MIN_EDGE_DEFAULT = 640;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEPT = new Set(['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'IDAT', 'IEND']);
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return 'image/png';
  return null;
}

function invalid(): never {
  throw new Error('invalid_image');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

let crcTable: Uint32Array | undefined;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2, scanned = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalid();
    const marker = bytes[offset + 1];
    if (marker === undefined) invalid();
    // Fill bytes before a marker.
    if (marker === 0xff) { offset += 1; continue; }
    // EOI ends the image once a scan was read; anything after it is dropped.
    if (marker === 0xd9 && scanned) { kept.push(bytes.subarray(offset, offset + 2)); return concat(kept); }
    // A second SOI, EOI before any scan, or a stray standalone marker is malformed.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) invalid();
    if (offset + 4 > bytes.length) invalid();
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    const finish = offset + 2 + length;
    if (length < 2 || finish > bytes.length) invalid();
    if (marker === 0xda) {
      // SOS: the header, then its entropy-coded data up to the next marker. Inside it a 0xFF is
      // always followed by a stuffed 0x00 or a restart marker (RST0-7), so the first other marker
      // ends the scan. The markers between scans of a progressive JPEG (DHT, DQT, DRI, the next
      // SOS, EOI) are then read by this same loop, which drops any APPn or COM among them.
      let end = finish;
      for (;;) {
        if (end + 1 >= bytes.length) invalid();
        if (bytes[end] === 0xff) {
          const next = bytes[end + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { end += 2; continue; }
          break;
        }
        end += 1;
      }
      kept.push(bytes.subarray(offset, end));
      scanned = true;
      offset = end;
      continue;
    }
    // APP1-APP13, APP15 and COM carry EXIF, GPS, XMP, ICC, comments and vendor data.
    const metadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!metadata) kept.push(bytes.subarray(offset, finish));
    offset = finish;
  }
  return invalid();
}

function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((value, i) => bytes[i] === value)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8, header = false, data = false, end = false;
  while (offset < bytes.length) {
    if (end || offset + 12 > bytes.length) invalid();
    const length = view.getUint32(offset);
    const finish = offset + 12 + length;
    if (finish > bytes.length) invalid();
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(kind)) invalid();
    if (crc32(bytes.subarray(offset + 4, finish - 4)) !== view.getUint32(finish - 4)) invalid();
    if (kind === 'IHDR') { if (header || offset !== 8) invalid(); header = true; }
    else if (!header) invalid();
    if (kind === 'IDAT') data = true;
    if (kind === 'IEND') end = true;
    const critical = kind[0] === kind[0].toUpperCase();
    if (kind === 'acTL' || (critical && !PNG_CRITICAL.has(kind))) invalid();
    if (PNG_KEPT.has(kind)) kept.push(bytes.subarray(offset, finish));
    offset = finish;
  }
  if (!header || !data || !end) invalid();
  return concat(kept);
}

/** Removes metadata; throws Error('invalid_image') on malformed or unsupported input. */
export function stripImageMetadata(bytes: Uint8Array, mime: ImageMime): Uint8Array {
  return mime === 'image/png' ? stripPng(bytes) : stripJpeg(bytes);
}

export function toLLMImage(bytes: Uint8Array, mime: ImageMime): LLMImage {
  return { mimeType: mime, data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') };
}

const edge = (size: TelegramPhotoSize) => Math.max(size.width, size.height);
const validSize = (size: TelegramPhotoSize | null | undefined): size is TelegramPhotoSize =>
  !!size && typeof size.file_id === 'string' && size.file_id.length > 0
  && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;

/**
 * The smallest size whose longest edge is at least `minEdge` (ties: smaller
 * file_size, then array order); else the largest available; null when none is valid.
 */
export function pickPhotoSize(sizes: readonly TelegramPhotoSize[], minEdge = TRIAGE_MIN_EDGE): TelegramPhotoSize | null {
  const valid = (Array.isArray(sizes) ? sizes : []).filter(validSize);
  let best: TelegramPhotoSize | null = null;
  for (const size of valid) {
    if (edge(size) < minEdge) continue;
    if (!best || edge(size) < edge(best)
      || (edge(size) === edge(best) && (size.file_size ?? Infinity) < (best.file_size ?? Infinity))) best = size;
  }
  if (best) return best;
  let largest: TelegramPhotoSize | null = null;
  for (const size of valid) if (!largest || edge(size) > edge(largest)) largest = size;
  return largest;
}

/** Reply resolution: text-heavy or unknown images get 1024 px, others 640 px. */
export function replyPhotoSize(sizes: readonly TelegramPhotoSize[], triage: ImageTriage | null): TelegramPhotoSize | null {
  const textHeavy = !triage || triage.task === 'extract_text'
    || triage.kind === 'document' || triage.kind === 'receipt' || triage.kind === 'screenshot' || triage.kind === 'chart';
  return pickPhotoSize(sizes, textHeavy ? REPLY_MIN_EDGE_TEXT : REPLY_MIN_EDGE_DEFAULT);
}
