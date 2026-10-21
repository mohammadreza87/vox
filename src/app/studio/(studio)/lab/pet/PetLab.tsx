'use client';

import { domMin, LazyMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PRESET_LOOKS, type Expression } from '@/lib/studio/character';
import { NEED_FLOOR, NEED_KEYS, QUIET_HOURS, type NeedKey, type PetAction, type PetCare, type Stage as StageN } from '@/lib/pet/types';
import { detectTier } from '../../../_lib/motion';
import { createPetEngine } from '../../../pet/_engine/loop';
import type { ReactionEvent, ReactionKind, Tier } from '../../../pet/_engine/types';
import { Bubble, Thought, type BubbleMsg } from '../../../pet/_ui/Bubble';
import { applyLocal, moodOf } from '../../../pet/_ui/care-local';
import type { EngineCue, PetEngine, ToyKind } from '../../../pet/_ui/contract';
import { NEED_LABEL, sayText } from '../../../pet/_ui/copy';
import { Dock, type Needs } from '../../../pet/_ui/Dock';
import { Particles } from '../../../pet/_ui/Particles';
import { PetRig } from '../../../pet/_ui/PetRig';
import { backdrop, characterBox, sceneAnchors } from '../../../pet/_ui/scene';
import { Stage } from '../../../pet/_ui/Stage';
import { EXTRA_EVENTS, SAMPLE_EVENTS } from './events';

const W = 360, H = 560;
const TIERS: Tier[] = ['full', 'lite', 'reduced'];
const STAGES: StageN[] = [1, 2, 3, 4];
const KINDS = Object.keys(SAMPLE_EVENTS) as ReactionKind[];
const inQuiet = (h: number) => (QUIET_HOURS.start > QUIET_HOURS.end ? h >= QUIET_HOURS.start || h < QUIET_HOURS.end : h >= QUIET_HOURS.start && h < QUIET_HOURS.end);

/** A care record around the sliders (time-of-day drives `asleep` through the quiet hours). */
function labCare(n: Needs, asleep: boolean): PetCare {
  const t = Date.now();
  return {
    v: 1, agentId: 'lab', userId: 1, ...n, bond: 10, asleep, lastUpdatedAt: t, lastSeenAt: t, firstMetAt: t - 3 * 86_400_000,
    tz: 'UTC', quietStart: QUIET_HOURS.start, quietEnd: QUIET_HOURS.end, lastSeenStage: 4,
    caps: { hourStart: t, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: t },
  };
}

const describe = (c: EngineCue) => {
  switch (c.type) {
    case 'expr': return `expr ${c.expr}`;
    case 'say': return `say ${typeof c.line === 'string' ? c.line : `“${c.line.text}”`}`;
    case 'thought': return `thought ${c.need}`;
    case 'care': return `care ${c.action}${c.n ? ` ×${c.n}` : ''}`;
    case 'score': return `score ${c.bops}/${c.misses}`;
    case 'playOver': return `playOver ${c.bops} ${c.won ? 'won' : 'lost'}`;
    case 'spoken': return 'spoken';
  }
};

function Chips<T extends string | number>({ items, active, on, label, name = String }: { items: readonly T[]; active?: T; on: (v: T) => void; label: string; name?: (v: T) => string }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
      {items.map((v) => <button key={String(v)} type="button" className="vx-chip" aria-pressed={active === v} onClick={() => on(v)}>{name(v)}</button>)}
    </div>
  );
}

/**
 * The pet lab (brief §4 row 11): the real engine, Stage, rig, particles and dock in a phone-sized frame.
 * Fire any reaction on any preset look and stage, set the needs and the hour (quiet hours put it to
 * sleep), and switch tiers (full / lite / reduced) to judge each on the device in hand.
 */
export function PetLab() {
  const [lookIdx, setLookIdx] = useState(0);
  const [stage, setStage] = useState<StageN>(3);
  const [tier, setTier] = useState<Tier>('full');
  const [needs, setNeeds] = useState<Needs>({ tummy: 72, joy: 64, energy: 80 });
  const [hour, setHour] = useState(14);
  const [expr, setExpr] = useState<Expression>('idle');
  const [bubble, setBubble] = useState<BubbleMsg | null>(null);
  const [thought, setThought] = useState<NeedKey | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [engine, setEngine] = useState<PetEngine | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const toys = useRef<Partial<Record<ToyKind, HTMLElement | null>>>({});

  const look = PRESET_LOOKS[lookIdx];
  const asleep = inQuiet(hour);
  const care = useMemo(() => labCare(needs, asleep), [needs, asleep]);
  const mood = useMemo(() => moodOf(care), [care]);
  const box = useMemo(() => characterBox(W, H, 0, H - 120), []);
  const bd = useMemo(() => backdrop(look), [look]);

  const cue = useRef<(c: EngineCue) => void>(() => {});
  cue.current = (c) => {
    setLog((l) => [describe(c), ...l].slice(0, 8));
    if (c.type === 'expr') setExpr(c.expr);
    if (c.type === 'say') setBubble({ id: performance.now(), text: sayText(c.line, 'Sara') });
    if (c.type === 'thought') { setThought(c.need); setTimeout(() => setThought(null), 2400); }
    // the lab applies care locally, so the rings answer like the page's optimistic care
    if (c.type === 'care') setNeeds((n) => { const r = applyLocal(labCare(n, asleep), c.action as PetAction, Date.now(), c.n).care; return { tummy: r.tummy, joy: r.joy, energy: r.energy }; });
  };

  useLayoutEffect(() => {
    const e = createPetEngine({ look, stage, size: box.size, tier, mood, seed: 7, onCue: (c: EngineCue) => cue.current(c) });
    setEngine(e);
    e.start();
    return () => { e.dispose(); setEngine(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { engine?.setLook(look, stage); }, [engine, look, stage]);
  useEffect(() => { engine?.setTier(tier); }, [engine, tier]);
  useEffect(() => { engine?.setMood(mood); }, [engine, mood]);
  useLayoutEffect(() => {
    const f = frame.current?.getBoundingClientRect();
    if (!engine || !f) return;
    const rel = (k: ToyKind) => { const r = toys.current[k]?.getBoundingClientRect(); return r && { left: r.left - f.left, top: r.top - f.top, width: r.width, height: r.height }; };
    engine.setSize(box.size);
    engine.setScene(sceneAnchors(W, H, box, { cookie: rel('cookie'), ball: rel('ball'), moon: rel('moon') }, null));
  }, [engine, box]);

  const fire = (e: ReactionEvent) => engine?.fire(e);

  return (
    <LazyMotion features={domMin}>
    <div className="vx">
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <header className="vx-pagehead" style={{ alignSelf: 'stretch' }}>
          <span className="vx-over">Vox Studio lab</span>
          <h1 className="vx-title">Pet</h1>
        </header>

        <div ref={frame} className="pet-root" data-embed="" data-pet-root="" data-tier={tier} data-stage={stage} data-tone={mood.tone} data-asleep={asleep ? '' : undefined}
          style={{ width: W, height: H, flexShrink: 0 }}>
          {engine && (
            <Stage engine={engine} backdrop={bd} box={box} embed
              over={<>
                <Particles engine={engine} />
                <Thought need={thought} top={box.y + box.size * 0.02} left={box.x + box.size * 0.82} />
                <Bubble msg={bubble} top={box.y + box.size * 0.2} onGone={(id) => setBubble((b) => (b?.id === id ? null : b))} />
              </>}>
              <PetRig engine={engine} look={look} stage={stage} size={box.size} label="Lab" expr={expr} />
            </Stage>
          )}
          {engine && (
            <div className="pet-bottom">
              <Dock needs={needs} onToy={(t) => engine.toy(t)} toyRef={(k, el) => { toys.current[k] = el; }} />
            </div>
          )}
        </div>

        <section className="vx-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'stretch' }} aria-label="Pet controls">
          <span className="vx-over">Tier · this device: {detectTier(false)}</span>
          <Chips label="Tier" items={TIERS} active={tier} on={setTier} />
          <span className="vx-over">Look</span>
          <Chips label="Look" items={PRESET_LOOKS.map((_, i) => i)} active={lookIdx} on={setLookIdx}
            name={(i) => `${i + 1} ${PRESET_LOOKS[i].species ?? 'cloud'}`} />
          <span className="vx-over">Stage</span>
          <Chips label="Stage" items={STAGES} active={stage} on={setStage} />
          {NEED_KEYS.map((k) => (
            <label key={k} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 32px', gap: 8, alignItems: 'center' }}>
              <span className="vx-small">{NEED_LABEL[k]}</span>
              <input type="range" min={NEED_FLOOR[k]} max={100} value={needs[k]} aria-label={NEED_LABEL[k]}
                onChange={(e) => setNeeds((n) => ({ ...n, [k]: Number(e.target.value) }))} />
              <span className="vx-small vx-2">{needs[k]}</span>
            </label>
          ))}
          <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr 32px', gap: 8, alignItems: 'center' }}>
            <span className="vx-small">Time</span>
            <input type="range" min={0} max={23} value={hour} aria-label="Time of day" onChange={(e) => setHour(Number(e.target.value))} />
            <span className="vx-small vx-2">{String(hour).padStart(2, '0')}h</span>
          </label>
          <span className="vx-small vx-2">Mood: {mood.level} · {mood.tone}{mood.asleep ? ' · asleep (quiet hours)' : ''}</span>

          <span className="vx-over">Reactions</span>
          <Chips label="Reactions" items={KINDS} on={(k) => fire(SAMPLE_EVENTS[k] as ReactionEvent)} />
          <Chips label="Variants" items={EXTRA_EVENTS.map((x) => x.label)} on={(l) => { const x = EXTRA_EVENTS.find((v) => v.label === l); if (x) fire(x.e as ReactionEvent); }} />
          <span className="vx-over">Talk</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {(['idle', 'listening', 'thinking', 'speaking'] as const).map((s) => <button key={s} type="button" className="vx-chip" onClick={() => engine?.talk(s)}>{s}</button>)}
            <button type="button" className="vx-chip" onClick={() => {
              const text = 'Oh hi! I was just counting clouds. Want to help me name them?';
              setBubble({ id: performance.now(), text });
              engine?.talk('speaking');
              engine?.speakText(text);
            }}>speak text</button>
          </div>
          <span className="vx-over">Cues</span>
          <ol aria-label="Engine cues" style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, lineHeight: '18px', color: 'var(--text-2)', minHeight: 72 }}>
            {log.map((l, i) => <li key={`${i}${l}`}>{l}</li>)}
          </ol>
        </section>
      </div>
    </div>
    </LazyMotion>
  );
}
