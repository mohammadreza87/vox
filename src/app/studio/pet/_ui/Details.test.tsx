import { act, render } from '@testing-library/react';
import { domMin, LazyMotion } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { MotionCue } from '../_engine/types';
import type { PetEngine } from './contract';
import Details from './Details';

function engine() {
  const on = new Set<(c: MotionCue) => void>();
  const e = { rig: {}, onMotion: vi.fn((fn: (c: MotionCue) => void) => { on.add(fn); return () => { on.delete(fn); }; }) } as unknown as PetEngine;
  return { e, cue: (c: MotionCue) => act(() => { for (const f of on) f(c); }) };
}

describe('growth details on the character (lazy Details overlay)', () => {
  it('draws nothing until the engine says what this stage wears; then the body parts, and the floor keepsakes apart', () => {
    const { e, cue } = engine();
    const look = PRESET_LOOKS[0];
    const { container } = render(<LazyMotion features={domMin}>
      <Details engine={e} look={look} stage={4} size={200} part="body" />
      <Details engine={e} look={look} stage={4} size={200} part="floor" />
    </LazyMotion>);
    expect(container.querySelector('svg')).toBeNull();
    cue({ type: 'details', details: { glint: true, pin: true, charm: false, keepsakes: ['play'], seasonal: null } });
    const svgs = container.querySelectorAll('svg.pet-details');
    expect(svgs).toHaveLength(2);
    expect(svgs[0].querySelector('[data-detail="glint"]')).toBeTruthy();
    expect(svgs[0].querySelector('[data-detail="pin"]')).toBeTruthy();
    expect(svgs[1].querySelector('[data-detail="keepsake:play"]')).toBeTruthy();
    expect(svgs[0].querySelector('[data-detail="keepsake:play"]')).toBeNull();
  });

  it('the lit one fades in on the litPeak cue (its group gets the fade class); one this stage cannot wear does not', () => {
    const { e, cue } = engine();
    const { container } = render(<LazyMotion features={domMin}><Details engine={e} look={PRESET_LOOKS[0]} stage={4} size={200} part="floor" /></LazyMotion>);
    cue({ type: 'details', details: { glint: false, pin: false, charm: false, keepsakes: ['play', 'book'], seasonal: null } });
    cue({ type: 'litPeak', detail: 'keepsake', id: 'book', shown: true });
    expect(container.querySelector('[data-detail="keepsake:book"]')).toHaveClass('pet-detail-in');
    expect(container.querySelector('[data-detail="keepsake:play"]')).not.toHaveClass('pet-detail-in');
    cue({ type: 'litPeak', detail: 'pin', shown: false });
    expect(container.querySelector('.pet-detail-in')).toBeTruthy();
  });

  it('the closet overlay (§4.3) from the engine\'s wearing cue: keepsakes drawn in the body overlay, the fresh one fading in; the floor never', () => {
    const { e, cue } = engine();
    const look = PRESET_LOOKS[0];
    const { container } = render(<LazyMotion features={domMin}>
      <Details engine={e} look={look} stage={4} size={200} part="body" />
      <Details engine={e} look={look} stage={4} size={200} part="floor" />
    </LazyMotion>);
    cue({ type: 'wearing', wearing: { head: 'pomegranateCrown', neck: 'sparkScarf', hand: null }, fresh: 'neck:sparkScarf' });
    const svgs = container.querySelectorAll('svg.pet-details');
    expect(svgs).toHaveLength(1);
    expect(svgs[0].querySelector('[data-wear="head:pomegranateCrown"]')).toBeTruthy();
    expect(svgs[0].querySelector('[data-wear="neck:sparkScarf"]')).toHaveClass('pet-detail-in');
    expect(svgs[0].querySelector('[data-wear="head:pomegranateCrown"]')).not.toHaveClass('pet-detail-in');
    cue({ type: 'wearing', wearing: { head: null, neck: null, hand: null } });
    expect(container.querySelector('svg.pet-details')).toBeNull();
  });
});
