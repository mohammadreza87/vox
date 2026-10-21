'use client';

import { m } from 'framer-motion';
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
}

/**
 * The scene (§3.2 layer 1): a static radial backdrop in the agent's hue (never animated), the floor
 * light, the stage-up glow and the lights-off overlay, both opacity-only and bound to the engine. It
 * also owns pointer input: every sample goes to the engine (on the character it squashes in the same
 * frame; off it, the eyes follow the finger), and the pointer is captured when the engine takes it.
 */
export function Stage({ engine, backdrop, box, children, over, embed, style, onTouch }: StageProps) {
  const origin = useRef<{ left: number; top: number }>({ left: 0, top: 0 });

  const send = (e: ReactPointerEvent<HTMLDivElement>, kind: PointerSample['kind']) => {
    if (kind === 'down') {
      const r = e.currentTarget.getBoundingClientRect();
      origin.current = { left: r.left, top: r.top };
    }
    const took = engine.pointer({ kind, id: e.pointerId, x: e.clientX - origin.current.left, y: e.clientY - origin.current.top, t: e.timeStamp || performance.now() });
    if (kind === 'down' && took) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    }
  };

  const groundY = box.y + box.size * 0.83;
  return (
    <div className="pet-stage" data-embed={embed ? '' : undefined} style={{ backgroundImage: backdrop.image, backgroundColor: backdrop.edge, ...style }}
      onPointerDown={(e) => { onTouch?.(); send(e, 'down'); }}
      onPointerMove={(e) => send(e, 'move')}
      onPointerUp={(e) => send(e, 'up')}
      onPointerCancel={(e) => send(e, 'cancel')}>
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
