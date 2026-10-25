import { describe, expect, it } from 'vitest';
import { minimizeImageDataUrl } from '../../adaptive/prediction/image';
import { crc32, sniffImageMime, stripImageMetadata, toLLMImage } from '../images';
import { containsBytes, IMAGE_CANARIES, tinyJpeg, tinyPng } from './images-fixtures';

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

function hasMarker(bytes: Uint8Array, marker: number): boolean {
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === marker) return true;
  return false;
}

function pngChunks(bytes: Uint8Array): Array<{ kind: string; crcOk: boolean }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Array<{ kind: string; crcOk: boolean }> = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const finish = offset + 12 + length;
    chunks.push({ kind: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), crcOk: crc32(bytes.subarray(offset + 4, finish - 4)) === view.getUint32(finish - 4) });
    offset = finish;
  }
  return chunks;
}

describe('sniffImageMime', () => {
  it('recognises JPEG and PNG', () => {
    expect(sniffImageMime(tinyJpeg(10, 10))).toBe('image/jpeg');
    expect(sniffImageMime(tinyPng(10, 10))).toBe('image/png');
  });

  it('rejects GIF, WebP and garbage', () => {
    expect(sniffImageMime(Uint8Array.from(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')))).toBeNull();
    expect(sniffImageMime(Uint8Array.from(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')))).toBeNull();
    expect(sniffImageMime(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  it('removes EXIF/GPS and comments from a JPEG and keeps the image structure', () => {
    const original = tinyJpeg(320, 240, { exifCanary: IMAGE_CANARIES.exif, comment: `note ${IMAGE_CANARIES.exif}` });
    expect(containsBytes(original, IMAGE_CANARIES.exif)).toBe(true);
    const stripped = stripImageMetadata(original, 'image/jpeg');
    expect(containsBytes(stripped, IMAGE_CANARIES.exif)).toBe(false);
    expect([stripped[0], stripped[1]]).toEqual([0xff, 0xd8]);
    expect(hasMarker(stripped, 0xe0)).toBe(true);
    expect(hasMarker(stripped, 0xe1)).toBe(false);
    expect(hasMarker(stripped, 0xfe)).toBe(false);
    expect(hasMarker(stripped, 0xc0)).toBe(true);
    expect(hasMarker(stripped, 0xda)).toBe(true);
    expect([stripped.at(-2), stripped.at(-1)]).toEqual([0xff, 0xd9]);
    expect(() => minimizeImageDataUrl(dataUrl(stripped, 'image/jpeg'))).not.toThrow();
  });

  it('keeps APP14 (Adobe colour transform)', () => {
    const stripped = stripImageMetadata(tinyJpeg(32, 32, { app14: true, exifCanary: IMAGE_CANARIES.exif }), 'image/jpeg');
    expect(hasMarker(stripped, 0xee)).toBe(true);
    expect(containsBytes(stripped, IMAGE_CANARIES.exif)).toBe(false);
  });

  it('removes PNG text chunks and keeps valid CRCs', () => {
    const original = tinyPng(64, 48, { textCanary: IMAGE_CANARIES.exif });
    expect(containsBytes(original, IMAGE_CANARIES.exif)).toBe(true);
    const stripped = stripImageMetadata(original, 'image/png');
    expect(containsBytes(stripped, IMAGE_CANARIES.exif)).toBe(false);
    const chunks = pngChunks(stripped);
    expect(chunks.map((c) => c.kind)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(() => minimizeImageDataUrl(dataUrl(stripped, 'image/png'))).not.toThrow();
  });

  it('throws invalid_image on truncated or malformed input', () => {
    const jpeg = tinyJpeg(32, 32, { exifCanary: 'x' });
    expect(() => stripImageMetadata(jpeg.subarray(0, jpeg.length - 3), 'image/jpeg')).toThrow('invalid_image');
    expect(() => stripImageMetadata(jpeg.subarray(0, 20), 'image/jpeg')).toThrow('invalid_image');
    expect(() => stripImageMetadata(Uint8Array.from([1, 2, 3, 4]), 'image/jpeg')).toThrow('invalid_image');
    const png = tinyPng(16, 16);
    expect(() => stripImageMetadata(png.subarray(0, png.length - 6), 'image/png')).toThrow('invalid_image');
    const badCrc = png.slice(); badCrc[29] ^= 0xff;
    expect(() => stripImageMetadata(badCrc, 'image/png')).toThrow('invalid_image');
    expect(() => stripImageMetadata(tinyJpeg(8, 8), 'image/png')).toThrow('invalid_image');
  });

  it('rejects animated PNG', () => {
    const png = tinyPng(16, 16);
    const actl = Uint8Array.from([...Buffer.from('acTL', 'latin1'), 0, 0, 0, 1, 0, 0, 0, 0]);
    const chunk = Uint8Array.from([0, 0, 0, 8, ...actl, ...Buffer.alloc(4)]);
    new DataView(chunk.buffer).setUint32(chunk.length - 4, crc32(actl));
    const animated = Uint8Array.from([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]);
    expect(() => stripImageMetadata(animated, 'image/png')).toThrow('invalid_image');
  });
});

describe('toLLMImage', () => {
  it('encodes base64 with the given mime type', () => {
    const bytes = tinyJpeg(4, 4);
    expect(toLLMImage(bytes, 'image/jpeg')).toEqual({ mimeType: 'image/jpeg', data: Buffer.from(bytes).toString('base64') });
  });
});
