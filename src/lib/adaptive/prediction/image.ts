import { z } from 'zod';
/** A deliberately smaller contract than the provider: one <=512px raster,
 * <=64KiB, inline only. No remote fetch, file handles, EXIF or OCR persistence. */
export const MAX_IMAGE_BYTES = 65_536;
export const MAX_IMAGE_EDGE = 512;
export const MAX_IMAGE_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32;
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function minimizeImageDataUrl(value: string): string {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || value.length > MAX_IMAGE_URL_LENGTH) throw new Error('invalid_image');
  const binary = atob(match[2]);
  if (binary.length > MAX_IMAGE_BYTES || btoa(binary) !== match[2]) throw new Error('invalid_image');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const kept: Uint8Array[] = [];
  const validSize = (w: number, h: number) => w > 0 && h > 0 && w <= MAX_IMAGE_EDGE && h <= MAX_IMAGE_EDGE;
  if (match[1] === 'png') {
    if (bytes.length < 45 || bytes.slice(0, 8).join() !== '137,80,78,71,13,10,26,10') throw new Error('invalid_image');
    const view = new DataView(bytes.buffer); kept.push(bytes.slice(0, 8));
    let offset = 8, header = false, data = false, end = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), finish = offset + 12 + length;
      if (finish > bytes.length) throw new Error('invalid_image');
      const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (!/^[A-Za-z]{4}$/.test(kind) || crc32(bytes.slice(offset + 4, finish - 4)) !== view.getUint32(finish - 4)) throw new Error('invalid_image');
      if (kind === 'IHDR') {
        if (header || offset !== 8 || length !== 13 || !validSize(view.getUint32(offset + 8), view.getUint32(offset + 12))) throw new Error('invalid_image');
        if (bytes[offset + 16] !== 8 || ![0, 2, 3, 4, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) throw new Error('invalid_image');
        header = true;
      } else if (kind === 'IDAT') data = true;
      else if (kind === 'IEND') { if (length || finish !== bytes.length) throw new Error('invalid_image'); end = true; }
      // Reject animation and unknown critical chunks; strip all metadata chunks.
      else if (kind === 'acTL' || !['PLTE', 'tRNS'].includes(kind) && kind[0] === kind[0].toUpperCase()) throw new Error('invalid_image');
      if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind)) kept.push(bytes.slice(offset, finish));
      offset = finish;
    }
    if (!header || !data || !end || offset !== bytes.length) throw new Error('invalid_image');
  } else {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('invalid_image');
    kept.push(bytes.slice(0, 2)); let offset = 2, size = false, scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error('invalid_image');
      const marker = bytes[offset + 1], length = bytes[offset + 2] * 256 + bytes[offset + 3], finish = offset + 2 + length;
      if (length < 2 || finish > bytes.length) throw new Error('invalid_image');
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc0, 0xc4].includes(marker)) throw new Error('invalid_image');
      if (marker === 0xc0) {
        if (length < 8 || !validSize(bytes[offset + 7] * 256 + bytes[offset + 8], bytes[offset + 5] * 256 + bytes[offset + 6])) throw new Error('invalid_image');
        size = true;
      }
      if (marker === 0xda) {
        if (!size || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('invalid_image');
        // Canvas emits a single baseline scan. Reject other markers inside
        // entropy, so metadata cannot be smuggled after the scan header.
        for (let i = finish; i < bytes.length - 2; i++) {
          if (bytes[i] === 0xff) { const next = bytes[++i]; if (next !== 0 && !(next >= 0xd0 && next <= 0xd7)) throw new Error('invalid_image'); }
        }
        kept.push(bytes.slice(offset)); scan = true; break;
      }
      // Drop all APP and COM segments, including EXIF/XMP/ICC/location metadata.
      if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) kept.push(bytes.slice(offset, finish));
      offset = finish;
    }
    if (!scan) throw new Error('invalid_image');
  }
  let output = ''; for (const chunk of kept) for (const byte of chunk) output += String.fromCharCode(byte);
  return `data:image/${match[1]};base64,${btoa(output)}`;
}

export const sharedImageDataUrlSchema = z.string().max(MAX_IMAGE_URL_LENGTH).transform((value, ctx) => {
  try { return minimizeImageDataUrl(value); } catch { ctx.addIssue({ code: 'custom', message: 'invalid_image' }); return z.NEVER; }
});
export function sharedImageForModel(dataUrl: string): { mimeType: 'image/jpeg' | 'image/png'; data: string } {
  const safe = minimizeImageDataUrl(dataUrl), comma = safe.indexOf(',');
  return { mimeType: safe.startsWith('data:image/png;') ? 'image/png' : 'image/jpeg', data: safe.slice(comma + 1) };
}
