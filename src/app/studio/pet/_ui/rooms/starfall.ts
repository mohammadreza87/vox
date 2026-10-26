/**
 * Starfall's round (design §4.2, §10.6), pure so it is unit-tested: stars fall in the stage, the pet catches the ones
 * that reach its mouth line close enough to it, a star that passes just beside it is a near miss (a glance, never a
 * frown, never counted against you). There are no bad items. A round ends when its time is up or every pip is lit;
 * Zen has no timer, no pips and no end: you stop when you like.
 */

export const STARFALL = {
  /** a round's length (30-60 s, §4.2) and its pips (progress, never a number on screen) */
  roundMs: 40_000,
  pips: 10,
  /** a star every … ms, falling at … px/s (Zen: slower and sparser; reduced motion: 60 % speed, §10.8) */
  everyMs: 850, zenEveryMs: 1300,
  speed: 170, zenSpeed: 110, reducedSpeed: 0.6,
  /** caught within this share of the character size from its centre; a near miss within the wider band */
  catchR: 0.32, nearR: 0.58,
  /** a round won (the happier ending line and the celebrate) */
  wonAt: 6,
  maxStars: 8,
} as const;

export interface Star { id: number; x: number; y: number; v: number }
export interface StarfallOpts {
  /** the field: stars spawn from y0 at x in [x0, x1] and are judged at catchY */
  x0: number; x1: number; y0: number; catchY: number;
  /** the character's size (catch radius scales with it) */
  size: number;
  zen: boolean;
  reduced?: boolean;
  /** 0 … 1 (seeded in tests) */
  random?: () => number;
}
export type StarEvent = { type: 'catch'; star: Star } | { type: 'nearMiss'; star: Star } | { type: 'end'; caught: number };

export class StarfallRound {
  stars: Star[] = [];
  caught = 0;
  elapsed = 0;
  over = false;
  private spawnIn = 400;
  private nextId = 1;
  private rnd: () => number;
  constructor(private o: StarfallOpts) { this.rnd = o.random ?? Math.random; }

  get won() { return this.caught >= STARFALL.wonAt; }
  /** pips lit, 0 … STARFALL.pips */
  get pips() { return Math.min(STARFALL.pips, this.caught); }

  /** advance `dt` ms with the catcher (the character's centre) at `cx`; returns what happened */
  step(dt: number, cx: number): StarEvent[] {
    if (this.over) return [];
    const o = this.o, out: StarEvent[] = [];
    this.elapsed += dt;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.stars.length < STARFALL.maxStars) {
      this.spawnIn += o.zen ? STARFALL.zenEveryMs : STARFALL.everyMs;
      const speed = (o.zen ? STARFALL.zenSpeed : STARFALL.speed) * (o.reduced ? STARFALL.reducedSpeed : 1) * (0.85 + this.rnd() * 0.3);
      this.stars.push({ id: this.nextId++, x: o.x0 + (o.x1 - o.x0) * this.rnd(), y: o.y0, v: speed });
    }
    const keep: Star[] = [];
    for (const s of this.stars) {
      const was = s.y;
      s.y += (s.v * dt) / 1000;
      if (was < o.catchY && s.y >= o.catchY) {
        const d = Math.abs(s.x - cx) / o.size;
        if (d <= STARFALL.catchR) { this.caught++; out.push({ type: 'catch', star: s }); continue; }
        if (d <= STARFALL.nearR) out.push({ type: 'nearMiss', star: s });
      }
      // past the catch line it falls on out of the field
      if (s.y < o.catchY + o.size) keep.push(s);
    }
    this.stars = keep;
    if (!o.zen && (this.elapsed >= STARFALL.roundMs || this.caught >= STARFALL.pips)) { this.over = true; out.push({ type: 'end', caught: this.caught }); }
    return out;
  }
}

/** A fresh client round id (8-40 of [A-Za-z0-9_-], play.ts): a retried save carries the same id. */
export function roundId(rnd: () => number = Math.random): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += a[Math.floor(rnd() * a.length) % a.length];
  return s;
}
