'use client';

import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MOOD_BAND, type NeedKey } from '@/lib/pet/types';
import type { Point } from '../_engine/types';
import { GESTURE, type ToyEvent, type ToyKind } from './contract';
import { NEED_LABEL } from './copy';
import { BallIcon, CookieIcon, MoonIcon } from './Particles';
import { t, type PetStringKey } from './strings';

export type Needs = Record<NeedKey, number>;

interface DockProps {
  /** null until the care state is known: rings draw empty-track only */
  needs: Needs | null;
  onToy: (e: ToyEvent) => void;
  /** the toy buttons, for SceneAnchors (gaze, feed reach) */
  toyRef?: (kind: ToyKind, el: HTMLElement | null) => void;
  disabled?: boolean;
}

const TOYS: { kind: ToyKind; need: NeedKey; label: PetStringKey; Icon: () => React.ReactElement }[] = [
  { kind: 'cookie', need: 'tummy', label: 'toy.feed', Icon: CookieIcon },
  { kind: 'ball', need: 'joy', label: 'toy.ball', Icon: BallIcon },
  { kind: 'moon', need: 'energy', label: 'toy.moon', Icon: MoonIcon },
];

/** Ring geometry: r 30 in a 68 box, so the stroke sits just outside the 52 px toy. */
const R = 30;
const C = 2 * Math.PI * R;

/** A need as a ring around its toy (§1.1): the only "UI". No numbers, never red. */
function Ring({ value }: { value: number | null }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg className="pet-ring" viewBox="0 0 68 68" aria-hidden="true">
      <circle cx="34" cy="34" r={R} className="pet-ring-track" />
      <circle cx="34" cy="34" r={R} className="pet-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - v)} transform="rotate(-90 34 34)" />
    </svg>
  );
}

/**
 * The three toys (§1.3): cookie (Tummy), ball (Joy), moon (Energy), each in its need ring. A toy
 * whose need is in "wants" wiggles 2° every ~6 s. The cookie can be dragged to the mouth (the engine
 * flies the cookie and decides whether it landed) or tapped (it arcs in by itself). A click that no
 * pointer made (keyboard, TalkBack/VoiceOver double-tap, switch access) feeds too: tap-to-feed is the
 * accessible path. Labels say what a tap does.
 */
export const Dock = memo(function Dock({ needs, onToy, toyRef, disabled }: DockProps) {
  const drag = useRef<{ id: number; x: number; y: number; lifted: boolean; origin: Point } | null>(null);
  /** when a pointer gesture last ended on the cookie: the click the browser sends after it is not a second feed */
  const pointerEnd = useRef(-Infinity);
  const [lifted, setLifted] = useState(false);

  const stagePoint = (o: Point, x: number, y: number): Point => ({ x: x - o.x, y: y - o.y });

  const cookieDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || drag.current) return;
    // stage px: the stage fills the viewport on the page, so client px are stage px (the lab offsets them)
    const stage = e.currentTarget.closest('[data-pet-root]')?.getBoundingClientRect();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lifted: false, origin: { x: stage?.left ?? 0, y: stage?.top ?? 0 } };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  };
  const cookieMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.lifted && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= GESTURE.dragPx) {
      d.lifted = true;
      setLifted(true);
      onToy({ type: 'cookieLift', at: stagePoint(d.origin, e.clientX, e.clientY) });
    }
    if (d.lifted) onToy({ type: 'cookieMove', at: stagePoint(d.origin, e.clientX, e.clientY) });
  };
  const cookieUp = (e: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    pointerEnd.current = performance.now();
    if (d.lifted) {
      setLifted(false);
      // a cancelled drag (system gesture, call) drops the cookie back where it was picked up
      onToy({ type: 'cookieDrop', at: cancelled ? stagePoint(d.origin, d.x, d.y) : stagePoint(d.origin, e.clientX, e.clientY) });
    } else if (!cancelled) {
      onToy({ type: 'cookieTap' });
    }
  };

  return (
    <div className="pet-dock" role="group" aria-label="Toys">
      {TOYS.map(({ kind, need, label, Icon }) => {
        const value = needs ? needs[need] : null;
        const wants = value !== null && value < MOOD_BAND.wantsBelow;
        const common = {
          ref: (el: HTMLButtonElement | null) => toyRef?.(kind, el),
          type: 'button' as const,
          className: 'pet-toy',
          'data-toy': kind,
          'data-wants': wants ? '' : undefined,
          'aria-label': t(label),
          'aria-description': value === null ? undefined : `${NEED_LABEL[need]}${wants ? ', wants some' : ''}`,
          disabled,
        };
        if (kind === 'cookie') {
          return (
            <button key={kind} {...common} data-lifted={lifted ? '' : undefined} title={t('toy.feedHint')}
              onPointerDown={cookieDown} onPointerMove={cookieMove} onPointerUp={(e) => cookieUp(e)} onPointerCancel={(e) => cookieUp(e, true)}
              onClick={() => { if (!disabled && performance.now() - pointerEnd.current > 600) onToy({ type: 'cookieTap' }); }}>
              <Ring value={value} /><span className="pet-toy-face"><Icon /></span>
            </button>
          );
        }
        return (
          <button key={kind} {...common} onClick={() => onToy(kind === 'ball' ? { type: 'ballTap' } : { type: 'moonTap' })}>
            <Ring value={value} /><span className="pet-toy-face"><Icon /></span>
          </button>
        );
      })}
    </div>
  );
});
