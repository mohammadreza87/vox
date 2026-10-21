/**
 * Lip-sync (brief §2.5): four visemes (X rest, B teeth/EE, D wide AA, F pucker OO, plus E round) on their own
 * layer while the idle runs underneath. Text path: synthetic visemes at the bubble's reveal rate (~28 chars/s).
 * Audio path: AnalyserNode RMS → openness with a −50 dB gate, X after 120 ms of silence; round vs wide from the
 * 2–4 kHz vs 300–900 Hz band ratio, each shape held ≥ 70 ms. Both run one envelope: attack 35 ms, release 110 ms.
 */

import { visemeOf, VISEME_SHAPE } from './face';

export const ENVELOPE = { attack: 35, release: 110 } as const;
/** After the last character (or stopSpeaking) the mouth closes on this time constant: rest within 110 ms. */
export const CLOSE_TAU = 25;
export const AUDIO = { gateDb: -50, rangeDb: 32, knee: 0.8, silenceMs: 120, holdMs: 70, lo: [300, 900], hi: [2000, 4000] } as const;

/** Openness from an RMS level (§2.5): clamp((20·log10(rms) + 50) / 32, 0, 1)^0.8, gated below −50 dB. */
export function openFromRms(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  if (db < AUDIO.gateDb) return 0;
  return Math.pow(Math.min(1, Math.max(0, (db - AUDIO.gateDb) / AUDIO.rangeDb)), AUDIO.knee);
}

/** One envelope step toward target over dt ms (attack when opening, release when closing). */
export const envStep = (env: number, target: number, dtMs: number, closing = false) =>
  env + (target - env) * (1 - Math.exp(-dtMs / (closing ? CLOSE_TAU : target > env ? ENVELOPE.attack : ENVELOPE.release)));

export interface MouthSample { open: number; width: number; done: boolean; /** a sentence starts on this frame */ sentence: boolean }

/** Synthetic visemes from text at `cps` chars/s, revealed in step with the bubble. */
export class TextLipSync {
  private env = 0;
  private width = 0;
  private start = 0;
  private lastIdx = -1;
  private closedAt = Infinity;
  constructor(private text: string, private cps = 28, now = 0) { this.start = now; }

  /** Total reveal time (ms). */
  get duration() { return (this.text.length / this.cps) * 1000; }

  sample(now: number, dtMs: number): MouthSample {
    const i = Math.floor(((now - this.start) / 1000) * this.cps);
    const ended = i >= this.text.length;
    let sentence = false;
    if (i !== this.lastIdx && !ended) {
      // a sentence starts at the first letter after . ! ? (or the very first letter)
      const prev = this.text.slice(Math.max(0, this.lastIdx), i);
      if ((this.lastIdx < 0 && i >= 0) || /[.!?…]\s*$/.test(prev)) sentence = /\p{L}/u.test(this.text[i] ?? '');
      this.lastIdx = i;
    }
    const v = ended ? VISEME_SHAPE.X : VISEME_SHAPE[visemeOf(this.text[i] ?? ' ')];
    this.env = envStep(this.env, v.open, dtMs, ended);
    this.width += (v.width - this.width) * (1 - Math.exp(-dtMs / 60));
    if (ended && this.closedAt === Infinity) this.closedAt = now;
    return { open: this.env, width: this.width, done: ended && this.env < 0.03, sentence };
  }
}

/** Minimal AnalyserNode surface (tests pass a fake). */
export interface AnalyserLike {
  fftSize: number;
  frequencyBinCount: number;
  context?: { sampleRate: number };
  getFloatTimeDomainData(a: Float32Array): void;
  getByteFrequencyData(a: Uint8Array): void;
}

/** Amplitude lip-sync from reply audio. */
export class AudioLipSync {
  private env = 0;
  private width = 0;
  private widthTarget = 0;
  private widthAt = -Infinity;
  private silentSince = -Infinity;
  private closing = false;
  private time: Float32Array<ArrayBuffer>;
  private freq: Uint8Array<ArrayBuffer>;
  constructor(private an: AnalyserLike) {
    an.fftSize = 1024;
    this.time = new Float32Array(an.fftSize);
    this.freq = new Uint8Array(an.frequencyBinCount);
  }

  /** The reply ended: close the mouth on the fast constant. */
  stop(): void { this.closing = true; }

  sample(now: number, dtMs: number): MouthSample {
    let target = 0;
    if (!this.closing) {
      this.an.getFloatTimeDomainData(this.time);
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
      const open = openFromRms(Math.sqrt(sum / this.time.length));
      if (open > 0) this.silentSince = Infinity; else if (this.silentSince === Infinity) this.silentSince = now;
      // short gaps keep the shape (consonants); 120 ms of silence is a rest (X)
      target = open > 0 || now - this.silentSince < AUDIO.silenceMs ? open : 0;
      if (open > 0 && now - this.widthAt >= AUDIO.holdMs) {
        this.an.getByteFrequencyData(this.freq);
        const hz = (this.an.context?.sampleRate ?? 48000) / 2 / this.freq.length;
        const band = ([a, b]: readonly [number, number]) => {
          let s = 0, n = 0;
          for (let i = Math.floor(a / hz); i <= Math.min(this.freq.length - 1, Math.ceil(b / hz)); i++) { s += this.freq[i]; n++; }
          return n ? s / n : 0;
        };
        const lo = band(AUDIO.lo), hi = band(AUDIO.hi);
        // bright (EE) vs dark (OO): the high band's share of the two
        this.widthTarget = lo + hi > 1 ? Math.max(-1, Math.min(1, (hi / (lo + hi) - 0.3) * 4)) : 0;
        this.widthAt = now;
      }
    }
    this.env = envStep(this.env, target, dtMs, this.closing);
    this.width += (this.widthTarget - this.width) * (1 - Math.exp(-dtMs / 60));
    return { open: this.env, width: this.width, done: this.closing && this.env < 0.03, sentence: false };
  }
}
