/**
 * Open issue 8: a progressive JPEG reaches image triage while STUDIO_IMAGES is on. The triage seam
 * (adaptive/prediction/image.ts) gets a multi-scan validator used only with the flag on; with it unset the
 * single-scan path, which rejects a progressive file, is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { minimizeImageDataUrl, sharedImageForModel } from '../../adaptive/prediction/image';
import { stripImageMetadata } from '../images/bytes';
import { progressiveJpeg64 } from './fixtures/progressive-jpeg';
import { tinyJpeg } from './images-fixtures';

const ascii = (text: string) => Array.from(Buffer.from(text, 'latin1'));
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const url = (bytes: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
const CANARY = 'BETWEENSCANSCANARY-GPS';

/** Marker offsets of a JPEG, header and between scans (entropy data skipped). */
function markers(bytes: Uint8Array): Array<{ marker: number; offset: number }> {
  const found: Array<{ marker: number; offset: number }> = [];
  let offset = 2;
  while (offset + 1 < bytes.length) {
    const marker = bytes[offset + 1];
    found.push({ marker, offset });
    if (marker === 0xd9) break;
    let end = offset + 2 + bytes[offset + 2] * 256 + bytes[offset + 3];
    if (marker === 0xda) {
      while (!(bytes[end] === 0xff && bytes[end + 1] !== 0x00 && !(bytes[end + 1] >= 0xd0 && bytes[end + 1] <= 0xd7))) end++;
    }
    offset = end;
  }
  return found;
}

/** The bytes with `segment` inserted right before the second SOS (between the first and second scans). */
function insertBetweenScans(bytes: Uint8Array, segment: number[]): Uint8Array {
  const second = markers(bytes).filter((m) => m.marker === 0xda)[1];
  return Uint8Array.from([...bytes.subarray(0, second.offset), ...segment, ...bytes.subarray(second.offset)]);
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('progressive JPEG triage (open issue 8)', () => {
  it('the fixture is a progressive (SOF2) multi-scan JPEG of 64x64 under 64 KiB', () => {
    const bytes = progressiveJpeg64();
    const list = markers(bytes).map((m) => m.marker);
    expect(list).toContain(0xc2);
    expect(list).not.toContain(0xc0);
    expect(list.filter((m) => m === 0xda).length).toBeGreaterThan(1);
    expect(bytes.byteLength).toBeLessThan(65_536);
  });

  it('passes sharedImageForModel after stripImageMetadata with STUDIO_IMAGES=1', () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const stripped = stripImageMetadata(progressiveJpeg64(), 'image/jpeg');
    const image = sharedImageForModel(url(stripped));
    expect(image.mimeType).toBe('image/jpeg');
    const out = Buffer.from(image.data, 'base64');
    expect(markers(out).map((m) => m.marker)).toEqual(markers(stripped).map((m) => m.marker));
    expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it('drops APPn and COM before the first scan with the flag on', () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const bytes = progressiveJpeg64();
    const exif = [0xff, 0xe1, ...u16(CANARY.length + 8), ...ascii('Exif'), 0, 0, ...ascii(CANARY)];
    const comment = [0xff, 0xfe, ...u16(CANARY.length + 2), ...ascii(CANARY)];
    const withHeaderMetadata = Uint8Array.from([...bytes.subarray(0, 2), ...exif, ...comment, ...bytes.subarray(2)]);
    const out = Buffer.from(sharedImageForModel(url(withHeaderMetadata)).data, 'base64');
    expect(out.includes(Buffer.from(CANARY, 'latin1'))).toBe(false);
  });

  it('throws invalid_image for the same file with the flag unset (base behaviour)', () => {
    vi.stubEnv('STUDIO_IMAGES', '');
    const stripped = stripImageMetadata(progressiveJpeg64(), 'image/jpeg');
    expect(() => sharedImageForModel(url(stripped))).toThrow('invalid_image');
    expect(() => minimizeImageDataUrl(url(stripped))).toThrow('invalid_image');
  });

  it('rejects an APPn or COM segment between scans (not stripped)', () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const bytes = progressiveJpeg64();
    const app1 = insertBetweenScans(bytes, [0xff, 0xe1, ...u16(CANARY.length + 8), ...ascii('Exif'), 0, 0, ...ascii(CANARY)]);
    const com = insertBetweenScans(bytes, [0xff, 0xfe, ...u16(CANARY.length + 2), ...ascii(CANARY)]);
    expect(() => sharedImageForModel(url(app1))).toThrow('invalid_image');
    expect(() => sharedImageForModel(url(com))).toThrow('invalid_image');
    // Positive control: the unmodified file passes.
    expect(() => sharedImageForModel(url(bytes))).not.toThrow();
  });

  it('rejects trailing bytes after EOI, a second frame and an oversize edge', () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const bytes = progressiveJpeg64();
    expect(() => sharedImageForModel(url(Uint8Array.from([...bytes, 0x00])))).toThrow('invalid_image');
    const sof = markers(bytes).find((m) => m.marker === 0xc2)!;
    const frameLength = bytes[sof.offset + 2] * 256 + bytes[sof.offset + 3];
    const frame = Array.from(bytes.subarray(sof.offset, sof.offset + 2 + frameLength));
    const twoFrames = Uint8Array.from([...bytes.subarray(0, sof.offset), ...frame, ...bytes.subarray(sof.offset)]);
    expect(() => sharedImageForModel(url(twoFrames))).toThrow('invalid_image');
    const wide = bytes.slice();
    wide[sof.offset + 7] = 0x02; wide[sof.offset + 8] = 0x01; // width 513
    expect(() => sharedImageForModel(url(wide))).toThrow('invalid_image');
  });

  it('a baseline JPEG takes the unchanged single-scan path whatever the flag', () => {
    const baseline = stripImageMetadata(tinyJpeg(64, 48, { exifCanary: CANARY }), 'image/jpeg');
    vi.stubEnv('STUDIO_IMAGES', '');
    const off = sharedImageForModel(url(baseline));
    vi.stubEnv('STUDIO_IMAGES', '1');
    expect(sharedImageForModel(url(baseline))).toEqual(off);
  });
});
