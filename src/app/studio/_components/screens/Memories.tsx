'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, haptic, type AgentView, type MemoryItem } from '../../_lib/client';
import { AgentFace } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Empty, Icon, TopBar } from '../ui';

const FILTERS = ['All', 'Private', 'Shared'] as const;

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MemoriesScreen({ id }: { id: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

  useEffect(() => {
    Promise.all([api.agent(id), api.memories(id)])
      .then(([a, m]) => { setAgent(a.agent); setMemories(m.memories); })
      .catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!agent || !memories) return <><TopBar onBack={nav.back} /><LoadingFill /></>;

  const shown = memories.filter((m) => filter === 'All' || (filter === 'Private' ? m.scope === 'private' : m.scope !== 'private'));

  const forget = async (m: MemoryItem) => {
    if (!confirm(`${agent.persona.name} will forget this for good.`)) return;
    try {
      await api.forget(id, m.id);
      haptic.success();
      setMemories((all) => all?.filter((x) => x.id !== m.id) ?? null);
    } catch (e) {
      nav.toast(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <TopBar onBack={nav.back} backLabel={agent.persona.name} />
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <AgentFace look={agent.look} size={56} expr="thinking" label={agent.persona.name} />
          <div>
            <h1 className="vx-title">What {agent.persona.name} remembers</h1>
            <div className="vx-small vx-2">Only what you’re allowed to see: your private memories and what’s shared with your groups.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => <button key={f} className="vx-chip" aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>)}
        </div>
        {shown.length === 0 ? (
          <Empty title="Nothing yet" body={`Talk to ${agent.persona.name} and memories form on their own. You can always delete what you said.`} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AnimatePresence initial={false}>
              {shown.map((m, i) => (
                <motion.div key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                  exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }} className="vx-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: '21px' }}>{m.content}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span className={`vx-pill ${m.scope === 'private' ? 'lock' : 'volt'}`} style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '22px' }}>{m.scopeLabel}</span>
                      <span className="vx-small vx-3">{m.mine ? 'You' : m.from} · {when(m.at)}</span>
                    </div>
                  </div>
                  {m.mine && (
                    <button className="vx-icon-btn" aria-label="Forget this" onClick={() => forget(m)} style={{ width: 36, height: 36, color: '#7D828C' }}>
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}
