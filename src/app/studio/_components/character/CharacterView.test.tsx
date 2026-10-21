import { render } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { characterModel, characterSvg, eyeD, EYE, GROUND, PRESET_LOOKS, type Expression } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { CharacterView } from './CharacterView';

const rigs = (html: string) => [...html.matchAll(/data-rig="([^"]+)"/g)].map((m) => m[1]);
const partD = (html: string, part: string) => html.match(new RegExp(`<path[^>]*data-part="${part}"[^>]*>`))?.[0].match(/ d="([^"]+)"/)?.[1];

describe('CharacterView', () => {
  it('matches the still: same rig layers and identical eye, mouth and body paths', () => {
    const stages: Stage[] = [1, 2, 3, 4];
    const exprs: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];
    PRESET_LOOKS.forEach((look, i) => {
      const stage = stages[i % 4], expr = exprs[i % 6];
      const live = renderToStaticMarkup(<CharacterView look={look} stage={stage} expr={expr} size={200} lod="hero" label="Agent" />);
      const still = characterSvg(look, { stage, expr, size: 200 });
      expect(rigs(live)).toEqual(rigs(still));
      for (const part of ['eye-l', 'eye-r', 'mouth', 'body']) {
        expect(partD(live, part)).toBeDefined();
        expect(partD(live, part)).toBe(partD(still, part));
      }
      expect(live).not.toContain('<filter');
      expect(live).not.toContain('feGaussianBlur');
    });
  });

  it('is an accessible image with per-instance paint ids', () => {
    const look = PRESET_LOOKS[1];
    const { container, getAllByRole } = render(<>
      <CharacterView look={look} stage={4} expr="idle" size={120} lod="card" label="Mira" />
      <CharacterView look={look} stage={4} expr="happy" size={120} lod="card" label="Mira" />
    </>);
    expect(getAllByRole('img').map((n) => n.getAttribute('aria-label'))).toEqual(['Mira, idle', 'Mira, happy']);
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    // every url(#…) reference resolves inside its own svg
    for (const svg of container.querySelectorAll('svg')) {
      const own = new Set([...svg.querySelectorAll('[id]')].map((n) => n.id));
      for (const ref of svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)) expect(own.has(ref[1])).toBe(true);
    }
  });

  it('uses the small face at icon LOD', () => {
    const look: CharacterLook = { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: true, brows: false } };
    const icon = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={96} lod="icon" label="A" />);
    const hero = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={96} lod="hero" label="A" />);
    expect(partD(icon, 'eye-l')).not.toBe(partD(hero, 'eye-l'));
    expect(icon.length).toBeLessThan(hero.length);
  });

  it('binds rig motion values: morph paths, lids, ears, layers and hue stops', () => {
    const look: CharacterLook = { hue: 'lagoon', family: 'puff', species: 'cat', hair: 'fringe', features: { cheeks: true, lashes: false, brows: false } };
    const eyeLD = motionValue(eyeD(10, 10, EYE.happy));
    const rig = {
      eyeLD, eyeRD: motionValue(eyeD(20, 10, EYE.happy)), mouthD: motionValue('M1 1C1 1 1 1 1 1C1 1 1 1 1 1Z'),
      lids: { scaleY: motionValue(0.5) }, earL: { rotate: motionValue(6) }, earR: { rotate: motionValue(-6) }, tail: { rotate: motionValue(8) },
      layer: { hair: { rotate: motionValue(2) }, body: { scaleY: motionValue(1.02) } },
      stops: { base: motionValue('#ff0000'), light: motionValue('#ffffff'), shadow: motionValue('#000000') },
    };
    const { container } = render(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Cat" rig={rig} />);
    expect(container.querySelector('[data-part="eye-l"]')?.getAttribute('d')).toBe(eyeD(10, 10, EYE.happy));
    expect(container.querySelector('[data-part="mouth"]')?.getAttribute('d')).toBe('M1 1C1 1 1 1 1 1C1 1 1 1 1 1Z');
    const lids = container.querySelector('[data-part="lids"]') as SVGGElement;
    expect(lids.style.transformOrigin).toMatch(/px/);
    expect(lids.style.transform).toContain('scaleY(0.5)');
    const ear = container.querySelector('[data-rig="ear-l"]') as SVGGElement;
    expect(ear.style.transform).toContain('rotate(6deg)');
    expect(ear.style.transformBox).toBe('view-box');
    expect((container.querySelector('[data-rig="hair"]') as SVGGElement).style.transform).toContain('rotate(2deg)');
    // body-material stops follow the tween; other paint servers stay put
    const puff = [...container.querySelectorAll('radialGradient')].find((g) => g.id.endsWith('p0'))!;
    const colors = [...puff.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')!);
    expect(colors.length).toBe(5);
    // light → base → shadow on the tweened (red) tones: green and blue channels stay equal
    for (const c of colors) expect(c.slice(3, 5)).toBe(c.slice(5, 7));
    const shadow = [...container.querySelectorAll('radialGradient')].find((g) => g.id.endsWith('cs'))!;
    expect(shadow.querySelector('stop')?.getAttribute('stop-color')).toBe('#000');
  });

  it("fit='circle' keeps every preset (tall bunny ears included) inside the disc and centred on it", () => {
    // translate(a b) scale(k) translate(-cx -G): y' = b + k (y - G)
    const rootY = (html: string) => {
      const [, b, k] = html.match(/<svg[^>]*><defs>.*?<\/defs><g transform="translate\([-\d.]+ ([-\d.]+)\) scale\(([-\d.]+)\)/)!.map(Number);
      return (y: number) => b + k * (y - GROUND);
    };
    PRESET_LOOKS.forEach((look) => {
      const box = characterModel(look, { uid: 'f', mode: 'live', stage: 4, expr: 'idle', size: 40 }).box;
      const fit = rootY(renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={40} lod="icon" label="A" fit="circle" />));
      const top = fit(box.y0), bottom = fit(GROUND + 6);
      expect(top).toBeGreaterThanOrEqual(-0.5);
      expect(bottom).toBeLessThanOrEqual(200.5);
      expect(Math.abs((top + bottom) / 2 - 100)).toBeLessThan(1);
    });
  });

  it('rigs every pair of ears (and the chick sprout) about its own base, with no limbs', () => {
    for (const species of ['cat', 'dog', 'bunny', 'bear', 'owl', 'chick'] as const) {
      const look: CharacterLook = { hue: 'butter', family: 'puff', species, features: { cheeks: true, lashes: false, brows: false } };
      const rig = { earL: { rotate: motionValue(-12) }, earR: { rotate: motionValue(12) } };
      const { container, unmount } = render(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="A" rig={rig} />);
      const l = container.querySelector('[data-rig="ear-l"]') as SVGGElement, r = container.querySelector('[data-rig="ear-r"]') as SVGGElement;
      expect(l.style.transform).toContain('rotate(-12deg)');
      expect(r.style.transform).toContain('rotate(12deg)');
      expect(l.style.transformOrigin).not.toBe(r.style.transformOrigin);
      expect(container.querySelectorAll('[data-rig^="wing-"], [data-rig="tail"]')).toHaveLength(0);
      unmount();
    }
  });
});
