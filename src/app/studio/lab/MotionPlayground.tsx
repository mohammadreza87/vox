'use client';

import { animate, useMotionValue } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ACCESSORIES, HAIR_STYLES, PRESET_LOOKS, SPECIES, FAMILY_IDS, type Expression } from '@/lib/studio/character';
import { HUES, type CharacterLook, type Stage } from '@/lib/studio/types';
import { haptic } from '../_lib/haptics';
import { detectTier, type MotionTier } from '../_lib/motion';
import { Cloud, type CloudMoment, type MomentKind } from '../_components/Cloud';
import { syllables } from '../_components/character/rig';
import { Burst } from '../_components/motion/Burst';
import { DoneCheck } from '../_components/motion/DoneCheck';
import { ProgressPill } from '../_components/motion/ProgressPill';
import { Ticker } from '../_components/motion/Ticker';
import { TierProvider } from '../_components/motion/tier';
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../_components/motion/activity';
import { TransitionBench } from '../_components/motion/TransitionBench';
import { Drafting } from '../_components/screens/spawn/Drafting';
import { Seg } from '../_components/ui';

const MOMENTS: MomentKind[] = ['poof', 'evolve', 'born', 'retire', 'hop', 'perk', 'nod', 'wince', 'spin', 'squish', 'shy'];
const EXPRS: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];
const HAPTICS = Object.keys(haptic) as Array<keyof typeof haptic>;
const next = <T,>(list: readonly T[], v: T | undefined) => list[(list.indexOf(v as T) + 1) % list.length];
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

function Chips<T extends string | number>({ items, on, active, label }: { items: readonly T[]; on: (v: T) => void; active?: T; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
      {items.map((v) => <button key={String(v)} type="button" className="vx-chip" aria-pressed={active === v} onClick={() => on(v)}>{String(v)}</button>)}
    </div>
  );
}

/**
 * Every character moment, gesture, look change, expression and motion primitive on a button, with a
 * tier override (full / lite / reduced) so lite and reduced can be judged on any device.
 */
export function MotionPlayground() {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const detected = detectTier(reduced);
  const [tier, setTier] = useState<MotionTier>(detected);
  const [look, setLook] = useState<CharacterLook>(PRESET_LOOKS[1]);
  const [stage, setStage] = useState<Stage>(4);
  const [expr, setExpr] = useState<Expression>('idle');
  const [moment, setMoment] = useState<CloudMoment | null>(null);
  const [checks, setChecks] = useState(0);
  const [bursts, setBursts] = useState(0);
  const [count, setCount] = useState(128);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState<'off' | 'drafting' | 'arrived'>('off');
  // a stand-in voice: syllables while speaking, so lip-sync can be judged without audio
  const level = useMotionValue(0);
  useEffect(() => {
    if (expr !== 'speaking' && expr !== 'listening') { animate(level, 0, { duration: 0.2 }); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => { level.set(syllables((now - t0) / 1000) * 0.35); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expr, level]);

  const play = (kind: MomentKind) => {
    if (kind === 'evolve' && stage === 1) setStage(2);
    setMoment({ kind, key: Date.now(), fromStage: kind === 'evolve' ? (Math.max(1, (stage === 1 ? 2 : stage) - 1) as Stage) : undefined });
  };

  return (
    <TierProvider value={tier}>
      <section className="vx-section" aria-label="Motion" data-motion={tier}>
        <div className="vx-section-head"><span className="vx-over">Motion · this device: {detected}</span></div>
        <Seg label="Motion tier" value={tier} onChange={(t) => setTier(t as MotionTier)}
          options={[{ value: 'full', label: 'Full' }, { value: 'lite', label: 'Lite' }, { value: 'reduced', label: 'Reduced' }]} />
        {tier === 'reduced' && !reduced && <p className="vx-small vx-2" style={{ margin: '8px 0 0' }}>CSS loops follow the OS setting; the JS rig and moments follow this toggle.</p>}

        <div className="vx-card" style={{ padding: 16, marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ position: 'relative', height: 230, display: 'grid', placeItems: 'end center' }}>
            <Cloud look={look} size={200} stage={stage} expr={expr} level={level} moment={moment} onMomentEnd={() => setMoment(null)} label="Playground" />
          </div>
          <span className="vx-small vx-2">Tap the character to squish it, hold it to make it shy.</span>
          <span className="vx-over">Moments</span>
          <Chips label="Moments" items={MOMENTS} active={moment?.kind} on={play} />
          {moment?.kind === 'retire' && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setMoment(null)}>Restore</button>}
          <span className="vx-over">Expression</span>
          <Chips label="Expression" items={EXPRS} active={expr} on={setExpr} />
          <span className="vx-over">Stage</span>
          <Chips label="Stage" items={[1, 2, 3, 4] as Stage[]} active={stage} on={setStage} />
          <span className="vx-over">Look change (squash · swap · stretch)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="vx-chip" onClick={() => setLook((l) => ({ ...l, species: next(SPECIES, l.species ?? 'cloud') }))}>Species · {look.species ?? 'cloud'}</button>
            <button type="button" className="vx-chip" onClick={() => setLook((l) => ({ ...l, family: next(FAMILY_IDS, l.family) }))}>Shape · {look.family}</button>
            <button type="button" className="vx-chip" onClick={() => setLook((l) => ({ ...l, hair: next(HAIR_STYLES, l.hair ?? 'none') }))}>Hair · {look.hair ?? 'none'}</button>
            <button type="button" className="vx-chip" onClick={() => setLook((l) => ({ ...l, accessory: next(ACCESSORIES, l.accessory ?? 'none') }))}>Accessory · {look.accessory ?? 'none'}</button>
            <button type="button" className="vx-chip" onClick={() => setLook((l) => ({ ...l, hue: next(HUES, l.hue) }))}>Hue · {look.hue}</button>
            <button type="button" className="vx-chip" onClick={() => setLook(pick(PRESET_LOOKS))}>Dice</button>
          </div>
        </div>

        <div className="vx-section-head"><span className="vx-over">Feedback</span></div>
        <div className="vx-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="vx-chip" onClick={() => setChecks((n) => n + 1)}>Done check</button>
            <button type="button" className="vx-chip" onClick={() => setBursts((n) => n + 1)}>Hire burst</button>
            <button type="button" className="vx-chip" onClick={() => setCount((n) => n + Math.ceil(Math.random() * 40))}>Tick up</button>
            <button type="button" className="vx-chip" aria-pressed={working} onClick={() => setWorking((w) => !w)}>{working ? 'Finish' : 'Start'} long work</button>
          </div>
          <div style={{ position: 'relative', minHeight: 72, display: 'grid', placeItems: 'center' }}>
            {checks > 0 && <DoneCheck key={checks} />}
            {bursts > 0 && <Burst key={`b${bursts}`} kind="hire" />}
          </div>
          <span className="vx-title" style={{ fontSize: 40 }}><Ticker value={count} /></span>
          <ProgressPill active={working} labels={['Painting a portrait…', 'Mixing the colours…', 'Adding the details…']} tau={6} done="Portrait ready" />
        </div>

        <div className="vx-section-head"><span className="vx-over">Spawn drafting</span></div>
        <div className="vx-card" style={{ padding: 0, minHeight: draft === 'off' ? 0 : 520, display: 'flex', flexDirection: 'column' }}>
          {draft === 'off'
            ? <button type="button" className="vx-btn vx-btn-secondary" style={{ margin: 16 }} onClick={() => setDraft('drafting')}>Start drafting</button>
            : <>
              <Drafting look={draft === 'arrived' ? PRESET_LOOKS[5] : null} onDone={() => setTimeout(() => setDraft('off'), 1200)} />
              {draft === 'drafting' && <button type="button" className="vx-btn vx-btn-primary" style={{ margin: 16 }} onClick={() => setDraft('arrived')}>Draft arrives</button>}
            </>}
        </div>

        <div className="vx-section-head"><span className="vx-over">Transitions</span></div>
        <div className="vx-card" style={{ padding: 16 }}><TransitionBench /></div>
        <div className="vx-section-head"><span className="vx-over">Haptics</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {HAPTICS.map((h) => <button key={h} type="button" className="vx-chip" onClick={() => haptic[h]()}>{h}</button>)}
        </div>
      </section>
    </TierProvider>
  );
}
