import { render } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRESET_LOOKS } from '@/lib/studio/character';
import { CharacterView } from './CharacterView';

// the pet rig's additive bindings: brows as a morph path, per-eye paint, the glint and the cheek puff
describe('CharacterView pet bindings', () => {
  const look = PRESET_LOOKS.find((l) => l.features?.brows && l.features?.cheeks)!;

  it('binds the brows path, per-eye paint, the glint and the cheeks when given', () => {
    const browsD = motionValue('M60 70Q64 66 68 70M132 70Q136 66 140 70');
    const sw = motionValue(1.7), glint = motionValue(0.3), cheek = motionValue(1.12);
    const { container } = render(
      <CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet"
        rig={{ browsD, eyeLD: motionValue('M79 98C79 87 87 87 87 98C87 109 79 109 79 98Z'), eyeStyle: { l: { strokeWidth: sw }, r: { strokeWidth: sw } }, glint: { opacity: glint }, cheeks: { scale: cheek } }} />,
    );
    expect(container.querySelector('[data-part="brows"]')?.getAttribute('d')).toBe(browsD.get());
    const eye = container.querySelector('[data-part="eye-l"]') as SVGElement;
    // a morphing eye takes its paint from the binding (framer writes SVG paint as attributes)
    expect(eye.getAttribute('stroke-width')).toBe('1.7');
    const glintPath = [...container.querySelectorAll('[data-part="lids"] path')].find((p) => !p.getAttribute('data-part')) as SVGElement;
    expect(glintPath.getAttribute('opacity') === '0.3' || glintPath.style.opacity === '0.3').toBe(true);
    const cheekEl = [...container.querySelectorAll('ellipse')].find((e) => e.getAttribute('fill')?.endsWith('bl)')) as SVGElement;
    expect(cheekEl.style.transform).toContain('scale(1.12)');
  });

  it('renders exactly as before when the pet bindings are not given', () => {
    const plain = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet" />);
    const lids = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet" rig={{ lids: { scaleY: motionValue(1) } }} />);
    // the brows keep the model's own path; eyes, glint and cheeks carry no style
    expect(lids.match(/data-part="brows"[^>]*d="([^"]+)"/)?.[1] ?? lids.match(/d="([^"]+)"[^>]*data-part="brows"/)?.[1])
      .toBe(plain.match(/data-part="brows"[^>]*d="([^"]+)"/)?.[1] ?? plain.match(/d="([^"]+)"[^>]*data-part="brows"/)?.[1]);
    expect(plain).not.toContain('stroke-width:');
  });

  it('draws the tongue, sparkles and dizzy swirls only when their bindings are given', () => {
    const plain = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet" />);
    const rigged = renderToStaticMarkup(<CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet" rig={{ mouthD: motionValue('M92 125C96 120 104 120 108 125C104 140 96 140 92 125Z') }} />);
    for (const html of [plain, rigged]) for (const part of ['tongue', 'sparkle', 'swirl']) expect(html).not.toContain(`data-part="${part}"`);
    const { container } = render(
      <CharacterView look={look} stage={4} expr="idle" size={200} lod="hero" label="Pet"
        rig={{ mouthD: motionValue('M92 125C96 120 104 120 108 125C104 140 96 140 92 125Z'), tongue: { opacity: motionValue(1) }, sparkle: { opacity: motionValue(0.8) }, swirl: { opacity: motionValue(0), rotate: motionValue(90) } }} />,
    );
    expect(container.querySelector('[data-part="tongue"] clipPath path')?.getAttribute('d')).toContain('M92 125');
    // the eye marks live inside the lids group, so a blink closes them too
    expect(container.querySelector('[data-part="lids"] [data-part="sparkle"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-part="lids"] [data-part="swirl"]').length).toBe(2);
  });
});
