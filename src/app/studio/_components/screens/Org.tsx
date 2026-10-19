'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, haptic, type AgentView, type Member, type Role } from '../../_lib/client';
import { AgentFace } from '../Cloud';
import { RelationshipObservations } from '../RelationshipObservations';
import { errorMessage, useNav } from '../StudioApp';
import { Icon, Sheet, Spinner } from '../ui';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', superadmin: 'Superadmin', admin: 'Admin', member: 'Member', pending: 'Waiting' };
const SECTIONS: Array<{ role: Role; title: string }> = [
  { role: 'pending', title: 'Waiting for approval' },
  { role: 'owner', title: 'Owners' },
  { role: 'superadmin', title: 'Superadmins' },
  { role: 'admin', title: 'Admins' },
  { role: 'member', title: 'Members' },
];

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
  const letters = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#282D35', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
      {letters || '?'}
    </span>
  );
}

export function OrgScreen() {
  const nav = useNav();
  const me = nav.me.member;
  const [people, setPeople] = useState<Member[] | null>(null);
  const [agentAdmins, setAgentAdmins] = useState<AgentView[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.members()
    .then((r) => { setPeople(r.people); setAgentAdmins(r.agentAdmins); })
    .catch((e) => nav.toast(errorMessage(e), 'error'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRole = async (target: Member, role: Role) => {
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

  return (
    <>
      <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <span className="vx-over">{nav.me.org}</span>
          <h1 className="vx-display">People</h1>
          <p className="vx-2" style={{ margin: 0 }}>
            {me.role === 'owner' ? 'You can make owners, superadmins and admins — humans or agents.'
              : me.role === 'superadmin' ? 'You can approve people and grant admin rights — to humans or agents.'
              : me.role === 'admin' ? 'You can approve new people. Superadmins grant admin rights.'
              : 'Everyone here can talk to every shared agent.'}
          </p>
        </div>

        {people === null ? (
          [0, 1, 2].map((i) => <div key={i} className="vx-skeleton" style={{ height: 56 }} />)
        ) : SECTIONS.map(({ role, title }) => {
          const list = people.filter((p) => p.role === role);
          if (!list.length) return null;
          return (
            <section key={role} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="vx-over">{title} · {list.length}</span>
              <div className="vx-group">
                {list.map((p, i) => {
                  const choices = choicesFor(me, p);
                  return (
                    <motion.div key={p.telegramId} className="vx-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                      <Initials name={p.name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}{p.telegramId === me.telegramId && <span className="vx-3"> · you</span>}</div>
                        {p.username && <div className="vx-small vx-2">@{p.username}</div>}
                      </div>
                      {role === 'pending' && choices.includes('member') ? (
                        <button className="vx-btn vx-btn-primary vx-btn-sm" disabled={!!busy} onClick={() => setRole(p, 'member')}>
                          {busy === `${p.telegramId}-member` ? <Spinner /> : 'Approve'}
                        </button>
                      ) : choices.length > 0 ? (
                        <button className="vx-icon-btn" aria-label={`Change ${p.name}'s role`} onClick={() => setSelected(p)}><Icon name="more" /></button>
                      ) : null}
                    </motion.div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {['owner', 'superadmin', 'admin'].includes(me.role) && <RelationshipObservations />}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="vx-over">Agent admins · {agentAdmins.length}</span>
          {agentAdmins.length === 0 ? (
            <p className="vx-small vx-2" style={{ margin: 0 }}>
              No agent is an admin yet.{me.role === 'superadmin' || me.role === 'owner' ? ' Open an agent → ··· → Make admin. Agent admins can propose new agents.' : ''}
            </p>
          ) : (
            <div className="vx-group">
              {agentAdmins.map((a) => (
                <button key={a.id} className="vx-row" onClick={() => nav.push({ name: 'agent', id: a.id })}
                  style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                  <AgentFace look={a.look} size={40} label={a.persona.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{a.persona.name}</div>
                    <div className="vx-small vx-2">{a.persona.role}</div>
                  </div>
                  <span className="vx-pill volt">AI ADMIN</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} label="Change role">
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="vx-title-m">{selected.name}</div>
              <div className="vx-small vx-2">Currently {ROLE_LABEL[selected.role].toLowerCase()}</div>
            </div>
            <div className="vx-group">
              {choicesFor(me, selected).map((r) => (
                <button key={r} className="vx-row" disabled={!!busy} onClick={() => setRole(selected, r)}
                  style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.08)', textAlign: 'left', cursor: 'pointer', color: r === 'pending' ? '#FF6B5E' : 'inherit' }}>
                  <span style={{ flex: 1 }}>{r === 'pending' ? 'Remove access' : `Make ${ROLE_LABEL[r].toLowerCase()}`}</span>
                  {busy === `${selected.telegramId}-${r}` && <Spinner />}
                </button>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
