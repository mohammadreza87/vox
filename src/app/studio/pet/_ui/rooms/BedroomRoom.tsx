'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MOOD_BAND } from '@/lib/pet/types';
import { MoonIcon } from '../Particles';
import { t } from '../strings';
import type { RoomProps } from '.';
import './rooms.css';

const LampIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l3 8H5zM12 12v6M8 20h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
const StoryIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5C6.5 5 9.5 5 12 6.5 14.5 5 17.5 5 20 6.5V18c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z M12 6.5V18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;

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
