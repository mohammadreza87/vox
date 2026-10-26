'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GardenState, PetPlayView, SeedKind } from '@/lib/pet/play';
import { t } from '../strings';
import type { RoomProps } from '.';
import { roomIntent } from './intent';
import './rooms.css';

/** "breathe with me" lasts a minute (§4.5), then the breath goes back to the pet's own */
const BREATHE_MS = 60_000;
/** the guided cycle, in seconds (§4.5: a six-second cycle you follow) */
const BREATHE_S = 6;
const RAIN_MS = 1800;

const SeedIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20v-7M12 13c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
const RainIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14a4 4 0 0 1 .6-8 5 5 0 0 1 9.6 1.4A3.3 3.3 0 0 1 17 14zM9 17l-1 2.5M13 17l-1 2.5M17 17l-1 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
const BreatheIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>;

/** The seeds on offer now: the flower always; sabzeh only while Nowruz is on (§4.5, §4.10; the server refuses it otherwise). */
export const seedsFor = (play: PetPlayView | undefined): SeedKind[] => (play?.season === 'nowruz' ? ['flower', 'sabzeh'] : ['flower']);

/** A seed can go in: an empty pot, or one whose seed already bloomed (one seed at a time, §4.5). */
const canPlant = (s: GardenState) => s === 'empty' || s === 'bloomed' || s === 'blooming';
const grew = (s: GardenState | undefined) => s === 'blooming' || s === 'bloomed';

/**
 * Garden (design §4.5, S10): Seed plants one seed (a picker when there is a choice), Rain is the cloud watering it (the
 * engine's rain reaction and drops; one watering a local day counts, the server says which), Breathe slows the pet's
 * breath to a six-second cycle for a minute and stops on leaving the room. The pot shows the server's state: seeded,
 * sprouting, watered today, blooming, bloomed. It never wilts: there is no state that goes backwards. A bloom brings the
 * bloom pin and a Life Book page (the server's), and is a moment worth sharing (P7). No numbers anywhere.
 */
export default function GardenRoom({ host }: RoomProps) {
  const [picking, setPicking] = useState(false);
  const [raining, setRaining] = useState(false);
  const [breathing, setBreathing] = useState(false);
  const [chip, setChip] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const busy = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (ms: number, fn: () => void) => { const h = setTimeout(() => { timers.current.delete(h); fn(); }, ms); timers.current.add(h); };
  const play = host?.view()?.play;
  const garden = play?.garden ?? null;
  const state: GardenState = garden?.state ?? 'empty';
  const engineGarden = !!host?.engine()?.setGarden;

  // the floor state follows the record (the motion engineer's seed; Extras keeps it in every room); leaving stops the guided breath
  useEffect(() => { host?.engine()?.setGarden?.(garden ? { state, seed: garden.seed } : null); }, [host, garden, state]);
  useEffect(() => {
    const h = host;
    if (!h) return;
    const tm = timers.current;
    const v = h.view();
    // arriving from a bloom check-in (§5.1): the bloom is the moment
    if (roomIntent.bloom) {
      roomIntent.bloom = false;
      if (grew(v?.play?.garden?.state)) later(600, () => bloomed(false));
    } else if (!v?.play?.garden) later(900, () => h.say(t('garden.empty', undefined, h.lang)));
    return () => {
      for (const x of tm) clearTimeout(x);
      tm.clear();
      h.engine()?.setGuidedBreath?.(null);
    };
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!host) return null;
  const lang = host.lang;
  const e = () => host.engine();

  function bloomed(fresh: boolean) {
    e()?.roomReact?.('bloom');
    host!.say(t('garden.bloom', undefined, lang));
    if (fresh) { setChip(t('garden.newKeepsake', { item: t('item.bloomPin', undefined, lang) }, lang)); later(3200, () => setChip(null)); }
    host!.emit({ type: 'moment', kind: 'bloom' });
  }

  const plant = async (seed: SeedKind) => {
    setPicking(false);
    if (busy.current) return;
    busy.current = true;
    const r = await host.play({ op: 'plantSeed', seed });
    busy.current = false;
    redraw((n) => n + 1);
    if (r && !r.guard) { e()?.roomReact?.('admire'); host.say(seed === 'sabzeh' ? t('season.nowruz.sabzeh', undefined, lang) : t('garden.planted', undefined, lang)); }
  };
  const onSeed = () => {
    if (!canPlant(state)) { if (state === 'watered') { setChip(t('garden.watered', undefined, lang)); later(2600, () => setChip(null)); } return; }
    const seeds = seedsFor(play);
    if (seeds.length > 1) setPicking(true);
    else void plant(seeds[0]);
  };
  const onRain = async () => {
    if (raining) return;
    setRaining(true);
    later(RAIN_MS, () => setRaining(false));
    e()?.roomReact?.('rain');
    // the rain is a stroke for Joy, inside the existing hourly cap (§4.5 Data)
    host.act('pet');
    if (!garden) { host.say(t('garden.empty', undefined, lang)); return; }
    if (grew(state)) return;
    host.say(t('garden.rain', undefined, lang));
    const was = state;
    const r = await host.play({ op: 'waterSeed' });
    redraw((n) => n + 1);
    const now = r?.play.garden?.state;
    if (r && !grew(was) && grew(now)) later(RAIN_MS, () => bloomed(true));
    else if (now === 'watered' || r?.guard === 'noop') { setChip(t('garden.watered', undefined, lang)); later(2600, () => setChip(null)); }
  };
  const onBreathe = () => {
    const on = !breathing;
    setBreathing(on);
    e()?.setGuidedBreath?.(on ? BREATHE_S : null);
    if (on) { host.say(t('garden.breathe.on', undefined, lang)); later(BREATHE_MS, () => { setBreathing(false); e()?.setGuidedBreath?.(null); }); }
  };

  const stageEl = host.root()?.querySelector<HTMLElement>('.pet-stage') ?? null;
  const box = host.box();
  const seedName = (s: SeedKind) => t(s === 'sabzeh' ? 'garden.seed.sabzeh' : 'garden.seed.flower', undefined, lang);

  return (
    <>
      {stageEl && createPortal(
        <div className="pet-garden" aria-hidden="true" style={{ left: box.x + box.size * 0.86, top: box.y + box.size * 0.74 }}>
          {!engineGarden && <div className="pet-pot" data-state={state} data-seed={garden?.seed}><i /></div>}
          {raining && <div className="pet-rain">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 0.17) % 0.6}s`, left: `${8 + i * 12}%` }} />)}</div>}
        </div>, stageEl)}
      {picking ? (
        <div className="pet-verbs" data-room="garden">
          {seedsFor(play).map((s) => <button key={s} type="button" className="pet-verb" onClick={() => void plant(s)}><i><SeedIcon /></i><span>{seedName(s)}</span></button>)}
          <button type="button" className="pet-link" onClick={() => setPicking(false)}>{t('closet.cancel', undefined, lang)}</button>
        </div>
      ) : (
        <div className="pet-verbs" data-room="garden" data-state={state}>
          <button type="button" className="pet-verb" onClick={onSeed} data-tired={canPlant(state) ? undefined : ''}><i><SeedIcon /></i><span>{t('toy.garden.seed', undefined, lang)}</span></button>
          <button type="button" className="pet-verb" onClick={() => void onRain()}><i><RainIcon /></i><span>{t('toy.garden.rain', undefined, lang)}</span></button>
          <button type="button" className="pet-verb pet-breath-verb" aria-pressed={breathing} onClick={onBreathe}><i><BreatheIcon /></i><span>{t('toy.garden.breathe', undefined, lang)}</span></button>
          {chip && <span className="pet-chip" role="status">{chip}</span>}
        </div>
      )}
    </>
  );
}
