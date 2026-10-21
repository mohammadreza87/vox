/**
 * Image byte helpers for S12: type sniffing and metadata stripping. Pure
 * functions with no I/O and no logging. Only baseline containers Vox can
 * reason about are accepted (JPEG, PNG); WebP, GIF and HEIC are rejected.
 *
 * Stripping removes EXIF/XMP/ICC/comments (JPEG APP1-APP15 and COM, PNG
 * ancillary chunks outside a small rendering allowlist), which is where GPS
 * positions, device ids and editing history live. Pixel data is copied as is.
 */

import type { LLMImage } from '../llm';

export type SupportedImageMime = 'image/jpeg' | 'image/png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Ancillary PNG chunks that only affect rendering and carry no free text. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'pHYs']);

export function sniffImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (!(bytes instanceof Uint8Array)) return null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return 'image/png';
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < n) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes (0xFF padding) may precede a marker.
    let m = i + 1;
    while (m < n && bytes[m] === 0xff) m++;
    if (m >= n) return null;
    const marker = bytes[m];
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return null; // stuffed byte, second SOI, or EOI before SOS
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(m - 1, m + 1));
      i = m + 1;
      continue;
    }
    if (marker === 0xda) {
      // Entropy-coded data follows: copy from SOS to the end unchanged.
      if (n < 2 || bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null;
      parts.push(bytes.subarray(m - 1));
      return concat(parts);
    }
    if (m + 2 >= n) return null;
    const length = (bytes[m + 1] << 8) | bytes[m + 2];
    const end = m + 1 + length;
    if (length < 2 || end > n) return null;
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(bytes.subarray(m - 1, end));
    i = end;
  }
  return null; // no SOS
}

function chunkType(bytes: Uint8Array, offset: number): string | null {
  let type = '';
  for (let k = 0; k < 4; k++) {
    const c = bytes[offset + k];
    const letter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (!letter) return null;
    type += String.fromCharCode(c);
  }
  return type;
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const n = bytes.length;
  if (sniffImageMime(bytes) !== 'image/png') return null;
  const parts: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
  let i: number = PNG_SIGNATURE.length;
  let first = true;
  while (i < n) {
    if (i + 12 > n) return null;
    const length = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
    const type = chunkType(bytes, i + 4);
    const end = i + 12 + length;
    if (type === null || length > 0x7fffffff || end > n) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    const critical = type.charCodeAt(0) < 0x61;
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(i, end));
    else if (critical) return null; // unknown critical chunk
    i = end;
    if (type === 'IEND') return i === n ? concat(parts) : null; // trailing bytes
  }
  return null; // no IEND
}

/** Metadata-free copy of the image, or null when the container is malformed. */
export function stripImageMetadata(bytes: Uint8Array, mime: SupportedImageMime): Uint8Array | null {
  if (!(bytes instanceof Uint8Array)) return null;
  return mime === 'image/jpeg' ? stripJpeg(bytes) : mime === 'image/png' ? stripPng(bytes) : null;
}

/** Sniffed, mime-checked, metadata-stripped and base64-encoded image, or null. */
export function toLLMImage(bytes: Uint8Array, declaredMime?: string): LLMImage | null {
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) return null;
  if (declaredMime !== undefined && declaredMime !== mimeType) return null;
  const stripped = stripImageMetadata(bytes, mimeType);
  if (!stripped) return null;
  return { mimeType, data: Buffer.from(stripped).toString('base64') };
}
