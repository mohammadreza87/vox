'use client';

import { useEffect, useRef, useState } from 'react';
import { haptic, type AgentView } from '../../_lib/client';
import { Icon, Spinner } from '../ui';
import { TelegramPhoto } from './TelegramPhoto';
import { clock, stepList, syncState, useNow, useSyncState, type SyncState } from './syncState';

export { syncState, type SyncState };

export interface ProfileSyncStatusProps {
  agent: AgentView;
  /** One line (profile hero row); otherwise title + detail + actions */
  compact?: boolean;
  /** Retry the Telegram push (failed states). May return a promise: the button spins until it settles. */
  onRetry?: () => void | Promise<unknown>;
  /** Outdated: draw new portraits from the current look */
  onRegenerate?: () => void;
  /** Outdated: send the character render instead */
  onUseCharacter?: () => void | Promise<unknown>;
  /** Draws the Telegram photo with the sync ring at this size (TelegramPhoto ring) */
  photo?: number;
}

const TITLE: Record<SyncState, string> = {
  'in-sync': 'Telegram photo · up to date',
  syncing: 'Updating Telegram…',
  synced: 'Updated in Telegram',
  'error-photo': 'Couldn’t update the photo',
  'error-other': 'Telegram profile still updating',
  outdated: 'Photo out of date',
};

/**
 * Telegram profile status for an active agent (interaction §5.4, motion §4.11):
 * in sync, updating, just updated, photo refused, another step pending (neutral:
 * the photo itself is fine), or a portrait drawn from an older look. Changes are
 * announced politely; haptics fire on transitions only.
 */
export function ProfileSyncStatus({ agent, compact, onRetry, onRegenerate, onUseCharacter, photo }: ProfileSyncStatusProps) {
  const state = useSyncState(agent);
  const sync = agent.profileSync;
  const retryAt = sync?.retryAt ? Date.parse(sync.retryAt) : NaN;
  const counting = (state === 'error-photo' || state === 'error-other') && Number.isFinite(retryAt);
  const now = useNow(counting);
  const [working, setWorking] = useState<'retry' | 'character' | null>(null);

  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === state) return;
    if (state === 'syncing') haptic.light();
    else if (state === 'synced') haptic.success();
    else if (state === 'error-photo' || (state === 'error-other' && was === 'syncing')) haptic.error();
  }, [state]);

  if (agent.status !== 'active') return null;

  const wait = counting ? (retryAt - now) / 1000 : 0;
  const auto = counting && wait > 0 ? `Auto-retry in ${clock(wait)}` : null;
  const detail = ({
    'in-sync': 'What people see in Telegram',
    syncing: 'Usually a few seconds',
    synced: 'Just now · chats may lag a minute',
    'error-photo': auto ?? 'Telegram didn’t accept it',
    'error-other': `Photo is fine · ${stepList(sync?.failed ?? [])} pending${auto ? ` · ${auto.toLowerCase()}` : ''}`,
    outdated: 'Look changed · not sent yet',
  } satisfies Record<SyncState, string>)[state];

  const run = (kind: 'retry' | 'character', fn: () => void | Promise<unknown>) => {
    haptic.tap();
    const out = fn();
    if (!(out instanceof Promise)) return;
    setWorking(kind);
    void out.finally(() => setWorking((w) => (w === kind ? null : w)));
  };

  const failed = state === 'error-photo' || state === 'error-other';
  const actions = (
    <>
      {failed && onRetry && (
        <button className="vx-btn vx-btn-secondary vx-sync-btn" aria-label="Retry Telegram profile" disabled={!!working} onClick={() => run('retry', onRetry)}>
          {working === 'retry' ? <Spinner size={14} /> : 'Retry'}
        </button>
      )}
      {state === 'outdated' && onRegenerate && (
        <button className="vx-btn vx-btn-secondary vx-sync-btn" disabled={!!working} onClick={() => { haptic.tap(); onRegenerate(); }}>{compact ? 'Update' : 'Regenerate'}</button>
      )}
      {state === 'outdated' && !compact && onUseCharacter && (
        <button className="vx-btn vx-sync-btn vx-sync-ghost" disabled={!!working} onClick={() => run('character', onUseCharacter)}>
          {working === 'character' ? <Spinner size={14} /> : 'Use character'}
        </button>
      )}
    </>
  );

  const lead = photo
    ? <TelegramPhoto agent={agent} size={photo} ring />
    : <span className="vx-sync-icon" aria-hidden="true">{state === 'syncing' ? <Spinner size={14} /> : <Icon name={ICON[state]} size={14} width={2.5} />}</span>;

  return (
    <div className={`vx-sync${compact ? ' compact' : ''}`} data-state={state}>
      {lead}
      <div className="vx-sync-text" role="status" aria-live="polite">
        <span className="vx-sync-title">{TITLE[state]}</span>
        {!compact && <span className="vx-sync-detail vx-num">{detail}</span>}
      </div>
      {actions}
    </div>
  );
}

const ICON: Record<SyncState, string> = {
  'in-sync': 'check', syncing: 'check', synced: 'check', 'error-photo': 'warn', 'error-other': 'clock', outdated: 'warn',
};
