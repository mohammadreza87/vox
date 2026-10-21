'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, openTelegram, tg, type AgentView } from '../../../_lib/client';
import { SPRING } from '../../../_lib/motion';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { Cloud, type CloudMoment } from '../../Cloud';
import { ProfileSyncStatus } from '../../look/ProfileSyncStatus';
import { TelegramPhoto } from '../../look/TelegramPhoto';
import { Burst } from '../../motion/Burst';
import { ProgressPill } from '../../motion/ProgressPill';
import { errorMessage, useNav } from '../../StudioApp';
import { Banner, Icon, Row, Spinner } from '../../ui';
import { Dock, type StepProps } from './shared';
import type { SpawnStep } from './SpawnScreen';

type TelegramEvents = { onEvent?(e: string, cb: () => void): void; offEvent?(e: string, cb: () => void): void };

const POLL_MS = 3000;
/** After a minute of waiting, check less often (interaction §3.4.6); `activated` still checks at once. */
const SLOW_POLL_MS = 10_000;
const SLOW_AFTER_MS = 60_000;

/** Storage can throw (private mode); these are conveniences, never required. */
const read = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* session only */ } };
const linkKey = (id: string) => `vx:hire-link:${id}`;
const bornKey = (id: string) => `vx:born:${id}`;

/**
 * Hire (board family; interaction §3.4.6). Before: what you're hiring, each row jumps back to its step,
 * and a preview of the Telegram profile. Waiting: BotFather is open; this page checks back on its own
 * and the moment Telegram hands the Mini App back. Hired: the designed character is born and rewinds
 * to a newborn (D20), with the Telegram profile card and its sync status.
 */
export function HireStep({ agent, busy, run, onUpdate, onSayHi, onEdit }: Omit<StepProps, 'onNext'> & {
  onSayHi?: () => void; onEdit?: (step: SpawnStep) => void;
}) {
  const nav = useNav();
  const all = spawnCopy[nav.locale ?? 'en'];
  const c = all.hire;
  const [link, setLink] = useState<string | null>(() => read(linkKey(agent.id)));
  const [statusError, setStatusError] = useState<string | null>(null);
  const awaiting = agent.status === 'awaiting_bot';
  const active = agent.status === 'active';
  const profileReady = agent.profileSync?.status === 'synced';
  const checking = awaiting || (active && !profileReady);
  const update = useRef(onUpdate);
  update.current = onUpdate;

  // Creation and applying the chosen profile finish separately in Telegram.
  useEffect(() => {
    if (!checking) return;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api.agent(agent.id);
        if (cancelled) return;
        setStatusError(null);
        if (r.agent.status === 'active' && r.agent.profileSync?.status === 'synced') haptic.success();
        update.current(r.agent);
      } catch (e) {
        if (!cancelled) setStatusError(errorMessage(e));
      } finally { inFlight = false; }
    };
    const loop = () => {
      timer = setTimeout(async () => { await check(); if (!cancelled) loop(); }, Date.now() - started > SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS);
    };
    loop();
    const app = tg() as (ReturnType<typeof tg> & TelegramEvents) | null;
    const onBack = () => void check();
    app?.onEvent?.('activated', onBack);
    return () => { cancelled = true; clearTimeout(timer); app?.offEvent?.('activated', onBack); };
  }, [checking, agent.id]);

  const publish = async () => {
    const r = await run('publish', () => api.publish(agent.id));
    if (r) { setLink(r.link); write(linkKey(agent.id), r.link); onUpdate(r.agent); openTelegram(r.link); }
  };
  const retryProfile = async () => {
    const r = await run('profile', () => api.syncProfile(agent.id));
    if (r) { setStatusError(null); onUpdate(r.agent); }
  };

  if (active) return <Hired agent={agent} statusError={statusError} onRetry={agent.canManageAccess || agent.canEdit ? retryProfile : undefined} />;

  const name = agent.persona.name;
  return (
    <>
      {/* layoutScroll: the face's hire → agent flight measures from the scrolled position (motion §3.3) */}
      <motion.div className="vx-scroll vx-form vx-hire" layoutScroll>
        <div className="vx-hire-hero">
          <span className="vx-hero-glow vx-hire-glow" aria-hidden="true" />
          <Cloud look={agent.look} size={140} stage={4} expr={awaiting ? 'listening' : 'idle'} label={name} heroId={agent.id} />
        </div>
        <div className="vx-step-head center">
          <h1 className="vx-title-l">{awaiting ? c.confirm : c.hire(name)}</h1>
          <p className="vx-2">
            {awaiting ? c.awaiting(name) : c.body(name, nav.me.org)}
          </p>
        </div>

        {awaiting ? (
          statusError
            ? <Banner tone="danger">{c.statusError(statusError)}</Banner>
            : <div className="vx-center"><ProgressPill active labels={c.waiting} tau={6} slow={all.slow} /></div>
        ) : (
          <>
            <section className="vx-section" aria-label={c.hiring}>
              <div className="vx-group">
                <Row plain lead={<Icon name="cloud" size={20} />} title={c.lookPhoto} value={agent.look.avatar ? c.portrait : c.character}
                  chevron={!!onEdit} onClick={onEdit ? () => onEdit('look') : undefined} />
                <Row plain lead={<Icon name="mic" size={20} />} title={c.voice} value={agent.voice?.label ?? c.textOnly}
                  chevron={!!onEdit} onClick={onEdit ? () => onEdit('voice') : undefined} />
                <Row plain lead={<Icon name="lock" size={20} />} title={c.locks} value={c.locksValue}
                  chevron={!!onEdit} onClick={onEdit ? () => onEdit('draft') : undefined} />
              </div>
            </section>
            <section className="vx-section" aria-label={c.preview}>
              <h2 className="vx-over vx-section-head">{c.preview}</h2>
              <div className="vx-group">
                <Row size="l" lead={<TelegramPhoto agent={agent} size={48} />} title={name} sub={c.botSub} />
              </div>
            </section>
            {onSayHi && <button type="button" className="vx-chip vx-self-center" onClick={onSayHi}><Icon name="chat" size={14} />{c.tryChat}</button>}
          </>
        )}
      </motion.div>
      <Dock>
        {awaiting ? (
          <button type="button" className="vx-btn vx-btn-secondary vx-btn-block" onClick={() => (link ? openTelegram(link) : void publish())} disabled={!!busy}>
            <Icon name="external" size={18} />{c.openAgain}
          </button>
        ) : (
          <button type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={() => void publish()} disabled={!!busy} aria-busy={busy === 'publish' || undefined}>
            {busy === 'publish' ? <Spinner /> : <Icon name="check" width={2} />}{c.hire(name)}
          </button>
        )}
      </Dock>
    </>
  );
}

/**
 * Just hired. The first time this device sees it, the designed character hops in a burst, rewinds to a
 * newborn (the `born` moment, D20) and the caption says it grows. Open flies the face to the profile.
 */
function Hired({ agent, statusError, onRetry }: { agent: AgentView; statusError: string | null; onRetry?: () => Promise<void> }) {
  const nav = useNav();
  const c = spawnCopy[nav.locale ?? 'en'].hire;
  const name = agent.persona.name;
  const ready = agent.profileSync?.status === 'synced';
  const [born] = useState(() => read(bornKey(agent.id)) === null);
  const [moment, setMoment] = useState<CloudMoment | null>(() => (born ? { kind: 'born', key: agent.id, fromStage: 4 } : null));
  useEffect(() => { if (born) { write(bornKey(agent.id), '1'); haptic.success(); } }, [born, agent.id]);
  // Until the first status lands, the push is still on its way: show it as updating.
  const shown: AgentView = agent.profileSync ? agent : { ...agent, profileSync: { status: 'pending', failed: [] } };

  const open = () => {
    nav.cache?.set(agent.id, agent);
    nav.reset({ name: 'home' }, { name: 'agent', id: agent.id });
  };

  return (
    <>
      {/* layoutScroll: the face's hire → agent flight measures from the scrolled position (motion §3.3) */}
      <motion.div className="vx-scroll vx-form vx-hire" layoutScroll>
        <div className="vx-hire-hero">
          <span className="vx-hero-glow vx-hire-glow" aria-hidden="true" />
          {born && <span className="vx-hire-burst"><Burst kind="hire" size={240} /></span>}
          <Cloud look={agent.look} size={160} stage={agent.stage ?? 1} expr={ready ? 'happy' : 'listening'} label={name} heroId={agent.id}
            moment={moment} onMomentEnd={() => setMoment(null)} />
        </div>
        <div className="vx-step-head center">
          <motion.h1 key={ready ? 'hired' : 'created'} className="vx-title-l" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.snappy}>
            {ready ? c.hired(name) : c.created(name)}
          </motion.h1>
          <p className="vx-2">
            {born ? c.newborn(name) : ''}{c.live(agent.bot?.username ?? '')}
          </p>
        </div>
        <section className="vx-section" aria-label={c.profile}>
          <div className="vx-group vx-tgcard">
            <Row size="l" lead={<TelegramPhoto agent={shown} size={56} ring />} title={name} sub={agent.bot ? `@${agent.bot.username}` : c.bot} />
            <div className="vx-tgcard-status"><ProfileSyncStatus agent={shown} onRetry={onRetry} /></div>
          </div>
        </section>
        {statusError && <Banner tone="danger">{c.statusError(statusError)}</Banner>}
      </motion.div>
      <Dock>
        <div className="vx-dock-row vx-grow">
          <button type="button" className="vx-btn vx-btn-secondary" onClick={() => agent.bot && openTelegram(`https://t.me/${agent.bot.username}`)}>{c.message}</button>
          <button type="button" className="vx-btn vx-btn-primary" onClick={open}>{c.open}</button>
        </div>
      </Dock>
    </>
  );
}
