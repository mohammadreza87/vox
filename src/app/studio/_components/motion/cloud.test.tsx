import { act, cleanup, render, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { characterSvg, eyeD, EYE, PRESET_LOOKS, type Expression } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import { setMediaQueries } from '@/test/browser';
import { AgentFace, Cloud, type CloudMoment } from '../Cloud';
import { TierProvider } from './tier';
import { MAX_HERO_RIGS } from '../character/rig';

const LOOK: CharacterLook = { hue: 'lagoon', family: 'puff', species: 'cat', hair: 'fringe', accessory: 'glasses', features: { cheeks: true, lashes: false, brows: false } };
/** framer's frame loop runs on real animation frames: let a few pass */
const flush = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

// No fake timers here: framer's frame loop runs on jsdom's animation frames, and faking them mid-file stalls it.
afterEach(() => { cleanup(); });

describe('Cloud rig', () => {
  it('renders the live character in an HTML wrapper with no aura and no SVG filters (a surface may opt in to a glow)', () => {
    const { container } = render(<Cloud look={LOOK} size={180} label="Mira" />);
    const char = container.querySelector('.vx-char') as HTMLElement;
    expect(char).toBeTruthy();
    expect(char.dataset.lod).toBe('hero');
    expect(char.querySelector('.vx-char-aura')).toBeNull();
    expect(char.querySelector('.vx-char-breathe svg')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/<filter|feGaussianBlur|blur\(/);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Mira, idle');
    const { container: glowing } = render(<Cloud look={LOOK} size={180} label="Mira" glow={0.4} />);
    expect(glowing.querySelector('.vx-char-aura')).toBeTruthy();
  });

  it('drives the face through morph paths at hero LOD and only the lids on cards', () => {
    const { container } = render(<><Cloud look={LOOK} size={180} /><Cloud look={LOOK} size={100} /></>);
    const [hero, card] = [...container.querySelectorAll('.vx-char')] as HTMLElement[];
    expect(hero.dataset.lod).toBe('hero');
    expect(card.dataset.lod).toBe('card');
    expect((hero.querySelector('[data-part="lids"]') as SVGGElement).style.transform).toMatch(/none|scaleY\(1\)|^$/);
    expect((hero.querySelector('[data-rig="face"]') as SVGGElement).style.transformOrigin).toMatch(/px/);
    expect((card.querySelector('[data-rig="face"]') as SVGGElement).getAttribute('style')).toBeNull();
    // the hero eye path comes from the rig's motion value and matches the model's idle eye
    const d = hero.querySelector('[data-part="eye-l"]')!.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toBe(card.querySelector('[data-part="eye-l"]')!.getAttribute('d'));
  });

  it('runs at most two hero rigs; the rest fall back to card LOD', async () => {
    const { container } = render(<>{Array.from({ length: MAX_HERO_RIGS + 1 }, (_, i) => <Cloud key={i} look={PRESET_LOOKS[i]} size={160} />)}</>);
    await flush();
    const lods = [...container.querySelectorAll('.vx-char')].map((n) => (n as HTMLElement).dataset.lod);
    expect(lods.filter((l) => l === 'hero')).toHaveLength(MAX_HERO_RIGS);
    expect(lods.filter((l) => l === 'card')).toHaveLength(1);
  });

  it('is a still face under reduced motion: no loop classes or attributes anywhere', () => {
    setMediaQueries({ '(prefers-reduced-motion: reduce)': true });
    const { container } = render(<><Cloud look={LOOK} size={180} expr="speaking" /><Cloud look={LOOK} size={100} /><Cloud look={LOOK} size={40} /></>);
    for (const el of container.querySelectorAll('*')) {
      expect(el.className.toString()).not.toMatch(/vx-(breathe|blink|talk|hop|glow|orbit|rise)\b/);
    }
    for (const c of container.querySelectorAll('.vx-char')) {
      expect(c.hasAttribute('data-loop')).toBe(false);
      expect(c.hasAttribute('data-sway')).toBe(false);
      expect(c.hasAttribute('data-pulse')).toBe(false);
    }
  });

  it('honours a lab tier override: lite keeps the breathe but drops sway and the aura pulse', () => {
    const { container } = render(<TierProvider value="lite"><Cloud look={LOOK} size={180} /></TierProvider>);
    const c = container.querySelector('.vx-char') as HTMLElement;
    expect(c.hasAttribute('data-loop')).toBe(true);
    expect(c.hasAttribute('data-sway')).toBe(false);
    expect(c.hasAttribute('data-pulse')).toBe(false);
  });

  it('renders the disc variant at 86 % on a hue disc, and `still` without any rig', () => {
    const { container } = render(<><Cloud look={LOOK} size={50} variant="disc" /><Cloud look={LOOK} size={32} still /></>);
    const disc = container.querySelector('.vx-avatar.disc') as HTMLElement;
    expect(disc.style.width).toBe('50px');
    expect(disc.querySelector('.vx-char')?.getAttribute('style')).toContain('width: 43px');
    const svgs = container.querySelectorAll('svg');
    expect(svgs[1].closest('.vx-char')).toBeNull();
    // the disc clips to a circle, so its character is circle-fitted (the free one is not)
    const root = (svg: Element) => svg.querySelector(':scope > g')?.getAttribute('transform');
    const { container: free } = render(<Cloud look={LOOK} size={43} />);
    expect(root(svgs[0])).not.toBe(root(free.querySelector('svg')!));
    const { container: still } = render(<Cloud look={LOOK} size={50} variant="disc" still />);
    expect(root(still.querySelector('svg')!)).toBe(root(svgs[0]));
  });

  it('AgentFace is always the vector character, even with a generated avatar', () => {
    const { container } = render(<AgentFace look={{ ...LOOK, avatar: 'a.jpg' } as CharacterLook} size={104} label="Mira" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[role="img"]')).toBeTruthy();
  });

  it('wraps a hero face in its shared-element frame', () => {
    const { container } = render(<Cloud look={LOOK} size={168} heroId="a1" />);
    expect(container.querySelector('[data-hero="face-a1"]')).toBeTruthy();
  });

  it('happy is a one-shot: it settles back to idle after the content hold', async () => {
    const { container } = render(<Cloud look={LOOK} size={180} expr="happy" />);
    expect(container.querySelector('.vx-char')?.getAttribute('data-expr')).toBe('happy');
    await waitFor(() => expect(container.querySelector('.vx-char')?.getAttribute('data-expr')).toBe('idle'), { timeout: 3000 });
  });

  it('plays a gesture moment and reports its end once', async () => {
    const onEnd = vi.fn();
    const moment: CloudMoment = { kind: 'hop', key: 1 };
    render(<Cloud look={LOOK} size={180} moment={moment} onMomentEnd={onEnd} />);
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    await flush(200);
    expect(onEnd).toHaveBeenCalledWith('hop');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('starts a stage-up at the old stage (never a frame at the new one) and lands on the new stage', async () => {
    const onEnd = vi.fn();
    const { container } = render(<Cloud look={LOOK} size={180} stage={3} moment={{ kind: 'evolve', key: 'a:3', fromStage: 2 }} onMomentEnd={onEnd} />);
    const char = () => container.querySelector('.vx-char') as HTMLElement;
    expect(char().dataset.stage).toBe('2');
    await waitFor(() => expect(onEnd).toHaveBeenCalledWith('evolve'), { timeout: 5000 });
    expect(char().dataset.stage).toBe('3');
  });

  it('retire holds its ash, sleeping end pose while the moment stays', async () => {
    const onEnd = vi.fn();
    const { container } = render(<Cloud look={LOOK} size={150} moment={{ kind: 'retire', key: 'x' }} onMomentEnd={onEnd} />);
    await waitFor(() => expect(onEnd).toHaveBeenCalledWith('retire'), { timeout: 5000 });
    await flush();
    expect(container.querySelector('.vx-char')?.getAttribute('data-expr')).toBe('sleeping');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('sleeping');
  });

  it('follows the level while speaking without re-rendering React', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const level = motionValue(0);
    const { container } = render(<Cloud look={LOOK} size={200} expr="speaking" level={level} />);
    await flush();
    const mouth = () => container.querySelector('[data-part="mouth"]')!.getAttribute('d');
    const closed = mouth();
    level.set(0.9);
    const t0 = performance.now();
    act(() => { for (let i = 1; i <= 20; i++) frames.shift()?.(t0 + i * 16.7); });
    await flush();
    expect(mouth()).not.toBe(closed);
    vi.unstubAllGlobals();
  });

  it('at rest, the rigged hero face is the still face: same eye and mouth paths for every preset and expression', async () => {
    const partD = (html: string, part: string) => html.match(new RegExp(`<path[^>]*data-part="${part}"[^>]*>`))?.[0].match(/ d="([^"]+)"/)?.[1];
    const exprs: Expression[] = ['idle', 'listening', 'thinking', 'happy', 'sleeping'];
    for (const [i, look] of PRESET_LOOKS.entries()) {
      const expr = exprs[i % exprs.length];
      const { container, unmount } = render(<TierProvider value="reduced"><Cloud look={look} size={200} expr={expr} /></TierProvider>);
      await flush(0);
      const live = container.innerHTML, still = characterSvg(look, { expr, size: 200 });
      expect(container.querySelector('.vx-char')?.getAttribute('data-lod')).toBe('hero');
      for (const part of ['eye-l', 'eye-r', 'mouth']) expect([look.species, expr, part, partD(live, part)]).toEqual([look.species, expr, part, partD(still, part)]);
      unmount();
    }
  });

  it('keeps every eye path morphable (one command structure per expression)', () => {
    const shape = (d: string) => d.replace(/[^MCZ]/g, '');
    expect(shape(eyeD(80, 110, EYE.happy))).toBe(shape(eyeD(80, 110, EYE.idle)));
  });
});
