import {
  ACCENTS, ACCENT_COLORS, ACCESSORIES, DEFAULT_ACCENT, FAMILY_IDS, HAIR_STYLES, HAIR_TONES, PALETTE, SPECIES,
  accentColor, derivePalette, hairMaterial, isCompatible, normalizeLook, suggestAccessories,
} from '@/lib/studio/character';
import {
  HUES, type Accessory, type AccentColor, type CharacterLook, type CloudFamily, type CloudSpecies, type HairStyle, type HairTone, type Hue, type Stage,
} from '@/lib/studio/types';

/** The editor's categories, in Seg order (interaction §4.2). */
export type LookCategory = 'species' | 'colour' | 'hair' | 'accessory' | 'face';
export const CATEGORIES: ReadonlyArray<{ value: LookCategory; label: string }> = [
  { value: 'species', label: 'Species' }, { value: 'colour', label: 'Colour' }, { value: 'hair', label: 'Hair' },
  { value: 'accessory', label: 'Accessory' }, { value: 'face', label: 'Face' },
];

export type Feature = keyof CharacterLook['features'];

export const SPECIES_LABEL: Record<CloudSpecies, string> = { cloud: 'Cloud', cat: 'Cat', dog: 'Dog', bunny: 'Bunny', bear: 'Bear', owl: 'Owl', chick: 'Chick' };
export const FAMILY_LABEL: Record<CloudFamily, string> = { puff: 'Puff', tower: 'Tower', drift: 'Drift' };
export const HAIR_LABEL: Record<HairStyle, string> = { none: 'None', tuft: 'Tuft', fringe: 'Fringe', bun: 'Bun', curls: 'Curls', spiky: 'Spiky', pony: 'Pony' };
export const ACCESSORY_LABEL: Record<Accessory, string> = {
  none: 'None', glasses: 'Glasses', specs: 'Specs', beret: 'Beret', cap: 'Cap', beanie: 'Beanie', headphones: 'Headphones',
  headset: 'Headset', bow: 'Bow', flower: 'Flower', star: 'Star', bowtie: 'Bow tie',
};
export const FEATURE_LABEL: Record<Feature, string> = { cheeks: 'Cheeks', lashes: 'Lashes', brows: 'Brows' };
const NAMED_TONE: Record<string, string> = { deep: 'Deep', cream: 'Cream', cocoa: 'Cocoa', ink: 'Ink', volt: 'Volt', coral: 'Coral', navy: 'Navy', berry: 'Berry' };
export const toneLabel = (t: HairTone | AccentColor) => NAMED_TONE[t] ?? PALETTE[t as Hue]?.name ?? t;

export { FAMILY_IDS, SPECIES, HAIR_STYLES, ACCESSORIES, HUES };
export const FEATURES: readonly Feature[] = ['cheeks', 'lashes', 'brows'];
export const TONE_OPTIONS: readonly HairTone[] = HAIR_TONES;
export const ACCENT_OPTIONS: readonly AccentColor[] = ACCENT_COLORS;

/** Swatch colour of a hair tone on this body ('deep' follows the hue). */
export const toneSwatch = (tone: HairTone, hue: Hue) => hairMaterial(tone, derivePalette(hue, 4)).base;
export const accentSwatch = (a: AccentColor) => (a in PALETTE ? accentColor(a) : ACCENTS[a]);

/**
 * Stage at which a part first shows (character §7): editing it while the
 * preview sits earlier jumps the scrubber forward, so every change is visible.
 */
export const STAGE_FOR: Record<'species' | 'hair' | 'accessory' | Feature, Stage> = { species: 2, hair: 3, accessory: 4, cheeks: 3, lashes: 3, brows: 3 };

/** Forming copy per stage (interaction §4.5): the scrubber's labels and valuetext. */
export const STAGE_DAY: Record<Stage, number> = { 1: 1, 2: 3, 3: 5, 4: 7 };
export const STAGE_NAME: Record<Stage, string> = { 1: 'Newborn', 2: 'Opens eyes', 3: 'Finds a smile', 4: 'Fully formed' };
export const PART_DAY: Record<Stage, string> = { 1: 'day 1', 2: 'day 2', 3: 'day 4', 4: 'day 6' };

/** Applies a patch the way the server does: a new accessory brings its default accent. */
export function applyPatch(look: CharacterLook, patch: Partial<CharacterLook>): CharacterLook {
  const next = { ...normalizeLook(look), ...patch, features: { ...look.features, ...patch.features } };
  if (patch.accessory !== undefined && patch.accent === undefined) next.accent = DEFAULT_ACCENT[patch.accessory];
  return normalizeLook(next, normalizeLook(look));
}

/** Why `patch` can't apply to `look`, or null when it can. */
export function blockedBy(look: CharacterLook, patch: Partial<CharacterLook>): string | null {
  const r = isCompatible(applyPatch(look, patch));
  return r.ok ? null : r.reason;
}

export const sameLook = (a: CharacterLook, b: CharacterLook) => {
  const x = normalizeLook(a), y = normalizeLook(b);
  return x.hue === y.hue && x.family === y.family && x.species === y.species && x.hair === y.hair && x.hairTone === y.hairTone
    && x.accessory === y.accessory && x.accent === y.accent && FEATURES.every((f) => x.features[f] === y.features[f]);
};

/** Accessories for the rail: the role's suggestions first (character §6), then the rest. */
export function accessoryOrder(role: string): { order: Accessory[]; suggested: ReadonlySet<Accessory> } {
  const suggested: ReadonlySet<Accessory> = new Set<Accessory>(suggestAccessories(role).filter((a) => a !== 'none'));
  return { order: ['none', ...ACCESSORIES.filter((a) => suggested.has(a)), ...ACCESSORIES.filter((a) => a !== 'none' && !suggested.has(a))], suggested };
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/** "a lilac cat with a fringe and a beanie" (the aria-live sentence, interaction §4.5). */
export function describeLook(look: CharacterLook): string {
  const l = normalizeLook(look);
  const hue = PALETTE[l.hue].name.toLowerCase();
  const body = l.species === 'cloud' ? `${FAMILY_LABEL[l.family].toLowerCase()} cloud` : SPECIES_LABEL[l.species!].toLowerCase();
  const parts = [
    l.hair !== 'none' ? `${HAIR_LABEL[l.hair!].toLowerCase()} hair` : '',
    l.accessory !== 'none' ? `${article(ACCESSORY_LABEL[l.accessory!])} ${ACCESSORY_LABEL[l.accessory!].toLowerCase()}` : '',
  ].filter(Boolean);
  return `${article(hue)} ${hue} ${body}${parts.length ? ` with ${parts.join(' and ')}` : ''}`;
}

/** What one change was, for the undo pill ("Undo · Beanie"). */
export function changeLabel(patch: Partial<CharacterLook>, prev: CharacterLook): string {
  if (patch.species) return SPECIES_LABEL[patch.species];
  if (patch.family) return FAMILY_LABEL[patch.family];
  if (patch.hue) return PALETTE[patch.hue].name;
  if (patch.hair) return patch.hair === 'none' ? 'No hair' : HAIR_LABEL[patch.hair];
  if (patch.hairTone) return `${toneLabel(patch.hairTone)} hair`;
  if (patch.accessory) return patch.accessory === 'none' ? `No ${ACCESSORY_LABEL[normalizeLook(prev).accessory!].toLowerCase()}` : ACCESSORY_LABEL[patch.accessory];
  if (patch.accent) return toneLabel(patch.accent);
  const f = patch.features && FEATURES.find((k) => patch.features![k] !== prev.features[k]);
  if (f) return `${patch.features![f] ? '' : 'No '}${FEATURE_LABEL[f].toLowerCase()}`.replace(/^./, (c) => c.toUpperCase());
  return 'Change';
}
