/**
 * Ballistics (brief §2.1 weight, §2.6 fling/drop, §2.7 Bop): hops are parabolas under gravity, a fling flies,
 * spins with its vx, bounces off the viewport walls and lands with squash; the ball is a circle under the same
 * gravity. Units are px at a 200 px character (the loop multiplies by k), integrated in the springs' substeps.
 */

import { LOOP, PHYSICS } from './types';

export interface Bounds { minX: number; maxX: number; minY: number; floor: number }
export type Contact = { type: 'wall'; nx: number; v: number } | { type: 'land'; v: number };

const substeps = (dtMs: number) => {
  const T = Math.min(dtMs, LOOP.maxDtMs) / 1000;
  const n = Math.max(1, Math.ceil(T / LOOP.substep - 1e-9));
  return { h: T / n, n };
};

/** A hop: up from the ground with v0 = √(2gh), down onto it; optional travel in x (hop home). */
export class Hop {
  y = 0;
  vy = 0;
  x = 0;
  private vx = 0;
  active = false;
  constructor(public g: number = PHYSICS.gravity) {}

  /** Launch a hop of apex h (px) that moves dx (px) by landing. */
  launch(h: number, dx = 0, from = this.y): void {
    this.y = Math.min(0, from);
    this.vy = -Math.sqrt(2 * this.g * Math.max(0.5, h + this.y));
    const air = (-this.vy + Math.sqrt(this.vy * this.vy + 2 * this.g * -this.y)) / this.g;
    this.vx = dx / Math.max(0.05, air);
    this.active = true;
  }

  /** Returns the landing speed (px/s) on the frame it lands, else 0. */
  step(dtMs: number): number {
    if (!this.active) return 0;
    const { h, n } = substeps(dtMs);
    for (let i = 0; i < n; i++) {
      this.vy += this.g * h;
      this.y += this.vy * h;
      this.x += this.vx * h;
      if (this.y >= 0 && this.vy > 0) {
        const v = this.vy;
        this.y = 0; this.vy = 0; this.vx = 0; this.active = false;
        return v;
      }
    }
    return 0;
  }
}

/** The flung body: x/y offset from home, spin, walls and floor. */
export class Fling {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  rot = 0;
  spin = 0;
  active = false;
  constructor(public g: number = PHYSICS.gravity) {}

  launch(x: number, y: number, vx: number, vy: number): void {
    Object.assign(this, { x, y, vx, vy, spin: vx * PHYSICS.spin, active: true });
  }

  step(dtMs: number, b: Bounds): Contact[] {
    const out: Contact[] = [];
    if (!this.active) return out;
    const { h, n } = substeps(dtMs);
    for (let i = 0; i < n; i++) {
      this.vy += this.g * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.rot += this.spin * h;
      if (this.x < b.minX || this.x > b.maxX) {
        const nx = this.x < b.minX ? 1 : -1;
        out.push({ type: 'wall', nx, v: Math.abs(this.vx) });
        this.x = nx > 0 ? b.minX : b.maxX;
        this.vx = -this.vx * PHYSICS.restitution;
        this.spin *= -0.5;
      }
      if (this.y < b.minY) { this.y = b.minY; this.vy = Math.abs(this.vy) * PHYSICS.restitution; }
      if (this.y >= b.floor && this.vy > 0) {
        const v = this.vy;
        out.push({ type: 'land', v });
        this.y = b.floor;
        // bounce while it still reads; otherwise it stops on the ground (the loop hops it home)
        if (v * PHYSICS.restitution > 420) { this.vy = -v * PHYSICS.restitution; this.vx *= 0.7; this.spin *= 0.6; }
        else { this.vy = 0; this.vx = 0; this.spin = 0; this.active = false; break; }
      }
    }
    return out;
  }
}

/** The Bop ball: a circle under gravity, walls, a floor (a miss) and the head it bops off. */
export class Ball {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  rot = 0;
  r = 22;
  active = false;
  constructor(public g: number = PHYSICS.gravity) {}

  spawn(x: number, y: number): void { Object.assign(this, { x, y, vx: 0, vy: 0, rot: 0, active: true }); }

  /** An upward tap impulse (the user keeps it alive). */
  tap(dir = 0): void { this.vy = Math.min(this.vy, 0) - 980; this.vx += dir * 160; }

  /**
   * Returns 'floor' on the frame it falls past the floor (a miss) or 'hit' when it bounces off the head circle
   * (the caller adds the bop impulse); the normal is from the head toward the ball.
   */
  step(dtMs: number, b: Bounds, head: { x: number; y: number; r: number } | null): { type: 'floor' } | { type: 'hit'; nx: number; ny: number } | null {
    if (!this.active) return null;
    const { h, n } = substeps(dtMs);
    for (let i = 0; i < n; i++) {
      this.vy += this.g * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.rot += (this.vx / this.r) * h * (180 / Math.PI);
      if (this.x - this.r < b.minX) { this.x = b.minX + this.r; this.vx = Math.abs(this.vx) * 0.8; }
      if (this.x + this.r > b.maxX) { this.x = b.maxX - this.r; this.vx = -Math.abs(this.vx) * 0.8; }
      if (this.y - this.r < b.minY) { this.y = b.minY + this.r; this.vy = Math.abs(this.vy) * 0.6; }
      if (head) {
        const dx = this.x - head.x, dy = this.y - head.y, d = Math.hypot(dx, dy);
        if (d < this.r + head.r && d > 0 && this.vy > -200) {
          const nx = dx / d, ny = dy / d;
          this.x = head.x + nx * (this.r + head.r);
          this.y = head.y + ny * (this.r + head.r);
          return { type: 'hit', nx, ny };
        }
      }
      if (this.y - this.r > b.floor) { this.active = false; return { type: 'floor' }; }
    }
    return null;
  }

  /** The bop: an impulse along the contact normal, mostly up, spread by `spread` radians. */
  bop(nx: number, ny: number, spread: number, power = 1250): void {
    const a = Math.atan2(Math.min(ny, -0.55), nx) + spread;
    this.vx = Math.cos(a) * power * 0.55;
    this.vy = Math.sin(a) * power;
  }
}

/** Velocity stretch while dragged or airborne: 1 + clamp(|v|·k, 0, max) (§2.6 drag). */
export const velocityStretch = (v: number) => 1 + Math.min(PHYSICS.stretchMax, Math.max(0, Math.abs(v) * PHYSICS.stretchK));
/** Landing squash: sy = 1 − clamp(v / 4000, 0.08, 0.3) (§2.6 fling). */
export const landSquash = (v: number) => 1 - Math.min(0.3, Math.max(0.08, v / 4000));
