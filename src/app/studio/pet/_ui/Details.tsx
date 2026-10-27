'use client';

/**
 * Lit growth moments on the character (design §4.11, §10.3), a lazy chunk mounted with the Wave B layer: the engine
 * says what this stage can wear (`details` cue) and when a new one should fade in (`litPeak`); this draws
 * _engine/details.ts's nodes where they belong. `lids` ride the face layer and the blink (opacity: the catch-light),
 * `body` sits under the model's root transform (the charm swings with the soft accessories about its pivot), `head`
 * (the Closet's keepsake bow) rides the rigid accessory layer, `back` (room keepsakes) stands in the room behind the
 * pet and `floor` (the garden's pot, the Garden room's hero) in front of it, both outside the body (they never hop).
 */

import { m, type MotionStyle } from 'framer-motion';
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { characterModel, rootTransform, type CharacterModel, type SvgNode } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { detailKey, detailLayers, NO_DETAILS, type ShownDetails } from '../_engine/details';
import { NO_WEARING, outfitLayers, type ShownWearing } from '../_engine/outfits';
import './extras.css';
import type { PetEngine } from './contract';
import { HORIZON_PX } from './scene';

const origin = ([x, y]: [number, number]): MotionStyle => ({ transformBox: 'view-box', originX: `${x}px`, originY: `${y}px` });
const prop = (k: string) => (k.startsWith('data-') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

function nodes(list: SvgNode[], fresh: string | null, swing: MotionStyle | undefined, key = ''): ReactNode[] {
  return list.map((n, i) => {
    const k = `${key}${i}`;
    const props: Record<string, unknown> = Object.fromEntries(Object.entries(n.attrs).map(([a, v]) => [prop(a), v]));
    const kids = n.children ? nodes(n.children, fresh, swing, `${k}.`) : undefined;
    const d = n.attrs['data-detail'] ?? n.attrs['data-wear'];
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

export interface DetailsProps { engine: PetEngine; look: CharacterLook; stage: Stage; size: number; part: 'body' | 'back' | 'floor'; room?: string }

/** One of the overlays: `body` inside the breathing wrapper, `back` behind it and `floor` in front of it in the character box. */
export default function Details({ engine, look, stage, size, part, room }: DetailsProps) {
  const [shown, setShown] = useState<ShownDetails>(NO_DETAILS);
  const [fresh, setFresh] = useState<string | null>(null);
  /** the person's closet overlay (§4.3) as this stage can wear it (the engine's `wearing` cue): this screen only */
  const [wearing, setWearing] = useState<ShownWearing>(NO_WEARING);
  useEffect(() => engine.onMotion?.((c) => {
    if (c.type === 'details') setShown(c.details);
    if (c.type === 'litPeak' && c.detail && c.shown !== false) setFresh(detailKey(c.detail, c.id));
    if (c.type === 'wearing') { setWearing(c.wearing); if (c.fresh && part === 'body') setFresh(c.fresh); }
  }), [engine, part]);
  const model: CharacterModel = useMemo(() => characterModel(look, { uid: 'pd', mode: 'live', stage, expr: 'idle', size }), [look, stage, size]);
  const hero = room === 'garden', headWorn = !!wearing.head;
  // room props stand on the backdrop's horizon (scene.ts HORIZON_PX, in view units at this size)
  const layers = useMemo(() => detailLayers(model, shown, { hero, headWorn, room, horizon: (HORIZON_PX * 200) / size }), [model, shown, hero, headWorn, room, size]);
  const outfit = useMemo(() => outfitLayers(model, wearing, { look, uid: 'pw' }), [model, wearing, look]);
  const rig = engine.rig;
  if (part !== 'body') {
    const list = part === 'back' ? layers.back : layers.floor;
    if (!list.length) return null;
    return <svg className="pet-details" data-part={part} viewBox="0 0 200 200" aria-hidden="true">{nodes(list, fresh, undefined)}</svg>;
  }
  const head = [...outfit.head, ...layers.head];
  const dressed = outfit.face.length + head.length + outfit.body.length + outfit.hand.length > 0;
  if (!layers.lids.length && !layers.body.length && !dressed) return null;
  const soft = rig.layer?.['acc-soft'];
  return (
    <svg className="pet-details" viewBox="0 0 200 200" aria-hidden="true">
      {outfit.defs.length > 0 && <defs>{nodes(outfit.defs, null, undefined, 'd')}</defs>}
      <g transform={rootTransform(model)}>
        {layers.lids.length > 0 && (
          <m.g style={{ ...origin(model.pivots.face), ...rig.layer?.face }}>
            <m.g style={{ ...origin([model.pivots.face[0], model.face.eyes[0].cy]), ...rig.lids }}>
              <m.g style={{ opacity: rig.glint?.opacity }}>{nodes(layers.lids, fresh, undefined)}</m.g>
            </m.g>
          </m.g>
        )}
        {nodes(layers.body, fresh, soft)}
        {/* the closet overlay: face pieces ride the face, head pieces the rigid accessory layer, soft parts swing like the charm */}
        {outfit.face.length > 0 && <m.g style={{ ...origin(model.pivots.face), ...rig.layer?.face }}>{nodes(outfit.face, fresh, soft, 'f')}</m.g>}
        {head.length > 0 && <m.g style={{ ...origin(model.pivots['acc-rigid']), ...rig.layer?.['acc-rigid'] }}>{nodes(head, fresh, soft, 'h')}</m.g>}
        {nodes(outfit.body, fresh, soft, 'b')}
        {nodes(outfit.hand, fresh, soft, 'n')}
      </g>
    </svg>
  );
}
