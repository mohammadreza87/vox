'use client';

import { useRef, useState } from 'react';
import { LookEditor } from '../../look/LookEditor';
import { PhotoPicker } from '../../look/PhotoPicker';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { useNav } from '../../StudioApp';
import { Seg } from '../../ui';
import { Dock, type StepProps } from './shared';

type Tab = 'character' | 'photo';

/**
 * Spawn's Look step: the character customizer, and the Telegram photo drawn
 * from it, behind a Character · Photo switch (UI §4.4). Edits save as you go;
 * the CTA names where it goes (hire, or Done back to the profile in a live refine).
 */
export function LookStep({ agent, busy, onUpdate, onNext }: StepProps) {
  const c = spawnCopy[useNav().locale ?? 'en'].look;
  const [tab, setTab] = useState<Tab>('character');
  const top = useRef<HTMLDivElement>(null);
  const name = agent.persona.name;
  const live = agent.status === 'active';
  const open = (t: Tab) => {
    setTab(t);
    top.current?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <>
      <div className="vx-scroll vx-look-scroll">
        <div ref={top} className="vx-look-mode">
          <Seg label={c.look(name)} value={tab} onChange={setTab}
            options={[{ value: 'character', label: c.character }, { value: 'photo', label: c.photo }]} />
        </div>
        <div hidden={tab !== 'character'}>
          <LookEditor agent={agent} onUpdate={onUpdate} mode={live ? 'live' : 'draft'}
            title={c.shape(name)} onPhoto={() => open('photo')} />
        </div>
        <div hidden={tab !== 'photo'}>
          <PhotoPicker agent={agent} onUpdate={onUpdate} />
        </div>
      </div>
      <Dock>
        <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={onNext} disabled={!!busy}>{live ? c.done : c.next(name)}</button>
      </Dock>
    </>
  );
}
