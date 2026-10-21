/**
 * The character palette: one source for the live renderer, the still SVG,
 * the Telegram photo and the AI portrait prompt.
 *
 * Minimal style (STYLE §3): every body hue sits in one pastel band measured
 * from the reference portraits (OKLCH light .945/.055, base .85/.10, shade
 * .75/.11, deep .64/.10), with the hue drifting cooler into the light and
 * deeper, never greyer or browner, into the shade. The shade stops sit a step
 * above the reference's darkest sample so the underside is a soft matte
 * roll-off, and warm hues shade toward coral and rose, never brown or ochre.
 * Pastel, never neon.
 */

import type { AccentColor, HairTone, Hue } from '../types';

export interface HuePalette { base: string; light: string; shadow: string; glow: string; name: string }

/**
 * UI hue tokens (chips, swatches, tints). base/light/shadow are the body
 * tones, so a swatch shows the character's own colour; glow is the UI accent
 * glow (never drawn on the character).
 */
export const PALETTE: Record<Hue, HuePalette> = {
  apricot: { base: '#FFBB90', light: '#FFE8D5', shadow: '#EC9475', glow: '#FF9E6B', name: 'Apricot' },
  rose: { base: '#FEB5C1', light: '#FFE6E6', shadow: '#E58EA9', glow: '#FF7FA3', name: 'Rosé' },
  butter: { base: '#E7CE81', light: '#F1EFC7', shadow: '#E5AB66', glow: '#FFD84D', name: 'Butter' },
  matcha: { base: '#A9DD9E', light: '#E3F4CD', shadow: '#77BE86', glow: '#9BF06A', name: 'Matcha' },
  lagoon: { base: '#75E6D6', light: '#BFF7E6', shadow: '#38C7BF', glow: '#4FF2DC', name: 'Lagoon' },
  sky: { base: '#ADDAF1', light: '#DCF2FA', shadow: '#74AFD8', glow: '#6BB8FF', name: 'Sky' },
  lilac: { base: '#D3C0FE', light: '#EAEBFF', shadow: '#BA9ADD', glow: '#B08CFF', name: 'Lilac' },
  ash: { base: '#D0D3E6', light: '#EDF0F7', shadow: '#AFB0C9', glow: '#D5DAF0', name: 'Pearl' },
};

/** Body tones per hue (STYLE §3.3): light → base → shade (`shadow`) → deep, the four gradient stops. */
export const TONES: Record<Hue, { base: string; light: string; shadow: string; deep: string }> = {
  apricot: { light: '#FFE8D5', base: '#FFBB90', shadow: '#EC9475', deep: '#CE736B' },
  rose: { light: '#FFE6E6', base: '#FEB5C1', shadow: '#E58EA9', deep: '#C37294' },
  butter: { light: '#F1EFC7', base: '#E7CE81', shadow: '#E5AB66', deep: '#D58551' },
  matcha: { light: '#E3F4CD', base: '#A9DD9E', shadow: '#77BE86', deep: '#539E74' },
  lagoon: { light: '#BFF7E6', base: '#75E6D6', shadow: '#38C7BF', deep: '#259D9D' },
  sky: { light: '#DCF2FA', base: '#ADDAF1', shadow: '#74AFD8', deep: '#5A8DBA' }, // powder blue: greyer than a UI sky (B1/B2)
  lilac: { light: '#EAEBFF', base: '#D3C0FE', shadow: '#BA9ADD', deep: '#9F7BB7' },
  ash: { light: '#EDF0F7', base: '#D0D3E6', shadow: '#AFB0C9', deep: '#9392AE' }, // pearl: a cool blue-lilac, never a dirty grey
};

/** Accessory and pony-band colours: matte, a step quieter than UI accents (hue accents use the hue's shade). */
export const ACCENTS: Record<AccentColor, string> = {
  ink: '#14202C', cream: '#F2E8D8', volt: '#D8EA8C', coral: '#EE8B7F', navy: '#41557F', berry: '#B4566F', cocoa: '#8E6A56',
  apricot: PALETTE.apricot.base, rose: PALETTE.rose.base, butter: PALETTE.butter.base, matcha: PALETTE.matcha.base,
  lagoon: PALETTE.lagoon.base, sky: PALETTE.sky.base, lilac: PALETTE.lilac.base, ash: PALETTE.ash.base,
};

/** Face ink (eyes, mouth, glasses): a navy ink, never pure black (STYLE §3.1). */
export const INK = '#14202C';
/** The eye highlight dot. */
export const HIGHLIGHT = '#FCFFFA';
/** Inner-ear pink (drawn at 40–55 % with a radial falloff). */
export const BLUSH = '#FFC8D2';
/** Cheek blush: a step deeper than the inner ear, so it still reads on the palest bodies (A1's soft blush). */
export const CHEEK = '#FFAEC0';
/** The flat ground of the profile photo and the AI reference (STYLE §3.1: OKLCH L .225, C .022, h 262). */
export const GROUND_COLOR = '#161C27';

/** #RGB, #RRGGBB or rgb()/rgba() (framer-motion tweens colours as rgba strings) → [r, g, b]. */
const hex = (h: string): number[] => {
  if (h[0] === '#') return h.length === 4 ? [1, 2, 3].map((i) => parseInt(h[i] + h[i], 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const m = h.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
};
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** Linear sRGB mix of two colours. */
export const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
/** Weighted average of colours (weights need not sum to 1). */
export const blend = (cs: readonly string[], w: readonly number[]) => {
  const sum = w.reduce((s, v) => s + v, 0) || 1;
  const rgb = cs.map(hex);
  return toHex([0, 1, 2].map((i) => rgb.reduce((s, c, j) => s + c[i] * (w[j] ?? 0), 0) / sum));
};

/** Relative luminance (0..1, sRGB approximation) of a colour. */
export const luminance = (c: string) => { const [r, g, b] = hex(c).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** A light/base/shadow(/deep) set: the stops a material gradient runs through. */
export interface Material { base: string; light: string; shadow: string; deep?: string }
/** A flat colour's material: a hair-tone or accent with a shade step (no gloss, no rim). */
export const material = (base: string): Material => ({ base, light: mix(base, '#FFFFFF', 0.35), shadow: mix(base, '#0B1622', 0.22), deep: mix(base, '#0B1622', 0.4) });

/** Body tones for a hue at a stage, plus the derived tones. `glow`, `rim` and `muzzle` are kept for old callers; the character draws none of them. */
export interface DerivedPalette { base: string; light: string; shadow: string; deep: string; glow: string; blush: string; rim: string; muzzle: string }
export function derivePalette(hue: Hue, stage: number): DerivedPalette {
  const t = TONES[hue] ?? TONES.lilac;
  const glow = (PALETTE[hue] ?? PALETTE.lilac).glow;
  // forming clouds are paler: a stage-1 wisp sits three quarters of a stop lighter (it keeps a clear tint of its
  // own hue, so forming agents still tell apart), stage 2 under half a stop
  const k = stage <= 1 ? 0.72 : stage === 2 ? 0.4 : 0;
  const up = (a: string, b: string) => (k ? mix(a, b, k) : a);
  // (a wisp never falls into the dark shade: its deepest tone is half-way to the shade, so it stays soft, not muddy)
  return {
    light: t.light, base: up(t.base, t.light), shadow: up(t.shadow, t.base), deep: stage <= 1 ? mix(t.base, t.shadow, 0.45) : up(t.deep, t.shadow),
    glow, blush: BLUSH, rim: t.light, muzzle: t.light,
  };
}

/* ---------- OKLab / OKLCH (the tone rules are stated in OKLCH, as STYLE §3 measures them) ---------- */
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** A colour in OKLCH: [L 0..1, C, h degrees]. */
export function oklch(c: string): [number, number, number] {
  const [r, g, b] = hex(c).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
const rgbOf = (L: number, C: number, h: number): number[] => {
  const t = (h * Math.PI) / 180, A = C * Math.cos(t), B = C * Math.sin(t);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
/** OKLCH → #RRGGBB, with the chroma reduced until the colour sits inside sRGB. */
export function fromOklch(L: number, C: number, h: number): string {
  let c = C, rgb = rgbOf(L, c, h);
  for (let i = 0; i < 40 && rgb.some((v) => v < -0.0005 || v > 1.0005); i++) { c *= 0.94; rgb = rgbOf(L, c, h); }
  return toHex(rgb.map((v) => gam(Math.max(0, Math.min(1, v)))));
}
/** Clamp a colour into a tone band (keeps its hue): lightness at least minL (at most maxL), chroma at most maxC. */
export function clampTone(c: string, minL: number, maxC: number, maxL = 1): string {
  const [L, C, h] = oklch(c);
  if (L >= minL && L <= maxL && C <= maxC) return c;
  return fromOklch(Math.min(maxL, Math.max(minL, L)), Math.min(maxC, C), h);
}
/** Hue distance in degrees (0..180). */
export const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * Hair material (STYLE §5.1): a linear base → shade gradient. `deep` is the
 * body hue's own shade → deep; hues use that hue's base → shade. No hair mass
 * goes below OKLCH L .55 on a pastel body (a dark cap or knot is the heaviest
 * mark in the frame and competes with the eyes), and every hair sits at least
 * ΔL .12 off the body base, so a pearl body's own-tone tuft still reads.
 */
export function hairMaterial(tone: HairTone, pal: DerivedPalette): Material {
  const own = (t: HairTone): Material => {
    if (t === 'deep') return { base: pal.shadow, light: pal.base, shadow: pal.deep, deep: mix(pal.deep, '#0B1622', 0.3) };
    if (t === 'ink') return INK_HAIR;
    if (t === 'cocoa') return COCOA_HAIR;
    if (t === 'cream') return { base: '#F4EAD9', light: '#FBF6EE', shadow: '#D9C6AA', deep: '#BCA688' };
    if (t in TONES) { const h = TONES[t as Hue]; return { base: h.base, light: h.light, shadow: h.shadow, deep: h.deep }; }
    return material(ACCENTS[t as AccentColor] ?? pal.deep);
  };
  // the chosen tone first; when it would vanish on the body (rose on rose, cream on peach, teal on teal) it steps
  // to a deeper take on the same tone, then cocoa, then the soft ink: the hair always reads as a mass of its own
  const m = own(tone), deeper: Material = { base: m.shadow, light: m.base, shadow: m.deep ?? mix(m.shadow, '#0B1622', 0.25), deep: mix(m.deep ?? m.shadow, '#0B1622', 0.3) };
  const steps = [m, deeper, COCOA_HAIR, INK_HAIR].map((c) => hairContrast(c, pal.base));
  return steps.find((c) => readsOn(c.base, pal.base, HAIR_READ)) ?? steps[steps.length - 1];
}
/** Hair must read on the body: WCAG contrast of the hair base over the body base at least this (or a clear hue step). */
export const HAIR_READ = 1.6;
/** Hair lightness floor (OKLCH L) and the least lightness step between the hair and the body base. */
export const HAIR_MIN_L = 0.55, HAIR_DL = 0.12;
function hairContrast(m: Material, body: string): Material {
  const bl = oklch(body)[0], [L, C, h] = oklch(m.base);
  const floor = (c: string) => clampTone(c, HAIR_MIN_L, 0.2);
  if (Math.abs(L - bl) >= HAIR_DL) return { ...m, base: floor(m.base), shadow: floor(m.shadow) };
  // a hair darker (or as dark) than the body goes a clear step darker; a paler one a step paler, where the gamut allows
  const to = L <= bl ? Math.max(HAIR_MIN_L + 0.05, bl - HAIR_DL) : Math.min(0.975, bl + HAIR_DL);
  const dL = to - L, step = (c: string) => { const [l2, c2, h2] = oklch(c); return fromOklch(Math.max(HAIR_MIN_L, Math.min(0.98, l2 + dL)), c2, h2); };
  return { base: fromOklch(to, C, h), light: step(m.light), shadow: step(m.shadow), deep: m.deep ? step(m.deep) : undefined };
}
/** Ink hair: a soft charcoal-lilac pastel (OKLCH L ≈ .64), never navy or near-black, so it stays a soft form. */
export const INK_HAIR: Material = { base: '#8A90A8', light: '#A6ABBF', shadow: '#787E97', deep: '#6E7490' };
/** Cocoa hair: a milky cocoa (OKLCH L ≈ .67), never chocolate. */
export const COCOA_HAIR: Material = { base: '#B48C78', light: '#C9A897', shadow: '#9F7966', deep: '#8C6858' };

/** A muted slate (kept for callers; no accessory is filled with it any more). */
export const SLATE = '#4D586C';
/** Filled accessories sit in a matte pastel band: OKLCH L at least FILL_MIN_L, chroma at most FILL_MAX_C. */
export const FILL_MIN_L = 0.72, FILL_MAX_C = 0.12;
/** The old relative-luminance floor (kept for callers). */
export const FILL_FLOOR = 0.52;
/** A filled accessory's colour: the accent clamped into the matte pastel band (never an ink, navy or slate mass). */
export function softFill(c: string): string {
  return clampTone(c, FILL_MIN_L, FILL_MAX_C);
}
/** Fills that have their own pastel stand-in: navy becomes a powder denim, ink a soft pearl slate, cocoa a milky cocoa. */
const FILL_ACCENT: Partial<Record<AccentColor, string>> = { navy: '#9DB4D8', ink: '#AEB6C8', cocoa: '#C9A28C', berry: '#D98AA0' };
/**
 * Accessory colour: hue accents take the hue's shade so they read against a pastel body. Filled pieces (`fill`)
 * are clamped into the matte pastel band (L ≥ .72, C ≤ .12): a navy bowtie or cup is the heaviest mark in
 * the frame and pulls focus off the eyes. Lines (glasses, specs) keep the true accent; ink is for lines only.
 */
export const accentColor = (a: AccentColor, fill = false) => {
  if (fill && FILL_ACCENT[a]) return softFill(FILL_ACCENT[a]!);
  const c = a in TONES ? TONES[a as Hue].shadow : ACCENTS[a] ?? ACCENTS.ink;
  return fill ? softFill(c) : c;
};
/**
 * A small clip's colour must read on the body: at least ΔL `dl` off the body base AND `dh` degrees of hue away
 * (lime on butter or matcha, rose on rose, vanish). The chosen accent is kept when it passes; otherwise the first
 * pastel that does (coral, sky, lilac, cream, lagoon, butter), clamped to the fill band.
 */
export function contrastAccent(color: string, body: string, dl = 0.1, dh = 60): string {
  const ok = (c: string) => {
    const [L, C, h] = oklch(c), [bl, bc, bh] = oklch(body);
    return Math.abs(L - bl) >= dl && (C < 0.035 || bc < 0.035 || hueDist(h, bh) >= dh) && readsOn(c, body, CLIP_READ);
  };
  if (ok(color)) return color;
  const pool = [accentColor('coral', true), accentColor('sky', true), accentColor('lilac', true), '#F6EBDA', accentColor('lagoon', true), accentColor('butter', true), accentColor('berry', true), accentColor('navy', true)];
  return pool.find(ok) ?? pool.find((c) => { const [L, , h] = oklch(c), [bl, , bh] = oklch(body); return Math.abs(L - bl) >= dl * 0.6 && hueDist(h, bh) >= dh * 0.6 && readsOn(c, body, CLIP_READ * 0.85); }) ?? color;
}
/** WCAG contrast ratio of two colours (1..21). */
export const contrastRatio = (a: string, b: string) => {
  const Y = (c: string) => { const [r, g, bl] = hex(c).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const x = Y(a), y = Y(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** A small clip must clear this contrast on the body, or a clear hue-and-chroma step (see readsOn). */
export const CLIP_READ = 1.6;
/**
 * A mark reads on the body: a WCAG contrast of at least `min` (about ΔL* 18 on these pastels), or a clear step in
 * both lightness and colour (pastel on pastel of a far hue: sky on peach, coral on lagoon), so a cream bow on a
 * peach body, a rose fringe on a rose owl or a teal spike on a teal body never vanish.
 */
export function readsOn(c: string, body: string, min = CLIP_READ): boolean {
  if (contrastRatio(c, body) >= min) return true;
  const [L, C, h] = oklch(c), [bl, bc, bh] = oklch(body);
  const t = ((h - bh) * Math.PI) / 180, ab = Math.sqrt(Math.max(0, C * C + bc * bc - 2 * C * bc * Math.cos(t)));
  return Math.abs(L - bl) >= 0.1 && ab >= 0.1;
}
/** Cheek blush for a body hue: pink and peach bodies take a deeper coral so both cheeks still read on them. */
export const cheekFor = (hue: Hue): { color: string; k: number } =>
  hue === 'rose' ? { color: '#F7808C', k: 1.25 } : hue === 'apricot' || hue === 'butter' ? { color: '#F88D92', k: 1.1 } : { color: CHEEK, k: 1 };
