/**
 * Net-speech estimate for Opus audio (S11L). Pure functions, no dependencies
 * beyond the shared minimum.
 *
 * This is a coarse packet-size VAD heuristic, not a real voice-activity
 * detector: Opus encoders spend very few bytes on silence (and DTX frames), so
 * packets below SPEECH_MIN_BYTES_PER_20MS per 20 ms are counted as non-speech.
 * It must be calibrated together with the FAR/FRR study before any
 * non-shadow use. Only Ogg Opus and WebM (Matroska) Opus are understood;
 * anything else, including audio/mp4 and malformed input, returns null.
 */
export { MIN_NET_SPEECH_MS } from '@/lib/tireh/identity/voice-band';

export interface NetSpeechEstimate { netMs: number; grossMs: number }
export interface NetSpeechEstimator { estimate(audio: Uint8Array, mimeType: string): NetSpeechEstimate | null }

/** Enrollment needs at least 10 s of net speech in a sample of at most 30 s. */
export const MIN_ENROLL_NET_SPEECH_MS = 10_000;
export const MAX_ENROLL_GROSS_MS = 30_000;
/** Opus packets carrying fewer bytes than this per 20 ms are treated as silence. */
export const SPEECH_MIN_BYTES_PER_20MS = 10;

const SILK_MS = [10, 20, 40, 60];
const HYBRID_MS = [10, 20];
const CELT_MS = [2.5, 5, 10, 20];

/** Duration of one Opus packet from its TOC byte (RFC 6716 section 3.1); null when malformed. */
function packetMs(packet: Uint8Array): number | null {
  if (packet.byteLength < 1) return 0; // an empty (lost or DTX) packet carries no duration
  const toc = packet[0];
  const config = toc >> 3;
  const frameMs = config < 12 ? SILK_MS[config % 4] : config < 16 ? HYBRID_MS[config % 2] : CELT_MS[config % 4];
  const code = toc & 3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else {
    if (packet.byteLength < 2) return null;
    frames = packet[1] & 0x3f;
  }
  return frameMs * frames;
}

function accumulate(packets: readonly Uint8Array[]): NetSpeechEstimate | null {
  let gross = 0, net = 0, audio = 0;
  for (const packet of packets) {
    const ms = packetMs(packet);
    if (ms === null) return null;
    if (ms <= 0) continue;
    audio++;
    gross += ms;
    if ((packet.byteLength * 20) / ms >= SPEECH_MIN_BYTES_PER_20MS) net += ms;
  }
  if (!audio) return null;
  return { netMs: Math.round(net), grossMs: Math.round(gross) };
}

const startsWith = (bytes: Uint8Array, text: string): boolean => {
  if (bytes.byteLength < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
};

/** Splits an Ogg bitstream into packets using the segment-table lacing. Null when malformed or truncated. */
function oggPackets(audio: Uint8Array): Uint8Array[] | null {
  const packets: Uint8Array[] = [];
  let partial: number[] | null = null;
  let offset = 0, serial: number | null = null;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  while (offset < audio.byteLength) {
    if (audio.byteLength - offset < 27 || !startsWith(audio.subarray(offset), 'OggS')) return null;
    const pageSerial = view.getUint32(offset + 14, true);
    const segments = audio[offset + 26];
    const tableStart = offset + 27;
    if (tableStart + segments > audio.byteLength) return null;
    let dataOffset = tableStart + segments;
    for (let i = 0; i < segments; i++) {
      const lace = audio[tableStart + i];
      if (dataOffset + lace > audio.byteLength) return null;
      if (serial === null) serial = pageSerial;
      if (pageSerial === serial) {
        partial ??= [];
        for (let b = 0; b < lace; b++) partial.push(audio[dataOffset + b]);
        if (lace < 255) { packets.push(Uint8Array.from(partial)); partial = null; }
      }
      dataOffset += lace;
    }
    offset = dataOffset;
  }
  if (partial) return null;
  return packets;
}

function estimateOgg(audio: Uint8Array): NetSpeechEstimate | null {
  const packets = oggPackets(audio);
  if (!packets || !packets.length || !startsWith(packets[0], 'OpusHead')) return null;
  return accumulate(packets.filter(p => !startsWith(p, 'OpusHead') && !startsWith(p, 'OpusTags')));
}

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, BLOCK_GROUP = 0xa0, SIMPLE_BLOCK = 0xa3, BLOCK = 0xa1;
const CONTAINERS = new Set([SEGMENT, CLUSTER, BLOCK_GROUP]);

/** EBML variable-length integer at `offset`. `marker` keeps the length marker (element ids). */
function vint(bytes: Uint8Array, offset: number, maxLength: number, marker: boolean): { value: number; length: number; unknown: boolean } | null {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset];
  let length = 1;
  while (length <= maxLength && !(first & (0x80 >> (length - 1)))) length++;
  if (length > maxLength || offset + length > bytes.byteLength) return null;
  let value = marker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i];
    if (bytes[offset + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !marker && allOnes };
}

function estimateWebm(audio: Uint8Array): NetSpeechEstimate | null {
  const packets: Uint8Array[] = [];
  let malformed = false;
  const walk = (start: number, end: number, depth: number): void => {
    let offset = start;
    while (offset < end && !malformed) {
      const id = vint(audio, offset, 4, true);
      const size = id && vint(audio, offset + id.length, 8, false);
      if (!id || !size || depth > 8) { malformed = true; return; }
      const dataStart = offset + id.length + size.length;
      const dataEnd = size.unknown ? end : dataStart + size.value;
      if (dataEnd > end || dataStart > end) { malformed = true; return; }
      if (CONTAINERS.has(id.value)) walk(dataStart, dataEnd, depth + 1);
      else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
        const track = vint(audio, dataStart, 8, false);
        const header = track ? dataStart + track.length + 3 : dataEnd + 1;
        if (!track || header > dataEnd) { malformed = true; return; }
        const flags = audio[header - 1];
        if ((flags >> 1) & 3) { malformed = true; return; } // laced blocks are not supported
        packets.push(audio.subarray(header, dataEnd));
      }
      offset = dataEnd;
    }
  };
  const header = vint(audio, 0, 4, true);
  if (!header || header.value !== EBML) return null;
  walk(0, audio.byteLength, 0);
  if (malformed) return null;
  return accumulate(packets);
}

export const opusNetSpeech: NetSpeechEstimator = {
  estimate(audio: Uint8Array, mimeType: string): NetSpeechEstimate | null {
    try {
      const mime = (mimeType || '').trim().toLowerCase();
      if (mime.startsWith('audio/ogg') || mime.startsWith('audio/opus') || mime.startsWith('application/ogg')) return estimateOgg(audio);
      if (mime.startsWith('audio/webm')) return estimateWebm(audio);
      return null;
    } catch {
      return null;
    }
  },
};
