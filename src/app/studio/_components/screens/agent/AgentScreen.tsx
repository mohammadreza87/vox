'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { agentCopy, fireReasonLabel, type AgentCopy } from '../../../_lib/agents-copy';
import { api, haptic, type AgentView, type AgentVisibility, type GroupBehavior, type Member } from '../../../_lib/client';
import { T } from '../../../_lib/motion';
import { useProfileSync } from '../../../_lib/useProfileSync';
import { PALETTE } from '../../Cloud';
import { errorMessage, useNav } from '../../StudioApp';
import { Banner, hueVars, Icon, Meta, Metas, Spinner, TopBar, useConfirm } from '../../ui';
import { languageCode, sampleLine, usePlayer } from '../spawn/shared';
import { AgentHero } from './AgentHero';
import { LookSheet } from './LookSheet';
import { GroupBehaviorSheet, groupBehaviorOf, ManageSheet, participationLabel } from './ManageSheet';
import { visibilityLabel, VisibilitySheet } from './VisibilitySheet';

function timeLeft(t: AgentCopy['timeLeft'], lockAt?: string): string {
  if (!lockAt) return '';
  const ms = new Date(lockAt).getTime() - Date.now();
  if (ms <= 0) return t.moments;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? t.days(d, h) : t.hours(h, Math.floor((ms % 3_600_000) / 60_000));
}

/** Profile content after the hero lands: each block rises in turn (motion §3.3, 40 ms apart from 120 ms). */
function Enter({ i, children }: { i: number; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...T.listItem(0), delay: 0.12 + i * 0.04 }}>
      {children}
    </motion.div>
  );
}

/** Ghost profile while an uncached agent loads: halo, two text bars, four discs (UI §4.3). */
function ProfileSkeleton({ label }: { label: string }) {
  return (
    <div className="vx-skel-profile vx-skeleton" data-delay="" role="status" aria-label={label} aria-busy="true">
      <span className="vx-skel-halo" />
      <span className="vx-skel-bar title" />
      <span className="vx-skel-bar" />
      <div className="vx-skel-discs">{[0, 1, 2, 3].map((i) => <span key={i} className="vx-skel-dot" />)}</div>
    </div>
  );
}

type SheetName = 'manage' | 'visibility' | 'group' | 'look' | null;


export function AgentScreen({ id, from }: { id: string; /** The route this profile was pushed from */ from?: string }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = agentCopy[locale];
  // The back chevron names the tab underneath; from anywhere deeper it is a bare chevron (aria "Back")
  const backLabel = from ? c.backTo[from] : c.backTo.home;
  const confirm = useConfirm();
  // Hero flights land on the cached agent at once (motion §3.4); the fetch refreshes it.
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache?.get(id) ?? null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [people, setPeople] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [inGroups, setInGroups] = useState<number | null>(null);
  const cachedAtMount = useRef(agent !== null);
  const player = usePlayer();
  const voiceSample = useRef<string | null>(null);
  const [sampling, setSampling] = useState(false);

  const update = useCallback((a: AgentView) => { nav.cache?.set(a.id, a); setAgent(a); }, [nav.cache]);

  const load = useCallback(() => {
    setStale(null);
    api.agent(id).then((r) => update(r.agent)).catch((e) => {
      // With a cached copy on screen, keep it (dimmed state + Retry); without one there's nothing to show.
      if (cachedAtMount.current) { setStale(errorMessage(e)); return; }
      nav.toast(errorMessage(e), 'error'); nav.back();
    });
  }, [id, nav, update]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  // Telegram profile status: polls while pending, backs off on errors, rereads on return (D's hook).
  useProfileSync(agent, update);

  const active = agent?.status === 'active';
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.groups().then((r) => { if (!cancelled) setInGroups(r.groups.filter((g) => g.agents.some((a) => a.id === id)).length); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, id]);

  if (!agent) return <><TopBar lead="back" onLead={nav.back} leadLabel={backLabel} /><div className="vx-scroll"><ProfileSkeleton label={c.loading} /></div></>;

  const pal = PALETTE[agent.look.hue];
  const isSuper = nav.me.member.role === 'superadmin' || nav.me.member.role === 'owner';
  const fired = agent.status === 'fired';
  const p = agent.persona;
  const behavior = groupBehaviorOf(agent);
  const canLook = !!agent.canEditLook && !fired;
  const canManage = active && (agent.canFire || isSuper || agent.canManageAccess || canLook);

  /** Run a write; the server's answer replaces the agent. */
  const write = async (fn: () => Promise<{ agent: AgentView }>, after?: (a: AgentView) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      update(r.agent);
      haptic.success();
      after?.(r.agent);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const toggleAdmin = () => write(() => api.setAgentAdmin(agent.id, !agent.isAdmin), (a) => {
    nav.toast(a.isAdmin ? c.nowAdmin(p.name) : c.noLongerAdmin(p.name));
    setSheet(null);
  });

  const openVisibility = () => {
    setSheet('visibility');
    if (!people) api.members().then((r) => setPeople(r.people)).catch(() => setPeople([]));
  };

  const chooseVisibility = async (v: AgentVisibility) => {
    if (v === agent.visibility || busy) return;
    if (v === 'public' && !(await confirm({
      title: c.publicTitle(p.name), confirmLabel: c.makePublic, tone: 'danger', look: agent.look, expr: 'listening',
      body: c.publicBody(p.name, nav.me.org),
    }))) return;
    await write(() => api.setVisibility(agent.id, v));
  };

  const updateGroupBehavior = async (b: GroupBehavior) => { if (!busy) await write(() => api.setGroupBehavior(agent.id, b)); };

  const syncProfile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.syncProfile(agent.id);
      update(r.agent);
      if (r.failed.length) { haptic.error(); nav.toast(c.refused(r.failed.join(locale === 'fa' ? '، ' : ', ')), 'error'); }
      else if (r.agent.profileSync?.status === 'synced') { haptic.success(); nav.toast(c.profileUpdated); }
      setSheet(null);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const allowList = Array.isArray(agent.access) ? agent.access : [];
  const toggleAllowed = async (telegramId: number) => {
    const next = allowList.includes(telegramId) ? allowList.filter((x) => x !== telegramId) : [...allowList, telegramId];
    try { update((await api.setAccess(agent.id, next)).agent); haptic.select(); } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };
  const unblock = async (telegramId: number) => {
    try { update((await api.unblock(agent.id, telegramId)).agent); haptic.success(); } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };

  /** The voice row's play disc: one spoken line, fetched once per visit. */
  const playVoice = async () => {
    if (voiceSample.current) { player.play('voice', voiceSample.current); return; }
    setSampling(true);
    try {
      const blob = await api.speak(agent.id, sampleLine(p, languageCode(p.languages[0])));
      if (!blob) return;
      voiceSample.current = URL.createObjectURL(blob);
      player.play('voice', voiceSample.current);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setSampling(false); }
  };

  // D16: exactly four. Chat is the in-app conversation; its top bar carries "Open in Telegram".
  const actions = [
    { label: c.actions.chat, icon: 'chat', run: () => nav.push({ name: 'conversation', id: agent.id }) },
    { label: c.actions.call, icon: 'phone', run: () => nav.push({ name: 'call', id: agent.id }) },
    { label: c.actions.groups, icon: 'groups', run: () => nav.push({ name: 'add-groups', id: agent.id }) },
    { label: c.actions.memories, icon: 'memory', run: () => nav.push({ name: 'memories', id: agent.id }) },
  ];
  const playing = player.playing === 'voice';
  const more = [p.backstory, p.communicationStyle, p.wontDo].some(Boolean) || p.values.length > 0 || p.expertise.length > 0;
  let n = 0;

  return (
    <>
      <TopBar lead="back" onLead={nav.back} leadLabel={backLabel}
        end={canManage ? <button type="button" className="vx-icon-btn" aria-label={c.manage} onClick={() => setSheet('manage')}><Icon name="more" width={3} /></button> : undefined} />
      <motion.div className={`vx-scroll vx-profile${stale ? ' stale' : ''}`} layoutScroll style={hueVars(pal)}>
        <AgentHero agent={agent} onUpdate={update} onRetryProfile={syncProfile} />

        <div className="vx-profile-body">
          {stale && (
            <Banner tone="warn" action={<button type="button" className="vx-btn vx-btn-xs" onClick={load}>{c.retry}</button>}>
              {c.couldntRefresh(p.name)} {stale}
            </Banner>
          )}
          {active && !agent.locked && (
            <Enter i={n++}>
              <div className="vx-strip">
                <div className="vx-strip-main">
                  <span className="vx-over vx-num">{c.formingDay(agent.formingDay ?? 1)}</span>
                  <span>{c.editableBefore}<b className="vx-num vx-strong-num">{timeLeft(c.timeLeft, agent.lockAt)}</b>{c.editableAfter}</span>
                </div>
                {agent.canEdit && <button type="button" className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => nav.push({ name: 'spawn', draftId: agent.id, refine: true })}>{c.refine}</button>}
              </div>
            </Enter>
          )}
          {agent.locked && !fired && (
            // the hero already says it is locked when the look can still change; the banner adds only the way out
            <Banner tone="info" icon="lock">{agent.canEditLook ? '' : c.lockedForGood(p.name)}{c.lockedWayOut(p.name)}</Banner>
          )}
          {fired && (
            // Not an alert: retirement is the agent's state, not a failure
            <div className="vx-banner danger"><Icon name="warn" size={18} /><span>{c.retired(agent.firedAt ? new Date(agent.firedAt).toLocaleDateString(c.dateLocale) : '')} {agent.firedReason ? fireReasonLabel(agent.firedReason, locale) : ''}</span></div>
          )}

          {active && (
            <Enter i={n++}>
              <div className="vx-actions">
                {actions.map((a) => (
                  <button key={a.label} type="button" className="vx-action" onClick={a.run}>
                    <span className="vx-action-disc"><Icon name={a.icon} /></span>
                    {a.label}
                  </button>
                ))}
              </div>
            </Enter>
          )}

          <Enter i={n++}>
            <section className="vx-panel" aria-label={c.whoIs(p.name)}>
              <span className="vx-over" aria-hidden="true">{c.whoIs(p.name)}</span>
              <p dir="auto">{p.personality || p.tagline}</p>
              <div className="vx-panel-divide">
                {agent.voice ? (
                  <button type="button" className="vx-voice-play" aria-label={playing ? c.pauseVoice(p.name) : c.playVoice(p.name)}
                    aria-busy={sampling || undefined} disabled={sampling} onClick={() => void playVoice()}>
                    {sampling ? <Spinner size={14} /> : <Icon name={playing ? 'pause' : 'play'} size={14} width={2.5} flip={false} />}
                  </button>
                ) : <span className="vx-voice-play off" aria-hidden="true"><Icon name="chat" size={16} /></span>}
                <span className="vx-row-main">
                  <span className="vx-voice-title">{agent.voice?.label ?? c.textOnly}</span>
                  <span className="vx-small vx-2">{p.languages.join(' · ')}</span>
                </span>
              </div>
            </section>
          </Enter>

          {more && (
            <Enter i={n++}>
              <details className="vx-disclosure vx-more">
                <summary>{c.moreAbout(p.name)}</summary>
                <div className="vx-doc vx-doc-quiet">
                  {p.backstory && <div className="vx-doc-sec"><span className="vx-over">{c.backstory}</span><p dir="auto">{p.backstory}</p></div>}
                  {p.communicationStyle && <div className="vx-doc-sec"><span className="vx-over">{c.howTheyTalk}</span><p dir="auto">{p.communicationStyle}</p></div>}
                  {p.values.length > 0 && <div className="vx-doc-sec"><span className="vx-over">{c.values}</span><p dir="auto">{p.values.join(' · ')}</p></div>}
                  {p.expertise.length > 0 && (
                    <div className="vx-doc-sec"><span className="vx-over">{c.expertise}</span><Metas>{p.expertise.map((x) => <Meta key={x}>{x}</Meta>)}</Metas></div>
                  )}
                  {p.wontDo && <div className="vx-doc-sec"><span className="vx-over warn">{c.wontDo}</span><p className="vx-2" dir="auto">{p.wontDo}</p></div>}
                </div>
              </details>
            </Enter>
          )}

          <Enter i={n++}>
            {/* Board: three plain facts. Live web and group behaviour are settings and live in Manage (UI §4.3);
                a viewer with no Manage still learns how the agent behaves in groups, read-only. */}
            <Metas>
              {inGroups ? <Meta>{c.inGroups(inGroups)}</Meta> : null}
              <Meta>{visibilityLabel(agent, nav.me.org, locale)}</Meta>
              {agent.creatorName && <Meta>{c.hiredBy(agent.creatorName)}</Meta>}
              {!canManage && <Meta>{c.groupReplies(participationLabel(behavior, locale))}</Meta>}
              {!canManage && !behavior.remember && <Meta>{c.groupMemoryOff}</Meta>}
            </Metas>
          </Enter>
        </div>
      </motion.div>

      {active && (
        <div className="vx-dock">
          <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => nav.push({ name: 'call', id: agent.id })}><Icon name="phone" width={2} />{c.callName(p.name)}</button>
        </div>
      )}
      {fired && nav.me.member.role !== 'member' && (
        <div className="vx-dock">
          <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => nav.push({ name: 'spawn', successorOf: agent.id })}>{c.hireSuccessor}</button>
        </div>
      )}

      <ManageSheet agent={agent} open={sheet === 'manage'} onClose={() => setSheet(null)} busy={busy} isSuper={isSuper}
        onVisibility={openVisibility} onToggleLiveWeb={() => void write(() => api.setLiveWeb(agent.id, !agent.liveWeb))}
        onGroupBehavior={() => setSheet('group')} onSyncProfile={syncProfile} onToggleAdmin={toggleAdmin}
        onLook={canLook ? () => setSheet('look') : undefined} />
      <GroupBehaviorSheet agent={agent} open={sheet === 'group'} onClose={() => setSheet(null)} busy={busy} onChange={updateGroupBehavior} />
      <VisibilitySheet agent={agent} open={sheet === 'visibility'} onClose={() => setSheet(null)} busy={busy} people={people}
        onChoose={(v) => void chooseVisibility(v)} onToggleAllowed={toggleAllowed} onUnblock={unblock} />
      {canLook && <LookSheet agent={agent} open={sheet === 'look'} onClose={() => setSheet(null)} onUpdate={update} />}
    </>
  );
}
