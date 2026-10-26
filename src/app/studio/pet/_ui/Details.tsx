'use client';

/**
 * Lit growth moments on the character (design §4.11, §10.3), a lazy chunk mounted with the Wave B layer: the engine
 * says what this stage can wear (`details` cue) and when a new one should fade in (`litPeak`); this draws
 * _engine/details.ts's nodes where they belong. `lids` ride the face layer and the blink (opacity: the catch-light),
 * `body` sits under the model's root transform (the charm swings with the soft accessories about its pivot), `floor`
 * stands in the character box outside the body (it never hops).
 */

import { m, type MotionStyle } from 'framer-motion';
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { characterModel, rootTransform, type CharacterModel, type SvgNode } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { detailKey, detailLayers, NO_DETAILS, type ShownDetails } from '../_engine/details';
import './extras.css';
import type { PetEngine } from './contract';

const origin = ([x, y]: [number, number]): MotionStyle => ({ transformBox: 'view-box', originX: `${x}px`, originY: `${y}px` });
const prop = (k: string) => (k.startsWith('data-') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

function nodes(list: SvgNode[], fresh: string | null, swing: MotionStyle | undefined, key = ''): ReactNode[] {
  return list.map((n, i) => {
    const k = `${key}${i}`;
    const props: Record<string, unknown> = Object.fromEntries(Object.entries(n.attrs).map(([a, v]) => [prop(a), v]));
    const kids = n.children ? nodes(n.children, fresh, swing, `${k}.`) : undefined;
    const d = n.attrs['data-detail'];
    if (d !== undefined && d === fresh) props.className = 'pet-detail-in';
    // the charm hangs from its pivot and swings with the soft accessories
    const pivot = n.attrs['data-pivot'];
    if (typeof pivot === 'string' && swing) {
      const [x, y] = pivot.split(' ').map(Number);
      return <m.g key={k} {...props} style={{ ...origin([x, y]), rotate: swing.rotate }}>{kids}</m.g>;
    }
    return createElement(n.tag, { key: k, ...props }, kids);
  });
}

export interface DetailsProps { engine: PetEngine; look: CharacterLook; stage: Stage; size: number; part: 'body' | 'floor' }

/** One of the two overlays: `body` inside the breathing wrapper, `floor` beside it in the character box. */
export default function Details({ engine, look, stage, size, part }: DetailsProps) {
  const [shown, setShown] = useState<ShownDetails>(NO_DETAILS);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => engine.onMotion?.((c) => {
    if (c.type === 'details') setShown(c.details);
    if (c.type === 'litPeak' && c.detail && c.shown !== false) setFresh(detailKey(c.detail, c.id));
  }), [engine]);
  const model: CharacterModel = useMemo(() => characterModel(look, { uid: 'pd', mode: 'live', stage, expr: 'idle', size }), [look, stage, size]);
  const layers = useMemo(() => detailLayers(model, shown), [model, shown]);
  const rig = engine.rig;
  if (part === 'floor') {
    if (!layers.floor.length) return null;
    return <svg className="pet-details" viewBox="0 0 200 200" aria-hidden="true">{nodes(layers.floor, fresh, undefined)}</svg>;
  }
  if (!layers.lids.length && !layers.body.length) return null;
  return (
    <svg className="pet-details" viewBox="0 0 200 200" aria-hidden="true">
      <g transform={rootTransform(model)}>
        {layers.lids.length > 0 && (
          <m.g style={{ ...origin(model.pivots.face), ...rig.layer?.face }}>
            <m.g style={{ ...origin([model.pivots.face[0], model.face.eyes[0].cy]), ...rig.lids }}>
              <m.g style={{ opacity: rig.glint?.opacity }}>{nodes(layers.lids, fresh, undefined)}</m.g>
            </m.g>
          </m.g>
        )}
        {nodes(layers.body, fresh, rig.layer?.['acc-soft'])}
      </g>
    </svg>
  );
}
