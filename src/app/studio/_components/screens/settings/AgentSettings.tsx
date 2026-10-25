'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_AGENT_SKILLS } from '@/lib/studio/skills/types';
import { adaptiveApi, type AdaptiveSnapshot } from '../../../_lib/adaptive-client';
import { agentCopy } from '../../../_lib/agents-copy';
import { api, tg, type AgentView } from '../../../_lib/client';
import { agentRows, canSee, settingById, type AgentGroup, type AgentSection, type SettingDef, type SettingsCtx } from '../../../_lib/settings/registry';
import { rowText, settingsCopy } from '../../../_lib/settings-copy';
import { useProfileSync } from '../../../_lib/useProfileSync';
import { youCopy } from '../../../_lib/you-copy';
import { AgentFace } from '../../Cloud';
import { RelationshipPanel } from '../../RelationshipPanel';
import { errorMessage, useNav } from '../../StudioApp';
import { Banner, ErrorState, Row, Section, SkeletonRows, Spinner, Switch } from '../../ui';
import { LookSheet } from '../agent/LookSheet';
import { GroupBehaviorSheet, groupBehaviorOf, participationLabel, petLink, profileValue } from '../agent/ManageSheet';
import { useAgentActions } from '../agent/useAgentActions';
import { visibilityLabel, VisibilitySheet } from '../agent/VisibilitySheet';
import { IdentityBanner, SkillsPage, VoicePage } from './IdentityPages';
import { IconTile, SettingsPage, SpaceBar } from './kit';
import { NotesGrantRow } from './NotesGrant';

const SECTIONS: readonly AgentSection[] = ['profile', 'voice', 'skills', 'access', 'groups', 'memory', 'permissions', 'connectors', 'notifications', 'activity'];
const asSection = (v: string | undefined): AgentSection | undefined => (SECTIONS as readonly string[]).includes(v ?? '') ? v as AgentSection : undefined;

/**
 * One agent's settings (Settings v2), page `agent` with params { agentId, section? }. Without a section it is
 * the hub: "<Agent> for everyone" for the people who manage it, and "<Agent> and you" for anyone who can open
 * it, rendered from the settings registry. A section opens that section's page. The agent comes from the
 * session cache at once and is refreshed by one read; every page reuses the existing controls.
 */
export function AgentSettingsScreen({ agentId, section, from }: { agentId: string; section?: string; from?: string }) {
  const nav = useNav();
  const s = settingsCopy[nav.locale ?? 'en'];
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache.get(agentId) ?? null);
  const [error, setError] = useState('');
  const update = useCallback((a: AgentView) => { nav.cache.set(a.id, a); setAgent(a); }, [nav.cache]);
  const load = useCallback(() => {
    setError('');
    api.agent(agentId).then((r) => update(r.agent)).catch((e) => setError(errorMessage(e)));
  }, [agentId, update]);
  useEffect(load, [load]);

  if (!agent) {
    return <SettingsPage title={s.settings} back={s.back}>
      {error ? <ErrorState title={s.loadError} reason={error} retryLabel={s.retry} onRetry={load} /> : <SkeletonRows rows={5} lead="tile" label={s.loading} />}
    </SettingsPage>;
  }
  const ctx: SettingsCtx = { me: nav.me, agent, locale: nav.locale };
  const page = asSection(section);
  const def = page && settingById(`agent.${page}`);
  // A section the viewer may not see (a stale link, a role change) falls back to the hub.
  // Opened from You › Your agents, the hub's Back returns to You and says so; otherwise to the agent.
  const hub = <AgentHub agent={agent} onUpdate={update} back={from === 'you' ? undefined : agent.persona.name} />;
  if (!def || !canSee(def, ctx)) return hub;
  switch (page) {
    case 'voice': return <VoicePage agent={agent} onUpdate={update} />;
    case 'skills': return <SkillsPage agent={agent} onUpdate={update} />;
    case 'profile': return <ProfilePage agent={agent} onUpdate={update} />;
    case 'groups': return <GroupsPage agent={agent} onUpdate={update} />;
    case 'permissions': return <PermissionsPage agent={agent} />;
    case 'notifications': return <NotificationsPage agent={agent} />;
    default: return hub;
  }
}

/* ---------- hub ---------- */

function AgentHub({ agent, onUpdate, back }: { agent: AgentView; onUpdate: (a: AgentView) => void; back?: string }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const s = settingsCopy[locale], c = agentCopy[locale];
  const p = agent.persona;
  const ctx: SettingsCtx = { me: nav.me, agent, locale };
  const actions = useAgentActions(agent, onUpdate);
  const [visibility, setVisibility] = useState(false);
  const [inGroups, setInGroups] = useState<number | null>(null);
  const groups: Record<AgentGroup, SettingDef[]> = { everyone: agentRows(ctx, 'everyone'), you: agentRows(ctx, 'you') };
  const manages = groups.everyone.length > 0;

  // The one optional aggregate read: how many groups the agent is in, for the people who manage it.
  useEffect(() => {
    if (!manages) return;
    let cancelled = false;
    api.groups().then((r) => { if (!cancelled) setInGroups(r.groups.filter((g) => g.agents.some((a) => a.id === agent.id)).length); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [manages, agent.id]);

  /** A short live summary from what is already loaded. */
  const summary = (id: string): string | undefined => {
    const copy = s.rows[id];
    switch (id) {
      case 'agent.profile': return agent.bot ? `@${agent.bot.username}` : rowText(copy?.sub, p.name);
      case 'agent.voice': return agent.voice?.label ?? s.textOnly;
      case 'agent.skills': return p.skillIds?.length ? s.skillsCount(p.skillIds.length, MAX_AGENT_SKILLS) : s.noSkills;
      case 'agent.access': return [visibilityLabel(agent, nav.me.org, locale), agent.blocked?.length ? s.blockedCount(agent.blocked.length) : ''].filter(Boolean).join(' · ');
      case 'agent.groups': {
        const b = groupBehaviorOf(agent);
        return [inGroups ? s.inGroups(inGroups) : '', `${participationLabel(b, locale)}${b.remember ? '' : c.noMemory}`].filter(Boolean).join(' · ');
      }
      case 'agent.notifications': return s.alertsAllAgents(nav.space === 'work' ? s.work : s.personal);
      default: return copy?.sub ? rowText(copy.sub, p.name) : undefined;
    }
  };
  const open = (d: SettingDef) => {
    const to = d.opens;
    if (!to) return;
    if ('page' in to) nav.push({ name: 'settings', page: 'agent', params: { agentId: agent.id, section: to.page } });
    else if ('sheet' in to) { setVisibility(true); actions.loadPeople(); }
    else if ('route' in to && to.route === 'memories') nav.push({ name: 'memories', id: agent.id });
    else if ('route' in to && to.route === 'agent-connections') nav.push({ name: 'settings', page: 'agent-connections', params: { agentId: agent.id, ...(to.view ? { view: to.view } : {}) } });
  };
  const row = (d: SettingDef) => (
    <Row key={d.id} plain lead={<IconTile name={d.icon} />} title={rowText(s.rows[d.id]?.title, p.name)} sub={summary(d.id)} chevron onClick={() => open(d)} />
  );

  return <SettingsPage title={s.settings} back={back}>
    <header className="vx-mem-head">
      <AgentFace look={agent.look} stage={agent.stage} size={56} expr="idle" label={p.name} />
      <h1 className="vx-title">{s.settingsFor(p.name)}</h1>
    </header>
    {agent.status !== 'active' && <Banner tone="info" icon="lock">{agent.status === 'fired' ? s.retired(p.name) : s.notActive(p.name)}</Banner>}
    {agent.canShapeIdentity && <IdentityBanner agent={agent} />}
    {manages && <Section title={s.groups.everyone(p.name)} foot={s.groups.everyoneFoot(p.name)}>{groups.everyone.map(row)}</Section>}
    {groups.you.length > 0 && <Section title={s.groups.you(p.name)} foot={s.groups.youFoot(p.name)}>{groups.you.map(row)}</Section>}
    {manages && <VisibilitySheet agent={agent} open={visibility} onClose={() => setVisibility(false)} busy={actions.busy} people={actions.people}
      onChoose={(v) => void actions.chooseVisibility(v)} onToggleAllowed={(id) => void actions.toggleAllowed(id)} onUnblock={(id) => void actions.unblock(id)} />}
  </SettingsPage>;
}

/* ---------- for everyone ---------- */

function ProfilePage({ agent, onUpdate }: { agent: AgentView; onUpdate: (a: AgentView) => void }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const s = settingsCopy[locale], c = agentCopy[locale];
  const p = agent.persona;
  const actions = useAgentActions(agent, onUpdate);
  // As on the profile: a pending or failed Telegram push resolves while this page is open.
  useProfileSync(agent, onUpdate);
  const [look, setLook] = useState(false);
  const isSuper = nav.me.member.role === 'superadmin' || nav.me.member.role === 'owner';
  const canLook = !!agent.canEditLook && agent.status !== 'fired';
  return <SettingsPage title={rowText(s.rows['agent.profile'].title)} back={p.name}>
    <Section>
      {canLook && <Row plain lead={<IconTile name="image" />} title={c.lookPhoto} chevron onClick={() => setLook(true)} />}
      {agent.canEdit && !agent.locked && <Row plain lead={<IconTile name="edit" />} title={s.personality} sub={s.personalitySub} chevron
        onClick={() => nav.push({ name: 'spawn', draftId: agent.id, refine: true })} />}
      {(agent.canManageAccess || agent.canEdit) && agent.bot && (
        <Row plain lead={<IconTile name="telegram" />} title={c.updateTelegram} disabled={actions.busy} onClick={() => void actions.syncProfile()}
          value={actions.busy ? undefined : profileValue(agent, c)} end={actions.busy ? <Spinner size={16} /> : undefined} />
      )}
    </Section>
    {isSuper && <Section>
      <Row plain title={agent.isAdmin ? c.removeAdmin : c.makeAdmin} value={c.superadmin} disabled={actions.busy} onClick={() => actions.toggleAdmin()} />
    </Section>}
    {agent.canFire && <Section>
      <Row plain tone="danger" title={agent.locked ? c.fireRehire : c.fire(p.name)} onClick={() => nav.push({ name: 'fire', id: agent.id })} />
    </Section>}
    {canLook && <LookSheet agent={agent} open={look} onClose={() => setLook(false)} onUpdate={onUpdate} />}
  </SettingsPage>;
}

function GroupsPage({ agent, onUpdate }: { agent: AgentView; onUpdate: (a: AgentView) => void }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const s = settingsCopy[locale], c = agentCopy[locale];
  const p = agent.persona;
  const actions = useAgentActions(agent, onUpdate);
  const [sheet, setSheet] = useState(false);
  const behavior = groupBehaviorOf(agent);
  return <SettingsPage title={rowText(s.rows['agent.groups'].title)} back={p.name}>
    <Section>
      <Row plain lead={<IconTile name="groups" />} title={s.groupBehaviour} value={`${participationLabel(behavior, locale)}${behavior.remember ? '' : c.noMemory}`} chevron onClick={() => setSheet(true)} />
      {agent.bot && <Switch checked={agent.mainMiniApp} onChange={actions.toggleMainMiniApp} disabled={actions.busy} label={c.mainMiniApp} sub={c.mainMiniAppSub(petLink(agent.id))} />}
    </Section>
    <Section>
      <Row plain lead={<IconTile name="plus" />} title={s.addToGroups} chevron onClick={() => nav.push({ name: 'add-groups', id: agent.id })} />
      <Row plain lead={<IconTile name="send" />} title={s.channels} sub={s.channelsSub} chevron onClick={() => nav.push({ name: 'channels', id: agent.id })} />
    </Section>
    <GroupBehaviorSheet agent={agent} open={sheet} onClose={() => setSheet(false)} busy={actions.busy} onChange={actions.updateGroupBehavior} />
  </SettingsPage>;
}

/* ---------- just you ---------- */

/**
 * Permissions: may this agent use your private notes (the per-agent grant, per space) and its check-ins.
 * One adaptive read per space; the identity banner follows the You tab's.
 */
function PermissionsPage({ agent }: { agent: AgentView }) {
  const nav = useNav();
  const { locale, space } = nav;
  const s = settingsCopy[locale], y = youCopy[locale];
  const session = tg()?.initData ?? '';
  const [snapshot, setSnapshot] = useState<{ scope: string; value: AdaptiveSnapshot } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = `${session}:${space}:${locale}`;
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setError('');
    try {
      const value = await adaptiveApi.read(space, locale);
      if (generation.current === current) setSnapshot({ scope, value });
    } catch { if (generation.current === current) setError(s.loadError); }
  }, [space, locale, scope, s.loadError]);
  // Leaving the space or language drops any answer still in flight.
  const invalidate = useCallback(() => { generation.current++; }, []);
  useLayoutEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  // A snapshot from another space, language or account never shows (or acts) here.
  const current = snapshot?.scope === scope ? snapshot.value : null;
  const allowed = !!current?.agents.some((g) => g.agentId === agent.id && g.allowed);
  const confirmed = !!current?.identity.confirmed;
  const toggle = async () => {
    if (!current || busy) return;
    const at = generation.current;
    setBusy(true); setError('');
    try {
      const value = await adaptiveApi.agent(space, agent.id, !allowed, current.revision);
      if (generation.current === at) { setSnapshot({ scope, value }); nav.snack({ message: s.saved, tone: 'success' }); }
    } catch { if (generation.current === at) setError(s.notConfirmed); } finally { setBusy(false); }
  };
  return <SettingsPage title={rowText(s.rows['agent.permissions'].title)} back={agent.persona.name}>
    <SpaceBar disabled={busy} />
    {current && !confirmed && <Banner tone="info" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" onClick={() => nav.reset({ name: 'privacy' })}>{s.confirmProfile}</button>}>{s.identityNeeded}</Banner>}
    {error && <Banner tone="danger" action={<button type="button" className="vx-btn vx-btn-secondary vx-btn-xs" disabled={busy} onClick={() => void load()}>{s.retry}</button>}>{error}</Banner>}
    <Section title={s.notesGrant(agent.persona.name)} foot={s.notesGrantSub}>
      {current
        ? <NotesGrantRow agent={agent} allowed={allowed} label={y.canUseNotes} disabled={busy || !confirmed} onToggle={() => void toggle()} />
        : !error && <SkeletonRows rows={1} lead="tile" label={s.loading} />}
    </Section>
    <RelationshipPanel key={`${space}:${session}`} agentId={agent.id} name={agent.persona.name} space={space} locale={locale} identityConfirmed={confirmed} part="checkins" />
  </SettingsPage>;
}

/**
 * Notifications: the Telegram check-in alert (stored per space for every agent; the panel's heading says so,
 * once), then the Vox-wide inbox and reminders.
 */
function NotificationsPage({ agent }: { agent: AgentView }) {
  const nav = useNav();
  const { locale, space } = nav;
  const s = settingsCopy[locale], y = youCopy[locale];
  const session = tg()?.initData ?? '';
  return <SettingsPage title={rowText(s.rows['agent.notifications'].title)} back={agent.persona.name}>
    <SpaceBar />
    <RelationshipPanel key={`${space}:${session}`} agentId={agent.id} name={agent.persona.name} space={space} locale={locale} part="alerts" />
    <Section title={s.forAllAgents}>
      <Row plain lead={<IconTile name="inbox" />} title={y.inbox} chevron onClick={() => nav.push({ name: 'settings', page: 'inbox' })} />
      <Row plain lead={<IconTile name="bell" />} title={y.reminders} chevron onClick={() => nav.push({ name: 'settings', page: 'reminders' })} />
    </Section>
  </SettingsPage>;
}
