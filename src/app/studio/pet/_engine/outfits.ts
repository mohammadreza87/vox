/**
 * The Closet's outfits on the rig (design §4.3, §10.2, §10.3): what this person dressed the pet in, drawn over the
 * character on their screen only (PetPlay.wearing; never `agent.look`, never PetCare). Three slots: head, neck, hand.
 * The existing accessory vocabulary is free to wear and drawn by the character library's own renderer (the same
 * pieces as the look's accessory); the earned keepsakes are drawn here: the pomegranate crown (head), the spark scarf,
 * the star pin and the bloom pin (neck), the sabzeh sprout held in front (hand).
 *
 * Closet items come with the accessory slot (STAGE_PARTS: stage 4; §10.3 "Unlocks: Closet items"), so a wisp wears
 * nothing yet: what it was dressed in is kept and appears with the part. A free accessory the look rules forbid
 * (a hat over a tall hairstyle or bunny ears) is kept the same way and never drawn through the hair.
 *
 * Overlap and follow-through (§10.2): rigid pieces ride the head, soft pieces (bow, flower, star, bowtie, the scarf's
 * tails, the sabzeh) hang from a pivot and swing with the soft-part follower. Pure geometry, not in the engine's core.
 */

import type { WearableId, WearSlot } from '@/lib/pet/play';
import { characterModel, DEFAULT_ACCENT, GROUND, hasPart, isCompatible, silhouette, type CharacterModel, type SvgNode } from '@/lib/studio/character';
import { domePt } from '@/lib/studio/character/geometry';
import type { Accessory, CharacterLook, Stage } from '@/lib/studio/types';
import { edgesAt } from './details';

/** Every wearable's slot (src/lib/pet/play.ts KEEPSAKES and FREE_ACCESSORIES; a test keeps the two in step). */
export const WEAR_SLOT: Readonly<Record<WearableId, WearSlot>> = {
  pomegranateCrown: 'head', sparkScarf: 'neck', sabzehSprout: 'hand', starPin: 'neck', bloomPin: 'neck',
  glasses: 'head', specs: 'head', beret: 'head', cap: 'head', beanie: 'head', headphones: 'head', headset: 'head',
  bow: 'head', flower: 'head', star: 'head', bowtie: 'neck',
};
const SLOTS: readonly WearSlot[] = ['head', 'neck', 'hand'];
const KEEPSAKE: ReadonlySet<string> = new Set(['pomegranateCrown', 'sparkScarf', 'sabzehSprout', 'starPin', 'bloomPin']);
export const isKeepsake = (id: string) => KEEPSAKE.has(id);
/** Free pieces that sit over the eyes: they ride the face (the eyes move inside them), never the head's half tilt. */
const ON_FACE: ReadonlySet<string> = new Set(['glasses', 'specs']);
/** The part every worn item needs. */
export const WEAR_PART = 'accessory' as const;

/** What the page asks the pet to wear, whole (PetPlay.wearing as it is): a slot left out or null wears nothing. */
export type Wearing = Partial<Record<WearSlot, WearableId | null>>;
/** What the character shows now, per slot. */
export interface ShownWearing { head: WearableId | null; neck: WearableId | null; hand: WearableId | null }
export const NO_WEARING: ShownWearing = { head: null, neck: null, hand: null };
/** The key of a worn item's group (`data-wear`). */
export const wearKey = (slot: WearSlot, id: string) => `${slot}:${id}`;

/** Can this look wear the item? Keepsakes always; a free accessory where the look rules allow it as the look's own. */
export function wearsWith(look: CharacterLook, id: WearableId): boolean {
  if (isKeepsake(id) || look.accessory === id) return true;
  const r = isCompatible({ ...look, accessory: id as Accessory });
  return r.ok || r.field !== 'accessory';
}

/** The items this stage (and look) can show; the rest wait for their part. */
export function fitWearing(w: Wearing, stage: Stage, look?: CharacterLook): ShownWearing {
  const out: ShownWearing = { ...NO_WEARING };
  if (!hasPart(stage, WEAR_PART)) return out;
  for (const slot of SLOTS) {
    const id = w[slot];
    if (!id || WEAR_SLOT[id] !== slot || (look && !wearsWith(look, id))) continue;
    out[slot] = id;
  }
  return out;
}

/* ---------- paint ---------- */

const r1 = (n: number) => Math.round(n * 10) / 10;
const g = (attrs: SvgNode['attrs'], children: SvgNode[]): SvgNode => ({ tag: 'g', attrs, children });
const p = (d: string, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'path', attrs: { d, ...attrs } });
const c = (cx: number, cy: number, r: number, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'circle', attrs: { cx: r1(cx), cy: r1(cy), r: r1(r), ...attrs } });
const at = (x: number, y: number, rot = 0, k = 1) => `translate(${r1(x)} ${r1(y)})${rot ? ` rotate(${r1(rot)})` : ''}${k !== 1 ? ` scale(${k})` : ''}`;
function starD(x: number, y: number, r: number, ri: number, n = 5): string {
  return `M${Array.from({ length: n * 2 }, (_, i) => { const a = ((-90 + (i * 180) / n) * Math.PI) / 180, k = i % 2 ? ri : r; return `${r1(x + Math.cos(a) * k)} ${r1(y + Math.sin(a) * k)}`; }).join('L')}Z`;
}
/** The keepsakes' scale over their sketch, so each reads as an object at card size (the free clips are ~1.3). */
const CROWN_K = 1.45, PIN_K = 1.7, HAND_K = 2.4;
const GOLD = '#F2B93B', GOLD_DEEP = '#C98F22', CREAM = '#FFF4D2';

/** The pomegranate crown: the fruit's own five-pointed crown in its red, gold-tipped, worn a little to the right. */
function crown(): SvgNode[] {
  return [
    p('M-10.5 0L-11.6 -9.4L-6.6 -5.6L-3.4 -11.8L0 -6.4L3.4 -11.8L6.6 -5.6L11.6 -9.4L10.5 0Q0 2 -10.5 0Z', { fill: '#D8434F', 'stroke-linejoin': 'round' }),
    p('M-10.5 0L-10.8 -3.2Q0 -1 10.8 -3.2L10.5 0Q0 2 -10.5 0Z', { fill: '#B5303B' }),
    ...[[-11.6, -9.4], [-3.4, -11.8], [3.4, -11.8], [11.6, -9.4]].map(([x, y]) => c(x, y, 1.5, { fill: GOLD })),
    c(0, -2.2, 1.9, { fill: GOLD }), c(-0.5, -2.7, 0.6, { fill: CREAM }),
    p('M-7.6 -6.4L-8.1 -2.4', { stroke: '#FFFFFF', 'stroke-width': 1.1, 'stroke-linecap': 'round', opacity: 0.35 }),
  ];
}

/**
 * The spark scarf (Chaharshanbe Suri): a bandana tied under the face, ember orange with tiny sparks. A narrow band
 * wraps the front (its ends tuck round the sides) and the kerchief's point hangs down the chest, so it reads as a
 * neckerchief and never as a belt (the retired plain scarf did); the point swings with the soft parts.
 */
function scarf(m: CharacterModel): { band: SvgNode[]; tails: SvgNode[]; pivot: [number, number] } {
  const fx = m.face.mouth.x, y = m.face.mouth.y + 7.5;
  const [l, rt] = edgesAt(m, y + 1);
  const L = l + 2, R = rt - 2;
  const band = `M${r1(L)} ${r1(y - 3)}Q${r1(fx)} ${r1(y + 3.5)} ${r1(R)} ${r1(y - 3)}L${r1(R + 0.4)} ${r1(y + 3)}Q${r1(fx)} ${r1(y + 11)} ${r1(L - 0.4)} ${r1(y + 3)}Z`;
  const top = y + 3.6, w = 20, tip = y + 31;
  return {
    band: [p(band, { fill: '#E2672A' })],
    // the kerchief's point (it hangs from the band and swings), a fold shade and three sparks
    tails: [
      p(`M${r1(fx - w)} ${r1(top)}Q${r1(fx)} ${r1(top + 3)} ${r1(fx + w)} ${r1(top)}Q${r1(fx + 6)} ${r1(tip - 6)} ${r1(fx + 0.8)} ${r1(tip)}Q${r1(fx)} ${r1(tip + 0.8)} ${r1(fx - 0.8)} ${r1(tip)}Q${r1(fx - 6)} ${r1(tip - 6)} ${r1(fx - w)} ${r1(top)}Z`, { fill: '#FF8A3D' }),
      p(`M${r1(fx + 3)} ${r1(top + 2.4)}Q${r1(fx + 9)} ${r1(top + 1.6)} ${r1(fx + w)} ${r1(top)}Q${r1(fx + 6)} ${r1(tip - 6)} ${r1(fx + 0.8)} ${r1(tip)}Z`, { fill: '#000', opacity: 0.1 }),
      ...[[-8, 6], [6, 10], [-1.5, 17]].map(([dx, dy]) => p(starD(fx + dx, top + dy, 2, 0.8, 4), { fill: '#FFD45C' })),
    ],
    pivot: [r1(fx), r1(top)],
  };
}

/** Where the neck pins sit: on the chest right of centre, under the mouth (the task pin keeps the left). */
export function broochAt(m: CharacterModel): { x: number; y: number } {
  return { x: r1(m.face.mouth.x + 17), y: r1(m.face.mouth.y + 18) };
}
function starPin(x: number, y: number): SvgNode[] {
  return [p(starD(x, y + 0.7, 6.4, 3), { fill: GOLD_DEEP, 'stroke-linejoin': 'round' }), p(starD(x, y, 6.2, 2.9), { fill: '#FFD45C', stroke: GOLD, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }), c(x - 1.4, y - 1.6, 0.9, { fill: CREAM })];
}
function bloomPin(x: number, y: number): SvgNode[] {
  return [
    p(`M${r1(x + 2)} ${r1(y + 3)}Q${r1(x + 6.5)} ${r1(y + 4)} ${r1(x + 7.5)} ${r1(y + 8)}Q${r1(x + 3)} ${r1(y + 7.5)} ${r1(x + 2)} ${r1(y + 3)}Z`, { fill: '#6FBF73' }),
    c(x, y, 5.6, { fill: GOLD_DEEP }),
    ...[0, 1, 2, 3, 4].map((i) => { const a = ((i * 72 - 90) * Math.PI) / 180; return c(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 2.3, { fill: '#FF9EC0' }); }),
    c(x, y, 1.6, { fill: '#FFD45C' }),
  ];
}

/** The sabzeh sprout, hugged low in front on the right: its dish, the blades and the red ribbon. */
export function handAt(m: CharacterModel): { x: number; y: number } {
  const y = GROUND - 5, [, rt] = edgesAt(m, y - 8);
  return { x: r1(rt - 17), y: r1(y) };
}
function sabzeh(): SvgNode[] {
  return [
    ...[-3.6, -1.8, 0, 1.8, 3.6].map((x, i) => p(`M${x} -3Q${r1(x + 0.3)} -8 ${r1(x * 1.25 + (i % 2 ? 0.5 : -0.3))} ${-11.5 + Math.abs(x) * 0.7}`, { fill: 'none', stroke: i % 2 ? '#55A652' : '#7ACB6A', 'stroke-width': 1.4, 'stroke-linecap': 'round' })),
    p('M-4 -5.6Q0 -4.6 4 -5.6', { fill: 'none', stroke: '#E5484D', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
    p('M-6.4 -3.4Q-5.8 0 -2.4 0.4H2.4Q5.8 0 6.4 -3.4Z', { fill: '#3FA3B1' }),
    { tag: 'ellipse', attrs: { cx: 0, cy: -3.4, rx: 6.4, ry: 1.2, fill: '#7FD0D6' } },
  ];
}

/* ---------- the free accessories, through the character library ---------- */

/** The library's own accessory pieces for this look wearing `id` (its accent: the look's if it is the look's own, else the item's default). */
function freePiece(look: CharacterLook, id: Accessory, uid: string): { rigid: SvgNode[]; soft: SvgNode[]; pivot: [number, number]; defs: SvgNode[] } {
  const m = characterModel({ ...look, accessory: id, ...(look.accessory === id ? {} : { accent: DEFAULT_ACCENT[id] }) }, { uid, mode: 'live', stage: 4, expr: 'idle', size: 200 });
  const rigid = m.layers['acc-rigid'], soft = m.layers['acc-soft'];
  const refs = new Set([...JSON.stringify([rigid, soft]).matchAll(/url\(#([^)]+)\)/g)].map((x) => x[1]));
  return { rigid, soft, pivot: m.pivots['acc-soft'], defs: m.defs.filter((d) => refs.has(String(d.attrs.id))) };
}

/* ---------- layers ---------- */

/**
 * The outfit's nodes by what they ride, in the 200 view box (the same overlay as details.ts):
 * - `face`: inside a group bound to `rig.layer.face` (origin the face pivot): glasses and specs;
 * - `head`: inside a group bound to `rig.layer['acc-rigid']` (origin `model.pivots['acc-rigid']`): hats, headphones,
 *   the crown, and the soft head clips;
 * - `body` and `hand`: inside the body wrapper and the model's root transform (with details' `body`);
 * - `defs`: paint servers and clips the pieces use (their ids carry `uid`).
 * Every item's group has `data-wear="<slot>:<id>"`; a soft piece (or its swinging part) is a group with
 * `data-pivot="x y"` that swings by the `acc-soft` layer's `rotate` about it, like the details' charm.
 */
export interface OutfitLayers { defs: SvgNode[]; face: SvgNode[]; head: SvgNode[]; body: SvgNode[]; hand: SvgNode[] }

export interface OutfitDraw {
  /** the look (the free accessories are the library's pieces for it); without it only keepsakes draw */
  look?: CharacterLook;
  /** the soft parts' swing this frame (deg, the follower's rotation): sheets; the page binds the MotionValue */
  swing?: number;
  /** paint-server id prefix (default 'pw') */
  uid?: string;
}

export function outfitLayers(m: CharacterModel, w: ShownWearing, o: OutfitDraw = {}): OutfitLayers {
  const out: OutfitLayers = { defs: [], face: [], head: [], body: [], hand: [] };
  const uid = o.uid ?? 'pw', sw = o.swing ? r1(o.swing) : 0;
  const swing = (key: string, [x, y]: [number, number], kids: SvgNode[]): SvgNode =>
    g({ 'data-pivot': `${r1(x)} ${r1(y)}`, ...(key ? { 'data-wear': key } : {}) }, sw ? [g({ transform: `rotate(${sw} ${r1(x)} ${r1(y)})` }, kids)] : kids);
  const look = o.look;
  for (const slot of SLOTS) {
    const id = w[slot];
    if (!id) continue;
    const key = wearKey(slot, id);
    if (!isKeepsake(id)) {
      // the look's own accessory is already drawn by the character
      if (!look || look.accessory === id) continue;
      const piece = freePiece(look, id as Accessory, `${uid}${slot[0]}`);
      out.defs.push(...piece.defs);
      const dest = slot === 'neck' ? out.body : ON_FACE.has(id) ? out.face : out.head;
      if (piece.rigid.length) dest.push(g({ 'data-wear': key }, piece.rigid));
      if (piece.soft.length) dest.push(swing(piece.rigid.length ? '' : key, piece.pivot, piece.soft));
      continue;
    }
    switch (id) {
      case 'pomegranateCrown': {
        // on top of the dome, a little to the right and tilted with it (between the ears of a cat or a bunny)
        const s = silhouette(look?.family ?? 'puff', 4, 100, look?.species ?? 'cloud');
        const [x, y] = domePt(s, 7, -3.5);
        out.head.push(g({ 'data-wear': key, transform: at(x, y, 7, CROWN_K) }, crown()));
        break;
      }
      case 'sparkScarf': {
        const sc = scarf(m);
        out.body.push(g({ 'data-wear': key }, [...sc.band, swing('', sc.pivot, sc.tails)]));
        break;
      }
      case 'starPin': case 'bloomPin': {
        const q = broochAt(m);
        out.body.push(g({ 'data-wear': key, transform: at(q.x, q.y, 0, PIN_K) }, id === 'starPin' ? starPin(0, 0) : bloomPin(0, 0)));
        break;
      }
      case 'sabzehSprout': {
        const q = handAt(m);
        out.hand.push(swing(key, [q.x, q.y], [g({ transform: at(q.x, q.y, -6, HAND_K) }, sabzeh())]));
        break;
      }
    }
  }
  return out;
}
