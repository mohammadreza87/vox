'use client';

import { agentCopy } from '../../../_lib/agents-copy';
import type { AgentView, AgentVisibility, Member } from '../../../_lib/client';
import type { Locale } from '../../../_lib/i18n';
import { useNav } from '../../StudioApp';
import { Check, Radio, Row, Section, Sheet, SheetHead, SkeletonRows } from '../../ui';

export interface VisibilitySheetProps {
  agent: AgentView;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  /** Org members for the private allow-list; null while loading */
  people: Member[] | null;
  onChoose: (v: AgentVisibility) => void;
  onToggleAllowed: (telegramId: number) => void;
  onUnblock: (telegramId: number) => void;
}

export function VisibilitySheet({ agent, open, onClose, busy, people, onChoose, onToggleAllowed, onUnblock }: VisibilitySheetProps) {
  const nav = useNav();
  const c = agentCopy[nav.locale ?? 'en'];
  const p = agent.persona;
  const allowList = Array.isArray(agent.access) ? agent.access : [];
  const blocked = agent.blocked ?? [];
  return (
    <Sheet open={open} onClose={onClose} label={c.whoCanTalk(p.name)}>
      <SheetHead title={c.whoCanTalk(p.name)} />
      <div className="vx-sheet-groups">
        <Section plain foot={c.visibilityFoot(p.name, nav.me.org)}>
          <div className="vx-group" role="radiogroup" aria-label={c.whoCanTalk(p.name)}>
            {VISIBILITY_OPTIONS.map((v) => (
              <Row key={v} role="radio" aria-checked={agent.visibility === v} align="top" plain lead={<Radio />} disabled={busy}
                title={c.visibility[v].title(nav.me.org)} sub={c.visibility[v].body(p.name, nav.me.org, p.openness)} onClick={() => onChoose(v)} />
            ))}
          </div>
        </Section>

        {agent.visibility === 'private' && (
          <Section title={c.peopleWho(p.name)} plain>
            {people === null ? <SkeletonRows rows={3} label={c.loadingPeople} /> : (
              <div className="vx-group">
                {people.filter((m) => m.role !== 'pending').map((m) => {
                  const always = m.telegramId === agent.createdBy || ['admin', 'superadmin', 'owner'].includes(m.role);
                  const on = always || allowList.includes(m.telegramId);
                  return always
                    ? <Row key={m.telegramId} title={<span className="vx-ellipsis">{m.name}</span>} plain value={m.telegramId === agent.createdBy ? c.creator : c.admin} />
                    : <Row key={m.telegramId} role="checkbox" aria-checked={on} plain title={<span className="vx-ellipsis">{m.name}</span>} end={<Check />}
                        onClick={() => onToggleAllowed(m.telegramId)} />;
                })}
              </div>
            )}
          </Section>
        )}

        {blocked.length > 0 && (
          <Section title={c.blockedBy(p.name, blocked.length)} plain>
            <div className="vx-group">
              {blocked.map((tgId) => (
                <Row key={tgId} plain title={<span className="vx-num">{c.telegramId(tgId)}</span>}
                  end={<button type="button" className="vx-btn vx-btn-xs" onClick={() => onUnblock(tgId)}>{c.unblock}</button>} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </Sheet>
  );
}

const VISIBILITY_OPTIONS: readonly AgentVisibility[] = ['private', 'org', 'public'];

export function visibilityLabel(agent: AgentView, org: string, locale: Locale = 'en'): string {
  const c = agentCopy[locale];
  if (agent.visibility === 'public') return c.visibility.public.title();
  if (agent.visibility === 'org') return c.visibility.org.title(org);
  const extra = Array.isArray(agent.access) ? agent.access.length : 0;
  return extra ? c.privateCount(extra + 1) : c.visibility.private.title();
}
