'use client';

import { agentCopy, type AgentCopy } from '../../../_lib/agents-copy';
import { openTelegram, type AgentView, type GroupBehavior } from '../../../_lib/client';
import type { Locale } from '../../../_lib/i18n';
import { useNav } from '../../StudioApp';
import { Icon, Radio, Row, Sheet, SheetHead, Spinner, Switch } from '../../ui';
import { visibilityLabel } from './VisibilitySheet';

export interface ManageSheetProps {
  agent: AgentView;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  isSuper: boolean;
  onVisibility: () => void;
  onToggleLiveWeb: () => void;
  /** Opens the Group behaviour sheet */
  onGroupBehavior: () => void;
  onSyncProfile: () => void;
  onToggleAdmin: () => void;
  /** Opens the look & Telegram photo sheet (creator or admin, D9) */
  onLook?: () => void;
}

const PARTICIPATION: ReadonlyArray<GroupBehavior['participation']> = ['mentions', 'balanced', 'active'];
/** Reply modes in order, labelled in the reader's language. */
export const groupParticipationOptions = (locale: Locale = 'en') =>
  PARTICIPATION.map((value) => ({ value, ...agentCopy[locale].participation[value] }));
export const GROUP_PARTICIPATION_OPTIONS = groupParticipationOptions('en');

export const groupBehaviorOf = (agent: AgentView): GroupBehavior => agent.groupBehavior ?? { participation: 'balanced', remember: true };
export const participationLabel = (b: GroupBehavior, locale: Locale = 'en') =>
  (agentCopy[locale].participation[b.participation] ?? agentCopy[locale].participation.balanced).label;

/** One word for the Telegram row: what the bot shows right now. */
function profileValue(agent: AgentView, c: AgentCopy): string {
  const s = agent.profileSync?.status;
  if (s === 'pending') return c.updating;
  if (s === 'error') return c.needsRetry;
  return agent.bot ? `@${agent.bot.username}` : '';
}

/**
 * Manage (···): rows only (UI §4.3). Settings first, then Telegram and access, then admin, and a
 * separate danger group for Fire. Group behaviour has its own sheet.
 */
export function ManageSheet({ agent, open, onClose, busy, isSuper, onVisibility, onToggleLiveWeb, onGroupBehavior, onSyncProfile, onToggleAdmin, onLook }: ManageSheetProps) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = agentCopy[locale];
  const p = agent.persona;
  const behavior = groupBehaviorOf(agent);
  const go = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Sheet open={open} onClose={onClose} label={c.manageName(p.name)}>
      <SheetHead title={c.manageName(p.name)} />
      <div className="vx-sheet-groups">
        {agent.canManageAccess && (
          <div className="vx-group">
            <Row plain title={c.whoCanTalk(p.name)} value={visibilityLabel(agent, nav.me.org, locale)} chevron onClick={onVisibility} />
            <Switch checked={agent.liveWeb} onChange={onToggleLiveWeb} disabled={busy} label={c.liveWeb}
              sub={c.liveWebSub} />
            <Row plain title={c.groupBehaviour} value={`${participationLabel(behavior, locale)}${behavior.remember ? '' : c.noMemory}`} chevron onClick={onGroupBehavior} />
          </div>
        )}
        <div className="vx-group">
          {onLook && <Row plain title={c.lookPhoto} chevron onClick={go(onLook)} />}
          {(agent.canManageAccess || agent.canEdit) && agent.bot && (
            <Row plain title={c.updateTelegram} disabled={busy} onClick={onSyncProfile}
              value={busy ? undefined : profileValue(agent, c)} end={busy ? <Spinner size={16} /> : undefined} />
          )}
          <Row plain title={c.connections} chevron onClick={go(() => nav.push({ name: 'connections', agentId: agent.id }))} />
        </div>
        {isSuper && (
          <div className="vx-group">
            <Row plain title={agent.isAdmin ? c.removeAdmin : c.makeAdmin} value={c.superadmin} disabled={busy} onClick={onToggleAdmin} />
          </div>
        )}
        {agent.canFire && (
          <div className="vx-group">
            <Row plain tone="danger" title={agent.locked ? c.fireRehire : c.fire(p.name)} onClick={go(() => nav.push({ name: 'fire', id: agent.id }))} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * How the agent joins group chats: reply mode (radio rows) and group memory (switch). Each change
 * waits for the server; while it is in flight every control is disabled and the old value stays.
 */
export function GroupBehaviorSheet({ agent, open, onClose, busy, onChange }: {
  agent: AgentView; open: boolean; onClose: () => void; busy: boolean; onChange: (b: GroupBehavior) => void | Promise<void>;
}) {
  const locale = useNav().locale ?? 'en';
  const c = agentCopy[locale];
  const p = agent.persona;
  const behavior = groupBehaviorOf(agent);
  const contextId = `group-context-${agent.id}`;
  return (
    <Sheet open={open} onClose={onClose} label={c.groupBehaviour}>
      <SheetHead title={c.groupBehaviour} sub={c.joinsGroups(p.name)} />
      <div className="vx-sheet-groups" aria-busy={busy}>
        <section className="vx-section">
          <div className="vx-group" role="radiogroup" aria-label={c.groupRepliesLabel} aria-describedby={contextId}>
            {groupParticipationOptions(locale).map((o) => (
              <Row key={o.value} role="radio" aria-checked={behavior.participation === o.value} align="top" plain lead={<Radio />}
                title={o.label} sub={o.description} disabled={busy}
                onClick={() => { if (o.value !== behavior.participation) void onChange({ ...behavior, participation: o.value }); }} />
            ))}
          </div>
          <p id={contextId} className="vx-section-foot">{c.modesFoot}</p>
        </section>
        <section className="vx-section">
          <div className="vx-group">
            <Switch checked={behavior.remember} disabled={busy} label={c.remember}
              sub={c.rememberSub}
              onChange={(remember) => { void onChange({ ...behavior, remember }); }} />
          </div>
          <p className="vx-section-foot">
            <Icon name="info" size={14} className="vx-inline-icon" />
            {c.privacyBefore}{' '}
            <a className="vx-link" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer"
              onClick={(e) => { e.preventDefault(); openTelegram('https://t.me/BotFather'); }}>BotFather</a>
            {' '}{c.privacyAfter}
          </p>
        </section>
      </div>
    </Sheet>
  );
}
