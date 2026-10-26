'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MOOD_BAND } from '@/lib/pet/types';
import { MoonIcon } from '../Particles';
import { t } from '../strings';
import type { RoomProps } from '.';
import { LampIcon, StoryIcon } from './art';
import './rooms.css';


/**
 * Bedroom (design §4.4, S12): Lamp dims the room (an overlay of the room's own, under the engine's lights-off one),
 * Story has no model-written story this wave (the pet hums instead: `bed.storyFallback`), Moon tucks in through the
 * existing sleep action, or says it is not sleepy yet with Energy high. Asleep, the moon is a gentle tap (two wake it,
 * as on Home), and waking turns the lamp back up. Guests see the lamp and the moon only.
 */
export default function BedroomRoom({ host, asleep }: RoomProps) {
  const [lamp, setLamp] = useState(false);
  // the pet woke: the lights come back up
  useEffect(() => { if (!asleep) setLamp(false); }, [asleep]);
  if (!host) return null;
  const v = host.view();
  const guest = v?.role === 'guest' || !!v?.talkInDm;
  const stageEl = host.root()?.querySelector<HTMLElement>('.pet-stage') ?? null;

  const onLamp = () => {
    const on = !lamp;
    setLamp(on);
    if (on && !asleep) host.say(t('bed.lamp.dim'));
  };
  const onStory = () => {
    host.engine()?.roomReact?.('storyNod');
    host.say(t('bed.storyFallback'));
  };
  const onMoon = () => {
    const care = host.care();
    if (asleep || care?.asleep) { host.toyEvent({ type: 'moonTap' }); return; }
    if (care && care.energy >= MOOD_BAND.happyAbove) { host.say(t('bed.tuck.notSleepy')); host.engine()?.roomReact?.('storyNod'); return; }
    host.say(t('bed.tuck.start'));
    setLamp(true);
    host.toyEvent({ type: 'moonTap' });
  };

  return (
    <>
      {stageEl && createPortal(<div className="pet-lamp" aria-hidden="true" data-on={lamp ? '' : undefined} />, stageEl)}
      <div className="pet-verbs" data-room="bedroom">
        <button type="button" className="pet-verb" aria-pressed={lamp} onClick={onLamp}><i><LampIcon /></i><span>{t('toy.bed.lamp')}</span></button>
        {!guest && <button type="button" className="pet-verb" onClick={onStory}><i><StoryIcon /></i><span>{t('toy.bed.story')}</span></button>}
        <button type="button" className="pet-verb" onClick={onMoon}><i><MoonIcon /></i><span>{t('toy.bed.moon')}</span></button>
      </div>
    </>
  );
}
