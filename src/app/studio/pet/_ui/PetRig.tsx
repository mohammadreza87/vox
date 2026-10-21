'use client';

import { m } from 'framer-motion';
import { memo, useLayoutEffect, useRef } from 'react';
import { CharacterView } from '../../_components/character/CharacterView';
import { BREATH_VARS } from '../_engine/breath';
import type { PetRigProps } from './contract';

type Loop = 'breathe' | 'sway';
const PERIOD_VAR: Record<Loop, string> = { breathe: BREATH_VARS.period, sway: BREATH_VARS.swayPeriod };
const FALLBACK: Record<Loop, number> = { breathe: 4.2, sway: 8 };

/**
 * Breath and sway periods, latched at a cycle boundary. The engine eases the depth and sway (vars on the
 * wrapper, read live by the keyframes), but a new period written straight into animation-duration would
 * jump the phase mid-breath. So the running loop keeps its period until its cycle ends (scale back at 1,
 * sway at its turn, both at rest) and only then restarts on the new one, under the twin keyframe name.
 */
function useLatchedLoops(el: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const period = (k: Loop) => {
      const v = parseFloat(getComputedStyle(node).getPropertyValue(PERIOD_VAR[k]));
      return Number.isFinite(v) && v > 0 ? v : FALLBACK[k];
    };
    const now: Record<Loop, { s: number; twin: boolean }> = { breathe: { s: period('breathe'), twin: false }, sway: { s: period('sway'), twin: false } };
    const write = () => {
      node.style.animationName = `petBreathe${now.breathe.twin ? '2' : ''}, petSway${now.sway.twin ? '2' : ''}`;
      node.style.animationDuration = `${now.breathe.s}s, ${now.sway.s}s`;
    };
    write();
    const onIteration = (e: AnimationEvent) => {
      if (e.target !== node) return;
      const k: Loop = e.animationName.startsWith('petSway') ? 'sway' : 'breathe';
      const s = period(k);
      if (Math.abs(s - now[k].s) < 0.02) return;
      now[k] = { s, twin: !now[k].twin };
      write();
    };
    node.addEventListener('animationiteration', onIteration);
    return () => node.removeEventListener('animationiteration', onIteration);
  }, [el]);
}

/**
 * The character (§3.2 layer 2): one `will-change: transform` wrapper the engine moves as a whole
 * (x, y, squash, rotation about the ground point), a CSS breathe-and-sway layer for the idle loop (the
 * rAF loop can sleep at rest; the engine only writes its depth, sway and period vars), and
 * CharacterView bound to the engine's RigBindings for part motion. Memoised: it renders again only when
 * the look, stage, size or structural expression changes, never per frame. Pointer input is taken by
 * the Stage, which also tracks fingers off the character.
 */
export const PetRig = memo(function PetRig({ engine, look, stage, size, label, expr }: PetRigProps) {
  const breathe = useRef<HTMLDivElement>(null);
  useLatchedLoops(breathe);
  return (
    <m.div className="pet-body" data-expr={expr} style={{ width: size, height: size, ...engine.body }}>
      <div className="pet-breathe" ref={breathe}>
        <CharacterView look={look} stage={stage} expr={expr} size={size} lod="hero" label={label} rig={engine.rig} />
      </div>
    </m.div>
  );
});
