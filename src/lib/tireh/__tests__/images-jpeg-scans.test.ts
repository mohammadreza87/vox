/** S12 metadata stripping across the scans of a progressive JPEG (fixer r1 on main). Pure bytes; no I/O. */
import { describe, expect, it } from 'vitest';
import { stripImageMetadata } from '../images/bytes';

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const text = (value: string) => [...value].map((c) => c.charCodeAt(0));
const sos = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
const dht = segment(0xc4, [0x00, 0x01, 0x02]);

describe('stripImageMetadata, JPEG with several scans', () => {
  it('drops a COM and an APP13 between scans and keeps the tables, every scan and the entropy data', () => {
    const scan1 = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]; // a stuffed 0xFF and a restart marker stay
    const scan2 = [0x78, 0x9a];
    const bytes = Uint8Array.from([0xff, 0xd8, ...sos, ...scan1, ...segment(0xfe, text('COMCANARY')), ...dht,
      ...segment(0xed, text('Photoshop IPTCCANARY')), ...sos, ...scan2, 0xff, 0xd9]);
    const out = stripImageMetadata(bytes, 'image/jpeg');
    expect(latin1(out)).not.toContain('CANARY');
    expect([...out]).toEqual([0xff, 0xd8, ...sos, ...scan1, ...dht, ...sos, ...scan2, 0xff, 0xd9]);
  });

  it('drops fill bytes before a marker between scans and anything after EOI', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, ...sos, 0x11, 0xff, 0xff, ...segment(0xe1, text('Exif\0\0GPSCANARY')), ...sos, 0x22, 0xff, 0xd9,
      ...text('TRAILCANARY'), 0xff, 0xd9]);
    const out = stripImageMetadata(bytes, 'image/jpeg');
    expect(latin1(out)).not.toContain('CANARY');
    expect([...out]).toEqual([0xff, 0xd8, ...sos, 0x11, ...sos, 0x22, 0xff, 0xd9]);
  });

  it('a single-scan baseline JPEG is unchanged apart from its metadata', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, ...segment(0xe1, text('Exif\0\0CANARY')), ...dht, ...sos, 0x01, 0x02, 0xff, 0xd9]);
    expect([...stripImageMetadata(bytes, 'image/jpeg')]).toEqual([0xff, 0xd8, ...dht, ...sos, 0x01, 0x02, 0xff, 0xd9]);
  });

  it('a malformed segment between scans is invalid', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, ...sos, 0x11, 0xff, 0xc4, 0x00, 0x40, 0x01, 0xff, 0xd9]);
    expect(() => stripImageMetadata(bytes, 'image/jpeg')).toThrow('invalid_image');
  });
});
