/**
 * The character as data: ONE geometry source for the still SVG (characterSvg)
 * and the live renderer (CharacterView). Minimal style (STYLE.md): one smooth
 * rig silhouette in one matte radial gradient, a soft contact shadow, a tiny
 * quiet ink face, and small cues for species, hair and accessory.
 *
 * Paint order (rig layers): contact shadow → back parts (hair behind the head,
 * ears in the body's own gradient) → body (and its matte form shade) → dog ears falling outward → hair → face
 * kit → accessory → fx. There is no outline, aura, glow, gloss, rim or filter,
 * in stills or live.
 */

import type { CharacterLook, Stage } from '../types';
import { accessoryParts, ringsOf } from './accessories';
import { eyeD, eyeFor, eyeOpen, mouthD, mouthFor, mouthOpenness, scaleEye, type EyeShape, type Expression, type MouthShape } from './face';
import {
  CANON, GROUND, bodyD, boxOf, outlineOf, pathPts, r1, roundedOutline, shapeD, silhouette, stageScale, unionBox, type Box, type Pt, type Shape,
} from './geometry';
import { hairParts } from './hair';
import { normalizeLook } from './look';
import { node as n, type SvgNode } from './node';
import { BLUSH, HIGHLIGHT, INK, accentColor, blend, cheekFor, contrastAccent, derivePalette, hairMaterial, luminance, mix, readsOn, type DerivedPalette, type Material } from './palette';
import { speciesParts, type Ear } from './species';
import { hasPart } from './stage';

export type { SvgNode } from './node';
export type { DerivedPalette } from './palette';
export { FAMILIES } from './geometry';

export type RigLayer = 'shadow' | 'aura' | 'back' | 'body' | 'ears' | 'hair' | 'face' | 'acc-rigid' | 'acc-soft' | 'fx';
/** Paint order of the rig layers ('aura' stays in the contract and is always empty). */
export const RIG_LAYERS: readonly RigLayer[] = ['shadow', 'aura', 'back', 'body', 'ears', 'hair', 'face', 'acc-rigid', 'acc-soft', 'fx'];
export type Lod = 'hero' | 'card' | 'icon';

export interface CharacterModel {
  defs: SvgNode[];
  layers: Record<RigLayer, SvgNode[]>;
  /** Transform origins in the 0..200 viewBox */
  pivots: Record<RigLayer | 'earL' | 'earR' | 'wingL' | 'wingR' | 'tail', [number, number]>;
  face: {
    eyes: [{ cx: number; cy: number }, { cx: number; cy: number }];
    mouth: { x: number; y: number };
    mouthKind: 'lens' | 'omega' | 'beak';
    eyeScale: number;
    /** species eye proportions over the kit (owl: rounder), multipliers on [half-width, height] */
    eyeTune: [number, number];
    strokeW: number;
    /** where the blush sits (drawn or not): the live rig grows a shy blush here */
    cheeks: { x: [number, number]; y: number; rx: number; ry: number };
    /** beak species: the beak's centre x, top y and scale (the live rig drops the lower mandible with the mouth) */
    beak?: { x: number; top: number; k: number };
  };
  palette: DerivedPalette;
  /** Stage growth: the whole character scales by this about (cx, GROUND). */
  growth: number;
  /** The body path (one M + 8 C + Z rig: tweenable between stages and families). */
  bodyD: string;
  /** Unscaled content bounds (body, ears, hair, accessory): circle fitting for profile photos. */
  box: Box;
  /** Unscaled points on the content's outline (same parts as `box`): the radial reach a circle crop must contain. */
  outline: Pt[];
}

export interface ModelOpts {
  stage?: Stage | 5;
  expr?: Expression;
  /** Rendered px size: drives level of detail (≤ 56 small, ≤ 32 tiny) */
  size?: number;
  /** Prefix for paint-server ids, unique per rendered instance */
  uid: string;
  /** 'still' and 'live' draw the same nodes (neither uses filters); kept for callers */
  mode: 'still' | 'live';
  bg?: 'none' | 'ground' | 'halo';
}

const GROWTH = [0, stageScale(1), stageScale(2), stageScale(3), 1, 1];
/** Body scale at a stage (1–4, 5 = seasoned), for anything drawn around the character. */
export const stageGrowth = (stage: number) => GROWTH[Math.max(0, Math.min(5, Math.round(stage)))];
/** Species parts by stage: a faint half-size nub on the wisp (the first species cue), budding at 2, full from 3. */
const SPECIES_K = [0, 0.5, 0.7, 1, 1, 1];
/** The beak: a saturated orange, deeper than any warm body tone, so it reads on butter and apricot. */
const BEAK = '#F08A3C';
/** Line accessories keep true ink (the reference glasses); filled ones are clamped into the matte pastel band. */
const LINE_ACC: ReadonlySet<string> = new Set(['none', 'glasses', 'specs']);
const HATS: ReadonlySet<string> = new Set(['beret', 'cap', 'beanie']);
/** Beak species: the mouth is the opening of the beak, a little over half the kit's mouth, on the beak's seam. */
export const BEAK_MOUTH = 0.66;
/** A beak's opening runs deeper than it is wide (the lower lip of the lens reaches under the dropped mandible). */
export const BEAK_OPEN = 1.6;
/** The kit mouth as a beak's opening: scaled to the beak, its lower lip deeper. */
export const beakMouth = (m: MouthShape): MouthShape => ({ ...m, w: m.w * BEAK_MOUTH, lift: m.lift * BEAK_MOUTH, u: m.u * BEAK_MOUTH, l: m.l * BEAK_MOUTH * BEAK_OPEN });
/** The beak's seam, below its top edge, in beak units. */
const BEAK_SEAM = 1.1;
/** How far the lower mandible drops at a full talking "ah", in beak units (owl 1.3: about 6 u; a still speaking frame about 3.5 u). */
export const BEAK_DROP = 4.6;
/** The upper mandible: an arched top, its lower edge a soft point a little past the seam. Beak centre fx, top bkY, scale k. */
export const beakUpperD = (fx: number, bkY: number, k: number) => {
  const sy = bkY + BEAK_SEAM * k;
  return `M${f(fx - 4.2 * k, bkY)}Q${f(fx, bkY - 2.6 * k)} ${f(fx + 4.2 * k, bkY)}Q${f(fx + 2.2 * k, sy + 0.1 * k)} ${f(fx, sy + 0.5 * k)}Q${f(fx - 2.2 * k, sy + 0.1 * k)} ${f(fx - 4.2 * k, bkY)}Z`;
};
/** The lower mandible: a small rounded wedge under the seam, `drop` units down (the beak opening). */
export const beakLowerD = (fx: number, bkY: number, k: number, drop = 0) => {
  const sy = bkY + BEAK_SEAM * k + drop;
  return `M${f(fx - 2.9 * k, sy - 0.3 * k)}Q${f(fx, sy + 0.5 * k)} ${f(fx + 2.9 * k, sy - 0.3 * k)}Q${f(fx + 1.2 * k, sy + 2.5 * k)} ${f(fx, sy + 3.3 * k)}Q${f(fx - 1.2 * k, sy + 2.5 * k)} ${f(fx - 2.9 * k, sy - 0.3 * k)}Z`;
};
/** Eye scale behind glasses and specs (the reference eye, 4.7 × 8.6, with air above and below inside the ring). */
export const LENS_EYE = 1;
/** Lensed eye proportions over the kit (multipliers on [half-width, height]): a touch shorter, so the eye fills about 60 % of the ring with clear air above and below (A1/B1). */
const LENS_TUNE: [number, number] = [1, 0.88];
/** Small clips whose colour must read on the body (contrast rule): [ΔL, hue distance]. */
const CLIP_CONTRAST: Partial<Record<string, [number, number]>> = { star: [0.1, 60], bow: [0.08, 45], flower: [0.08, 45], scarf: [0.08, 60], bowtie: [0.08, 45] };
/** At 48 px and under, lensed eyes shrink by this much (so rings, eyes and mouth stay separate marks). */
const MICRO_LENS_EYE = 0.85;

/** The dog's ear flap tone, from its root (t = 0: 55 % shade over base) to its tip (t = 1: the shade, a touch deeper). */
export const flapTone = (pal: Pick<DerivedPalette, 'base' | 'shadow' | 'deep'>, t: number) => (t <= 0 ? mix(pal.base, pal.shadow, 0.55) : mix(pal.shadow, pal.deep, 0.18));

/** Weighted mix over [light, base, shadow, deep] (a live hue tween recomputes body stops with it). */
export function mix3(w: readonly number[], m: Material): string {
  return blend([m.light, m.base, m.shadow, m.deep ?? m.shadow], [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0]);
}

/** An eye of the kit as this model draws it: small-size scale, then the species proportions. */
export function modelEye(m: Pick<CharacterModel, 'face'>, e: EyeShape): EyeShape {
  const s = scaleEye(e, m.face.eyeScale), [a, b] = m.face.eyeTune;
  return a === 1 && b === 1 ? s : { ...s, w: s.w * a, t: s.t * b, b: s.b * b };
}

const shapeNode = (s: Shape, attrs: SvgNode['attrs']): SvgNode =>
  s.k === 'c' ? n('circle', { cx: r1(s.cx), cy: r1(s.cy), r: r1(s.r), ...attrs })
    : s.k === 'e' && !s.rot ? n('ellipse', { cx: r1(s.cx), cy: r1(s.cy), rx: r1(s.rx), ry: r1(s.ry), ...attrs })
      : n('path', { d: shapeD(s), ...attrs });

const emptyLayers = (): Record<RigLayer, SvgNode[]> => ({ shadow: [], aura: [], back: [], body: [], ears: [], hair: [], face: [], 'acc-rigid': [], 'acc-soft': [], fx: [] });
const stroke = (color: string, w: number, extra: SvgNode['attrs'] = {}): SvgNode['attrs'] => ({ fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });
const circleD = (x: number, y: number, r: number) => shapeD({ k: 'c', cx: x, cy: y, r });
const f = (x: number, y: number) => `${r1(x)} ${r1(y)}`;
/** Body gradient stops (STYLE §3.2) with their weights over [light, base, shadow, deep]. */
/** (the shade stop comes in earlier and the deep stop is only reached at the far corner: a wide, soft roll-off, never a dark band) */
const BODY_STOPS: ReadonlyArray<[number, number[]]> = [[0, [1, 0, 0, 0]], [0.22, [1, 0, 0, 0]], [0.52, [0, 1, 0, 0]], [0.8, [0, 0.25, 0.75, 0]], [1, [0, 0, 0.45, 0.55]]];
/**
 * The matte form shade (A1/B1's soft occlusion along the underside and the far side): the deep tone over the same
 * body path, nothing over the face and the lit dome, rising to about a quarter along the bottom and right edge. A
 * flat paint, never a gloss, a glow or a filter. [offset, opacity]
 */
const SHADE_STOPS: ReadonlyArray<[number, number]> = [[0, 0], [0.58, 0], [0.8, 0.15], [1, 0.32]];

export function characterModel(input: CharacterLook, o: ModelOpts): CharacterModel {
  const look = normalizeLook(input);
  const st = Math.max(1, Math.min(5, o.stage ?? 4)) as Stage | 5;
  const s4 = Math.min(st, 4) as Stage;
  const expr: Expression = o.expr ?? 'idle';
  const size = o.size ?? 200;
  const small = size <= 56, s48 = size <= 48, tiny = size <= 32, micro = size <= 26;
  const id = (s: string) => `${o.uid}${s}`;
  const url = (s: string) => `url(#${id(s)})`;
  const pal = derivePalette(look.hue, s4);
  const body: Material = { light: pal.light, base: pal.base, shadow: pal.shadow, deep: pal.deep };
  const species = look.species ?? 'cloud';
  const sil = silhouette(look.family, s4, 100, species);
  const { W, top } = sil;
  const dome = sil.dome;
  const cx = sil.cx;
  const features = look.features;
  const growth = GROWTH[st];
  // at 32 px and under, accessories collapse into smudges (a band reads as a helmet): ears and hair carry the look
  const accOn = hasPart(st, 'accessory') && !!look.accessory && look.accessory !== 'none' && !tiny;
  // a hat keeps the species cue (ears peek out either side of it, owl tufts sit below it); only the chick's sprout hides
  const hatOn = accOn && HATS.has(look.accessory ?? 'none');
  const sp = speciesParts(species, sil, SPECIES_K[st], hatOn, look.accessory === 'beret');
  const happy = expr === 'happy' && st >= 3;
  const bd = bodyD(sil);

  const defs: SvgNode[] = [];
  // pink and peach bodies take a deeper coral blush, so both cheeks read on them
  const cheek = cheekFor(look.hue);
  const L = emptyLayers();
  const boxes: Box[] = [];
  const outline: Pt[] = [];
  const bound = (s: Shape) => { boxes.push(boxOf(s)); outline.push(...outlineOf(s)); };

  // ---- paint servers: the one body material, the contact shadow, blush
  // the key light sits high on the upper left of the dome (toward the crown), measured from the base so every
  // family and stage falls to the same shade at the bottom; the face sits on the mid tone, as in A1/A2
  const hk = sil.R.h / CANON.h, gk = Math.sqrt(hk);
  const gx = cx - 0.26 * W + sil.lean * W * 0.6, gy = GROUND - 0.66 * W * gk;
  defs.push(
    n('radialGradient', { id: id('p0'), gradientUnits: 'userSpaceOnUse', cx: r1(gx), cy: r1(gy), r: r1(W * gk * 1.12), gradientTransform: `translate(${f(gx, gy)}) scale(1 0.62) translate(${f(-gx, -gy)})` },
      BODY_STOPS.map(([offset, w]) => n('stop', { offset, 'stop-color': mix3(w, body), 'data-tone': w.join(',') }))),
    n('radialGradient', { id: id('cs') }, [
      n('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0.7 }), n('stop', { offset: 0.6, 'stop-color': '#000', 'stop-opacity': 0.35 }), n('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0 }),
    ]),
    // a wide feathered falloff: the blush is a soft flush, never a disc with an edge
    n('radialGradient', { id: id('bl') }, [n('stop', { offset: 0, 'stop-color': cheek.color, 'stop-opacity': 1 }), n('stop', { offset: 0.3, 'stop-color': cheek.color, 'stop-opacity': 0.82 }), n('stop', { offset: 0.66, 'stop-color': cheek.color, 'stop-opacity': 0.34 }), n('stop', { offset: 1, 'stop-color': cheek.color, 'stop-opacity': 0 })]),
    n('clipPath', { id: id('c') }, [n('path', { d: bd })]),
  );
  // the form shade's centre sits left of the body (so the bottom and right edge darken); a drift leans the other way,
  // so its full low left lobe takes the deeper tone (A2)
  const sx = cx - 0.08 * W - sil.lean * W * 4.2, sy = GROUND - 0.6 * W * gk;
  defs.push(n('radialGradient', { id: id('p1'), gradientUnits: 'userSpaceOnUse', cx: r1(sx), cy: r1(sy), r: r1(W * 0.6), gradientTransform: `translate(${f(sx, sy)}) scale(1 0.8) translate(${f(-sx, -sy)})` },
    SHADE_STOPS.map(([offset, op]) => n('stop', { offset, 'stop-color': pal.deep, 'stop-opacity': r1(op * (st === 1 ? 0.5 : 1) * 100) / 100, 'data-tone': '0,0,0,1' }))));
  const bodyFill = url('p0');

  // ---- contact shadow: darker under the base, never a glow
  L.shadow.push(n('ellipse', { cx: r1(cx), cy: GROUND + 1, rx: 56, ry: 6, fill: url('cs') }));

  // ---- hair (stage 3+): matte base → shade, one linear gradient per piece
  // a fringe gives way to a hat (a sliver under the brim reads as a glitch); a tuft between ears becomes one rounded curl
  const crownEars = species === 'cat' || species === 'bunny';
  const hair = hasPart(st, 'hair') && look.hair && look.hair !== 'none'
    ? hairParts(look.hair, sil, { hat: hatOn, crownEars }) : null;
  const hairMat0 = hairMaterial(look.hairTone ?? 'deep', pal);
  // that curl between the ears is lifted a step lighter (a dark same-hue clump in the ear gap reads as a leaf),
  // as far as it still reads on the body
  const lift = (t: number): Material => ({ base: mix(hairMat0.base, hairMat0.light, t), light: hairMat0.light, shadow: mix(hairMat0.shadow, hairMat0.base, t), deep: hairMat0.deep });
  const hairMat = crownEars && look.hair === 'tuft' ? [lift(0.4), lift(0.22)].find((m) => readsOn(m.base, pal.base, 1.45)) ?? hairMat0 : hairMat0;
  // one gradient across every hair piece (user space over their union), so a cap and its bun read as one form
  if (hair) {
    const hb = unionBox([...hair.front, ...hair.back, ...(hair.hang ?? [])].map(boxOf));
    defs.push(n('linearGradient', { id: id('hk'), gradientUnits: 'userSpaceOnUse', x1: r1(hb.x0), y1: r1(hb.y0), x2: r1(hb.x0 + 0.3 * (hb.x1 - hb.x0)), y2: r1(hb.y1) },
      [n('stop', { offset: 0, 'stop-color': hairMat.base }), n('stop', { offset: 1, 'stop-color': hairMat.shadow })]));
  }
  // filled accessories sit in the matte pastel band (ink stays for the face and the glasses' lines); a small clip
  // whose colour would vanish on the body (lime on butter, rose on rose) takes the first pastel that reads
  const acc0 = accentColor(look.accent ?? 'ink', !LINE_ACC.has(look.accessory ?? 'none'));
  const cc = CLIP_CONTRAST[look.accessory ?? 'none'];
  const accent = cc ? contrastAccent(acc0, pal.base, cc[0], cc[1]) : acc0;

  // ---- back: hair behind the head, then ears and sprouts in the body's own material
  const earGroup = (e: Ear, children: SvgNode[]) => n('g', { 'data-rig': `ear-${e.side < 0 ? 'l' : 'r'}` }, children);
  // the pony band takes the accent when it reads on the hair (never volt: lime on a band reads as a badge), else coral
  // the band is a filled piece: a line accessory's true ink/navy accent is swapped for its pastel fill stand-in
  const tieAccent = LINE_ACC.has(look.accessory ?? 'none') ? accentColor(look.accent ?? 'ink', true) : accent;
  const tieNode = (t: NonNullable<NonNullable<typeof hair>['tie']>) => {
    const tie = look.accessory !== 'none' && look.accent !== 'volt' && Math.abs(luminance(tieAccent) - luminance(hairMat.base)) >= 0.12 ? tieAccent : accentColor('coral');
    // a small soft band across the tail where it leaves the head, or round the bun's base (never a loose dot)
    const len = t.len ?? 11;
    return n('rect', { x: -2.4, y: r1(-len / 2), width: 4.8, height: r1(len), rx: 2.4, fill: tie, transform: `translate(${f(t.x, t.y)}) rotate(${r1(t.rot)})`, 'data-part': 'tie' });
  };
  if (hair?.back.length) {
    const kids = hair.back.map((s) => shapeNode(s, { fill: url('hk') }));
    L.back.push(n('g', { 'data-rig': 'hair-back' }, kids));
    for (const s of hair.back) bound(s);
  }
  if (sp.back.length) {
    defs.push(n('radialGradient', { id: id('ie') }, [n('stop', { offset: 0, 'stop-color': BLUSH, 'stop-opacity': 0.55 }), n('stop', { offset: 0.7, 'stop-color': BLUSH, 'stop-opacity': 0.4 }), n('stop', { offset: 1, 'stop-color': BLUSH, 'stop-opacity': 0 })]));
  }
  // a floppy ear's flap: a step deeper than the body (about 55 % of the way to its shade at the root, reaching the
  // shade toward the tip), matte and opaque: never paler than the body, never a dark patch
  if ([...sp.back, ...sp.front].some((e) => e.tone === 'flap')) defs.push(n('linearGradient', { id: id('fl'), x1: 0, y1: 0, x2: 0.15, y2: 1 }, [n('stop', { offset: 0, 'stop-color': flapTone(pal, 0) }), n('stop', { offset: 1, 'stop-color': flapTone(pal, 1) })]));
  // pieces that hang from behind the head (dog ears, the pony) are clipped to everything outside the dome circle
  const outsideDome = () => {
    if (!defs.some((d) => d.attrs.id === id('ho'))) defs.push(n('clipPath', { id: id('ho') }, [n('path', { d: `M-40 -40H240V240H-40Z${circleD(dome.cx, dome.cy, dome.r - 0.5)}`, 'clip-rule': 'evenodd' })]));
    return url('ho');
  };
  for (const e of sp.back) {
    const kids = [shapeNode(e.shape, { fill: e.tone === 'flap' ? url('fl') : bodyFill })];
    if (e.inner) kids.push(shapeNode(e.inner, { fill: url('ie') }));
    // a wisp's nub is still half mist
    L.back.push(st === 1 ? n('g', { opacity: 0.85 }, [earGroup(e, kids)]) : earGroup(e, kids));
    bound(e.shape);
  }

  // ---- body: one path, one material
  // a wisp is still half mist: a touch translucent, so its edge sits softly on the ground
  L.body.push(n('path', { d: bd, fill: bodyFill, 'data-part': 'body', ...(st === 1 ? { opacity: 0.95 } : {}) }));
  L.body.push(n('path', { d: bd, fill: url('p1'), 'data-part': 'shade' }));
  outline.push(...pathPts(bd));
  boxes.push({ x0: cx - W / 2 + Math.min(0, sil.lean * W), y0: top, x1: cx + W / 2 + Math.max(0, sil.lean * W), y1: GROUND });

  // ---- front species parts: the dog's floppy ears, falling outward from the upper dome in the body's own material
  for (const e of sp.front) {
    const kids = [shapeNode(e.shape, { fill: e.tone === 'flap' ? url('fl') : bodyFill })];
    L.ears.push(earGroup(e, kids));
    bound(e.shape);
  }

  // ---- hair: the pony tail hangs from behind the head over the shoulder (clipped to outside the dome circle)
  if (hair?.hang?.length) {
    L.hair.push(...hair.hang.map((sh) => shapeNode(sh, { fill: url('hk'), 'clip-path': outsideDome(), 'data-part': 'tail' })));
    for (const sh of hair.hang) bound(sh);
  }
  // ---- hair: the front pieces
  if (hair?.front.length) {
    // `outside` pieces (the pony) hang from behind the dome: clipped to everything outside the dome circle, so they
    // fall in front of the shoulder as if tied at the back of the head
    const clip: SvgNode['attrs'] = hair.clip ? { 'clip-path': url('c') } : hair.outside ? { 'clip-path': outsideDome() } : {};
    L.hair.push(...hair.front.map((s) => shapeNode(s, { fill: url('hk'), ...clip })));
    for (const s of hair.front) { boxes.push(boxOf(s)); if (!hair.clip) outline.push(...outlineOf(s)); }
  }
  // the pony band sits over the join, in front of the head's edge
  if (hair?.tie) L.hair.push(tieNode(hair.tie));

  // ---- face kit, anchored to the body: eyes at half its height on the dome axis, the mouth a little lower
  const fx = cx + sil.lean * W * 0.7;
  // at 32 px and under the eyes sit a pixel higher and the mouth a little lower, so the smile never joins the
  // eyes into a "U"
  const ey = GROUND - 0.5 * sil.R.h * W - (tiny ? 5 : 0);
  const my = GROUND - 0.274 * W * hk + (tiny ? 3.5 : 0);
  const eL = fx - 17.3, eR = fx + 17.3;
  // behind lenses the eyes fill a little more of the ring (A1/A2: about 55-60 % of the lens height)
  const lensed = accOn && (look.accessory === 'glasses' || look.accessory === 'specs');
  const eyeScale = tiny ? 1.75 : small ? 1.55 * (lensed && s48 ? MICRO_LENS_EYE : 1) : lensed ? LENS_EYE : 1;
  const eyeTune: [number, number] = sp.face.eye && st >= 3 ? sp.face.eye : lensed && st >= 3 ? LENS_TUNE : [1, 1];
  const sw = (tiny ? 5 : small ? 3.9 : st === 2 ? 2.3 : 2.55);
  const face = L.face;
  const blushOn = (features.cheeks || happy) && hasPart(st, 'cheeks') && expr !== 'sleeping' && !micro;
  // beak species hold the cheeks a little wider, clear of the beak
  // a wide soft flush tucked just under the lens rims (A1)
  const cheeks = { x: [fx - (sp.face.beak ? 30 : 28), fx + (sp.face.beak ? 30 : 28)] as [number, number], y: my - (tiny ? 7.5 : 3), rx: small ? 13 : 13, ry: small ? 9.5 : 9 };
  if (blushOn) {
    // clearly visible but soft (A1); a budding stage-2 face gets a faint first flush
    const op = Math.min(1, (st === 2 ? 0.38 : happy ? 0.85 : 0.68) * cheek.k);
    for (const x of cheeks.x) face.push(n('ellipse', { cx: r1(x), cy: r1(cheeks.y), rx: cheeks.rx, ry: cheeks.ry, fill: url('bl'), opacity: op }));
  }
  // eyes + highlights live in one lids group (the rig's blink scales it about the eye line)
  const fm = { face: { eyeScale, eyeTune } } as Pick<CharacterModel, 'face'>;
  const eye = modelEye(fm, eyeFor(expr, s4));
  const open = eyeOpen(eye);
  const lids: SvgNode[] = [eL, eR].map((x, i) => n('path', {
    d: eyeD(x, ey, eye), 'data-part': i ? 'eye-r' : 'eye-l',
    ...(open ? { fill: INK } : stroke(INK, sw)),
  }));
  // one small dim catchlight near the top of each eye (the reference has no second glint)
  if (open && st >= 2 && !tiny) {
    const r = (st === 2 ? 0.7 : 0.85) * eyeScale;
    const hi = [eL, eR].map((x) => circleD(x + (eye.dx ?? 0) + eye.w * 0.3, ey + (eye.dy ?? 0) - eye.t * 0.5, r));
    lids.push(n('path', { d: hi.join(''), fill: HIGHLIGHT, opacity: 0.72 }));
  }
  face.push(n('g', { 'data-part': 'lids' }, lids));
  // brows: short soft dashes in the body's own shade, never ink or a dark brown (B1)
  // listening always lifts the brows (B2's attentive, raised brows), even on a face that rests without them
  const listening = expr === 'listening';
  // at icon sizes brows give way to glasses and specs (brows, frames and ears merge into one dark band)
  const browsOn = (features.brows || listening) && hasPart(st, 'brows') && !tiny && !(small && lensed);
  if (browsOn) {
    const rings = ringsOf(eL, eR, ey), by = ey - 19;
    const up = listening ? 3 : 0;
    const d = [rings.L, rings.R].map((x, i) => {
      if (expr === 'sleeping') return `M${f(x - 4, by + 2)}L${f(x + 4, by + 2)}`;
      // thinking: one brow lifts, the other settles (an asymmetric, quizzical brow)
      const raise = expr === 'thinking' ? (i === 1 ? 3 : -0.8) : 0;
      // listening: the inner ends lift a little more (a soft, attentive tilt)
      const inL = listening && i === 1 ? 1.4 : 0, inR = listening && i === 0 ? 1.4 : 0;
      return `M${f(x - 4, by + 1 - up - raise - inL)}Q${f(x, by - 1.6 - up - raise)} ${f(x + 4, by + 1 - up - raise - inR)}`;
    }).join('');
    face.push(n('path', { d, 'data-part': 'brows', ...stroke(pal.deep, small ? 3.6 : 2.8) }));
  }
  // lashes: a single short soft flick off each eye's upper outer edge (the only lash option). The reference face is
  // two dots: lashes give way to glasses and brows (one cue at a time) and to icon sizes
  if (features.lashes && hasPart(st, 'lashes') && expr !== 'sleeping' && !small && !lensed && !browsOn) {
    const d = [eL, eR].map((x, i) => {
      const s = i ? 1 : -1, ex = x + (eye.dx ?? 0) + s * eye.w * 0.7, ty = ey + (eye.dy ?? 0) - (open ? eye.t * 0.6 : 1);
      return `M${f(ex, ty)}l${r1(s * 1.8)} -1.6`;
    }).join('');
    face.push(n('path', { d, 'data-part': 'lashes', ...stroke(INK, 1.7) }));
  }
  // mouth: always the face-kit lens (morphable). On owls and chicks the beak IS the mouth: the lens becomes the dark
  // opening between the two halves of the beak (a hairline seam at rest, a small wedge when it talks or chirps), so
  // the face never carries a beak and a smile
  const beak = !!sp.face.beak;
  const mouthKind: CharacterModel['face']['mouthKind'] = beak ? 'beak' : 'lens';
  const bkY = my - 3;
  const bkK = (st === 2 ? 0.8 : 1) * (small ? 1.3 : 1) * (sp.face.beakK ?? 1);
  const mouth = { x: fx, y: beak ? bkY + BEAK_SEAM * bkK : my };
  const mShape0 = mouthFor(expr, s4);
  // at 48 px a lensed face's smile widens a little, so it stays a mark of its own under the rings
  const mk = (beak ? BEAK_MOUTH : 1) * (tiny ? 0.95 : small ? 1.3 * (lensed && s48 && !beak ? 1.15 : 1) : 1);
  // at icon sizes a talking mouth opens a little wider, so it reads as an open "o" rather than a dot
  const wk = small && !beak && expr === 'speaking' ? 1.25 : 1;
  const mShape: MouthShape = mk === 1 && wk === 1 ? mShape0 : { ...mShape0, w: mShape0.w * mk * wk, lift: mShape0.lift * mk, u: mShape0.u * mk, l: mShape0.l * mk * (beak ? BEAK_OPEN : 1) };
  // under 26 px a mouth merges with the eyes into a smudge: two eye dots carry the face. A beak's opening gives way
  // where there is no beak yet (the wisp) and for the quiet side smirk and the sleeper's dot
  const hidden = (beak && (expr === 'thinking' || expr === 'sleeping' || st <= 1)) || micro;
  const mouthNode = n('path', {
    d: mouthD(mouth.x, mouth.y, mShape), 'data-part': 'mouth',
    ...(beak ? { fill: mix(BEAK, INK, 0.72) } : { fill: INK, stroke: INK, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    ...(hidden ? { opacity: 0 } : {}),
  });
  if (!beak) face.push(mouthNode);
  if (beak && st >= 2) {
    // the beak IS the mouth: an upper mandible (a soft rounded triangle in a saturated orange, a step deeper than any
    // warm body, with an ink-toned edge) over a small lower mandible that drops when the beak talks or chirps; the
    // opening between them is the dark lens (drawn first, so both halves sit over it)
    const k = bkK, drop = r1(mouthOpenness(mShape) * BEAK_DROP * k * 10) / 10;
    const edge = { stroke: mix(BEAK, INK, 0.45), 'stroke-width': small ? 1.2 : 0.9, 'stroke-linejoin': 'round' };
    face.push(mouthNode);
    face.push(n('path', { 'data-part': 'beak-lo', d: beakLowerD(fx, bkY, k, drop), fill: mix(BEAK, INK, 0.12), ...edge }));
    face.push(n('path', { 'data-part': 'mouth-deco', d: beakUpperD(fx, bkY, k), fill: BEAK, ...edge }));
  } else if (beak) face.push(mouthNode);

  // ---- accessory (stage 4): flat fills and 2.0 lines
  let accPivot: Pt = [fx, ey];
  if (accOn && look.accessory) {
    const acc = accessoryParts(look.accessory, { s: sil, eL, eR, ey, my, color: accent, clip: url('c'), id, lw: small ? 1.6 : 1, deep: pal.deep, small, tint: pal.shadow, body: pal.base, micro: s48, hair: hair ? look.hair : 'none' });
    if (acc) {
      if (acc.defs) defs.push(...acc.defs);
      L['acc-rigid'].push(...acc.rigid);
      L['acc-soft'].push(...acc.soft);
      accPivot = acc.pivot;
      boxes.push(acc.box);
      outline.push(...roundedOutline(acc.box));
    }
  }

  // ---- fx (static poses; the rig animates them): thought dots or a sleeper's z, always on the upper right of
  // the head (one motion for every look); a side accessory or a pony tail there pushes them further out
  let fxAt: Pt = [dome.cx + dome.r + 10, dome.cy - dome.r * 0.8];
  if ((expr === 'thinking' && st >= 2) || expr === 'sleeping') {
    const right = (accOn && (look.accessory === 'bow' || look.accessory === 'star')) || (hair?.tie !== undefined);
    const push = right ? 13 : 0, lift = right ? 0.18 : 0;
    const at = (k: number, up: number): Pt => [dome.cx + dome.r + k + push, dome.cy - dome.r * (up + lift)];
    if (expr === 'thinking') {
      // two tiny cloud puffs (the body's own gumdrop in miniature: a crown and two low lobes), the smaller one
      // nearer the head; each is its own path so the live rig can drift them up one after the other
      const puff = ([x, y]: Pt, r: number) => [circleD(x, y - r * 0.3, r), circleD(x - r * 0.9, y + r * 0.22, r * 0.66), circleD(x + r * 0.9, y + r * 0.22, r * 0.7)].join('');
      const a = at(6, 0.5), b = at(14, 0.98);
      L.fx.push(n('path', { d: puff(a, 2.8), fill: pal.light, opacity: 0.85, 'data-part': 'puff-1' }));
      L.fx.push(n('path', { d: puff(b, 4), fill: pal.light, opacity: 0.85, 'data-part': 'puff-2' }));
      fxAt = a;
    } else {
      const z = ([x, y]: Pt, s: number) => `M${f(x - s / 2, y - s / 2)}h${r1(s)}l${r1(-s)} ${r1(s)}h${r1(s)}`;
      const a = at(6, 0.78), b = at(15, 1.15);
      L.fx.push(n('path', { d: z(a, 5.5), ...stroke(pal.light, 1.8, { opacity: 0.8 }), 'data-part': 'z-1' }));
      L.fx.push(n('path', { d: z(b, 4), ...stroke(pal.light, 1.8, { opacity: 0.8 }), 'data-part': 'z-2' }));
      fxAt = a;
    }
  }

  const earPivot = (side: -1 | 1): Pt => [...sp.back, ...sp.front].find((e) => e.side === side)?.pivot ?? [dome.cx + side * dome.r * 0.6, top + 8];
  const ground: Pt = [cx, GROUND];
  const pivots: CharacterModel['pivots'] = {
    shadow: ground, aura: ground, back: ground, body: ground, ears: [dome.cx, top], hair: hair?.root ?? [dome.cx, top],
    face: [fx, ey], 'acc-rigid': [fx, ey], 'acc-soft': accPivot, fx: fxAt,
    earL: earPivot(-1), earR: earPivot(1), wingL: [cx - W * 0.42, ey + 14], wingR: [cx + W * 0.42, ey + 14], tail: [cx + W * 0.4, GROUND - 20],
  };
  return {
    defs, layers: L, pivots,
    face: { eyes: [{ cx: eL, cy: ey }, { cx: eR, cy: ey }], mouth, mouthKind, eyeScale, eyeTune, strokeW: sw, cheeks, ...(beak && st >= 2 ? { beak: { x: fx, top: bkY, k: bkK } } : {}) },
    palette: pal, growth, bodyD: bd, box: unionBox(boxes), outline,
  };
}
