/**
 * F196: stripImageMetadata keeps only the first APP0 JFIF header, without its embedded thumbnail, and drops
 * JFXX (thumbnail extension) and every other APP0 segment. APP14 (Adobe colour transform) is kept.
 */
import { describe, expect, it } from 'vitest';
import { sniffImageMime, stripImageMetadata } from '../images/bytes';
import { containsBytes, tinyJpeg } from './images-fixtures';

const THUMB_CANARY = 'JFIFTHUMBCANARY-uncropped-original';
const JFXX_CANARY = 'JFXXCANARY-thumbnail-extension';
const SECOND_CANARY = 'SECONDJFIFCANARY';

const ascii = (text: string) => Array.from(Buffer.from(text, 'latin1'));
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];

function app0(body: number[]): number[] {
  return [0xff, 0xe0, ...u16(body.length + 2), ...body];
}

/** JFIF APP0 with an RGB thumbnail of width x 1 whose bytes hold `canary`. */
function jfifWithThumbnail(canary: string): number[] {
  const width = Math.ceil(canary.length / 3);
  const thumbnail = [...ascii(canary), ...new Array(width * 3 - canary.length).fill(0x20)];
  return app0([...ascii('JFIF'), 0, 1, 2, 1, 0, 72, 0, 72, width, 1, ...thumbnail]);
}

function jpegWith(segments: number[][], opts: { app14?: boolean } = {}): Uint8Array {
  const base = Array.from(tinyJpeg(64, 48, { app14: opts.app14 }));
  // tinyJpeg: SOI, then its own plain APP0 JFIF (18 bytes); replace that APP0 with the test segments.
  expect(base.slice(2, 4)).toEqual([0xff, 0xe0]);
  const ownApp0Length = base[4] * 256 + base[5];
  return Uint8Array.from([...base.slice(0, 2), ...segments.flat(), ...base.slice(4 + ownApp0Length)]);
}

/** Every APP0 segment in a JPEG, up to the first SOS. */
function app0Segments(bytes: Uint8Array): Uint8Array[] {
  const found: Uint8Array[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset + 1] !== 0xda) {
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (bytes[offset + 1] === 0xe0) found.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return found;
}

describe('F196: APP0 thumbnails never leave the process', () => {
  it('drops the JFIF thumbnail and the JFXX segment; the output is a valid JPEG without either canary', () => {
    const input = jpegWith([
      jfifWithThumbnail(THUMB_CANARY),
      app0([...ascii('JFXX'), 0, 0x13, ...ascii(JFXX_CANARY)]),
      jfifWithThumbnail(SECOND_CANARY),
    ]);
    // Positive control: the canaries are in the input.
    for (const canary of [THUMB_CANARY, JFXX_CANARY, SECOND_CANARY]) expect(containsBytes(input, canary)).toBe(true);

    const output = stripImageMetadata(input, 'image/jpeg');
    for (const canary of [THUMB_CANARY, JFXX_CANARY, SECOND_CANARY]) expect(containsBytes(output, canary), canary).toBe(false);
    expect(sniffImageMime(output)).toBe('image/jpeg');

    const segments = app0Segments(output);
    expect(segments).toHaveLength(1);
    // FF E0, length 16, 'JFIF\0', version 1.2, units 1, densities 72/72, thumbnail 0 x 0.
    expect(Array.from(segments[0])).toEqual([0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 2, 1, 0, 72, 0, 72, 0, 0]);
    // The rest of the image is unchanged and still ends at EOI.
    expect(Array.from(output.subarray(-2))).toEqual([0xff, 0xd9]);
    expect(stripImageMetadata(output, 'image/jpeg')).toEqual(output);
  });

  it('drops a lone JFXX or a non-JFIF APP0 and keeps APP14 (Adobe colour transform)', () => {
    const input = jpegWith([app0([...ascii('JFXX'), 0, 0x10, ...ascii(JFXX_CANARY)]), app0([...ascii('AVI1'), 0, ...ascii(SECOND_CANARY)])], { app14: true });
    const output = stripImageMetadata(input, 'image/jpeg');
    expect(app0Segments(output)).toHaveLength(0);
    expect(containsBytes(output, JFXX_CANARY)).toBe(false);
    expect(containsBytes(output, SECOND_CANARY)).toBe(false);
    expect(containsBytes(output, 'Adobe')).toBe(true);
  });

  it('drops a truncated JFIF header that cannot hold the thumbnail fields', () => {
    const input = jpegWith([app0([...ascii('JFIF'), 0, 1])]);
    expect(app0Segments(stripImageMetadata(input, 'image/jpeg'))).toHaveLength(0);
  });
});
