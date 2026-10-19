'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, haptic, type AgentView, type Member, type MemoryItem } from '../../_lib/client';
import { AgentFace } from '../Cloud';
import { RelationshipPanel } from '../RelationshipPanel';
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
  const [people, setPeople] = useState<Member[]>([]);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<number[]>([]);
  const [shareError, setShareError] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [forgetId, setForgetId] = useState<string | null>(null);
  const [legacySharing, setLegacySharing] = useState(false);

  useEffect(() => {
    Promise.all([api.agent(id), api.memories(id)])
      .then(([a, m]) => { setAgent(a.agent); setMemories(m.memories); })
      .catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    api.members().then(({ people: members }) => setPeople(members)).catch(() => setPeople([]));
    api.me().then(({ features }) => setLegacySharing(features.legacyMemorySharing === true)).catch(() => setLegacySharing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!agent || !memories) return <><TopBar onBack={nav.back} /><LoadingFill /></>;

  const shown = memories.filter((m) => filter === 'All' || (filter === 'Private' ? m.scope === 'private' : m.scope !== 'private'));

  const forget = async (m: MemoryItem) => {
    try {
      await api.forget(id, m.id);
      haptic.success();
      setMemories((all) => all?.filter((x) => x.id !== m.id) ?? null);
      setForgetId(null);
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
        <RelationshipPanel agentId={id} name={agent.persona.name} />
        <div style={{ display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => <button key={f} className="vx-chip" aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>)}
        </div>
        {shown.length === 0 ? (
          <Empty title="Nothing yet" body="Use Privacy to save private notes, or Shared memories to choose exactly who can access a note. You can inspect and delete saved memories." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AnimatePresence initial={false}>
              {shown.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <motion.div key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}
                  exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }} className="vx-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: '21px' }}>{m.content}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span className={`vx-pill ${m.scope === 'private' ? 'lock' : 'volt'}`} style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '22px' }}>{m.scopeLabel}</span>
                      <span className="vx-small vx-3">{m.mine ? 'You' : m.from} · {when(m.at)}</span>
                    </div>
                  </div>
                  {m.mine && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button className="vx-icon-btn" aria-label="Forget this" aria-expanded={forgetId === m.id} onClick={() => setForgetId(forgetId === m.id ? null : m.id)} style={{ width: 36, height: 36, color: '#7D828C' }}><Icon name="trash" size={18} /></button>
                    {legacySharing && !['personal', 'confidential', 'sensitive'].includes(m.sensitivity.toLowerCase()) && <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => { setSharingId(sharingId === m.id ? null : m.id); setRecipients([]); setShareError(''); }} aria-expanded={sharingId === m.id}>Share</button>}
                  </div>}
                </motion.div>
                {forgetId === m.id && <div role="group" aria-label="Forget memory confirmation" className="vx-group" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="vx-small">{agent.persona.name} will forget this for good.</span><button className="vx-btn vx-btn-danger vx-btn-sm" onClick={() => void forget(m)}>Forget</button><button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => setForgetId(null)}>Keep memory</button></div>}
                {sharingId === m.id && <div key={`${m.id}-share`} className="vx-group" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="vx-small">Choose who can see this memory. You can take access away later.</div>
                  {people.filter(person => person.role !== 'pending').length === 0 ? <p className="vx-small vx-2" style={{ margin: 0 }}>No people are available to share with yet.</p> : people.filter(person => person.role !== 'pending').map(person => <label key={person.telegramId} className="vx-small" style={{ display: 'flex', gap: 9, alignItems: 'center' }}><input type="checkbox" checked={recipients.includes(person.telegramId)} onChange={e => setRecipients(r => e.target.checked ? [...r, person.telegramId] : r.filter(x => x !== person.telegramId))} />{person.name}</label>)}
                  {shareError && <div role="alert" className="vx-small" style={{ color: '#FF6B5E' }}>{shareError}</div>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={shareBusy || recipients.length === 0} onClick={async () => { setShareBusy(true); setShareError(''); try { await api.shareMemory(id, m.id, recipients); setMemories(all => all?.map(x => x.id === m.id ? { ...x, scope: 'shared', scopeLabel: 'Shared with selected people' } : x) ?? null); setSharingId(null); haptic.success(); } catch (e) { setShareError(errorMessage(e)); } finally { setShareBusy(false); } }}>Share with selected</button>
                    {m.scope !== 'private' && <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={shareBusy} onClick={async () => { setShareBusy(true); setShareError(''); try { await api.revokeMemory(id, m.id); setMemories(all => all?.map(x => x.id === m.id ? { ...x, scope: 'private', scopeLabel: 'Private to you' } : x) ?? null); setSharingId(null); haptic.success(); } catch (e) { setShareError(errorMessage(e)); } finally { setShareBusy(false); } }}>Stop sharing</button>}
                    <button className="vx-btn vx-btn-secondary vx-btn-sm" disabled={shareBusy} onClick={() => setSharingId(null)}>Cancel</button>
                  </div>
                </div>}
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}
