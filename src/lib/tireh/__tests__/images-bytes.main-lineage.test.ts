// Main's earlier S12 lineage (d99e3a5) cases that pass against the chosen wave A image module; the rest are recorded in WAVE_A_MAIN_INTEGRATION.md (S12).
import { describe, expect, it } from 'vitest';
import { sniffImageMime, stripImageMetadata, toLLMImage } from '../images';
import { COMMENT_CANARY, EXIF_CANARY, jpegBytes, PNG_SIGNATURE, PNG_TEXT_CANARY, pngBytes, pngChunk } from './images-main-lineage-fixtures';

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

});
