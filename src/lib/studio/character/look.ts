/**
 * Look normalisation, identity and validation. Every v2 field is optional on
 * stored looks; these helpers give one normalised view of any look.
 */

import { HUES, type Accessory, type AccentColor, type CharacterLook, type CloudFamily, type CloudSpecies, type HairStyle, type HairTone, type Hue } from '../types';

export const FAMILY_IDS: readonly CloudFamily[] = ['puff', 'tower', 'drift'];
export const SPECIES: readonly CloudSpecies[] = ['cloud', 'cat', 'dog', 'bunny', 'bear', 'owl', 'chick'];
export const HAIR_STYLES: readonly HairStyle[] = ['none', 'tuft', 'fringe', 'bun', 'curls', 'spiky', 'pony'];
export const HAIR_TONES: readonly HairTone[] = ['deep', 'cream', 'cocoa', 'ink', ...HUES];
export const ACCESSORIES: readonly Accessory[] = ['none', 'glasses', 'specs', 'beret', 'cap', 'beanie', 'headphones', 'headset', 'bow', 'scarf', 'flower', 'star', 'bowtie'];
export const ACCENT_COLORS: readonly AccentColor[] = ['ink', 'cream', 'volt', 'coral', 'navy', 'berry', 'cocoa', ...HUES];

/**
 * Default accent per accessory (character §6). Filled pieces default to a pastel (never navy or ink: those are
 * for the glasses' lines only); the renderer still swaps a clip's colour that would vanish on the body.
 */
export const DEFAULT_ACCENT: Record<Accessory, AccentColor> = {
  none: 'ink', glasses: 'ink', specs: 'ink', beret: 'berry', cap: 'sky', beanie: 'coral', headphones: 'sky',
  headset: 'lilac', bow: 'coral', scarf: 'sky', flower: 'rose', star: 'butter', bowtie: 'coral',
};

const DEFAULT_LOOK: CharacterLook = { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: false, brows: false } };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T extends string>(list: readonly T[], v: unknown, fb: T): T => (list as readonly unknown[]).includes(v) ? v as T : fb;

/** Fills defaults and drops invalid values; legacy {hue, family, features} becomes a plain cloud. */
export function normalizeLook(raw: unknown, fallback: CharacterLook = DEFAULT_LOOK): CharacterLook {
  const r = isObj(raw) ? raw : {};
  const f = isObj(r.features) ? r.features : {};
  const fbf = fallback.features;
  const accessory = pick(ACCESSORIES, r.accessory, fallback.accessory ?? 'none');
  return {
    hue: pick<Hue>(HUES, r.hue, fallback.hue),
    family: pick(FAMILY_IDS, r.family, fallback.family),
    features: {
      cheeks: typeof f.cheeks === 'boolean' ? f.cheeks : fbf.cheeks,
      lashes: typeof f.lashes === 'boolean' ? f.lashes : fbf.lashes,
      brows: typeof f.brows === 'boolean' ? f.brows : fbf.brows,
    },
    species: pick(SPECIES, r.species, fallback.species ?? 'cloud'),
    hair: pick(HAIR_STYLES, r.hair, fallback.hair ?? 'none'),
    hairTone: pick(HAIR_TONES, r.hairTone, fallback.hairTone ?? 'deep'),
    accessory,
    accent: pick(ACCENT_COLORS, r.accent, DEFAULT_ACCENT[accessory]),
  };
}

/** FNV-1a 32-bit: isomorphic, stable across runtimes. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

/** Stable short key of the normalised look (photo fields never count). */
export function lookKey(look: CharacterLook): string {
  const l = normalizeLook(look);
  const f = l.features;
  return hash([l.hue, l.family, `${+f.cheeks}${+f.lashes}${+f.brows}`, l.species, l.hair, l.hairTone, l.accessory, l.accent].join('|'));
}

const HATS: ReadonlySet<Accessory> = new Set(['beret', 'cap', 'beanie']);

/**
 * Compatibility rules (character §6, STYLE §5.5): combinations whose parts
 * collide on the one silhouette are refused, with the field to change.
 */
export function isCompatible(look: CharacterLook): { ok: true } | { ok: false; field: keyof CharacterLook; reason: string } {
  const l = normalizeLook(look);
  if (HATS.has(l.accessory!) && ['tuft', 'bun', 'spiky'].includes(l.hair!)) return { ok: false, field: 'accessory', reason: 'Hats sit flat, so they can’t go over this hairstyle.' };
  if (HATS.has(l.accessory!) && l.hair === 'curls') return { ok: false, field: 'accessory', reason: 'Curls sit right where the hat goes.' };
  if (l.species === 'chick' && l.hair !== 'none') return { ok: false, field: 'hair', reason: 'A chick’s sprout is its hair.' };
  if (l.species === 'owl' && !['none', 'fringe'].includes(l.hair!)) return { ok: false, field: 'hair', reason: 'Owls only wear a fringe.' };
  if (l.species === 'bunny' && HATS.has(l.accessory!)) return { ok: false, field: 'accessory', reason: 'Bunny ears would poke through.' };
  if (l.species === 'bunny' && l.hair === 'spiky') return { ok: false, field: 'hair', reason: 'Spikes clash with bunny ears.' };
  if (l.species === 'bunny' && (l.hair === 'bun' || l.hair === 'curls')) return { ok: false, field: 'hair', reason: 'Bunny ears sit right where this hair goes.' };
  if (l.species === 'dog' && (l.accessory === 'headphones' || l.accessory === 'headset')) return { ok: false, field: 'accessory', reason: 'The ear cups would sit on the floppy ears.' };
  return { ok: true };
}

const PATCH_FIELDS: ReadonlyArray<[keyof CharacterLook, readonly string[], string]> = [
  ['hue', HUES, 'Unknown colour'], ['family', FAMILY_IDS, 'Unknown shape'], ['species', SPECIES, 'Unknown species'],
  ['hair', HAIR_STYLES, 'Unknown hairstyle'], ['hairTone', HAIR_TONES, 'Unknown hair colour'],
  ['accessory', ACCESSORIES, 'Unknown accessory'], ['accent', ACCENT_COLORS, 'Unknown accent colour'],
];

/** Validates a client look patch against the current look. Photo fields are never taken from a patch. */
export function parseLookPatch(patch: unknown, current: CharacterLook): { ok: true; look: CharacterLook } | { ok: false; error: string } {
  if (!isObj(patch)) return { ok: false, error: 'Look must be an object' };
  for (const [key, list, error] of PATCH_FIELDS) {
    if (patch[key] !== undefined && !list.includes(patch[key] as string)) return { ok: false, error };
  }
  const base = normalizeLook(current);
  const features = { ...base.features };
  if (patch.features !== undefined) {
    if (!isObj(patch.features)) return { ok: false, error: 'Unknown features' };
    if (Object.values(patch.features).some((v) => typeof v !== 'boolean')) return { ok: false, error: 'Face features can only be on or off.' };
    for (const k of ['cheeks', 'lashes', 'brows'] as const) if (typeof patch.features[k] === 'boolean') features[k] = patch.features[k];
  }
  const picked = Object.fromEntries(PATCH_FIELDS.map(([k]) => [k, patch[k]]).filter(([, v]) => v !== undefined));
  // A new accessory without an explicit accent takes that accessory's default.
  if (picked.accessory !== undefined && picked.accent === undefined) picked.accent = DEFAULT_ACCENT[picked.accessory as Accessory];
  let look = normalizeLook({ ...base, ...picked, features }, base);
  let compat = isCompatible(look);
  // A saved look that a newer rule no longer allows (e.g. a puff dog in headphones) must stay editable:
  // a clash this patch did not choose is cleared instead of blocking every later edit. Explicit clashes still fail.
  for (let i = 0; i < 3 && !compat.ok && !isCompatible(base).ok && picked[compat.field] === undefined; i++) {
    const field = compat.field;
    look = field === 'accessory' ? { ...look, accessory: 'none', accent: DEFAULT_ACCENT.none } : { ...look, [field]: 'none' };
    compat = isCompatible(look);
  }
  return compat.ok ? { ok: true, look } : { ok: false, error: compat.reason };
}

const ROLE_ACCESSORIES: ReadonlyArray<[RegExp, Accessory[]]> = [
  [/support|customer|success|\bcs\b|help ?desk/i, ['headset']],
  [/research|analy|finance|account|data|legal/i, ['specs', 'glasses']],
  [/design|creative|market|brand|content|writer/i, ['beret', 'flower', 'star']],
  [/engineer|developer|dev\b|ops|infra|tech|it\b/i, ['headphones', 'cap', 'beanie']],
  [/sales|exec|chief|ceo|director|host|partner/i, ['bowtie', 'scarf']],
  [/coach|well|people|hr\b|care|mentor/i, ['flower', 'scarf']],
];

/** Accessories that suit a role (character §6); the user can always override. */
export function suggestAccessories(role: string): Accessory[] {
  const hit = ROLE_ACCESSORIES.find(([re]) => re.test(role));
  return hit ? [...hit[1]] : ['none', 'bow'];
}
