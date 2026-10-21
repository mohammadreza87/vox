'use client';

import { m, useTransform, type MotionStyle, type MotionValue } from 'framer-motion';
import { createElement, useId, useMemo, type ReactElement, type ReactNode } from 'react';
import {
  characterModel, circleFit, lookKey, mix, mix3, RIG_LAYERS, rootTransform,
  type CharacterModel, type Expression, type Lod, type Material, type RigLayer, type SvgNode,
} from '@/lib/studio/character';
import { HIGHLIGHT, INK } from '@/lib/studio/character/palette';
import { SPARKLE, TONGUE, dotD, sparklePts, swirlD, swirlR, tongueBase } from '@/lib/studio/character/petFace';
import type { CharacterLook, Stage } from '@/lib/studio/types';

/** Motion bindings the rig (Cloud) drives; transform origins come from the model's pivots. */
export interface RigBindings {
  /** transform/opacity per <m.g data-rig> */
  layer?: Partial<Record<RigLayer, MotionStyle>>;
  earL?: MotionStyle; earR?: MotionStyle; tail?: MotionStyle;
  /** scaleY blink, origin = eye centre line */
  lids?: MotionStyle;
  /** morph paths (face kit) */
  eyeLD?: MotionValue<string>; eyeRD?: MotionValue<string>; mouthD?: MotionValue<string>;
  /** beak species: the lower mandible, which drops with the mouth when the beak talks */
  beakD?: MotionValue<string>;
  /** hue tween of the body material (light → base → shade → deep) */
  stops?: Partial<Record<'base' | 'light' | 'shadow' | 'deep', MotionValue<string>>>;
  /** the body silhouette (and its clip): one rig path, so a stage or family change tweens `d` and the body grows out */
  bodyD?: MotionValue<string>;
  /** shy blush over both cheeks (opacity/scale about each cheek); drawn only when bound */
  blush?: MotionStyle;
  /** the pet rig (additive): the brows as one morph path, so they lift, furrow and flick */
  browsD?: MotionValue<string>;
  /** the pet rig: paint per eye, so a morphing eye goes from a filled oval to a stroked closed arc without a swap */
  eyeStyle?: { l?: MotionStyle; r?: MotionStyle };
  /** the pet rig: the catch-light (fades as the lids close) */
  glint?: MotionStyle;
  /** the pet rig: the drawn cheek blush, scaling about each cheek (puff and jiggle while chewing) */
  cheeks?: MotionStyle;
  /** the pet rig: a tongue inside the open mouth (clipped by the mouth path; lens mouths only); drawn only when bound */
  tongue?: MotionStyle;
  /** the pet rig: two white highlights per eye for sparkly, wanting eyes (inside the lids); drawn only when bound */
  sparkle?: MotionStyle;
  /** the pet rig: a dizzy swirl over each eye, turning about the eye centre (inside the lids); drawn only when bound */
  swirl?: MotionStyle;
}

export interface CharacterViewProps {
  look: CharacterLook; stage: Stage; expr: Expression; size: number; lod: Lod; label: string; rig?: RigBindings;
  /** 'circle' scales and centres the content into the inscribed circle (disc avatars clip to it), like characterSvg's photo fit */
  fit?: 'circle';
}

/** SVG-cased model attributes → React props (data-* stay as they are). */
const propName = (k: string) => (k.startsWith('data-') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
const toProps = (attrs: SvgNode['attrs']) => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [propName(k), v]));
/** Rig transforms use view-box coordinates, so a pivot from the model is the transform origin as is. */
const origin = ([x, y]: [number, number]): MotionStyle => ({ transformBox: 'view-box', originX: `${x}px`, originY: `${y}px` });

/** A body-material gradient stop that follows a hue tween (weights over light/base/shade/deep from the model). */
function ToneStop({ offset, opacity, weights, stops, fallback }: { offset: number | string; opacity?: number | string; weights: number[]; stops: NonNullable<RigBindings['stops']>; fallback: Material }) {
  const color = useTransform(() => {
    const shadow = stops.shadow?.get() ?? fallback.shadow;
    // without a deep binding the deep stop follows the tweened shade, a step darker
    const deep = stops.deep?.get() ?? (stops.shadow ? mix(shadow, '#000000', 0.22) : fallback.deep ?? shadow);
    return mix3(weights, { light: stops.light?.get() ?? fallback.light, base: stops.base?.get() ?? fallback.base, shadow, deep });
  });
  return <m.stop offset={offset} stopColor={color} stopOpacity={opacity} />;
}

const MORPH: Record<string, keyof RigBindings> = { 'eye-l': 'eyeLD', 'eye-r': 'eyeRD', mouth: 'mouthD', 'beak-lo': 'beakD', brows: 'browsD' };
/** data-rig → [binding, pivot] (wing and tail groups are kept for older models; the minimal character draws ears only). */
const EAR: Record<string, ['earL' | 'earR' | 'tail', keyof CharacterModel['pivots']]> = {
  'ear-l': ['earL', 'earL'], 'ear-r': ['earR', 'earR'], 'wing-l': ['earL', 'wingL'], 'wing-r': ['earR', 'wingR'], tail: ['tail', 'tail'],
};

function renderNodes(nodes: SvgNode[], model: CharacterModel, rig: RigBindings | undefined, prefix: string): ReactNode[] {
  return nodes.map((nd, i) => {
    const key = `${prefix}${i}`;
    const { 'data-part': part, 'data-rig': rigName, 'data-tone': tone, ...rest } = nd.attrs;
    const props: Record<string, unknown> = toProps(rest);
    if (part !== undefined) props['data-part'] = part;
    if (rigName !== undefined) props['data-rig'] = rigName;
    const kids = nd.children ? renderNodes(nd.children, model, rig, `${key}.`) : undefined;
    if (rig) {
      // the body and the clip that hair and scarves use are the same path: both follow the tween
      if (rig.bodyD && nd.tag === 'path' && nd.attrs.d === model.bodyD) return <m.path key={key} {...props} d={rig.bodyD} />;
      const morph = typeof part === 'string' ? MORPH[part] : undefined;
      const mv = morph ? (rig[morph] as MotionValue<string> | undefined) : undefined;
      if (mv) return <m.path key={key} {...props} d={mv} style={part === 'eye-l' ? rig.eyeStyle?.l : part === 'eye-r' ? rig.eyeStyle?.r : undefined} />;
      if (rig.glint && nd.tag === 'path' && part === undefined && nd.attrs.fill === HIGHLIGHT) return <m.path key={key} {...props} style={rig.glint} />;
      if (rig.cheeks && nd.tag === 'ellipse' && String(nd.attrs.fill).endsWith('bl)')) {
        return <m.ellipse key={key} {...props} style={{ transformBox: 'fill-box', originX: '50%', originY: '50%', ...rig.cheeks }} />;
      }
      if (part === 'lids' && (rig.sparkle || rig.swirl)) kids?.push(...petEyeParts(model, rig, key));
      if (part === 'lids' && rig.lids) return <m.g key={key} {...props} style={{ ...origin([model.pivots.face[0], model.face.eyes[0].cy]), ...rig.lids }}>{kids}</m.g>;
      const [ear, pivot] = (typeof rigName === 'string' && EAR[rigName]) || [];
      if (ear && pivot && rig[ear]) return <m.g key={key} {...props} style={{ ...origin(model.pivots[pivot]), ...rig[ear] }}>{kids}</m.g>;
      // hair behind the head (a pony tail, a bun between ears) moves with the crown hair, about its pivot
      if (rigName === 'hair-back' && rig.layer?.hair) return <m.g key={key} {...props} style={{ ...origin(model.pivots.hair), ...rig.layer.hair }}>{kids}</m.g>;
      if (nd.tag === 'stop' && typeof tone === 'string' && rig.stops) {
        return <ToneStop key={key} offset={nd.attrs.offset} opacity={nd.attrs['stop-opacity']} weights={tone.split(',').map(Number)} stops={rig.stops} fallback={model.palette} />;
      }
    }
    return createElement(nd.tag, { key, ...props }, kids);
  });
}

/** Pet-only eye marks (sparkle highlights, dizzy swirls), drawn inside the lids group only when bound. */
function petEyeParts(model: CharacterModel, rig: RigBindings, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  if (rig.sparkle) {
    out.push(<m.path key={`${key}sp`} data-part="sparkle" d={sparklePts(model).map((p) => dotD(p.cx, p.cy, p.r)).join('')} fill={SPARKLE} style={{ opacity: 0, ...rig.sparkle }} />);
  }
  if (rig.swirl) {
    const r = swirlR(model);
    model.face.eyes.forEach(({ cx, cy }, i) => out.push(
      <m.path key={`${key}sw${i}`} data-part="swirl" d={swirlD(cx, cy, r)} fill="none" stroke={INK} strokeWidth={model.face.strokeW * 0.7} strokeLinecap="round" strokeLinejoin="round"
        style={{ ...origin([cx, cy]), opacity: 0, ...rig.swirl }} />,
    ));
  }
  return out;
}

/** The pet's tongue: a pink disc clipped by the (morphing) mouth path, so only a mound shows inside an open mouth. */
function Tongue({ model, uid, mouthD, style }: { model: CharacterModel; uid: string; mouthD: MotionValue<string>; style: MotionStyle }) {
  const t = tongueBase(model);
  return (
    <g data-part="tongue" aria-hidden="true">
      <clipPath id={`${uid}mc`}><m.path d={mouthD} /></clipPath>
      <g clipPath={`url(#${uid}mc)`}>
        <m.ellipse cx={t.cx} cy={t.cy} rx={t.r} ry={t.r} fill={TONGUE} style={{ transformBox: 'fill-box', originX: '50%', originY: '50%', opacity: 0, ...style }} />
      </g>
    </g>
  );
}

/** The shy blush: two cheek discs in the model's blush paint, each scaling about its own centre (under the eyes). */
function ShyBlush({ model, uid, style }: { model: CharacterModel; uid: string; style: MotionStyle }) {
  const c = model.face.cheeks;
  return (
    <g data-part="shy" aria-hidden="true">
      {c.x.map((x) => (
        <m.ellipse key={x} cx={x} cy={c.y} rx={c.rx * 1.08} ry={c.ry * 1.08} fill={`url(#${uid}bl)`}
          style={{ transformBox: 'fill-box', originX: '50%', originY: '50%', ...style }} />
      ))}
    </g>
  );
}

/**
 * The character as live SVG, from the same model as the still characterSvg():
 * static structure only, no timers, no filters and no aura (the rig in Cloud
 * animates these groups through RigBindings). Parts are `m.*` elements, so the
 * route that draws them chooses framer's weight: a bound rig needs a LazyMotion
 * ancestor (Cloud brings domMax, the pet page domMin); a still character needs none.
 */
export function CharacterView({ look, stage, expr, size, lod, label, rig, fit }: CharacterViewProps): ReactElement {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const key = lookKey(look);
  // icon LOD gets the small-size face (bigger eyes, heavier strokes, no glints) whatever the box size
  const lodSize = lod === 'icon' ? Math.min(size, 56) : size;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => characterModel(look, { uid, mode: 'live', stage, expr, size: lodSize }), [key, uid, stage, expr, lodSize]);
  const layers = useMemo(() => RIG_LAYERS.filter((l) => model.layers[l].length).map((l) => {
    const kids = renderNodes(model.layers[l], model, rig, `${l}.`);
    if (l === 'face' && rig?.blush) kids.unshift(<ShyBlush key="shy" model={model} uid={uid} style={rig.blush} />);
    if (l === 'face' && rig?.tongue && rig.mouthD && model.face.mouthKind === 'lens') kids.push(<Tongue key="tongue" model={model} uid={uid} mouthD={rig.mouthD} style={rig.tongue} />);
    const style = rig?.layer?.[l];
    return style
      ? <m.g key={l} data-rig={l} style={{ ...origin(model.pivots[l]), ...style }}>{kids}</m.g>
      : <g key={l} data-rig={l}>{kids}</g>;
  }), [model, rig, uid]);
  // circleFit centres on (100, 105) for the photo frame, then drops toward the portraits' baseline; an in-app disc
  // avatar stays centred on this box's (100, 100)
  const root = useMemo(() => {
    if (fit !== 'circle') return rootTransform(model);
    const c = circleFit(model);
    return rootTransform(model, c.fit, [c.shift[0], c.shift[1] - 5 - c.drop]);
  }, [model, fit]);
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`${label}, ${expr}`}
      data-lod={lod} data-stage={stage} data-expr={expr} style={{ display: 'block', overflow: 'visible' }}>
      <defs>{renderNodes(model.defs, model, rig, 'd.')}</defs>
      <g transform={root}>{layers}</g>
    </svg>
  );
}
