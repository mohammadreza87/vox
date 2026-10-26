'use client';

import { m } from 'framer-motion';
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { PointerSample, PetEngine } from './contract';
import type { Backdrop, CharacterBox } from './scene';

interface StageProps {
  engine: PetEngine;
  backdrop: Backdrop;
  box: CharacterBox;
  /** the character (PetRig) */
  children: ReactNode;
  /** above the lights-off overlay: particles, bubble, thought (Z marks and words stay readable at night) */
  over?: ReactNode;
  /** the lab's framed stage instead of the fullscreen page */
  embed?: boolean;
  style?: CSSProperties;
  /** the first pointerdown anywhere on the stage (AudioContext resume, accelerometer start) */
  onTouch?: () => void;
  /** a fast horizontal flick on the background, never on the character (design §4: switches rooms) */
  onSwipe?: (toward: 'left' | 'right') => void;
  /** the character took a pointer (a tip signal: the body was touched) */
  onBody?: () => void;
  /** reduced motion: the room cross-fade is quicker (fades stay, §10.8) */
  reduced?: boolean;
}

/** Room change (§10.5): the old room's light fades out over the new one, on the UI's sine ease; reduced motion 160 ms. */
export const ROOM_FADE_MS = { full: 320, reduced: 160 } as const;
const SINE = 'cubic-bezier(.37, 0, .63, 1)';

/**
 * The room's light cross-fades (§10.5): the new backdrop paints at once under a copy of the old one, which fades out
 * (one opacity animation on one layer, compositor only; no filters). A resize that only moves the floor line repaints
 * in place.
 */
function useRoomFade(bd: Backdrop, reduced: boolean) {
  const [out, setOut] = useState<{ key: number; bd: Backdrop } | null>(null);
  const [was, setWas] = useState(bd);
  const el = useRef<HTMLDivElement>(null);
  // derived in render: the old light is on screen in the same frame the new one lands
  if (was.room !== bd.room) { setWas(bd); setOut({ key: performance.now(), bd: was }); }
  else if (was !== bd) setWas(bd);
  useLayoutEffect(() => {
    const node = el.current;
    if (!out || !node) return;
    const ms = reduced ? ROOM_FADE_MS.reduced : ROOM_FADE_MS.full;
    let done = false;
    const end = () => { if (!done) { done = true; setOut((o) => (o?.key === out.key ? null : o)); } };
    const a = typeof node.animate === 'function' ? node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: SINE, fill: 'forwards' }) : null;
    if (a) a.onfinish = end;
    // never left over the new room (no animation support, a paused page)
    const t = setTimeout(end, ms + 120);
    return () => { clearTimeout(t); a?.cancel(); };
  }, [out, reduced]);
  return out && <div ref={el} key={out.key} className="pet-bd-out" aria-hidden="true"
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: out.bd.image, backgroundColor: out.bd.edge, backgroundRepeat: 'no-repeat' }} />;
}

/** A flick, not a gaze drag: ≥ 60 px sideways, twice as far as up or down, within 320 ms. */
export const SWIPE = { px: 60, ms: 320 } as const;

/**
 * The scene (§3.2 layer 1): the room's static backdrop in the agent's hue (never animated; a room change
 * cross-fades it), the floor light, the stage-up glow and the lights-off overlay, both opacity-only and bound to the engine. It
 * also owns pointer input: every sample goes to the engine (on the character it squashes in the same
 * frame; off it, the eyes follow the finger), and the pointer is captured when the engine takes it.
 */
export function Stage({ engine, backdrop, box, children, over, embed, style, onTouch, onSwipe, onBody, reduced = false }: StageProps) {
  const fading = useRoomFade(backdrop, reduced);
  const origin = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const flick = useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  const send = (e: ReactPointerEvent<HTMLDivElement>, kind: PointerSample['kind']) => {
    if (kind === 'down') {
      const r = e.currentTarget.getBoundingClientRect();
      origin.current = { left: r.left, top: r.top };
    }
    const took = engine.pointer({ kind, id: e.pointerId, x: e.clientX - origin.current.left, y: e.clientY - origin.current.top, t: e.timeStamp || performance.now() });
    if (kind === 'down' && took) {
      onBody?.();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    }
    // the engine took it (the character): poke, stroke, drag. Only a pointer it left alone can be a flick.
    if (kind === 'down') flick.current = took ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    const f = flick.current;
    if (kind === 'cancel' || (kind === 'up' && f?.id !== e.pointerId)) flick.current = null;
    if (kind !== 'up' || !f || f.id !== e.pointerId) return;
    flick.current = null;
    const dx = e.clientX - f.x, dy = e.clientY - f.y, dt = performance.now() - f.t;
    if (onSwipe && Math.abs(dx) >= SWIPE.px && Math.abs(dx) >= 2 * Math.abs(dy) && dt <= SWIPE.ms) onSwipe(dx < 0 ? 'left' : 'right');
  };

  const groundY = box.y + box.size * 0.83;
  return (
    <div className="pet-stage" data-embed={embed ? '' : undefined} style={{ backgroundImage: backdrop.image, backgroundColor: backdrop.edge, ...style }}
      onPointerDown={(e) => { onTouch?.(); send(e, 'down'); }}
      onPointerMove={(e) => send(e, 'move')}
      onPointerUp={(e) => send(e, 'up')}
      onPointerCancel={(e) => send(e, 'cancel')}>
      {fading}
      <div className="pet-floor" aria-hidden="true"
        style={{ left: box.x - box.size * 0.35, top: groundY - box.size * 0.22, width: box.size * 1.7, height: box.size * 0.44, backgroundImage: backdrop.floor }} />
      <m.div className="pet-glow" aria-hidden="true"
        style={{ left: box.x - box.size * 0.3, top: box.y - box.size * 0.25, width: box.size * 1.6, height: box.size * 1.4, backgroundImage: backdrop.glow, opacity: engine.glow }} />
      <div className="pet-char" style={{ left: box.x, top: box.y, width: box.size, height: box.size }}>{children}</div>
      <m.div className="pet-night" aria-hidden="true" style={{ opacity: engine.dim }} />
      {over}
    </div>
  );
}
