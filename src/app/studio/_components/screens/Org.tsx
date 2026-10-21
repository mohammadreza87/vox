'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { orgCopy } from '../../_lib/agents-copy';
import { api, haptic, type AgentView, type Member, type Role } from '../../_lib/client';
import { T } from '../../_lib/motion';
import { AgentFace } from '../Cloud';
import { RelationshipObservations } from '../RelationshipObservations';
import { errorMessage, useNav } from '../StudioApp';
import { ErrorState, Icon, PageHead, Row, Sheet, SheetHead, SkeletonRows, Spinner, useConfirm } from '../ui';

/** Section order; titles come from orgCopy */
const SECTIONS: readonly Role[] = ['pending', 'owner', 'superadmin', 'admin', 'member'];

/** Role changes the current user may offer for a person (the server re-checks). */
function choicesFor(me: Member, target: Member): Role[] {
  if (me.telegramId === target.telegramId) return [];
  if (me.role === 'owner') return (['owner', 'superadmin', 'admin', 'member', 'pending'] as Role[]).filter((r) => r !== target.role);
  if (me.role === 'superadmin') return target.role === 'owner' ? [] : (['superadmin', 'admin', 'member', 'pending'] as Role[]).filter((r) => r !== target.role);
  if (me.role === 'admin') {
    if (target.role === 'pending') return ['member'];
    if (target.role === 'member') return ['pending'];
  }
  return [];
}

function Initials({ name }: { name: string }) {
  const letters = name.split(/\s+/).filter(Boolean).map((w) => [...w][0]).join('').slice(0, 2).toLocaleUpperCase();
  return <span className="vx-initials" aria-hidden="true">{letters || '?'}</span>;
}

export function OrgScreen() {
  const nav = useNav();
  const c = orgCopy[nav.locale ?? 'en'];
  const me = nav.me.member;
  const [people, setPeople] = useState<Member[] | null>(null);
  const [agentAdmins, setAgentAdmins] = useState<AgentView[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoadError(null);
    api.members()
      .then((r) => { setPeople(r.people); setAgentAdmins(r.agentAdmins); })
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const setRole = async (target: Member, role: Role) => {
    if (role === 'pending') {
      const ok = await confirm({
        title: c.removeTitle(target.name), confirmLabel: c.removeAccess, tone: 'danger',
        body: c.removeBody(target.name, nav.me.org),
      });
      if (!ok) return;
    }
    setBusy(`${target.telegramId}-${role}`);
    try {
      const r = await api.setRole(target.telegramId, role);
      haptic.success();
      setPeople((all) => all?.map((p) => (p.telegramId === r.member.telegramId ? r.member : p)) ?? null);
      setSelected(null);
    } catch (e) {
      nav.toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const grants = selected ? choicesFor(me, selected).filter((r) => r !== 'pending') : [];
  const rights = me.role === 'owner' || me.role === 'superadmin' || me.role === 'admin' ? c.rights[me.role] : c.rights.member;
  const sections = people ? SECTIONS.map((role) => ({ role, title: c.sections[role], list: people.filter((p) => p.role === role) })).filter((s) => s.list.length > 0) : [];

  return (
    <>
      <div className="vx-scroll vx-stack">
        {/* A direct child of the stack, like Groups and You, so the head doesn't jump between tabs */}
        <PageHead over={nav.me.org} title={c.title} />

        {loadError && !people ? (
          <ErrorState title={c.loadError} reason={loadError} onRetry={load} />
        ) : people === null ? (
          <SkeletonRows rows={4} label={c.loading} />
        ) : sections.map(({ role, title, list }, si) => {
          return (
            <section key={role} className="vx-section">
              <h2 className="vx-over vx-section-head">{c.count(title, list.length)}</h2>
              <div className="vx-group">
                {list.map((p, i) => {
                  const choices = choicesFor(me, p);
                  return (
                    <motion.div key={p.telegramId} className="vx-row l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...T.fadeIn, delay: i * 0.02 }}>
                      <Initials name={p.name} />
                      <div className="vx-row-main">
                        <span className="vx-row-title plain vx-ellipsis">{p.name}{p.telegramId === me.telegramId && <span className="vx-3">{c.you}</span>}</span>
                        {p.username && <span className="vx-row-sub">@{p.username}</span>}
                      </div>
                      {role === 'pending' && choices.includes('member') ? (
                        // One volt per screen: approving in a list is tonal, not the primary CTA
                        <button type="button" className="vx-btn vx-btn-tonal vx-btn-xs" disabled={!!busy} aria-label={c.approveName(p.name)} onClick={() => setRole(p, 'member')}>
                          {busy === `${p.telegramId}-member` ? <Spinner size={14} /> : c.approve}
                        </button>
                      ) : choices.length > 0 ? (
                        <button type="button" className="vx-icon-btn" aria-label={c.changeRoleOf(p.name)} onClick={() => setSelected(p)}><Icon name="more" /></button>
                      ) : null}
                    </motion.div>
                  );
                })}
              </div>
              {si === 0 && <p className="vx-section-foot">{rights}</p>}
            </section>
          );
        })}


        <section className="vx-section">
          <h2 className="vx-over vx-section-head">{c.count(c.agentAdmins, agentAdmins.length)}</h2>
          {agentAdmins.length === 0 ? (
            <p className="vx-section-foot">
              {c.noAgentAdmin}{me.role === 'superadmin' || me.role === 'owner' ? c.noAgentAdminHow : ''}
            </p>
          ) : (
            <div className="vx-group">
              {agentAdmins.map((a) => (
                <Row key={a.id} size="l" onClick={() => nav.push({ name: 'agent', id: a.id })} lead={<AgentFace look={a.look} stage={a.stage} size={40} label={a.persona.name} />}
                  title={a.persona.name} sub={a.persona.role} end={<span className="vx-pill volt">{c.aiAdmin}</span>} chevron />
              ))}
            </div>
          )}
        </section>
        {['owner', 'superadmin', 'admin'].includes(me.role) && <RelationshipObservations />}
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} label={c.changeRole}>
        {selected && (
          <div className="vx-sheet-groups">
            <SheetHead title={selected.name} sub={c.currently(c.roles[selected.role])} />
            {grants.length > 0 && (
              <div className="vx-group">
                {grants.map((r) => (
                  <Row key={r} plain disabled={!!busy} onClick={() => void setRole(selected, r)} title={c.make(c.roles[r])}
                    end={busy === `${selected.telegramId}-${r}` ? <Spinner /> : undefined} />
                ))}
              </div>
            )}
            {choicesFor(me, selected).includes('pending') && (
              <div className="vx-group">
                <Row plain tone="danger" disabled={!!busy} onClick={() => void setRole(selected, 'pending')} title={c.removeAccess}
                  end={busy === `${selected.telegramId}-pending` ? <Spinner /> : undefined} />
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
