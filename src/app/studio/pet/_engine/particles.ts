/**
 * Particles (brief §3.2 layer 3, decision 10): a fixed pool of ≤ 16 divs the UI renders once; the loop writes
 * `data-kind`, transform and opacity straight into them (no React state, no Burst.tsx). Each kind has its own
 * small motion: crumbs fall, hearts and notes rise, Z marks drift up swaying, sparkles burst, wisps float off,
 * a tear drops. Lite: half the count (≤ 6 live) at 30 Hz. Reduced: one static icon that only fades.
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

/** Life (ms) and launch per kind, px/s at a 200 px character. */
const KIND: Record<ParticleKind, { ttl: number; g: number; launch: (rng: Rng) => [number, number]; s: [number, number] }> = {
  crumb: { ttl: 400, g: 1600, launch: (r) => [range(r, -90, 90), range(r, -260, -120)], s: [0.5, 0.8] },
  heart: { ttl: 900, g: -60, launch: (r) => [range(r, -50, 50), range(r, -150, -90)], s: [0.8, 1.1] },
  z: { ttl: 1600, g: 0, launch: () => [10, -42], s: [0.7, 1] },
  sparkle: { ttl: 620, g: 0, launch: (r) => { const a = range(r, 0, Math.PI * 2), v = range(r, 140, 260); return [Math.cos(a) * v, Math.sin(a) * v - 60]; }, s: [0.6, 1.1] },
  note: { ttl: 1200, g: -20, launch: (r) => [range(r, 20, 50), range(r, -90, -60)], s: [0.8, 1] },
  wisp: { ttl: 1400, g: -10, launch: (r) => [range(r, -40, 40), range(r, -50, -25)], s: [0.7, 1.2] },
  tear: { ttl: 520, g: 900, launch: (r) => [range(r, -10, 10), 10], s: [0.7, 0.9] },
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

  /** Spawn n of a kind at a stage point (k = px per unit). Respects the tier's live cap. */
  burst(kind: ParticleKind, n: number, at: Point, k: number, tier: Tier): void {
    const cap = TIER_BUDGET[tier].particles || 1;
    let live = this.pool.filter((p) => p.live).length;
    for (let i = 0; i < n && live < cap; i++) {
      // reuse the oldest dead slot; when all are live the burst is trimmed (never steals a live one)
      const p = this.pool.find((q) => !q.live);
      if (!p) break;
      const d = KIND[kind];
      const [vx, vy] = tier === 'reduced' ? [0, 0] : d.launch(this.rng);
      Object.assign(p, {
        kind, x: at.x + (tier === 'reduced' ? 0 : range(this.rng, -6, 6) * k), y: at.y, vx: vx * k, vy: vy * k, age: 0,
        ttl: tier === 'reduced' ? 600 : d.ttl * range(this.rng, 0.9, 1.1), s: range(this.rng, d.s[0], d.s[1]),
        rot: range(this.rng, -20, 20), spin: range(this.rng, -180, 180), phase: range(this.rng, 0, Math.PI * 2), live: true,
      });
      live++;
    }
  }

  get live(): number { return this.pool.reduce((n, p) => n + (p.live ? 1 : 0), 0); }

  /** Advance and write. Lite updates at 30 Hz. */
  update(dtMs: number, k: number, tier: Tier): void {
    this.acc += dtMs;
    if (tier === 'lite' && this.acc < 33) return;
    const dt = Math.min(64, this.acc) / 1000;
    this.acc = 0;
    this.pool.forEach((p, i) => {
      const el = this.els[i];
      if (!p.live) return;
      p.age += dt * 1000;
      if (p.age >= p.ttl) {
        p.live = false;
        if (el) park(el);
        return;
      }
      const u = p.age / p.ttl;
      let x = p.x, s = p.s, o = 1;
      if (tier !== 'reduced') {
        p.vy += KIND[p.kind].g * k * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt * (p.kind === 'sparkle' ? 2 : 0.3);
        x = p.x;
        if (p.kind === 'z' || p.kind === 'note' || p.kind === 'wisp') x += Math.sin(p.phase + u * Math.PI * 2) * 6 * k;
        if (p.kind === 'sparkle') s = p.s * Math.sin(Math.min(1, u * 1.4) * Math.PI);
        if (p.kind === 'heart' || p.kind === 'z') s = p.s * (0.6 + 0.4 * Math.min(1, u * 4));
      }
      // fade in fast, out over the last 40 %
      o = Math.min(1, u * 8) * (u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1);
      if (el) {
        if (el.dataset.kind !== p.kind) el.dataset.kind = p.kind;
        place(el, `translate3d(${x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${p.rot.toFixed(0)}deg) scale(${s.toFixed(3)})`, o.toFixed(3));
      }
    });
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
