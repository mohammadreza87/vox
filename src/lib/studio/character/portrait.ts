/**
 * AI portraits locked to the vector look (character §9; server only, never
 * re-exported by the isomorphic barrel). The prompt is built from the same
 * enums and palette the renderer draws with, and the preferred path re-renders
 * the stage-4 vector itself (gpt-image edit with a reference image), so the
 * Telegram portrait and the in-app character are one character.
 */

import type { OpenAIMedia } from '../media';
import type { AccentColor, CharacterLook, CloudFamily, CloudSpecies, HairStyle, Accessory, PersonaSpec } from '../types';
import type { Expression } from './face';
import { normalizeLook } from './look';
import { GROUND_COLOR, INK, PALETTE, TONES, accentColor, derivePalette, hairMaterial } from './palette';
import { characterSvg } from './svg';

const SPECIES_TEXT: Record<CloudSpecies, string> = {
  cloud: 'a pure cloud creature with no animal features at all',
  cat: 'a cloud cat: the only animal cue is two small soft rounded cat ears in the same body colour and material, set on the top of the dome and leaning slightly outward (no nose, no whiskers, no tail)',
  dog: 'a cloud puppy dog: the only animal cue is two soft floppy leaf-shaped ears in a slightly darker tint of the body colour, hanging from under the upper sides of the dome and tipped a little outward, ending above the cheeks (no nose, no muzzle)',
  bunny: 'a cloud bunny: the only animal cue is two short upright oval ears in the body colour with a faint pink inner ear, rising from the top of the dome (no nose)',
  bear: 'a cloud bear: the only animal cue is two small round ear bumps in the body colour on the top of the dome (no nose, no muzzle)',
  owl: 'a cloud owl: two small swept-back feather tufts in the body colour set wide on the dome and a small soft orange beak (the same eyes as every character, no face disc)',
  chick: 'a cloud chick: a tiny two-leaf sprout on the very top of the dome and a small rounded orange beak above a tiny smile',
};

const FAMILY_TEXT: Record<CloudFamily, string> = {
  puff: 'one smooth soft silhouette: a round gumdrop dome rising between two soft rounded shoulder lobes, a small soft saddle where they meet, on a wide, nearly flat base, about a quarter wider than tall (a soft three-lobed cloud bun, not a bumpy cumulus)',
  tower: 'the same smooth cloud silhouette, the same wide base and shoulders, with a slightly taller dome',
  drift: 'the same smooth cloud silhouette with the dome leaning slightly to the left, a full left shoulder and a lower, smaller right shoulder (a gentle asymmetry)',
};

const HAIR_TEXT: Record<Exclude<HairStyle, 'none'>, string> = {
  tuft: 'a tuft: a short soft swoosh of three small rounded curls on the crown, sweeping right',
  fringe: 'a fringe: one soft rounded side-swept swoop lying over the upper left edge of the dome',
  bun: 'a bun: one small round ball peeking up from behind the top of the dome',
  curls: 'curls: three small soft round puffs along the top of the dome',
  spiky: 'spiky hair: three short soft rounded points peeking up from behind the crown',
  pony: 'a ponytail: a thin swept part of hair over the crown gathering at the upper right into one small soft round puff tucked behind the head in the dip above the right shoulder, with a tiny hair tie where they meet',
};

const ACCESSORY_TEXT: Record<Exclude<Accessory, 'none'>, string> = {
  glasses: 'thin round glasses: two slightly tall oval rings in a dark ink tinted toward the body colour, drawn as thin lines around the eyes, with a small arched bridge set high',
  specs: 'thin rounded-rectangle specs drawn as thin lines around the eyes',
  beret: 'a small soft matte beret seated on the crown, following its curve and overhanging slightly to the right, with a tiny stem',
  cap: 'a small soft matte cap on the crown, its lower edge following the head, with a short curved brim to the right',
  beanie: 'a small soft matte beanie on the crown with a folded band and a pompom',
  headphones: 'soft pastel over-ear headphones: a soft band hugging the top of the head right on its outline and two small rounded cups on the sides of the body at eye height',
  headset: 'a soft headset: a band over the top of the head, two small rounded cups on the sides at eye height and a short boom microphone that ends well before the cheek',
  bow: 'a small flat ribbon bow (two rounded triangular loops and a centre knot) on the upper right of the head, well inside the outline',
  scarf: 'a slim soft pastel scarf collar wrapped round the body just under the mouth, curving gently up toward the sides and fading out before the side edges, with a small knot at the front right and one short soft end falling over the right shoulder',
  flower: 'a small flat five-petal flower clip on the upper left of the dome',
  star: 'a small flat rounded star clip on the upper right of the dome',
  bowtie: 'a flat pastel bowtie low on the base of the body, well below the mouth',
};

/** Plain colour words for the named tones (the hex follows, for precision). */
const COLOUR_WORDS: Record<string, string> = { ink: 'navy ink', cream: 'warm cream', volt: 'soft lime', coral: 'soft coral', navy: 'navy', berry: 'muted berry', cocoa: 'cocoa brown' };
/** Filled accessories are drawn in the matte pastel band: their words follow (navy fills are a powder denim, ink a pearl slate). */
const FILL_WORDS: Record<string, string> = { ink: 'soft pearl slate', navy: 'powder denim', berry: 'dusty rose', cocoa: 'milky cocoa' };
const LINE_ACC = new Set(['glasses', 'specs']);
const colourWord = (name: string, hex: string) => `${COLOUR_WORDS[name] ?? (PALETTE[name as keyof typeof PALETTE]?.name.toLowerCase() ?? name)} ${hex}`;

/** An accessory's colour as the renderer paints it: lines keep the true accent, fills the matte pastel tone. */
const accentText = (acc: string, accent: AccentColor) => (LINE_ACC.has(acc) ? colourWord(accent, accentColor(accent))
  : `${FILL_WORDS[accent] ?? COLOUR_WORDS[accent] ?? (PALETTE[accent as keyof typeof PALETTE]?.name.toLowerCase() ?? accent)} ${accentColor(accent, true)}`);

/**
 * Portrait moods, in the order variants use them: consecutive variants differ (character §9: a mood, never a new creature).
 * `beak`: the same mood for owls and chicks, where the vector opens a small mouth just below the beak.
 */
export const PORTRAIT_MOODS: ReadonlyArray<{ expr: Expression; text: string; beak?: string }> = [
  { expr: 'idle', text: 'a gentle small closed-mouth smile' },
  { expr: 'happy', text: 'happy, a small open smile, the eyes softening into happy arches', beak: 'happy, a small open smile just below the beak, the eyes softening into happy arches' },
  { expr: 'listening', text: 'curious and attentive, eyes slightly wide, a tiny calm mouth' },
  { expr: 'idle', text: 'calm and friendly, a soft closed smile' },
];
export const moodFor = (variant: number) => PORTRAIT_MOODS[((Math.floor(variant) % PORTRAIT_MOODS.length) + PORTRAIT_MOODS.length) % PORTRAIT_MOODS.length];

/** Plain-language description of the formed (stage 4) look, from the same enums and palette the renderer uses. */
export function describeLook(input: CharacterLook): string {
  const l = normalizeLook(input);
  const tone = TONES[l.hue], name = PALETTE[l.hue].name;
  const species = l.species!, hair = l.hair!, acc = l.accessory!;
  const beak = species === 'owl' || species === 'chick';
  const hairHex = hairMaterial(l.hairTone!, derivePalette(l.hue, 4)).base;
  const hairColour = l.hairTone === 'deep' ? `a deeper shade of the body colour ${hairHex}` : colourWord(l.hairTone!, hairHex);
  const face = [
    `a tiny quiet face in the middle of the body: two small solid ${INK} navy-ink vertical oval eyes (tall and narrow, about twice as tall as wide, set about a quarter of the body width apart at half the body height), each with one tiny white highlight dot near the top, softly dimmed, no eye whites`,
    beak ? 'a tiny soft amber beak between and just below the eyes, with no mouth at rest (a small open mouth shows just below the beak only when smiling)' : 'a small thin curved smile drawn as one navy-ink line',
    l.features.cheeks && 'soft pink blush ovals on the cheeks, gentle but clearly visible',
    l.features.lashes && 'tiny lash ticks, one at the outer corner of each eye',
    l.features.brows && `short soft brow strokes above the eyes in a pale shade of the body colour ${tone.shadow}`,
  ].filter(Boolean).join(', ');
  return [
    `Species: ${SPECIES_TEXT[species]}. Body: ${FAMILY_TEXT[l.family]}`,
    `Body colour ${name} ${tone.base}: a desaturated pastel, smooth matte soft-touch material with one soft radial light from the upper left, lightening to ${tone.light} on the upper left of the dome and falling smoothly to ${tone.shadow} and ${tone.deep} along the bottom right; no outline, no rim light, no gloss or specular spot, no texture`,
    hair !== 'none' ? `Hair: ${HAIR_TEXT[hair]}, in ${hairColour}, the same matte material, tiny and simple` : 'Hair: none',
    acc !== 'none' ? `Accessory: ${ACCESSORY_TEXT[acc]} in ${accentText(acc, l.accent!)}, flat and minimal; this is the only accessory` : 'Accessory: none',
    `Face: ${face}`,
  ].join('. ') + '.';
}

/**
 * The portrait prompt. With a reference the model re-renders the vector
 * (keeping silhouette, parts and colours); without one the description
 * carries the whole look.
 */
export function avatarPromptV2(persona: PersonaSpec, look: CharacterLook, variant: number, withReference: boolean): string {
  const l = normalizeLook(look), m = moodFor(variant);
  const mood = (l.species === 'owl' || l.species === 'chick') && m.beak ? m.beak : m.text;
  const lead = withReference
    ? 'Re-render the character in the reference image as a soft 3D matte toy portrait. Keep EXACTLY the same silhouette, species features, hair, accessory, colours, face size and placement and framing; only soften the material and the light.'
    : 'A single cute, super minimal cloud character, a soft 3D matte toy portrait.';
  return `${lead}
${describeLook(l)}
Expression: ${mood}. Their work, for mood only (add no props for it): ${persona.role || 'teammate'}.
Style: super minimal and calm, smooth matte soft-touch material, soft diffuse studio light from the upper left, a soft dark contact shadow directly under the flat base, square, a flat dark slate background ${GROUND_COLOR} with no glow, no halo and no vignette. Centred with generous padding, the body about three quarters of the frame width: the photo is cropped to a circle, so the whole character, including ears, hair and any hat, stays well inside the central circle.
Avoid: text, letters, logos, watermarks, extra accessories, extra props, limbs, arms, hands, feet, noses, muzzles, whiskers, teeth, tongues, eye whites, eyelashes beyond the described ticks, outlines, glow, aura, sparkles, rim light, glossy plastic or jelly look, specular highlights, saturated neon colours, bumpy multi-puff cumulus shapes, realistic human features, extra characters, busy or gradient-heavy backgrounds, photorealism, emoji style, robots, religious or national symbols, gendered stereotypes, anything cut off by the frame.`;
}

/** The stage-4 still the edit path re-renders (the Telegram photo: reference ground and circle framing, in the variant's mood). */
export const portraitReferenceSvg = (look: CharacterLook, variant: number) =>
  characterSvg(look, { stage: 4, size: 1024, bg: 'halo', fit: 'circle', expr: moodFor(variant).expr, uid: 'ref' });

/** SVG → square PNG via sharp (lazy, so importing this module never loads native code). Size the SVG at `size` for a crisp raster. */
export async function svgToPng(svg: string, size: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

export interface PortraitDeps {
  openai: Pick<OpenAIMedia, 'editAvatar' | 'generateAvatar'>;
  svgToPng: (svg: string, size: number) => Promise<Buffer>;
  /** 'text' skips the reference edit (the switch if the A/B shows edits drift; PLAN §7). Default 'edit'. */
  prefer?: 'edit' | 'text';
  /** Called with the edit failure before falling back to text (diagnostics only). */
  onFallback?: (error: unknown) => void;
}

/**
 * One portrait of the look: an edit of the stage-4 vector reference, falling
 * back to the text-only prompt when the reference or the edit fails. Throws
 * when the text path fails too (the caller keeps the vector photo).
 */
export async function renderPortrait(deps: PortraitDeps, persona: PersonaSpec, look: CharacterLook, variant: number): Promise<{ image: Buffer; via: 'edit' | 'text' }> {
  if (deps.prefer !== 'text') {
    try {
      const reference = await deps.svgToPng(portraitReferenceSvg(look, variant), 1024);
      return { image: await deps.openai.editAvatar(avatarPromptV2(persona, look, variant, true), reference), via: 'edit' };
    } catch (error) { deps.onFallback?.(error); }
  }
  return { image: await deps.openai.generateAvatar(avatarPromptV2(persona, look, variant, false)), via: 'text' };
}
