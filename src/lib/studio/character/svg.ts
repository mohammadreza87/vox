import type { CharacterLook } from '../types';
import { GROUND, pathPts, r1, type Pt } from './geometry';
import { characterModel, RIG_LAYERS, type CharacterModel, type ModelOpts } from './model';
import type { SvgNode } from './node';
import { GROUND_COLOR } from './palette';

const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Serialises model nodes to SVG markup (attributes are already SVG-cased). */
export function nodesToSvg(nodes: SvgNode[]): string {
  return nodes.map((n) => {
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return n.children?.length ? `<${n.tag}${attrs}>${nodesToSvg(n.children)}</${n.tag}>` : `<${n.tag}${attrs}/>`;
  }).join('');
}

/** A model's layers in paint order, each tagged data-rig for parity with the live renderer. */
export function modelToSvg(model: CharacterModel): string {
  return `<defs>${nodesToSvg(model.defs)}</defs>`
    + RIG_LAYERS.filter((l) => model.layers[l].length).map((l) => `<g data-rig="${l}">${nodesToSvg(model.layers[l])}</g>`).join('');
}

/** Root transform: stage growth (and, for profile photos, the circle fit) about the ground point. */
export function rootTransform(model: CharacterModel, fit = 1, shift: [number, number] = [0, 0]): string {
  const cx = model.pivots.body[0], k = model.growth * fit;
  return `translate(${r1(cx + shift[0])} ${r1(GROUND + shift[1])}) scale(${Math.round(k * 1000) / 1000}) translate(${-r1(cx)} ${-GROUND})`;
}

/**
 * The photo viewBox is 240 wide around (100, 105) and Telegram crops it to the
 * inscribed circle. The content fills PHOTO_FILL of the diameter on its longer
 * side, unless its outline (body, species parts, hair, accessory) would reach
 * within PHOTO_EDGE of the rim (about 6 % of the diameter, so bunny ear tips,
 * a beret knob or a bun keep clear air inside the circle); tall head features
 * above the body keep PHOTO_HEAD_EDGE straight up as well.
 */
const PHOTO_FILL = 0.79, PHOTO_R = 120, PHOTO_EDGE = 15, PHOTO_HEAD_EDGE = 25;
/**
 * The reference portraits sit the body a little below the frame centre (A1/B1: the body's mid-height about 6 u
 * under it, with the contact shadow well inside the circle): the framed content drops by up to this much, as far
 * as its outline keeps clear of the rim.
 */
const PHOTO_DROP = 6;

/**
 * Profile photos are circle-cropped: scale and centre the content so it fills
 * the circle (the face has to read at 40 px in a chat list) while ears, hair
 * and hats stay inside it. Each stage is framed on its own outline, then
 * scaled by √growth: a forming cloud still reads a little smaller in Telegram
 * (D8), without shrinking to a dot. `fit` is relative to the growth that
 * rootTransform applies.
 */
export function circleFit(model: CharacterModel): { fit: number; shift: [number, number]; drop: number } {
  const b = model.box, cx = model.pivots.body[0];
  // the contact shadow sits just under the ground line
  const top = b.y0, bottom = GROUND + 6;
  const mx = (b.x0 + b.x1) / 2, my = (top + bottom) / 2;
  const reach = Math.max(bottom - my, ...model.outline.map(([x, y]) => Math.hypot(x - mx, y - my)));
  const bodyTop = Math.min(...pathPts(model.bodyD).map((p) => p[1]));
  const head = model.outline.filter(([, y]) => y < bodyTop - 2).map(([x, y]) => Math.hypot(x - mx, y - my));
  const k = Math.min((PHOTO_FILL * 2 * PHOTO_R) / Math.max(b.x1 - b.x0, bottom - top), (PHOTO_R - PHOTO_EDGE) / reach,
    head.length ? (PHOTO_R - PHOTO_HEAD_EDGE) / Math.max(...head) : Infinity) * Math.sqrt(model.growth);
  const shift: [number, number] = [100 - (cx + (mx - cx) * k), 105 - (GROUND + (my - GROUND) * k)];
  // drop toward the reference baseline while every outline point (and the contact shadow) stays clear of the rim
  const pts: Pt[] = [...model.outline, [cx - 50, GROUND + 6], [cx + 50, GROUND + 6]];
  const clear = (d: number) => pts.every(([x, y]) => Math.hypot(cx + shift[0] + (x - cx) * k - 100, GROUND + shift[1] + d + (y - GROUND) * k - 105) <= PHOTO_R - PHOTO_EDGE * 0.8);
  let drop = 0;
  while (drop < PHOTO_DROP && clear(drop + 0.5)) drop += 0.5;
  return { fit: k / model.growth, shift: [shift[0], shift[1] + drop], drop };
}

/**
 * Still character as standalone SVG (Telegram photo, sheets, previews, the AI
 * reference). Same model as the live renderer. bg 'ground' and 'halo' (the
 * Telegram photo) both draw the flat dark ground of the reference portraits.
 */
export function characterSvg(look: CharacterLook, o: Partial<ModelOpts> & { fit?: 'circle' } = {}): string {
  const size = o.size ?? 640;
  const model = characterModel(look, { uid: o.uid ?? 'v', mode: 'still', stage: o.stage, expr: o.expr, size, bg: o.bg });
  const bg = o.bg ?? 'none';
  const vb = bg === 'none' ? '0 0 200 200' : '-20 -15 240 240';
  // the photo ground is the reference's flat dark slate: no halo, no vignette (the contact shadow sits on it)
  const back = bg === 'none' ? '' : `<rect x="-20" y="-15" width="240" height="240" fill="${GROUND_COLOR}"/>`;
  const { fit, shift } = o.fit === 'circle' ? circleFit(model) : { fit: 1, shift: [0, 0] as [number, number] };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${back}<g transform="${rootTransform(model, fit, shift)}">${modelToSvg(model)}</g></svg>`;
}
