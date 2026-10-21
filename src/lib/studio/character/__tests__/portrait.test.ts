import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIMedia } from '../../media';
import { HUES, type CharacterLook } from '../../types';
import { personaSpec } from '../../__tests__/helpers';
import { ACCESSORIES, GROUND_COLOR, HAIR_STYLES, PALETTE, PRESET_LOOKS, SPECIES, TONES, accentColor } from '..';
import { avatarPromptV2, describeLook, moodFor, portraitReferenceSvg, renderPortrait, svgToPng, type PortraitDeps } from '../portrait';

const base: CharacterLook = { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false }, species: 'cloud', hair: 'none', accessory: 'none' };
const persona = personaSpec({ role: 'Producer', avatarHint: 'a small notebook' });
const segment = (prompt: string, label: string) => prompt.match(new RegExp(`${label}: ([^.]*)\\.`))?.[1] ?? '';

describe('portrait prompt (one vocabulary with the renderer)', () => {
  it('names every species, hair style and accessory it is given', () => {
    for (const species of SPECIES) expect(segment(avatarPromptV2(persona, { ...base, species }, 0, false), 'Species')).toContain(species);
    for (const hair of HAIR_STYLES) expect(segment(avatarPromptV2(persona, { ...base, hair }, 0, false), 'Hair')).toContain(hair);
    for (const accessory of ACCESSORIES) {
      const acc = segment(avatarPromptV2(persona, { ...base, accessory }, 0, false), 'Accessory');
      expect(acc).toContain(accessory);
      // no other accessory sneaks in (bow ⊂ bowtie and cap ⊂ … are whole-word checked)
      for (const other of ACCESSORIES) if (other !== accessory && other !== 'none') expect(acc).not.toMatch(new RegExp(`\\b${other}\\b`));
    }
  });

  it('uses the renderer palette: hue name and body tones, hair and accent colours', () => {
    for (const hue of HUES) {
      const p = describeLook({ ...base, hue });
      expect(p).toContain(`${PALETTE[hue].name} ${TONES[hue].base}`);
      expect(p).toContain(TONES[hue].light);
      expect(p).toContain(TONES[hue].shadow);
    }
    const look: CharacterLook = { ...base, hair: 'curls', hairTone: 'cocoa', accessory: 'bowtie', accent: 'navy' };
    expect(segment(describeLook(look), 'Hair')).toContain('cocoa brown');
    // filled accessories are described in the pastel tone the renderer paints (a navy bowtie is a powder denim)
    expect(segment(describeLook(look), 'Accessory')).toContain(`powder denim ${accentColor('navy', true)}`);
    // glasses keep the true ink line
    expect(segment(describeLook({ ...base, accessory: 'glasses', accent: 'ink' }), 'Accessory')).toContain(`navy ink ${accentColor('ink')}`);
    // the default accent follows the accessory (character §6): a butter star, never lime
    expect(segment(describeLook({ ...base, accessory: 'star' }), 'Accessory')).toContain(`butter ${accentColor('butter', true)}`);
    expect(segment(describeLook({ ...base, hair: 'bun' }), 'Hair')).toContain('a deeper shade of the body colour');
  });

  it('describes the face the vector draws', () => {
    expect(describeLook({ ...base, features: { cheeks: true, lashes: true, brows: true } })).toMatch(/blush[\s\S]*lash ticks[\s\S]*brow strokes/);
    expect(describeLook({ ...base, features: { cheeks: false, lashes: false, brows: false } })).not.toMatch(/blush|lash|brow/);
    for (const species of ['owl', 'chick'] as const) expect(segment(describeLook({ ...base, species }), 'Face')).toContain('beak');
    expect(segment(describeLook({ ...base, species: 'cat' }), 'Face')).toContain('curved smile');
    expect(segment(describeLook(base), 'Face')).toMatch(/small solid #14202C navy-ink vertical oval eyes.*one tiny white highlight.*no eye whites.*curved smile/);
  });

  it('describes the minimal style the vector draws: one silhouette, matte, no glow, gloss or outline', () => {
    const p = describeLook(base);
    expect(segment(p, 'Body')).toMatch(/one smooth soft silhouette.*gumdrop dome.*nearly flat base/);
    expect(p).toMatch(/matte.*no outline, no rim light, no gloss/);
    for (const species of ['cat', 'dog', 'bunny', 'bear'] as const) expect(segment(describeLook({ ...base, species }), 'Species')).toContain('only animal cue');
    const prompt = avatarPromptV2(persona, base, 0, false);
    expect(prompt).toContain(GROUND_COLOR);
    expect(prompt).toMatch(/no glow, no halo and no vignette/);
    expect(prompt).toMatch(/Avoid:.*outlines, glow, aura/);
    for (const species of ['owl', 'chick'] as const) {
      const face = segment(describeLook({ ...base, species }), 'Face');
      expect(face).toContain('only when smiling');
      expect(avatarPromptV2(persona, { ...base, species }, 1, true)).toContain('Expression: happy, a small open smile just below the beak');
    }
    expect(avatarPromptV2(persona, base, 1, true)).toContain(`Expression: ${moodFor(1).text}.`);
  });

  it('normalises legacy looks to a plain cloud', () => {
    const legacy = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } } as CharacterLook;
    const p = describeLook(legacy);
    expect(p).toContain('pure cloud creature');
    expect(p).toContain('Hair: none');
    expect(p).toContain('Accessory: none');
    expect(p).toContain('dome leaning slightly to the left');
  });

  it('locks the edit to the reference, keeps the role for mood only, and never uses free-text hints', () => {
    const withRef = avatarPromptV2(persona, base, 0, true), text = avatarPromptV2(persona, base, 0, false);
    expect(withRef).toMatch(/^Re-render the character in the reference image[\s\S]*Keep EXACTLY the same silhouette/);
    expect(text).toMatch(/^A single cute, super minimal cloud character/);
    for (const p of [withRef, text]) {
      expect(p).toContain('Producer');
      expect(p).not.toContain('notebook');
      expect(p).toContain('cropped to a circle');
      expect(p).toMatch(/Avoid:.*extra accessories.*glossy plastic or jelly look.*religious or national symbols/);
    }
  });

  it('varies the mood between consecutive variants, never the creature', () => {
    expect(moodFor(0).text).not.toBe(moodFor(1).text);
    expect(moodFor(0).expr).toBe('idle');
    expect(moodFor(1).expr).toBe('happy');
    expect(moodFor(-1)).toBe(moodFor(3));
    const strip = (p: string) => p.replace(/Expression: [^.]*\./, '');
    expect(strip(avatarPromptV2(persona, base, 0, true))).toBe(strip(avatarPromptV2(persona, base, 1, true)));
  });
});

describe('portrait reference', () => {
  it('is the stage-4 still on the reference ground with the circle fit, in the variant mood', () => {
    const look = PRESET_LOOKS[0];
    const svg = portraitReferenceSvg(look, 0);
    expect(svg).toMatch(/^<svg[^>]*width="1024" height="1024"/);
    expect(svg).toContain(`fill="${GROUND_COLOR}"`);
    expect(svg).not.toMatch(/bgh|<filter/);
    expect(svg).toMatch(/data-rig="acc-(rigid|soft)"/); // the accessory appears at stage 4
    expect(portraitReferenceSvg(look, 1)).not.toBe(svg);
  });

  it('rasterises to a square 1024 PNG with sharp', async () => {
    const png = await svgToPng(portraitReferenceSvg(PRESET_LOOKS[3], 0), 1024);
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 1024, height: 1024 });
  });
});

function deps(o: Partial<{ edit: () => Promise<Buffer>; text: () => Promise<Buffer>; png: () => Promise<Buffer> }> = {}, extra: Partial<PortraitDeps> = {}) {
  const editAvatar = vi.fn(o.edit ?? (async () => Buffer.from('EDIT')));
  const generateAvatar = vi.fn(o.text ?? (async () => Buffer.from('TEXT')));
  const toPng = vi.fn(o.png ?? (async () => Buffer.from('PNG')));
  return { editAvatar, generateAvatar, toPng, deps: { openai: { editAvatar, generateAvatar }, svgToPng: toPng, ...extra } satisfies PortraitDeps };
}

describe('renderPortrait', () => {
  const look = PRESET_LOOKS[2];

  it('re-renders the 1024 vector reference first', async () => {
    const d = deps();
    expect(await renderPortrait(d.deps, persona, look, 1)).toEqual({ image: Buffer.from('EDIT'), via: 'edit' });
    expect(d.toPng).toHaveBeenCalledWith(portraitReferenceSvg(look, 1), 1024);
    expect(d.editAvatar).toHaveBeenCalledWith(avatarPromptV2(persona, look, 1, true), Buffer.from('PNG'));
    expect(d.generateAvatar).not.toHaveBeenCalled();
  });

  it('falls back to the text prompt when the edit fails, and reports why', async () => {
    const onFallback = vi.fn();
    const d = deps({ edit: async () => { throw new Error('moderation'); } }, { onFallback });
    expect(await renderPortrait(d.deps, persona, look, 0)).toEqual({ image: Buffer.from('TEXT'), via: 'text' });
    expect(d.generateAvatar).toHaveBeenCalledWith(avatarPromptV2(persona, look, 0, false));
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ message: 'moderation' }));
  });

  it('falls back to text when the reference cannot be rasterised', async () => {
    const d = deps({ png: async () => { throw new Error('sharp missing'); } });
    expect((await renderPortrait(d.deps, persona, look, 0)).via).toBe('text');
    expect(d.editAvatar).not.toHaveBeenCalled();
  });

  it('can be switched to text-first without touching the edit endpoint', async () => {
    const d = deps({}, { prefer: 'text' });
    expect((await renderPortrait(d.deps, persona, look, 0)).via).toBe('text');
    expect(d.toPng).not.toHaveBeenCalled();
    expect(d.editAvatar).not.toHaveBeenCalled();
  });

  it('throws when the text fallback fails too (the vector photo stays)', async () => {
    const d = deps({ edit: async () => { throw new Error('edit down'); }, text: async () => { throw new Error('OpenAI image generation failed: HTTP 500'); } });
    await expect(renderPortrait(d.deps, persona, look, 0)).rejects.toThrow('HTTP 500');
  });

  it('falls back end to end over HTTP: refused edit → generations', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const edit = url.endsWith('/images/edits');
      return {
        ok: !edit, status: edit ? 400 : 200,
        json: async () => (edit ? { error: { message: 'input_fidelity is not supported' } } : { data: [{ b64_json: Buffer.from('JPEG').toString('base64') }] }),
      } as unknown as Response;
    });
    const openai = new OpenAIMedia('sk-test', fetchFn as unknown as typeof fetch, 'gpt-image-1', 'stt');
    const out = await renderPortrait({ openai, svgToPng: async () => Buffer.from('PNG') }, persona, look, 0);
    expect(out).toEqual({ image: Buffer.from('JPEG'), via: 'text' });
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual(['https://api.openai.com/v1/images/edits', 'https://api.openai.com/v1/images/generations']);
    expect(JSON.parse((fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).prompt).toBe(avatarPromptV2(persona, look, 0, false));
  });
});
