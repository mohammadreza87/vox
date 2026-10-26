/**
 * The one-shot player (brief §2.3 L4, decisions 7 and 14). Plays prepared beats on the shot channels: each beat
 * retargets its channels (velocity kept) and fires its side effects at `at`. A channel belongs to the reaction
 * that touched it last; when a reaction has played out, every channel it still owns releases to neutral on the
 * last beat's `release` spring. Priority (drag > eat > touch > talk > play > needs > idle): a new reaction
 * cancels lower classes and replaces one of its own kind; a lower class than one already playing is dropped.
 */

import { timelineEnd, type KC, type PreparedBeat } from './beats';
import { presetKC } from './spring';
import { PRIORITY_ORDER, type Channel, type PlayKind, type PriorityClass, type SpringPreset } from './types';

export interface Playing {
  id: number;
  kind: PlayKind;
  cls: PriorityClass;
  start: number;
  beats: PreparedBeat[];
  next: number;
  endAt: number;
  release: SpringPreset;
  onEnd?: () => void;
  onCancel?: () => void;
}

export interface PlayerHost {
  /** retarget one shot channel (velocity kept) */
  set(c: Channel, v: number, kc: KC): void;
  /** release one shot channel to neutral */
  release(c: Channel, kc: KC): void;
  /** a beat's side effects (haptic, particles, face, gaze, hop, osc, hit-stop, blink, cues) */
  effects(b: PreparedBeat, p: Playing, now: number): void;
  /** a reaction ended or was cancelled (the face and gaze overrides it set are dropped) */
  ended(p: Playing, cancelled: boolean): void;
}

const rank = (c: PriorityClass) => PRIORITY_ORDER.indexOf(c);

export class Player {
  readonly playing: Playing[] = [];
  private owner = new Map<Channel, number>();
  private seq = 0;
  constructor(private host: PlayerHost) {}

  /** Highest class playing now (null when idle). */
  top(): PriorityClass | null {
    let best: PriorityClass | null = null;
    for (const p of this.playing) if (best === null || rank(p.cls) < rank(best)) best = p.cls;
    return best;
  }

  play(kind: PlayKind, cls: PriorityClass, beats: PreparedBeat[], now: number, onEnd?: () => void, onCancel?: () => void): Playing | null {
    const top = this.top();
    if (top !== null && rank(cls) > rank(top)) return null;
    for (const p of [...this.playing]) if (rank(p.cls) > rank(cls) || p.kind === kind) this.stop(p, true, beats);
    const release = beats.find((b) => b.release)?.release ?? 'pop';
    const p: Playing = { id: ++this.seq, kind, cls, start: now, beats, next: 0, endAt: now + timelineEnd(beats), release, onEnd, onCancel };
    this.playing.push(p);
    this.update(now);
    return p;
  }

  /** Fire due beats; release reactions that have played out. */
  update(now: number): void {
    // the common frame fires nothing and ends nothing: no copies, no allocation
    let due = false;
    for (let i = 0; i < this.playing.length && !due; i++) {
      const p = this.playing[i];
      due = (p.next < p.beats.length && p.start + p.beats[p.next].at <= now) || (p.next >= p.beats.length && now >= p.endAt);
    }
    if (!due) return;
    for (const p of [...this.playing]) {
      if (!this.playing.includes(p)) continue;
      while (p.next < p.beats.length && p.start + p.beats[p.next].at <= now) {
        const b = p.beats[p.next++];
        for (const [c, v] of Object.entries(b.target) as Array<[Channel, number]>) {
          this.owner.set(c, p.id);
          this.host.set(c, v, b.kcs?.[c] ?? b.kc);
        }
        this.host.effects(b, p, now);
      }
      if (p.next >= p.beats.length && now >= p.endAt) this.stop(p, false);
    }
  }

  /** Cancel every reaction (a state change that owns the body, dispose). */
  clear(): void { for (const p of [...this.playing]) this.stop(p, true); }

  /** Push a reaction's end (a hold that lasts while a finger is down). */
  extend(kind: PlayKind, until: number): void { for (const p of this.playing) if (p.kind === kind) p.endAt = Math.max(p.endAt, until); }

  /** End a reaction early (finger lifted): it releases now. */
  end(kind: PlayKind): void { for (const p of [...this.playing]) if (p.kind === kind) this.stop(p, false); }

  has(kind: PlayKind): boolean { return this.playing.some((p) => p.kind === kind); }

  /** Move every timeline later by `ms` (the page was hidden): what came due meanwhile plays on, not all at once. */
  shift(ms: number): void { for (const p of this.playing) { p.start += ms; p.endAt += ms; } }

  /** The next moment a beat or a release is due (the loop stays awake until then). */
  nextDue(): number {
    let t = Infinity;
    for (const p of this.playing) t = Math.min(t, p.next < p.beats.length ? p.start + p.beats[p.next].at : p.endAt);
    return t;
  }

  private stop(p: Playing, cancelled: boolean, incoming?: PreparedBeat[]): void {
    const i = this.playing.indexOf(p);
    if (i < 0) return;
    this.playing.splice(i, 1);
    // channels the incoming reaction is about to take are handed over, not released (no dip between the two)
    const taken = new Set<Channel>();
    for (const b of incoming ?? []) for (const c of Object.keys(b.target) as Channel[]) taken.add(c);
    const kc = presetKC(p.release);
    for (const [c, id] of [...this.owner]) {
      if (id !== p.id) continue;
      this.owner.delete(c);
      if (!taken.has(c)) this.host.release(c, kc);
    }
    this.host.ended(p, cancelled);
    if (cancelled) p.onCancel?.(); else p.onEnd?.();
  }
}
