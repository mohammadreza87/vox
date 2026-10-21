'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EASE } from '../../_lib/motion';
import { useTier } from './tier';

/**
 * One-shot particles (motion §4.7, §4.8, §5.6): HTML divs, transform + opacity only, created once per
 * moment and removed when they land. At most 18 nodes per burst (lite: half). Decorative.
 */

export type ParticleKind = 'vapor' | 'sparkle' | 'hire' | 'wisp' | 'puffs';
export interface BurstSpec {
  id: number;
  kind: ParticleKind;
  /** origin in px, relative to the particle layer's top-left */
  at: [number, number];
  /** distance scale (1 = a 200 px character) */
  k: number;
  light: string;
  base: string;
  lite?: boolean;
}

type Shape = 'dot' | 'puff' | 'spark';
interface Particle { shape: Shape; r: number; dx: number; dy: number; rise: number; color: string; delay: number; dur: number; peak: number; opacity: number }

const VOLT = 'var(--volt, #D6FF5C)';
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** A random direction weighted upward (clouds rise). */
function upward(): [number, number] {
  const a = -Math.PI / 2 + rnd(-1, 1) * Math.PI * 0.62;
  return [Math.cos(a), Math.sin(a)];
}

export function particlesFor(s: BurstSpec): Particle[] {
  const k = s.k, half = s.lite;
  const radial = (i: number, n: number) => { const a = (i / n) * Math.PI * 2 + rnd(-0.25, 0.25); return [Math.cos(a), Math.sin(a)] as const; };
  switch (s.kind) {
    case 'vapor': return Array.from({ length: half ? 4 : 7 }, () => {
      const [x, y] = upward(), d = rnd(36, 56) * k;
      return { shape: 'dot' as const, r: rnd(6, 14) * k, dx: x * d, dy: y * d, rise: 10 * k, color: s.light, delay: 0, dur: 0.52, peak: 1.2, opacity: 0.9 };
    });
    case 'puffs': return Array.from({ length: 3 }, (_, i) => {
      const d = rnd(10, 18) * k;
      return { shape: 'dot' as const, r: rnd(3, 5) * k, dx: (i - 1) * d, dy: -rnd(4, 10) * k, rise: 8 * k, color: s.light, delay: i * 0.03, dur: 0.4, peak: 1, opacity: 0.85 };
    });
    case 'sparkle': {
      const n = half ? 4 : 8;
      return Array.from({ length: n }, (_, i) => {
        const [x, y] = radial(i, n), d = rnd(40, 80) * k, volt = i % (n / 2) === 0;
        return { shape: 'spark' as const, r: rnd(4, 6.5) * k, dx: x * d, dy: y * d, rise: 0, color: volt ? VOLT : s.base, delay: 0, dur: 0.5, peak: 1, opacity: 1 };
      });
    }
    case 'hire': {
      const clouds = half ? 6 : 12, sparks = half ? 3 : 6;
      return [
        ...Array.from({ length: clouds }, (_, i) => {
          const [x, y] = radial(i, clouds), d = rnd(70, 120) * k;
          return { shape: 'puff' as const, r: rnd(4, 8) * k, dx: x * d, dy: y * d, rise: 12 * k, color: i % 2 ? s.light : s.base, delay: 0, dur: 0.7, peak: 1, opacity: 1 };
        }),
        ...Array.from({ length: sparks }, (_, i) => {
          const [x, y] = radial(i + 0.5, sparks), d = rnd(80, 120) * k;
          return { shape: 'spark' as const, r: rnd(4, 6) * k, dx: x * d, dy: y * d, rise: 0, color: VOLT, delay: 0.04, dur: 0.7, peak: 1, opacity: 1 };
        }),
      ];
    }
    case 'wisp': return Array.from({ length: half ? 2 : 4 }, (_, i) => ({
      shape: 'dot' as const, r: rnd(5, 9) * k, dx: rnd(-26, 26) * k, dy: -rnd(30, 52) * k, rise: 14 * k,
      color: s.light, delay: i * 0.35, dur: rnd(1.6, 2.2), peak: 1.15, opacity: 0.55,
    }));
  }
}

const SHAPE: Record<Shape, CSSProperties> = {
  dot: { borderRadius: '50%' },
  puff: { borderRadius: '50%' },
  spark: { clipPath: 'polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%)' },
};

function Bits({ spec, onDone }: { spec: BurstSpec; onDone: (id: number) => void }) {
  // Random layout is drawn once per burst (re-renders must not reshuffle it).
  const [parts] = useState(() => particlesFor(spec));
  const left = useRef(parts.length);
  const land = () => { if (--left.current === 0) onDone(spec.id); };
  return (
    <>
      {parts.map((p, i) => (
        <motion.span key={i} aria-hidden="true" className={p.shape === 'puff' ? 'vx-puff' : undefined}
          style={{ position: 'absolute', left: spec.at[0] - p.r, top: spec.at[1] - p.r, width: p.r * 2, height: p.r * 2, background: p.color, pointerEvents: 'none', ...SHAPE[p.shape] }}
          initial={{ x: 0, y: 0, scale: 0, opacity: p.opacity, rotate: 0 }}
          animate={{ x: [0, p.dx, p.dx], y: [0, p.dy, p.dy - p.rise], scale: [0, p.peak, p.shape === 'spark' ? 0.4 : 1], opacity: [p.opacity, p.opacity, 0], rotate: p.shape === 'spark' ? [0, 45, 90] : 0 }}
          transition={{ duration: p.dur, delay: p.delay, times: [0, 0.5, 1], ease: [EASE.enter, EASE.standard] }}
          onAnimationComplete={land} />
      ))}
    </>
  );
}

/** Renders queued bursts; each removes itself (`onDone`) when its last particle lands. */
export function Particles({ bursts, onDone }: { bursts: BurstSpec[]; onDone: (id: number) => void }) {
  if (!bursts.length) return null;
  return <span className="vx-particles" aria-hidden="true">{bursts.map((b) => <Bits key={b.id} spec={b} onDone={onDone} />)}</span>;
}

let seq = 0;
/**
 * A celebration burst centred on its positioned parent: `hire` (12 mini clouds + 6 volt sparks) or
 * `spark` (8 sparkles). Plays once on mount; nothing under reduced motion, half on lite.
 */
export function Burst({ kind = 'spark', size = 220, light = 'var(--hue-light, #E6DBFF)', base = 'var(--hue, #C3A6FF)', onDone }: {
  kind?: 'hire' | 'spark'; size?: number; light?: string; base?: string; onDone?: () => void;
}) {
  const tier = useTier();
  const [spec, setSpec] = useState<BurstSpec | null>(() => tier === 'reduced' ? null
    : { id: ++seq, kind: kind === 'hire' ? 'hire' : 'sparkle', at: [0, 0], k: size / 220, light, base, lite: tier === 'lite' });
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => { if (!spec) done.current?.(); }, [spec]);
  return (
    <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none', zIndex: 2 }}>
      {spec && <Particles bursts={[spec]} onDone={() => setSpec(null)} />}
    </span>
  );
}
