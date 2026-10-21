'use client';

import { animate, motion, useIsPresent, useMotionValueEvent, useMotionValue } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { FIRE_REASONS, fireCopy, type FirePolicy } from '../../_lib/agents-copy';
import { api, haptic, type AgentView } from '../../_lib/client';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { Cloud } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, Radio, Row, TopBar } from '../ui';

/** The server stores the English reason; the chip shows it in the reader's language. */
const REASONS = FIRE_REASONS;
const POLICIES: readonly FirePolicy[] = ['transfer', 'archive', 'delete'];
const HOLD_MS = 1600;
const RETIRE = { kind: 'retire', key: 'fired' } as const;

export function FireScreen({ id }: { id: string }) {
  const nav = useNav();
  const c = fireCopy[nav.locale ?? 'en'];
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache?.get(id) ?? null);
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState<FirePolicy>('transfer');
  const [confirmName, setConfirmName] = useState('');
  const [firing, setFiring] = useState(false);
  const [done, setDone] = useState<AgentView | null>(null);
  // Hold progress 0..1 drives a scaleX fill (P5): transform only, growing from the reading start edge.
  const progress = useMotionValue(0);
  const hold = useRef<ReturnType<typeof animate> | null>(null);
  const label = useRef<HTMLSpanElement>(null);
  const passed = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const [nameWrong, setNameWrong] = useState(false);
  useMotionValueEvent(progress, 'change', (v) => {
    // select at 33 % and 66 % while filling (motion §5.10); the text trembles past 70 %, no re-render
    const step = v >= 2 / 3 ? 2 : v >= 1 / 3 ? 1 : 0;
    if (step > passed.current && hold.current) haptic.select();
    passed.current = step;
    label.current?.classList.toggle('vx-tremble', v > 0.7 && v < 1);
  });

  useEffect(() => {
    api.agent(id).then((r) => { nav.cache?.set(id, r.agent); setAgent(r.agent); }).catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A hold must never outlive the screen: the motion value's animation keeps running after unmount, and a
  // person who backs out mid-hold (Telegram back, a second finger on ✕) must not fire the agent.
  const present = useIsPresent();
  const here = useRef(true);
  here.current = present;
  const dropHold = () => { hold.current?.stop(); hold.current = null; };
  useEffect(() => { if (!present) dropHold(); }, [present]);
  useEffect(() => () => { here.current = false; dropHold(); }, []);

  useEffect(() => {
    if (!nameWrong) return;
    const t = setTimeout(() => setNameWrong(false), 1200);
    return () => clearTimeout(t);
  }, [nameWrong]);

  if (!agent) return <><TopBar lead="close" onLead={nav.back} /><LoadingFill /></>;
  const name = agent.persona.name;
  const nameMatches = confirmName.trim().toLowerCase() === name.trim().toLowerCase();
  const ready = reason.trim().length > 0 && nameMatches;
  /** A typed name that doesn't match shakes once on blur (the border stays red for 1.2 s). */
  const checkName = () => {
    const el = nameInput.current;
    if (!el || !confirmName.trim() || nameMatches) return;
    haptic.error();
    setNameWrong(true);
    el.classList.remove('vx-shake');
    void el.offsetWidth;
    el.classList.add('vx-shake');
  };

  const fire = async () => {
    setFiring(true);
    try {
      const r = await api.fire(id, { reason, memoryPolicy: policy, confirmName });
      if (!here.current) return;
      // sombre: the hold's heavy beat was the only haptic (motion §4.15)
      nav.cache?.set(id, r.agent);
      setDone(r.agent);
    } catch (e) {
      if (!here.current) return;
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      progress.set(0);
    } finally {
      if (here.current) setFiring(false);
    }
  };

  const press = () => {
    if (!ready || firing || !here.current) return;
    haptic.tap();
    hold.current = animate(progress, 1, { duration: HOLD_MS / 1000 * (1 - progress.get()), ease: 'linear', onComplete: () => {
      hold.current = null;
      if (!here.current) return;
      haptic.heavy();
      void fire();
    } });
  };
  const release = () => {
    if (progress.get() >= 1) return;
    hold.current?.stop();
    hold.current = null;
    animate(progress, 0, SPRING.snappy);
  };

  if (done) {
    const enter = (delay: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: DUR.slow, ease: EASE.enter, delay } });
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
        <div style={{ height: 176, display: 'flex', alignItems: 'flex-end' }}>
          <Cloud look={agent.look} size={150} stage={agent.stage} expr="sleeping" label={name} moment={RETIRE} glow={0.3} />
        </div>
        <motion.h1 className="vx-title" {...enter(0.5)}>{c.goodbye(name)}</motion.h1>
        <motion.p className="vx-2" style={{ margin: 0, maxWidth: 300 }} {...enter(0.7)}>
          {c.left(name)}{' '}{c.after[policy]}
        </motion.p>
        <motion.div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340 }} {...enter(1)}>
          <button className="vx-btn vx-btn-primary" onClick={() => nav.reset({ name: 'home' }, { name: 'spawn', successorOf: id })}><Icon name="plus" width={2} />{c.hireSuccessor}</button>
          <button className="vx-btn vx-btn-secondary" onClick={() => nav.reset({ name: 'home' })}>{c.backToAgents}</button>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <TopBar lead="close" onLead={nav.back} title={c.title(name)} />
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <Cloud look={agent.look} size={110} stage={agent.stage} expr="sleeping" label={name} />
          <h1 className="vx-title">{c.question(name)}</h1>
          <p className="vx-2" style={{ margin: 0 }}>{c.permanent}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">{c.why}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => <button key={r} className="vx-chip" aria-pressed={reason === r} onClick={() => { haptic.select(); setReason(r); }}>{c.reasons[r]}</button>)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">{c.memories}</span>
          <div className="vx-group" role="radiogroup" aria-label={c.memories}>
            {POLICIES.map((p) => (
              <Row key={p} role="radio" aria-checked={policy === p} lead={<Radio />} title={c.policies[p].title} sub={c.policies[p].body} plain
                tone={p === 'delete' ? 'danger' : undefined} onClick={() => { haptic.select(); setPolicy(p); }} />
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="vx-over">{c.typeName(name)}</span>
          <input ref={nameInput} className="vx-input" value={confirmName} onChange={(e) => { setConfirmName(e.target.value); setNameWrong(false); }} onBlur={checkName}
            onAnimationEnd={(e) => e.currentTarget.classList.remove('vx-shake')} aria-invalid={nameWrong || undefined}
            autoComplete="off" spellCheck={false} style={nameWrong ? { borderColor: 'var(--danger)' } : undefined} />
        </label>
      </div>
      <div className="vx-dock">
        <button className="vx-btn vx-btn-danger vx-btn-block" disabled={!ready || firing}
          onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) press(); } }}
          onKeyUp={release} onContextMenu={(e) => e.preventDefault()}
          style={{ position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}>
          <motion.span aria-hidden="true" style={{ position: 'absolute', inset: 0, scaleX: progress, transformOrigin: nav.dir === 'rtl' ? 'right' : 'left', background: 'rgba(255,107,94,.3)' }} />
          <span ref={label} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="warn" size={18} width={2} />{firing ? c.firing : c.hold(name)}
          </span>
        </button>
      </div>
    </>
  );
}
