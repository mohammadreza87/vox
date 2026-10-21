import { describe, expect, it } from 'vitest';
import { MIN_NET_SPEECH_MS, opusNetSpeech, SPEECH_MIN_BYTES_PER_20MS } from '../identity/net-speech';

const SILK_20MS = 1 << 3; // config 1: SILK 20 ms, code 0 (one frame)
const packet = (length: number, toc = SILK_20MS, second?: number) => {
  const bytes = new Uint8Array(length).fill(0x55);
  bytes[0] = toc;
  if (second !== undefined) bytes[1] = second;
  return bytes;
};

function oggPage(packets: Uint8Array[], sequence: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let remaining = p.byteLength;
    while (remaining >= 255) { lacing.push(255); remaining -= 255; }
    lacing.push(remaining);
  }
  const header = new Uint8Array(27 + lacing.length);
  header.set([0x4f, 0x67, 0x67, 0x53]); // OggS
  new DataView(header.buffer).setUint32(14, 0x1234, true);
  new DataView(header.buffer).setUint32(18, sequence, true);
  header[26] = lacing.length;
  header.set(lacing, 27);
  const body = new Uint8Array(packets.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of packets) { body.set(p, offset); offset += p.byteLength; }
  return concat([header, body]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}
const ascii = (text: string, pad = 0) => concat([new TextEncoder().encode(text), new Uint8Array(pad)]);
function ogg(audio: Uint8Array[]): Uint8Array {
  const pages = [oggPage([ascii('OpusHead', 11)], 0), oggPage([ascii('OpusTags', 8)], 1)];
  for (let i = 0; i < audio.length; i += 50) pages.push(oggPage(audio.slice(i, i + 50), pages.length));
  return concat(pages);
}

const vsize = (n: number) => n < 127 ? new Uint8Array([0x80 | n]) : new Uint8Array([0x40 | (n >> 8), n & 0xff]);
const UNKNOWN = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const element = (id: number[], payload: Uint8Array, unknown = false) => concat([new Uint8Array(id), unknown ? UNKNOWN : vsize(payload.byteLength), payload]);
function webm(audio: Uint8Array[], flags = 0x80): Uint8Array {
  const blocks = audio.map((p, i) => element([0xa3], concat([new Uint8Array([0x81, 0, i & 0xff, flags]), p])));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], concat([element([0xe7], new Uint8Array([0])), ...blocks]), true);
  const segment = element([0x18, 0x53, 0x80, 0x67], cluster, true);
  return concat([element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], ascii('webm'))), segment]);
}

describe('opusNetSpeech', () => {
  it('counts 200 x 20 ms speech packets in Ogg Opus as 4 s net and gross', () => {
    const audio = Array.from({ length: 200 }, () => packet(40));
    expect(opusNetSpeech.estimate(ogg(audio), 'audio/ogg')).toEqual({ netMs: 4000, grossMs: 4000 });
    expect(opusNetSpeech.estimate(ogg(audio), 'audio/ogg; codecs=opus')).toEqual({ netMs: 4000, grossMs: 4000 });
    expect(MIN_NET_SPEECH_MS).toBe(3000);
    expect(SPEECH_MIN_BYTES_PER_20MS).toBe(10);
  });
  it('excludes small (silent) packets from net speech only', () => {
    const audio = [...Array.from({ length: 150 }, () => packet(40)), ...Array.from({ length: 100 }, () => packet(3))];
    expect(opusNetSpeech.estimate(ogg(audio), 'audio/ogg')).toEqual({ netMs: 3000, grossMs: 5000 });
  });
  it('counts TOC code 3 multi-frame packets', () => {
    const toc = (19 << 3) | 3; // CELT 20 ms, code 3
    const audio = [packet(100, toc, 3), packet(100, toc, 3), packet(5, toc, 3)];
    expect(opusNetSpeech.estimate(ogg(audio), 'audio/ogg')).toEqual({ netMs: 120, grossMs: 180 });
  });
  it('handles packets that span 255-byte lacing', () => {
    expect(opusNetSpeech.estimate(ogg([packet(600), packet(300)]), 'audio/ogg')).toEqual({ netMs: 40, grossMs: 40 });
  });
  it('estimates WebM with unknown-size Segment and Cluster and SimpleBlocks', () => {
    const audio = [...Array.from({ length: 150 }, () => packet(40)), ...Array.from({ length: 50 }, () => packet(2))];
    expect(opusNetSpeech.estimate(webm(audio), 'audio/webm;codecs=opus')).toEqual({ netMs: 3000, grossMs: 4000 });
  });
  it('returns null for audio/mp4, truncated pages, laced blocks and junk', () => {
    const good = ogg(Array.from({ length: 20 }, () => packet(40)));
    expect(opusNetSpeech.estimate(good, 'audio/mp4')).toBeNull();
    expect(opusNetSpeech.estimate(good.subarray(0, good.byteLength - 7), 'audio/ogg')).toBeNull();
    expect(opusNetSpeech.estimate(webm([packet(40), packet(40)], 0x80 | 0x02), 'audio/webm')).toBeNull();
    expect(opusNetSpeech.estimate(new TextEncoder().encode('SPEAKER:x|not audio'), 'audio/webm')).toBeNull();
    expect(opusNetSpeech.estimate(new TextEncoder().encode('SPEAKER:x|not audio'), 'audio/ogg')).toBeNull();
    expect(opusNetSpeech.estimate(new Uint8Array(0), 'audio/ogg')).toBeNull();
  });
});
