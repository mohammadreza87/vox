import { describe, expect, it } from 'vitest';
import { sniffImageMime, stripImageMetadata, toLLMImage } from '../images';
import { COMMENT_CANARY, EXIF_CANARY, jpegBytes, PNG_SIGNATURE, PNG_TEXT_CANARY, pngBytes, pngChunk } from './images-fixtures';

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const indexOf = (haystack: Uint8Array, needle: number[]): number => Buffer.from(haystack).indexOf(Buffer.from(needle));

describe('sniffImageMime', () => {
  it('recognises JPEG and PNG by signature', () => {
    expect(sniffImageMime(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageMime(pngBytes())).toBe('image/png');
  });

  it('rejects GIF, WebP and text', () => {
    expect(sniffImageMime(new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')))).toBeNull();
    expect(sniffImageMime(new Uint8Array(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')))).toBeNull();
    expect(sniffImageMime(new Uint8Array(Buffer.from('hello world')))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe('stripImageMetadata (JPEG)', () => {
  it('drops APP1 Exif and COM segments and keeps SOI, SOF0, SOS and EOI', () => {
    const original = jpegBytes({ withExif: true, withComment: true, canary: 'PIXELS' });
    expect(latin1(original)).toContain(EXIF_CANARY);
    expect(latin1(original)).toContain(COMMENT_CANARY);
    const stripped = stripImageMetadata(original, 'image/jpeg')!;
    expect(stripped).not.toBeNull();
    expect(latin1(stripped)).not.toContain(EXIF_CANARY);
    expect(latin1(stripped)).not.toContain(COMMENT_CANARY);
    expect(indexOf(stripped, [0xff, 0xe1])).toBe(-1);
    expect(indexOf(stripped, [0xff, 0xfe])).toBe(-1);
    expect([...stripped.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
    // SOF0 and the scan (SOS to EOI) are copied unchanged.
    const sof = indexOf(original, [0xff, 0xc0]);
    const sofLength = (original[sof + 2] << 8) | original[sof + 3];
    const sofBytes = [...original.subarray(sof, sof + 2 + sofLength)];
    expect(indexOf(stripped, sofBytes)).toBeGreaterThan(0);
    const sos = indexOf(original, [0xff, 0xda]);
    expect([...stripped.subarray(indexOf(stripped, [0xff, 0xda]))]).toEqual([...original.subarray(sos)]);
    expect(latin1(stripped)).toContain('PIXELS');
  });

  it('is the identity on a JPEG without metadata', () => {
    const plain = jpegBytes();
    expect([...stripImageMetadata(plain, 'image/jpeg')!]).toEqual([...plain]);
  });

  it('rejects truncated files, bad lengths, a missing SOS and a missing EOI', () => {
    const valid = jpegBytes({ withExif: true });
    expect(stripImageMetadata(valid.subarray(0, 10), 'image/jpeg')).toBeNull();
    const badLength = valid.slice();
    const app0 = indexOf(badLength, [0xff, 0xe0]);
    badLength[app0 + 2] = 0xff; badLength[app0 + 3] = 0xff;
    expect(stripImageMetadata(badLength, 'image/jpeg')).toBeNull();
    const noEoi = valid.subarray(0, valid.length - 2);
    expect(stripImageMetadata(noEoi, 'image/jpeg')).toBeNull();
    const noSos = valid.subarray(0, indexOf(valid, [0xff, 0xda]));
    expect(stripImageMetadata(new Uint8Array([...noSos, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01]), 'image/jpeg')).toBeNull();
  });
});

describe('stripImageMetadata (PNG)', () => {
  it('drops tEXt and eXIf and keeps IHDR, IDAT and IEND', () => {
    const original = pngBytes({ withText: true });
    const stripped = stripImageMetadata(original, 'image/png')!;
    expect(stripped).not.toBeNull();
    const text = latin1(stripped);
    expect(text).not.toContain(PNG_TEXT_CANARY);
    expect(text).not.toContain(EXIF_CANARY);
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('eXIf');
    for (const kept of ['IHDR', 'IDAT', 'IEND', 'pHYs']) expect(text).toContain(kept);
    expect([...stripped.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect([...stripImageMetadata(pngBytes(), 'image/png')!]).toEqual([...pngBytes()]);
  });

  it('rejects IHDR not first, trailing bytes, unknown critical chunks and a missing IEND', () => {
    const ihdr = pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const idat = pngChunk('IDAT', [1, 2, 3]);
    const iend = pngChunk('IEND', []);
    expect(stripImageMetadata(new Uint8Array([...PNG_SIGNATURE, ...idat, ...ihdr, ...iend]), 'image/png')).toBeNull();
    expect(stripImageMetadata(new Uint8Array([...pngBytes(), 0x00]), 'image/png')).toBeNull();
    expect(stripImageMetadata(new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...pngChunk('ZZZZ', [1]), ...idat, ...iend]), 'image/png')).toBeNull();
    expect(stripImageMetadata(new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...idat]), 'image/png')).toBeNull();
    expect(stripImageMetadata(pngBytes().subarray(0, 20), 'image/png')).toBeNull();
  });
});

describe('toLLMImage', () => {
  it('returns null when the declared type disagrees with the bytes', () => {
    expect(toLLMImage(jpegBytes(), 'image/png')).toBeNull();
    expect(toLLMImage(pngBytes(), 'image/jpeg')).toBeNull();
  });

  it('returns null for unsupported or malformed bytes', () => {
    expect(toLLMImage(new Uint8Array(Buffer.from('GIF89a')))).toBeNull();
    expect(toLLMImage(jpegBytes().subarray(0, 30))).toBeNull();
  });

  it('base64-encodes the stripped bytes', () => {
    const original = jpegBytes({ withExif: true });
    const image = toLLMImage(original, 'image/jpeg')!;
    expect(image.mimeType).toBe('image/jpeg');
    expect(image.data).toBe(Buffer.from(stripImageMetadata(original, 'image/jpeg')!).toString('base64'));
    expect(Buffer.from(image.data, 'base64').toString('latin1')).not.toContain(EXIF_CANARY);
    expect(toLLMImage(pngBytes({ withText: true }))?.mimeType).toBe('image/png');
  });
});
