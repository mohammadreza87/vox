'use client';

import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, type AgentView } from '../../_lib/client';
import { Cloud } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, TopBar } from '../ui';

const REASONS = ['Wrong personality', 'Role changed', 'Not needed anymore', 'Start fresh'];
const POLICIES = [
  { value: 'transfer', title: 'Pass memories on', body: 'A successor you hire next inherits what they know.' },
  { value: 'archive', title: 'Archive', body: 'Kept, but no agent uses them.' },
  { value: 'delete', title: 'Delete forever', body: 'Every memory is erased. This can’t be undone.' },
] as const;
const HOLD_MS = 1600;

export function FireScreen({ id }: { id: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState<(typeof POLICIES)[number]['value']>('transfer');
  const [confirmName, setConfirmName] = useState('');
  const [firing, setFiring] = useState(false);
  const [done, setDone] = useState<AgentView | null>(null);
  const progress = useMotionValue(0);
  const width = useTransform(progress, (v) => `${v * 100}%`);
  const hold = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    api.agent(id).then((r) => setAgent(r.agent)).catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!agent) return <><TopBar onBack={nav.back} /><LoadingFill /></>;
  const name = agent.persona.name;
  const ready = reason.trim().length > 0 && confirmName.trim().toLowerCase() === name.trim().toLowerCase();

  const fire = async () => {
    setFiring(true);
    try {
      const r = await api.fire(id, { reason, memoryPolicy: policy, confirmName });
      haptic.success();
      setDone(r.agent);
    } catch (e) {
      haptic.error();
      nav.toast(errorMessage(e), 'error');
      progress.set(0);
    } finally {
      setFiring(false);
    }
  };

  const press = () => {
    if (!ready || firing) return;
    haptic.tap();
    hold.current = animate(progress, 1, { duration: HOLD_MS / 1000 * (1 - progress.get()), ease: 'linear', onComplete: () => { haptic.heavy(); void fire(); } });
  };
  const release = () => {
    if (progress.get() >= 1) return;
    hold.current?.stop();
    animate(progress, 0, { duration: 0.25 });
  };

  if (done) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
        <motion.div initial={{ y: 0, opacity: 1 }} animate={{ y: [-4, -30], opacity: [1, 0.55] }} transition={{ duration: 2.4, ease: 'easeOut' }}>
          <Cloud look={{ ...agent.look, hue: 'ash' }} size={150} expr="sleeping" label={name} />
        </motion.div>
        <h1 className="vx-title">Goodbye, {name}</h1>
        <p className="vx-2" style={{ margin: 0, maxWidth: 300 }}>
          {name} has left every group and stopped answering.{' '}
          {policy === 'transfer' ? 'Their memories wait for a successor.' : policy === 'archive' ? 'Their memories are archived.' : 'Their memories are gone.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340 }}>
          <button className="vx-btn vx-btn-primary" onClick={() => nav.reset({ name: 'home' }, { name: 'spawn', successorOf: id })}><Icon name="plus" width={2} />Hire a successor</button>
          <button className="vx-btn vx-btn-secondary" onClick={() => nav.reset({ name: 'home' })}>Back to agents</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <TopBar onBack={nav.back} backLabel={name} />
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <Cloud look={agent.look} size={110} expr="sleeping" label={name} />
          <h1 className="vx-title">Fire {name}?</h1>
          <p className="vx-2" style={{ margin: 0 }}>A personality is permanent once formed. To change who they are, retire them and hire a new spawn.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">Why</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => <button key={r} className="vx-chip" aria-pressed={reason === r} onClick={() => { haptic.select(); setReason(r); }}>{r}</button>)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vx-over">Their memories</span>
          <div className="vx-group" role="radiogroup">
            {POLICIES.map((p) => (
              <button key={p.value} role="radio" aria-checked={policy === p.value} className="vx-row" onClick={() => { haptic.select(); setPolicy(p.value); }}
                style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: `2px solid ${policy === p.value ? (p.value === 'delete' ? '#FF6B5E' : '#D6FF5C') : '#7D828C'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {policy === p.value && <motion.span layoutId="fire-radio" style={{ width: 10, height: 10, borderRadius: '50%', background: p.value === 'delete' ? '#FF6B5E' : '#D6FF5C' }} />}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: p.value === 'delete' ? '#FF6B5E' : undefined }}>{p.title}</span>
                  <span className="vx-small vx-2">{p.body}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="vx-over">Type “{name}” to confirm</span>
          <input className="vx-input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="vx-dock">
        <button className="vx-btn vx-btn-danger vx-btn-block" disabled={!ready || firing}
          onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) press(); } }}
          onKeyUp={release} onContextMenu={(e) => e.preventDefault()}
          style={{ position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}>
          <motion.span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width, background: 'rgba(255,107,94,.3)' }} />
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="warn" size={18} width={2} />{firing ? 'Firing…' : `Hold to fire ${name}`}
          </span>
        </button>
      </div>
    </>
  );
}
