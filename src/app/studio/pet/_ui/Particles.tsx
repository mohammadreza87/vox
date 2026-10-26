'use client';

import { lazy, memo, Suspense, useLayoutEffect, useRef } from 'react';
import { TIER_BUDGET } from '../_engine/types';
import type { PetEngine } from './contract';

/** fx.css: each particle kind's look, the thought cloud and the Bop count, out of the route's first CSS (§3.3). */
const FxStyles = lazy(() => import('./FxStyles'));

/** The full-tier pool (§3.3): lite and reduced use fewer of the same divs. */
export const PARTICLE_POOL = TIER_BUDGET.full.particles;

/**
 * The particle and ball layer (§3.2 layer 3): a fixed pool of ≤ 16 divs rendered once, plus the Bop
 * ball and the cookie in flight. The engine writes `data-kind`, transform and opacity straight into
 * them (no React state per burst, unlike Studio's Burst.tsx); fx.css draws each kind (crumb, heart,
 * z, sparkle, note, wisp, tear), loaded with this layer. Taps on the ball keep it in the air.
 */
export const Particles = memo(function Particles({ engine }: { engine: PetEngine }) {
  const pool = useRef<(HTMLDivElement | null)[]>([]);
  const ball = useRef<HTMLDivElement>(null);
  const cookie = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => engine.attach({
    particles: pool.current.filter((d): d is HTMLDivElement => d !== null),
    ball: ball.current,
    cookie: cookie.current,
  }), [engine]);

  return (
    <div className="pet-fx" aria-hidden="true">
      <Suspense fallback={null}><FxStyles /></Suspense>
      {Array.from({ length: PARTICLE_POOL }, (_, i) => <div key={i} ref={(d) => { pool.current[i] = d; }} className="pet-p" />)}
      <div ref={cookie} className="pet-flycookie" style={{ opacity: 0 }}><CookieIcon /></div>
      <div ref={ball} className="pet-ball" style={{ opacity: 0 }}
        onPointerDown={(e) => {
          // a ball that is not in play lets the touch through to the stage
          if (parseFloat(e.currentTarget.style.opacity || '0') < 0.1) return;
          e.stopPropagation();
          const r = e.currentTarget.parentElement?.getBoundingClientRect();
          engine.toy({ type: 'ballTap', at: { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) } });
        }}>
        <BallIcon />
      </div>
    </div>
  );
});

/* ---------- the three toys, drawn once (vinyl-toy minimal: two tones and a highlight) ---------- */

export function CookieIcon() {
  return (
    <svg viewBox="0 0 40 40" className="pet-icon" aria-hidden="true">
      <circle cx="20" cy="21" r="15" fill="#B9773F" />
      <circle cx="20" cy="20" r="15" fill="#E3A35E" />
      <path d="M9 15a13 13 0 0 1 9-8" stroke="#F6CF95" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="15" cy="21" r="2.4" fill="#5B3420" /><circle cx="24" cy="15" r="2" fill="#5B3420" />
      <circle cx="25" cy="25" r="2.6" fill="#5B3420" /><circle cx="17" cy="28" r="1.6" fill="#5B3420" />
    </svg>
  );
}

export function BallIcon() {
  return (
    <svg viewBox="0 0 40 40" className="pet-icon" aria-hidden="true">
      <circle cx="20" cy="20" r="15" fill="#F2F1EC" />
      <path d="M5 20a15 15 0 0 1 30 0z" fill="#D6FF5C" />
      <path d="M5.5 20h29" stroke="#0E1013" strokeOpacity=".18" strokeWidth="2" />
      <circle cx="14" cy="12" r="3" fill="#fff" fillOpacity=".7" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 40 40" className="pet-icon" aria-hidden="true">
      <path d="M26 6a15 15 0 1 0 8 23A12 12 0 0 1 26 6z" fill="#F1E3A0" />
      <path d="M12 14a10 10 0 0 1 6-5" stroke="#FFF8D6" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="31" cy="9" r="1.6" fill="#F1E3A0" /><circle cx="35" cy="16" r="1" fill="#F1E3A0" />
    </svg>
  );
}
