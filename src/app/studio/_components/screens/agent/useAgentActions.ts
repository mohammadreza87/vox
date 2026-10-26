'use client';

import { useState } from 'react';
import { agentCopy } from '../../../_lib/agents-copy';
import { api, haptic, type AgentView, type AgentVisibility, type GroupBehavior, type Member } from '../../../_lib/client';
import { errorMessage, useNav } from '../../StudioApp';
import { useConfirm } from '../../ui';

/**
 * The manager actions on one agent (who can talk, live web, groups, Telegram profile, agent admin), shared
 * by the profile's Manage sheet and the agent settings hub. Every write waits for the server, whose answer
 * replaces the agent through `update`; `after` callbacks run only on success.
 */
export function useAgentActions(agent: AgentView | null, update: (a: AgentView) => void) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = agentCopy[locale];
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Member[] | null>(null);

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

  /** Org members for the private allow-list, fetched once when the sheet first opens. */
  const loadPeople = () => { if (!people) api.members().then((r) => setPeople(r.people)).catch(() => setPeople([])); };

  const chooseVisibility = async (v: AgentVisibility) => {
    if (!agent || v === agent.visibility || busy) return;
    const p = agent.persona;
    if (v === 'public' && !(await confirm({
      title: c.publicTitle(p.name), confirmLabel: c.makePublic, tone: 'danger', look: agent.look, expr: 'listening',
      body: c.publicBody(p.name, nav.me.org),
    }))) return;
    await write(() => api.setVisibility(agent.id, v));
  };

  const updateGroupBehavior = async (b: GroupBehavior) => { if (agent && !busy) await write(() => api.setGroupBehavior(agent.id, b)); };
  const toggleLiveWeb = () => { if (agent) void write(() => api.setLiveWeb(agent.id, !agent.liveWeb)); };
  const toggleMainMiniApp = () => { if (agent) void write(() => api.setMainMiniApp(agent.id, !agent.mainMiniApp)); };

  const toggleAdmin = (after?: () => void) => {
    if (!agent) return;
    void write(() => api.setAgentAdmin(agent.id, !agent.isAdmin), (a) => {
      nav.toast(a.isAdmin ? c.nowAdmin(a.persona.name) : c.noLongerAdmin(a.persona.name));
      after?.();
    });
  };

  const syncProfile = async (after?: () => void) => {
    if (!agent || busy) return;
    setBusy(true);
    try {
      const r = await api.syncProfile(agent.id);
      update(r.agent);
      if (r.failed.length) { haptic.error(); nav.toast(c.refused(r.failed.join(locale === 'fa' ? '، ' : ', ')), 'error'); }
      else if (r.agent.profileSync?.status === 'synced') { haptic.success(); nav.toast(c.profileUpdated); }
      after?.();
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const toggleAllowed = async (telegramId: number) => {
    if (!agent) return;
    const allowList = Array.isArray(agent.access) ? agent.access : [];
    const next = allowList.includes(telegramId) ? allowList.filter((x) => x !== telegramId) : [...allowList, telegramId];
    try { update((await api.setAccess(agent.id, next)).agent); haptic.select(); } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };
  const unblock = async (telegramId: number) => {
    if (!agent) return;
    try { update((await api.unblock(agent.id, telegramId)).agent); haptic.success(); } catch (e) { nav.toast(errorMessage(e), 'error'); }
  };

  return { busy, people, loadPeople, write, chooseVisibility, updateGroupBehavior, toggleLiveWeb, toggleMainMiniApp, toggleAdmin, syncProfile, toggleAllowed, unblock };
}
