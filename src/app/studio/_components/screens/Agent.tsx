'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, haptic, openTelegram, type AgentView, type AgentVisibility, type Member } from '../../_lib/client';
import { AgentFace, PALETTE, stageFor } from '../Cloud';
import { errorMessage, LoadingFill, useNav } from '../StudioApp';
import { Icon, Sheet, Spinner, TopBar } from '../ui';

function FormingHalo({ day, color, size }: { day: number; color: string; size: number }) {
  const cx = size / 2, r = size / 2 - 6, seg = 360 / 7, gap = 4;
  const pt = (deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cx + r * Math.sin(a)]; };
  const arc = (a0: number, a1: number) => { const [x0, y0] = pt(a0); const [x1, y1] = pt(a1); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };
  return (
    <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => {
        const a0 = i * seg + gap / 2, a1 = (i + 1) * seg - gap / 2;
        return (
          <g key={i}>
            <path d={arc(a0, a1)} fill="none" stroke="#282D35" strokeWidth={6} strokeLinecap="round" />
            {i < day && (
              <motion.path d={arc(a0, a1)} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LockSeal({ size }: { size: number }) {
  return (
    <motion.div initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.3 }}
      style={{ position: 'absolute', right: size * 0.08, bottom: size * 0.08, width: 40, height: 40, borderRadius: '50%', background: '#8FB8FF', color: '#0E1013', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px #0E1013' }}>
      <Icon name="lock" size={18} width={2.25} />
    </motion.div>
  );
}

function timeLeft(lockAt?: string): string {
  if (!lockAt) return '';
  const ms = new Date(lockAt).getTime() - Date.now();
  if (ms <= 0) return 'moments';
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function AgentScreen({ id }: { id: string }) {
  const nav = useNav();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [sheet, setSheet] = useState<'admin' | 'visibility' | null>(null);
  const [people, setPeople] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.agent(id).then((r) => setAgent(r.agent)).catch((e) => { nav.toast(errorMessage(e), 'error'); nav.back(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!agent) return <><TopBar onBack={nav.back} backLabel="Agents" /><LoadingFill /></>;

  const pal = PALETTE[agent.look.hue];
  const isSuper = nav.me.member.role === 'superadmin' || nav.me.member.role === 'owner';
  const active = agent.status === 'active';
  const fired = agent.status === 'fired';
  const p = agent.persona;

  const addToGroup = async () => {
    try {
      const { link } = await api.groupLink(agent.id);
      openTelegram(link);
    } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };

  const toggleAdmin = async () => {
    setBusy(true);
    try {
      const r = await api.setAgentAdmin(agent.id, !agent.isAdmin);
      setAgent(r.agent);
      haptic.success();
      nav.toast(r.agent.isAdmin ? `${p.name} is now an admin` : `${p.name} is no longer an admin`);
      setSheet(null);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const openVisibility = () => {
    setSheet('visibility');
    if (!people) api.members().then((r) => setPeople(r.people)).catch(() => setPeople([]));
  };

  const chooseVisibility = async (v: AgentVisibility) => {
    if (v === agent.visibility) return;
    setBusy(true);
    try {
      const r = await api.setVisibility(agent.id, v);
      setAgent(r.agent);
      haptic.success();
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const toggleLiveWeb = async () => {
    setBusy(true);
    try {
      const r = await api.setLiveWeb(agent.id, !agent.liveWeb);
      setAgent(r.agent);
      haptic.success();
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const syncProfile = async () => {
    setBusy(true);
    try {
      const r = await api.syncProfile(agent.id);
      setAgent(r.agent);
      if (r.failed.length) { haptic.error(); nav.toast(`Telegram refused: ${r.failed.join(', ')}. Try again in a minute.`, 'error'); }
      else { haptic.success(); nav.toast(`@${agent.bot?.username} now has ${p.name}'s name and photo`); }
      setSheet(null);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const allowList = Array.isArray(agent.access) ? agent.access : [];
  const toggleAllowed = async (telegramId: number) => {
    const next = allowList.includes(telegramId) ? allowList.filter((x) => x !== telegramId) : [...allowList, telegramId];
    try {
      const r = await api.setAccess(agent.id, next);
      setAgent(r.agent);
      haptic.select();
    } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };

  const unblock = async (telegramId: number) => {
    try {
      setAgent((await api.unblock(agent.id, telegramId)).agent);
      haptic.success();
    } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };

  const actions = [
    { label: 'Chat', icon: 'chat', run: () => agent.bot && openTelegram(`https://t.me/${agent.bot.username}`) },
    { label: 'Call', icon: 'phone', run: () => nav.push({ name: 'call', id: agent.id }) },
    { label: 'Group', icon: 'groups', run: addToGroup },
    { label: 'Memories', icon: 'memory', run: () => nav.push({ name: 'memories', id: agent.id }) },
  ];

  return (
    <>
      <TopBar onBack={nav.back} backLabel="Agents" right={
        (agent.canFire || isSuper || agent.canManageAccess) && active
          ? <button className="vx-icon-btn" aria-label="Manage" onClick={() => setSheet('admin')}><Icon name="more" width={3} /></button>
          : undefined
      } />
      <div className="vx-scroll" style={{ paddingTop: 0 }}>
        <div style={{ position: 'absolute', left: -60, top: -40, width: 510, height: 420, background: `radial-gradient(closest-side, ${pal.glow}38, transparent)`, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {active && !agent.locked && <FormingHalo day={agent.formingDay ?? 1} color={pal.base} size={220} />}
            <AgentFace look={agent.look} size={agent.look.avatar ? 168 : 172} stage={stageFor(agent.formingDay, agent.status)} expr={fired ? 'sleeping' : 'idle'} label={p.name} />
            {agent.locked && <LockSeal size={220} />}
          </div>
          <h1 className="vx-display" style={{ marginTop: 6 }}>{p.name}</h1>
          <span className="vx-small vx-2">{p.role}{agent.bot ? ` · @${agent.bot.username}` : ''}</span>
          {agent.isAdmin && <span className="vx-pill volt" style={{ marginTop: 8 }}>Admin agent</span>}
        </div>

        <div style={{ position: 'relative', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {active && !agent.locked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px 12px 16px', borderRadius: 16, background: `${pal.base}1F` }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="vx-over" style={{ color: pal.base }}>Forming · day {agent.formingDay} of 7</span>
                <span>Personality editable for <b className="vx-num" style={{ fontFamily: 'var(--font-unbounded)', fontWeight: 500 }}>{timeLeft(agent.lockAt)}</b></span>
              </div>
              {agent.canEdit && <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => nav.push({ name: 'spawn', draftId: agent.id })}>Refine</button>}
            </div>
          )}
          {agent.locked && (
            <div className="vx-banner info">
              <Icon name="lock" size={18} style={{ color: '#8FB8FF', flexShrink: 0 }} />
              <span>{p.name}&apos;s personality is locked for good. To change who {p.name} is, an admin fires and hires a successor.</span>
            </div>
          )}
          {fired && (
            <div className="vx-banner danger">
              <Icon name="warn" size={18} style={{ color: '#FF6B5E', flexShrink: 0 }} />
              <span>Retired {agent.firedAt ? new Date(agent.firedAt).toLocaleDateString() : ''}. {agent.firedReason}</span>
            </div>
          )}

          {active && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {actions.map((a) => (
                <button key={a.label} onClick={a.run} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#F2F1EC' }}>
                  <motion.span whileTap={{ scale: 0.92 }} style={{ width: 56, height: 56, borderRadius: '50%', background: '#1E2228', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={a.icon} />
                  </motion.span>
                  <span className="vx-small" style={{ fontWeight: 500 }}>{a.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="vx-group" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="vx-over">Who {p.name} is</span>
            {p.tagline && <p style={{ margin: 0, fontWeight: 600 }}>{p.tagline}</p>}
            <p style={{ margin: 0 }}>{p.personality}</p>
            <p className="vx-2" style={{ margin: 0 }}>{p.backstory}</p>
            {p.expertise.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {p.expertise.map((x) => <span key={x} className="vx-pill" style={{ background: '#1E2228', color: '#A9ADB5', height: 26, fontWeight: 500 }}>{x}</span>)}
              </div>
            )}
            {p.wontDo && <p className="vx-small" style={{ margin: 0, color: '#FFC24B' }}>Won&apos;t do: <span className="vx-2">{p.wontDo}</span></p>}
          </div>

          <div className="vx-group">
            <div className="vx-row"><span className="vx-2" style={{ flex: 1 }}>Voice</span><span>{agent.voice?.label ?? 'Text only'}</span></div>
            <div className="vx-row"><span className="vx-2" style={{ flex: 1 }}>Languages</span><span>{p.languages.join(', ')}</span></div>
            <div className="vx-row"><span className="vx-2" style={{ flex: 1 }}>Who can talk</span><span>{visibilityLabel(agent, nav.me.org)}</span></div>
            <div className="vx-row"><span className="vx-2" style={{ flex: 1 }}>Live web</span><span>{agent.liveWeb ? 'Searches when needed' : 'Off'}</span></div>
            <div className="vx-row"><span className="vx-2" style={{ flex: 1 }}>Hired by</span><span>{agent.creatorName ?? '—'}</span></div>
          </div>

          {fired && nav.me.member.role !== 'member' && (
            <button className="vx-btn vx-btn-primary vx-btn-block" onClick={() => nav.push({ name: 'spawn', successorOf: agent.id })}>Hire a successor</button>
          )}
        </div>
      </div>

      {active && (
        <div className="vx-dock">
          <button className="vx-btn vx-btn-primary vx-btn-block" onClick={() => nav.push({ name: 'call', id: agent.id })}><Icon name="phone" width={2} />Call {p.name}</button>
        </div>
      )}

      <Sheet open={sheet === 'admin'} onClose={() => setSheet(null)} label={`Manage ${p.name}`}>
        <h2 className="vx-title-m" style={{ marginBottom: 12 }}>Manage {p.name}</h2>
        <div className="vx-group">
          {agent.canManageAccess && (
            <button className="vx-row" onClick={openVisibility} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 1 }}>Who can talk to {p.name}</span>
              <span className="vx-small vx-2">{visibilityLabel(agent, nav.me.org)}</span>
            </button>
          )}
          {agent.canManageAccess && (
            <button className="vx-row" role="switch" aria-checked={agent.liveWeb} disabled={busy} onClick={toggleLiveWeb} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid rgba(255,255,255,.08)', color: 'inherit' }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Live web search</span>
                <span className="vx-small vx-2">News, prices, weather and other live facts, with sources</span>
              </span>
              <span style={{ width: 44, height: 26, borderRadius: 13, padding: 3, flexShrink: 0, background: agent.liveWeb ? '#D6FF5C' : '#3A3F48', transition: 'background .2s', display: 'flex', justifyContent: agent.liveWeb ? 'flex-end' : 'flex-start' }}>
                <motion.span layout style={{ width: 20, height: 20, borderRadius: '50%', background: agent.liveWeb ? '#0E1013' : '#A9ADB5' }} />
              </span>
            </button>
          )}
          {(agent.canManageAccess || agent.canEdit) && agent.bot && (
            <button className="vx-row" disabled={busy} onClick={syncProfile} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid rgba(255,255,255,.08)', color: 'inherit' }}>
              <span style={{ flex: 1 }}>Update Telegram name &amp; photo</span>
              {busy ? <Spinner /> : <span className="vx-small vx-3">@{agent.bot.username}</span>}
            </button>
          )}
          {isSuper && (
            <button className="vx-row" disabled={busy} onClick={toggleAdmin} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <span style={{ flex: 1 }}>{agent.isAdmin ? 'Remove admin rights' : 'Make admin'}</span>
              <span className="vx-small vx-3">Superadmin</span>
            </button>
          )}
          {agent.canFire && (
            <button className="vx-row" onClick={() => { setSheet(null); nav.push({ name: 'fire', id: agent.id }); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: '#FF6B5E', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <span style={{ flex: 1 }}>{agent.locked ? 'Fire & re-hire' : `Fire ${p.name}`}</span>
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === 'visibility'} onClose={() => setSheet(null)} label={`Who can talk to ${p.name}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="vx-title-m" style={{ margin: 0 }}>Who can talk to {p.name}</h2>
          <div className="vx-group" role="radiogroup">
            {VISIBILITY_OPTIONS.map((o) => {
              const on = agent.visibility === o.value;
              return (
                <button key={o.value} role="radio" aria-checked={on} className="vx-row" disabled={busy} onClick={() => chooseVisibility(o.value)}
                  style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: 'pointer', color: 'inherit', alignItems: 'flex-start' }}>
                  <span style={{ width: 20, height: 20, marginTop: 2, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? '#D6FF5C' : '#7D828C'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#D6FF5C' }} />}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{o.title(nav.me.org)}</span>
                    <span className="vx-small vx-2">{o.body(p.name, nav.me.org, p.openness)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="vx-small vx-3" style={{ margin: 0 }}>Groups you add {p.name} to are always open to everyone in them. People outside {nav.me.org} never see internal memories.</p>

          {agent.visibility === 'private' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="vx-over">People who can talk to {p.name}</span>
              {people === null ? <div className="vx-skeleton" style={{ height: 56 }} /> : (
                <div className="vx-group">
                  {people.filter((m) => m.role !== 'pending').map((m) => {
                    const always = m.telegramId === agent.createdBy || ['admin', 'superadmin', 'owner'].includes(m.role);
                    const on = always || allowList.includes(m.telegramId);
                    return (
                      <button key={m.telegramId} className="vx-row" disabled={always} onClick={() => toggleAllowed(m.telegramId)} aria-pressed={on}
                        style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: always ? 'default' : 'pointer', color: 'inherit' }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                        {always
                          ? <span className="vx-small vx-3">{m.telegramId === agent.createdBy ? 'Creator' : 'Admin'}</span>
                          : <span style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? '#D6FF5C' : '#7D828C'}`, background: on ? '#D6FF5C' : 'transparent', color: '#0E1013', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {on && <Icon name="check" size={14} width={3} />}
                            </span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(agent.blocked?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="vx-over">Blocked by {p.name} · {agent.blocked!.length}</span>
              <div className="vx-group">
                {agent.blocked!.map((tgId) => (
                  <div key={tgId} className="vx-row">
                    <span className="vx-num" style={{ flex: 1 }}>Telegram ID {tgId}</span>
                    <button className="vx-btn vx-btn-secondary vx-btn-sm" style={{ height: 32 }} onClick={() => unblock(tgId)}>Unblock</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

const VISIBILITY_OPTIONS: Array<{ value: AgentVisibility; title: (org: string) => string; body: (name: string, org: string, openness?: number) => string }> = [
  { value: 'private', title: () => 'Private', body: (name) => `Only you, the people you pick, and admins can message ${name}.` },
  { value: 'org', title: (org) => `Everyone in ${org}`, body: (name, org) => `Any approved ${org} member can message ${name}.` },
  {
    value: 'public', title: () => 'Public',
    body: (name, org, openness) => `Anyone on Telegram can message ${name}. ${name} decides in character how to treat strangers${openness !== undefined ? ` (openness ${openness}/100)` : ''}, and never shares ${org}'s internal memories.`,
  },
];

function visibilityLabel(agent: AgentView, org: string): string {
  if (agent.visibility === 'public') return 'Public';
  if (agent.visibility === 'org') return `Everyone in ${org}`;
  const extra = Array.isArray(agent.access) ? agent.access.length : 0;
  return extra ? `Private · ${extra + 1} people` : 'Private';
}
