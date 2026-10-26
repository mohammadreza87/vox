/**
 * The hands-free detector's state machine (design §8A.2), pure so it is unit-tested: it eats one level per 20 ms
 * frame (dBFS of the frame's RMS, from the AudioWorklet in handsFree.ts) and answers what happened. An adaptive
 * noise floor (falls fast, rises slowly, never while speech is on); speech starts after VAD.startMs above the floor
 * plus a margin; it ends after VAD.endMs of silence; an utterance under VAD.minMs is dropped; one over VAD.maxMs is
 * cut. While the pet is talking the margin rises and the start needs longer, so its own voice does not barge in.
 */

export const VAD = {
  frameMs: 20,
  /** above the threshold this long: speech (a `candidate` fires on the first frame, so the recorder starts early) */
  startMs: 120,
  /** below the threshold this long: end of speech (the brief's ~600 ms; the design names ~800 ms for Persian pauses) */
  endMs: 600,
  minMs: 400,
  maxMs: 30_000,
  /** no speech this long: hands-free turns itself off */
  idleMs: 60_000,
  /** dB over the noise floor that counts as voice */
  marginDb: 10,
  /** while the pet speaks: this much more, held this long (barge-in) */
  playbackDb: 6,
  playbackStartMs: 200,
  floorStart: -55,
  floorMin: -85,
  floorMax: -30,
  /** per frame: how fast the floor follows a quieter room (down) and a louder one (up) */
  floorDown: 0.3,
  floorUp: 0.015,
} as const;

export type VadEvent =
  /** first loud frame: start recording now (a pre-roll without holding audio) */
  | 'candidate'
  /** it was voice: keep the recording; while the pet speaks this is a barge-in */
  | 'start'
  /** the candidate was a blip: drop the recording */
  | 'cancel'
  /** end of an utterance long enough to send */
  | 'end'
  /** ended, but shorter than VAD.minMs: drop it */
  | 'tooShort'
  /** no speech for VAD.idleMs */
  | 'idle';

export type VadState = 'quiet' | 'rising' | 'speech';

export interface Vad {
  readonly state: VadState;
  readonly floor: number;
  frame(db: number, t: number, playing?: boolean): VadEvent[];
  /** restart the idle clock (the pet was thinking or speaking: that is not the person's silence) */
  hold(t: number): void;
  reset(t: number): void;
}

export function createVad(t0: number, o: Partial<Record<keyof typeof VAD, number>> = {}): Vad {
  const c = { ...VAD, ...o };
  let state: VadState = 'quiet';
  let floor: number = c.floorStart;
  let since = t0;
  let lastLoud = t0;
  let lastSpeech = t0;
  let idled = false;
  return {
    get state() { return state; },
    get floor() { return floor; },
    hold(t) { lastSpeech = Math.max(lastSpeech, t); idled = false; },
    reset(t) { state = 'quiet'; since = t; lastLoud = t; lastSpeech = t; idled = false; },
    frame(db, t, playing = false) {
      const out: VadEvent[] = [];
      const level = Number.isFinite(db) ? db : -120;
      const loud = level > floor + c.marginDb + (playing ? c.playbackDb : 0);
      if (state === 'quiet') {
        // the floor learns the room only between utterances
        floor += (level - floor) * (level < floor ? c.floorDown : c.floorUp);
        floor = Math.min(c.floorMax, Math.max(c.floorMin, floor));
        if (loud) { state = 'rising'; since = t; lastLoud = t; out.push('candidate'); }
        else if (!idled && t - lastSpeech >= c.idleMs) { idled = true; out.push('idle'); }
      } else if (state === 'rising') {
        if (!loud) { state = 'quiet'; out.push('cancel'); }
        else if (t - since + c.frameMs >= (playing ? c.playbackStartMs : c.startMs)) { state = 'speech'; lastLoud = t; lastSpeech = t; out.push('start'); }
      } else {
        if (loud) { lastLoud = t; lastSpeech = t; }
        const long = t - since >= c.maxMs;
        if (long || t - lastLoud >= c.endMs) {
          state = 'quiet';
          lastSpeech = t;
          out.push(long || lastLoud - since + c.frameMs >= c.minMs ? 'end' : 'tooShort');
        }
      }
      return out;
    },
  };
}
