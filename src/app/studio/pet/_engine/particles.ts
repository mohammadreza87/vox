/**
 * Particles (brief §3.2 layer 3, decision 10): a fixed pool of ≤ 16 divs the UI renders once; the loop writes
 * `data-kind`, transform and opacity straight into them (no React state, no Burst.tsx). Each kind has its own
 * small motion: crumbs fall, hearts and notes rise, Z marks drift up swaying, sparkles burst, wisps float off,
 * a tear drops, raindrops fall straight from a wide spread under the body. Lite: half the count (≤ 6 live) at 30 Hz. Reduced motion: none at all (§10.8; the model's own
 * Z marks and faces still say what a burst would). The pool is fixed: no allocation per burst or per frame.
 */

import { range } from './rng';
import { TIER_BUDGET, type ParticleKind, type Point, type Rng, type Tier } from './types';

interface Particle {
  kind: ParticleKind;
  x: number; y: number; vx: number; vy: number;
  age: number; ttl: number;
  s: number; rot: number; spin: number; phase: number;
  live: boolean;
}

/** Life (ms) and launch per kind, px/s at a 200 px character; `w`: a wide spawn (± px) that falls straight (rain). */
const KIND: Record<ParticleKind, { ttl: number; g: number; launch: (rng: Rng) => [number, number]; s: [number, number]; w?: number }> = {
  crumb: { ttl: 400, g: 1600, launch: (r) => [range(r, -90, 90), range(r, -260, -120)], s: [0.5, 0.8] },
  heart: { ttl: 900, g: -60, launch: (r) => [range(r, -50, 50), range(r, -150, -90)], s: [0.8, 1.1] },
  z: { ttl: 2300, g: 0, launch: () => [12, -38], s: [0.85, 1.15] },
  sparkle: { ttl: 620, g: 0, launch: (r) => { const a = range(r, 0, Math.PI * 2), v = range(r, 140, 260); return [Math.cos(a) * v, Math.sin(a) * v - 60]; }, s: [0.6, 1.1] },
  note: { ttl: 1200, g: -20, launch: (r) => [range(r, 20, 50), range(r, -90, -60)], s: [0.8, 1] },
  wisp: { ttl: 1400, g: -10, launch: (r) => [range(r, -40, 40), range(r, -50, -25)], s: [0.7, 1.2] },
  tear: { ttl: 520, g: 900, launch: (r) => [range(r, -10, 10), 10], s: [0.7, 0.9] },
  drop: { ttl: 560, g: 1500, launch: (r) => [range(r, -8, 8), range(r, 50, 130)], s: [0.75, 1.05], w: 24 },
};

/** A live element: its composited transform and opacity (visible again if it was parked). */
export function place(el: HTMLElement, transform: string, opacity: string): void {
  if (el.style.visibility !== 'visible') el.style.visibility = 'visible';
  el.style.transform = transform;
  el.style.opacity = opacity;
}

/**
 * Parked between uses: hidden, with no 3D transform. A translate3d is a compositing reason on its own
 * (Chromium promotes it even at z 0), so a parked pool of 18 would keep 18 layers alive at rest; only the
 * live ones carry one (§3.3: ≤ 4 promoted layers).
 */
export function park(el: HTMLElement): void {
  if (el.style.visibility === 'hidden' && el.style.transform === 'none') return;
  el.style.visibility = 'hidden';
  el.style.opacity = '0';
  el.style.transform = 'none';
}

export class Particles {
  private pool: Particle[] = [];
  private els: HTMLElement[] = [];
  private acc = 0;
  constructor(private rng: Rng, private size = 16) {
    for (let i = 0; i < size; i++) this.pool.push({ kind: 'sparkle', x: 0, y: 0, vx: 0, vy: 0, age: 0, ttl: 0, s: 1, rot: 0, spin: 0, phase: 0, live: false });
  }

  attach(els: HTMLElement[]): void {
    this.els = els.slice(0, this.size);
    for (const el of this.els) park(el);
  }

  /** Spawn n of a kind at a stage point (k = px per unit), spread ± w units (default the kind's). Respects the tier's live cap. */
  burst(kind: ParticleKind, n: number, at: Point, k: number, tier: Tier, w?: number): void {
    const cap = TIER_BUDGET[tier].particles;
    let live = this.live, slot = 0;
    const d = KIND[kind], sw = w ?? d.w ?? 6;
    for (let i = 0; i < n && live < cap; i++) {
      // reuse the first dead slot; when all are live the burst is trimmed (never steals a live one)
      while (slot < this.pool.length && this.pool[slot].live) slot++;
      if (slot >= this.pool.length) break;
      const p = this.pool[slot];
      const [vx, vy] = d.launch(this.rng);
      p.kind = kind; p.x = at.x + range(this.rng, -sw, sw) * k; p.y = at.y; p.vx = vx * k; p.vy = vy * k; p.age = 0;
      p.ttl = d.ttl * range(this.rng, 0.9, 1.1); p.s = range(this.rng, d.s[0], d.s[1]);
      p.rot = d.w ? 0 : range(this.rng, -20, 20); p.spin = d.w ? 0 : range(this.rng, -180, 180); p.phase = range(this.rng, 0, Math.PI * 2); p.live = true;
      live++;
    }
  }

  get live(): number { let n = 0; for (const p of this.pool) if (p.live) n++; return n; }

  /** Advance and write. Lite updates at 30 Hz. */
  update(dtMs: number, k: number, tier: Tier): void {
    this.acc += dtMs;
    if (tier === 'lite' && this.acc < 33) return;
    const dt = Math.min(64, this.acc) / 1000;
    this.acc = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i], el = this.els[i];
      if (!p.live) continue;
      p.age += dt * 1000;
      if (p.age >= p.ttl) {
        p.live = false;
        if (el) park(el);
        continue;
      }
      const u = p.age / p.ttl;
      let x = p.x, s = p.s, o = 1;
      if (tier !== 'reduced') {
        p.vy += KIND[p.kind].g * k * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt * (p.kind === 'sparkle' ? 2 : 0.3);
        x = p.x;
        if (p.kind === 'z' || p.kind === 'note' || p.kind === 'wisp') x += Math.sin(p.phase + u * Math.PI * 2) * (p.kind === 'z' ? 9 : 6) * k;
        if (p.kind === 'sparkle') s = p.s * Math.sin(Math.min(1, u * 1.4) * Math.PI);
        if (p.kind === 'heart') s = p.s * (0.6 + 0.4 * Math.min(1, u * 4));
        // a Z puffs up from small as it rises (a little overshoot), rocking gently as it sways
        if (p.kind === 'z') { const g = Math.min(1, u * 3.5); s = p.s * (0.35 + 0.65 * g + 0.12 * Math.sin(Math.PI * g)); p.rot = 14 * Math.sin(p.phase + u * Math.PI * 2); }
      }
      // fade in fast, out over the last 40 %
      o = Math.min(1, u * 8) * (u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1);
      if (el) {
        if (el.dataset.kind !== p.kind) el.dataset.kind = p.kind;
        place(el, `translate3d(${x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${p.rot.toFixed(0)}deg) scale(${s.toFixed(3)})`, o.toFixed(3));
      }
    }
  }

  clear(): void { for (const p of this.pool) p.live = false; for (const el of this.els) park(el); }

  /** Live particle snapshot (frame sheets draw these). */
  snapshot(): Array<{ kind: ParticleKind; x: number; y: number; s: number; o: number }> {
    return this.pool.filter((p) => p.live).map((p) => {
      const u = p.age / p.ttl;
      return { kind: p.kind, x: p.x, y: p.y, s: p.s, o: Math.min(1, u * 8) * (u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1) };
    });
  }
}
