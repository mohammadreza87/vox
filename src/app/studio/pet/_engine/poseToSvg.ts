/**
 * A RigFrame drawn as a still SVG (brief §4.3): the same model nodes CharacterView renders, with the engine's
 * layer transforms applied to the `<g data-rig>` groups and its morph paths written into the `d`s, as
 * modelToSvg writes them. Pure (no React, no DOM): scripts/pet-frames.ts tiles these into frame sheets.
 */

import { BEAK_DROP, beakLowerD, beakMouth, GROUND, INK, mouthD, nodesToSvg, RIG_LAYERS, rootTransform, type CharacterModel, type RigLayer, type SvgNode } from '@/lib/studio/character';
import { HIGHLIGHT } from '@/lib/studio/character/palette';
import { SPARKLE, TONGUE, dotD, sparklePts, swirlD, swirlR, tongueBase } from '@/lib/studio/character/petFace';
import { detailLayers, type DetailLayers, type ShownDetails } from './details';
import { beakOpen, browsD, bulgePath, lerpPath, petEyeD, petMouthD } from './face';
import type { GardenDraw } from './garden';
import type { Geom, RigFrame } from './layers';
import { outfitLayers, type OutfitLayers, type ShownWearing } from './outfits';
import type { CharacterLook } from '@/lib/studio/types';

const r = (n: number) => Math.round(n * 1000) / 1000;
type Pt = [number, number];

/** framer's transform about an origin: translate, rotate, scale (in that order). */
function about([ox, oy]: Pt, t: { x?: number; y?: number; rot?: number; sx?: number; sy?: number }): string {
  const parts = [`translate(${r(ox + (t.x ?? 0))} ${r(oy + (t.y ?? 0))})`];
  if (t.rot) parts.push(`rotate(${r(t.rot)})`);
  if ((t.sx ?? 1) !== 1 || (t.sy ?? 1) !== 1) parts.push(`scale(${r(t.sx ?? 1)} ${r(t.sy ?? 1)})`);
  parts.push(`translate(${r(-ox)} ${r(-oy)})`);
  return parts.join(' ');
}

export interface PoseSvgOpts {
  /** the CSS breath and sway at this moment (scale/rotate on the wrapper's inner element) */
  breath?: { sx: number; sy: number; rot: number };
  /** paint-server id prefix the model was built with (blush gradient), default 'pet' */
  uid?: string;
  /** growth details (§4.11) to draw, and the one fading in (details.ts detailFade); none: the output is unchanged */
  details?: { shown: ShownDetails; fade?: { key: string; o: number; s: number } | null } & GardenDraw;
  /** the closet outfit (outfits.ts) and the look its free accessories are drawn for; none: the output is unchanged */
  outfit?: { shown: ShownWearing; look: CharacterLook };
}

/**
 * The character at one frame, as SVG markup in the 200 view box (no outer <svg>): body wrapper transform about
 * the ground point, then the root growth, then the layers.
 */
export function poseToSvg(geom: Geom, f: RigFrame, o: PoseSvgOpts = {}): string {
  const m = geom.model;
  const uid = o.uid ?? 'pet';
  const e = m.face.eyes, bk = m.face.beak;
  const mouth = bk ? beakMouth(f.mouth) : f.mouth;
  const sw = m.face.strokeW;
  const eyePaint = (i: 0 | 1) => ({ fill: INK, stroke: INK, 'stroke-width': r(f.eyeStroke[i] * sw), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const pivot = (k: keyof CharacterModel['pivots']): Pt => m.pivots[k];
  const dl: DetailLayers | null = o.details ? detailLayers(m, o.details.shown, { fade: o.details.fade, swing: f.accSoft.rot, glint: f.glint, sway: o.details.sway, shimmer: o.details.shimmer }) : null;
  const ol: OutfitLayers | null = o.outfit ? outfitLayers(m, o.outfit.shown, { look: o.outfit.look, swing: f.accSoft.rot }) : null;
  const extra: Partial<Record<RigLayer, SvgNode[]>> = ol ? { face: ol.face, 'acc-rigid': ol.head } : {};

  const rewrite = (nodes: SvgNode[]): SvgNode[] => nodes.map((nd) => {
    const part = nd.attrs['data-part'], rig = nd.attrs['data-rig'];
    const kids = nd.children ? rewrite(nd.children) : undefined;
    const out: SvgNode = { ...nd, attrs: { ...nd.attrs }, ...(kids ? { children: kids } : {}) };
    if (nd.tag === 'path' && nd.attrs.d === m.bodyD) out.attrs.d = bulgePath(lerpPath(geom.fromBodyD, m.bodyD, f.morph), m.pivots.body[0], f.bulges);
    if (part === 'eye-l') Object.assign(out.attrs, { d: petEyeD(e[0].cx, e[0].cy, f.eyeL, 1), ...eyePaint(0) });
    if (part === 'eye-r') Object.assign(out.attrs, { d: petEyeD(e[1].cx, e[1].cy, f.eyeR, -1), ...eyePaint(1) });
    if (part === 'mouth') out.attrs.d = bk ? mouthD(m.face.mouth.x, m.face.mouth.y, mouth) : petMouthD(m.face.mouth.x, m.face.mouth.y, mouth);
    if (part === 'beak-lo' && bk) out.attrs.d = beakLowerD(bk.x, bk.top, bk.k, Math.round(beakOpen(f.mouth) * BEAK_DROP * bk.k * 10) / 10);
    if (part === 'brows') out.attrs.d = browsD(e, f.brows.l, f.brows.r, f.brows.inner, f.brows.arch);
    if (part === 'lids') {
      out.attrs.transform = about([pivot('face')[0], e[0].cy], { sy: f.lids });
      // the pet-only eye marks live inside the lids (a blink closes them too), as CharacterView draws them when bound
      const extra: SvgNode[] = [];
      if (f.sparkle.o > 0.01) extra.push({ tag: 'path', attrs: { 'data-part': 'sparkle', d: sparklePts(m).map((q) => dotD(q.cx, q.cy, q.r)).join(''), fill: SPARKLE, opacity: r(f.sparkle.o), transform: about([0, 0], { x: f.sparkle.x, y: f.sparkle.y }) } });
      if (f.swirl.o > 0.01) {
        const sr = swirlR(m);
        for (const q of e) extra.push({ tag: 'path', attrs: { 'data-part': 'swirl', d: swirlD(q.cx, q.cy, sr), fill: 'none', stroke: INK, 'stroke-width': r(sw * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: r(f.swirl.o), transform: about([q.cx, q.cy], { x: f.swirl.x, y: f.swirl.y, rot: f.swirl.rot }) } });
      }
      if (dl) extra.push(...dl.lids);
      out.children = [...(out.children ?? []), ...extra];
    }
    if (nd.tag === 'path' && part === undefined && nd.attrs.fill === HIGHLIGHT) out.attrs.opacity = r(f.glint);
    if (nd.tag === 'ellipse' && String(nd.attrs.fill).endsWith('bl)')) {
      const cx = Number(nd.attrs.cx), cy = Number(nd.attrs.cy);
      out.attrs.transform = about([cx, cy], { sx: f.cheeks, sy: f.cheeks });
    }
    if (rig === 'ear-l' || rig === 'wing-l') out.attrs.transform = about(pivot(rig === 'ear-l' ? 'earL' : 'wingL'), { rot: f.earL });
    if (rig === 'ear-r' || rig === 'wing-r') out.attrs.transform = about(pivot(rig === 'ear-r' ? 'earR' : 'wingR'), { rot: f.earR });
    if (rig === 'tail') out.attrs.transform = about(pivot('tail'), { rot: f.tail });
    if (rig === 'hair-back') out.attrs.transform = about(pivot('hair'), { y: f.hair.y, rot: f.hair.rot, sy: f.hair.sy });
    return out;
  });

  const layer = (l: RigLayer): string => {
    let nodes = rewrite(m.layers[l]);
    let t = '', op = '';
    const g = m.growth;
    switch (l) {
      case 'face': {
        t = about(pivot('face'), { x: f.face.x, y: f.face.y, rot: f.face.rot });
        // the shy blush grows under the eyes (CharacterView draws it when the blush is bound)
        if (f.blush.o > 0.01) {
          const c = m.face.cheeks;
          const shy: SvgNode[] = c.x.map((x) => ({ tag: 'ellipse', attrs: { cx: x, cy: c.y, rx: r(c.rx * 1.08), ry: r(c.ry * 1.08), fill: `url(#${uid}bl)`, opacity: r(f.blush.o), transform: about([x, c.y], { sx: f.blush.s, sy: f.blush.s }) } }));
          nodes = [...shy, ...nodes];
        }
        if (f.tongue.o > 0.01 && m.face.mouthKind === 'lens') {
          const tb = tongueBase(m);
          nodes = [...nodes,
            { tag: 'clipPath', attrs: { id: `${uid}mc` }, children: [{ tag: 'path', attrs: { d: petMouthD(m.face.mouth.x, m.face.mouth.y, mouth) } }] },
            { tag: 'g', attrs: { 'clip-path': `url(#${uid}mc)` }, children: [{ tag: 'ellipse', attrs: { cx: tb.cx, cy: tb.cy, rx: tb.r, ry: tb.r, fill: TONGUE, opacity: r(f.tongue.o), transform: about([tb.cx, tb.cy], { x: f.tongue.x, y: f.tongue.y, sx: f.tongue.sx, sy: f.tongue.sy }) } }] },
          ];
        }
        if (extra.face?.length) nodes = [...nodes, ...extra.face];
        break;
      }
      case 'acc-rigid': t = about(pivot('acc-rigid'), { x: f.accRigid.x, y: f.accRigid.y, rot: f.accRigid.rot }); if (extra['acc-rigid']?.length) nodes = [...nodes, ...extra['acc-rigid']]; break;
      case 'acc-soft': t = about(pivot('acc-soft'), { y: f.accSoft.y, rot: f.accSoft.rot }); break;
      case 'hair': t = about(pivot('hair'), { y: f.hair.y, rot: f.hair.rot, sy: f.hair.sy }); break;
      case 'fx': t = about(pivot('fx'), { y: f.fx.y }); op = ` opacity="${r(f.fx.o)}"`; break;
      case 'shadow': t = about(pivot('shadow'), { y: -f.body.y / (f.body.sy * g), rot: -f.body.rot, sx: f.shadow.s, sy: f.shadow.s }); op = ` opacity="${r(f.shadow.o)}"`; break;
      default: break;
    }
    return `<g data-rig="${l}"${t ? ` transform="${t}"` : ''}${op}>${nodesToSvg(nodes)}</g>`;
  };

  const b = o.breath ?? { sx: 1, sy: 1, rot: 0 };
  const body = about([100, GROUND], { x: f.body.x, y: f.body.y, rot: f.body.rot + b.rot, sx: f.body.sx * b.sx, sy: f.body.sy * b.sy });
  const layers = RIG_LAYERS.filter((l) => m.layers[l].length || extra[l]?.length).map(layer).join('');
  // the worn details ride the body over the face; floor keepsakes stay on the floor (outside the body's transform)
  const worn = (ol && ol.body.length + ol.hand.length ? `<g data-wear="body">${nodesToSvg([...ol.body, ...ol.hand])}</g>` : '')
    + (dl?.body.length ? `<g data-details="body">${nodesToSvg(dl.body)}</g>` : '');
  const floor = dl?.floor.length ? `<g data-details="floor">${nodesToSvg(dl.floor)}</g>` : '';
  return `<defs>${nodesToSvg(ol ? [...m.defs, ...ol.defs] : m.defs)}</defs>${floor}<g transform="${body}"><g transform="${rootTransform(m)}">${layers}${worn}</g></g>`;
}
