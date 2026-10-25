'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addGroupsCopy, channelsCopy } from '../../_lib/agents-copy';
import { api, haptic, openTelegram, tg, type AgentView, type ChannelsView, type GroupItem } from '../../_lib/client';
import { SPRING, T } from '../../_lib/motion';
import { Cloud, PALETTE, type CloudMoment } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Banner, Empty, ErrorState, hueVars, Icon, Row, SkeletonRows, Spinner, TopBar } from '../ui';
import { GroupTile, groupSub } from './Groups';

type TelegramEvents = { onEvent?(e: string, cb: () => void): void; offEvent?(e: string, cb: () => void): void };

/** A group row's state for this agent. `asked` = we opened Telegram for it and are waiting to hear back. */
type RowState = 'added' | 'add' | 'asked' | 'joined';

/**
 * Add an agent to Telegram groups (board add-to-groups, interaction §3.8). A bot can't add itself and
 * Telegram's `startgroup` picker can't be preselected, so every Add opens Telegram's own picker. When
 * the Mini App comes back (`activated`), the list refetches: a newly joined group's row pops its check
 * and the cloud hops; a group that didn't join says so.
 */
export function AddToGroupsScreen({ id }: { id: string }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = addGroupsCopy[locale];
  const cc = channelsCopy[locale];
  const [agent, setAgent] = useState<AgentView | null>(() => nav.cache?.get(id) ?? null);
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asked, setAsked] = useState<number | 'other' | null>(null);
  const [joined, setJoined] = useState<Set<number>>(() => new Set());
  const [opening, setOpening] = useState(false);
  const [moment, setMoment] = useState<CloudMoment | null>(null);
  /** Circles S5: null while Circles is off (the endpoint answers 404) or before it loads. */
  const [channels, setChannels] = useState<ChannelsView | null>(null);
  const link = useRef<string | null>(null);
  const before = useRef<Set<number> | null>(null);

  useEffect(() => {
    api.agent(id).then((r) => { nav.cache?.set(id, r.agent); setAgent(r.agent); })
      .catch((e) => { if (!nav.cache?.get(id)) { nav.toast(errorMessage(e), 'error'); nav.back(); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const memberOf = (list: GroupItem[]) => new Set(list.filter((g) => g.agents.some((a) => a.id === id)).map((g) => g.chatId));

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api.groups();
      setGroups(r.groups);
      return r.groups;
    } catch (e) { setLoadError(errorMessage(e)); return null; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let off = false;
    void Promise.resolve().then(() => api.channels(id)).then((r) => { if (!off) setChannels(r); }, () => undefined);
    return () => { off = true; };
  }, [id]);

  // Back from Telegram: see what changed since we opened the picker.
  const recheck = useCallback(async () => {
    const was = before.current;
    if (!was) return;
    before.current = null;
    const list = await load();
    if (!list) return;
    const now = memberOf(list);
    const fresh = [...now].filter((c) => !was.has(c));
    setAsked(null);
    if (fresh.length) {
      haptic.success();
      setJoined((s) => new Set([...s, ...fresh]));
      setMoment({ kind: 'hop', key: Date.now() });
    } else {
      nav.snack({ message: c.notAdded, tone: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, nav, c]);

  useEffect(() => {
    const app = tg() as (ReturnType<typeof tg> & TelegramEvents) | null;
    const onVisible = () => { if (document.visibilityState === 'visible') void recheck(); };
    const onActivated = () => void recheck();
    app?.onEvent?.('activated', onActivated);
    document.addEventListener('visibilitychange', onVisible);
    return () => { app?.offEvent?.('activated', onActivated); document.removeEventListener('visibilitychange', onVisible); };
  }, [recheck]);

  // The cloud's hop is one beat; clear it even if the rig never reports the end.
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), 1400);
    return () => clearTimeout(t);
  }, [moment]);

  if (!agent) return <><TopBar lead="back" onLead={nav.back} /><div className="vx-scroll"><SkeletonRows rows={4} lead="tile" label={c.loading} /></div></>;
  const name = agent.persona.name;
  const pal = PALETTE[agent.look.hue];

  const pick = async (target: number | 'other') => {
    if (opening) return;
    setOpening(true);
    try {
      link.current ??= (await api.groupLink(agent.id)).link;
      before.current = memberOf(groups ?? []);
      setAsked(target);
      haptic.tap();
      openTelegram(link.current);
    } catch (e) { nav.toast(errorMessage(e), 'error'); } finally { setOpening(false); }
  };

  const ready = agent.status === 'active' && !!agent.bot;
  const rows = (groups ?? []).map((g) => {
    const inIt = g.agents.some((a) => a.id === id);
    const state: RowState = inIt ? (joined.has(g.chatId) ? 'joined' : 'added') : asked === g.chatId ? 'asked' : 'add';
    return { g, state };
  });
  // Added groups sink below the ones you can still add to.
  rows.sort((a, b) => Number(a.state === 'added') - Number(b.state === 'added'));
  const guests = rows.find((r) => r.g.hasGuests && r.state === 'add')?.g;
  const added = joined.size;

  return (
    <div className="vx-hue-scope" style={hueVars(pal)}>
      <TopBar lead="back" onLead={nav.back} leadLabel={name} />
      <motion.div className="vx-scroll vx-stack" layoutScroll>
        <div className="vx-subhead">
          <Cloud look={agent.look} size={64} stage={agent.stage} expr={moment ? 'happy' : 'idle'} label={name}
            moment={moment} onMomentEnd={() => setMoment(null)} />
          <div className="vx-subhead-text">
            <h1 className="vx-title">{c.title}</h1>
            <span className="vx-small vx-2">{c.sub}</span>
          </div>
        </div>

        {!ready ? (
          <Empty look={agent.look} expr="sleeping" title={c.notReadyTitle(name)} body={c.notReadyBody(name)} />
        ) : loadError && !groups ? (
          <ErrorState title={c.loadError} reason={loadError} onRetry={() => void load()} />
        ) : groups === null ? (
          <SkeletonRows rows={4} lead="tile" label={c.loading} />
        ) : (
          <>
            <section className="vx-section" aria-label={c.groups}>
              <div className="vx-group">
                {rows.map(({ g, state }) => (
                  <div key={g.chatId} className="vx-li">
                    <Row size="l" lead={<GroupTile group={g} />} title={<span className="vx-ellipsis">{g.title}</span>}
                      sub={g.hasGuests ? c.guestSub(g.memberCount, nav.me.org) : groupSub(g, locale)} subTone={g.hasGuests ? 'warn' : undefined}
                      end={<RowEnd c={c} state={state} name={name} title={g.title} busy={opening} onAdd={() => void pick(g.chatId)} />} />
                  </div>
                ))}
                <div className="vx-li">
                  <Row size="l" plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="plus" size={20} /></span>}
                    title={asked === 'other' ? c.waiting : groups.length ? c.another : c.choose}
                    sub={c.opensPicker} disabled={opening} onClick={() => void pick('other')}
                    end={asked === 'other' ? <Spinner size={16} /> : undefined} chevron={asked !== 'other'} />
                </div>
                {/* Circles S5: Add to a channel next to Add to group (people who can manage the agent), and the post screen. */}
                {channels?.link && (
                  <div className="vx-li">
                    <Row size="l" plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="telegram" size={20} /></span>}
                      title={cc.addChannel} sub={cc.addChannelSub} chevron onClick={() => { haptic.tap(); openTelegram(channels.link!); }} />
                  </div>
                )}
                {!!channels?.channels.length && (
                  <div className="vx-li">
                    <Row size="l" plain lead={<span className="vx-tile icon" aria-hidden="true"><Icon name="edit" size={20} /></span>}
                      title={cc.post} sub={cc.count(channels.channels.length)} chevron onClick={() => nav.push({ name: 'channels', id: agent.id })} />
                  </div>
                )}
              </div>
            </section>
            {guests && (
              <Banner tone="warn">
                {c.guestsBefore}<b>{guests.title}</b>{c.guestsAfter(nav.me.org, name)}
              </Banner>
            )}
          </>
        )}
      </motion.div>
      {ready && (
        <div className="vx-dock stack">
          <p className="vx-dock-note">{c.dockNote}</p>
          <AnimatePresence initial={false}>
            {added > 0 && (
              <motion.button key="done" type="button" className="vx-btn vx-btn-primary vx-btn-block" onClick={nav.back}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING.snappy}>
                <Icon name="check" width={2} />{c.done(added)}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function RowEnd({ c, state, name, title, busy, onAdd }: { c: (typeof addGroupsCopy)['en']; state: RowState; name: string; title: string; busy: boolean; onAdd: () => void }) {
  if (state === 'added' || state === 'joined') {
    return (
      <motion.span className="vx-pill" initial={state === 'joined' ? { scale: 0.6, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={SPRING.pop}>
        <Icon name="check" size={12} width={2.5} />{c.added}
      </motion.span>
    );
  }
  if (state === 'asked') {
    return <motion.span className="vx-small vx-2 vx-row-wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T.fadeIn}><Spinner size={14} />{c.inTelegram}</motion.span>;
  }
  return (
    <button type="button" className="vx-btn vx-btn-xs" aria-label={c.addTo(name, title)} disabled={busy} onClick={onAdd}>{c.add}</button>
  );
}
