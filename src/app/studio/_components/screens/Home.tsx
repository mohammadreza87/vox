'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, type AgentView } from '../../_lib/client';
import { AgentFace, Cloud, PALETTE, stageFor } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Empty, Icon } from '../ui';

const FILTERS = ['All', 'Mine', 'Forming', 'Drafts', 'Retired'] as const;
type Filter = (typeof FILTERS)[number];

export function FormingRing({ day, color, size = 20 }: { day: number; color: string; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#282D35" strokeWidth={2.5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${(c * day) / 7} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

export function StatusLine({ agent }: { agent: AgentView }) {
  const pal = PALETTE[agent.look.hue];
  if (agent.status === 'fired') return <span className="vx-pill danger">RETIRED</span>;
  if (agent.status === 'draft') return <span className="vx-pill warn">DRAFT</span>;
  if (agent.status === 'awaiting_bot') return <span className="vx-pill warn">AWAITING BOT</span>;
  if (agent.locked) return <span className="vx-pill lock"><Icon name="lock" size={11} width={2.5} />LOCKED</span>;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <FormingRing day={agent.formingDay ?? 1} color={pal.base} />
      <span className="vx-small vx-2 vx-num">Forming · day {agent.formingDay}/7</span>
    </span>
  );
}

export function HomeScreen() {
  const nav = useNav();
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    api.agents().then((r) => setAgents(r.agents)).catch((e) => nav.toast(errorMessage(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = nav.me.member.telegramId;
  const shown = (agents ?? []).filter((a) => {
    if (filter === 'Retired') return a.status === 'fired';
    if (a.status === 'fired') return false;
    if (filter === 'Mine') return a.createdBy === me;
    if (filter === 'Forming') return a.status === 'active' && !a.locked;
    if (filter === 'Drafts') return a.status === 'draft' || a.status === 'awaiting_bot';
    return true;
  });
  const active = (agents ?? []).filter((a) => a.status === 'active');
  const forming = active.filter((a) => !a.locked).length;

  return (
    <>
      <div className="vx-scroll">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Cloud look={{ hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } }} size={32} label="Vox" />
            <span style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.02em' }}>Vox Studio</span>
          </div>
          <span className="vx-pill volt" style={{ textTransform: 'capitalize' }}>{nav.me.member.role}</span>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vx-over">{nav.me.org} · {active.length} agent{active.length === 1 ? '' : 's'}{forming ? ` · ${forming} forming` : ''}</span>
          <h1 className="vx-display">Your agents</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '16px -16px 0', padding: '0 16px' }}>
          {FILTERS.map((f) => (
            <button key={f} className="vx-chip" aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        {agents === null ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="vx-skeleton" style={{ height: 204, borderRadius: 24 }} />)}
          </div>
        ) : shown.length === 0 ? (
          <Empty
            title={filter === 'All' ? 'No agents yet' : `Nothing in ${filter}`}
            body={filter === 'All' ? 'Spawn your first colleague. Claude drafts the persona, you shape it.' : undefined}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
            {shown.map((a, i) => {
              const pal = PALETTE[a.look.hue];
              return (
                <motion.button key={a.id} className="vx-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3, ease: [0.05, 0.7, 0.1, 1] }} whileTap={{ scale: 0.97 }}
                  onClick={() => (a.status === 'draft' || a.status === 'awaiting_bot') ? nav.push({ name: 'spawn', draftId: a.id }) : nav.push({ name: 'agent', id: a.id })}
                  aria-label={`${a.persona.name}, ${a.persona.role}`}
                  style={{ position: 'relative', height: 208, padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: '50%', top: 16, width: 120, height: 120, marginLeft: -60, borderRadius: '50%', background: pal.glow, opacity: 0.16 }} />
                  {a.isAdmin && <span className="vx-pill volt" style={{ position: 'absolute', top: 12, left: 12 }}>Admin</span>}
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6, position: 'relative', opacity: a.status === 'fired' ? 0.5 : 1 }}>
                    <AgentFace look={a.look} size={100} stage={stageFor(a.formingDay, a.status)} expr={a.status === 'fired' ? 'sleeping' : 'idle'} label={a.persona.name} />
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <span className="vx-head" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.persona.name}</span>
                    <span className="vx-small vx-2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.persona.role}</span>
                  </div>
                  <div style={{ marginTop: 8, height: 22, display: 'flex', alignItems: 'center' }}><StatusLine agent={a} /></div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
      <motion.button className="vx-btn vx-btn-primary" onClick={() => nav.push({ name: 'spawn' })} whileTap={{ scale: 0.95 }}
        style={{ position: 'absolute', right: 16, bottom: 'calc(92px + env(safe-area-inset-bottom))', height: 56, paddingLeft: 16, boxShadow: '0 12px 32px rgba(214,255,92,.22)', zIndex: 7 }}>
        <Icon name="plus" width={2} />Spawn
      </motion.button>
    </>
  );
}
