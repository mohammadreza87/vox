'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hue } from '@/lib/studio/types';
import { groupsCopy } from '../../_lib/agents-copy';
import { api, type GroupItem } from '../../_lib/client';
import type { Locale } from '../../_lib/i18n';
import { T } from '../../_lib/motion';
import { PALETTE } from '@/lib/studio/character';
import { Cloud } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Empty, ErrorState, hueVars, PageHead, Row, Sheet, SheetHead, SkeletonRows } from '../ui';

/** Ash means retired; groups get the seven living hues. */
const HUES = (Object.keys(PALETTE) as Hue[]).filter((h) => h !== 'ash');

/** A group's tile colour: stable per chat id, from the agent palette (UI §4.6). */
export const groupHue = (chatId: number): Hue => HUES[Math.abs(chatId) % HUES.length];
const initialOf = (title: string) => [...title.trim()][0]?.toLocaleUpperCase() ?? '#';

/** 40 r12 hue tile with the group's initial. */
export function GroupTile({ group }: { group: Pick<GroupItem, 'chatId' | 'title'> }) {
  return <span className="vx-tile hue" style={hueVars(PALETTE[groupHue(group.chatId)])} aria-hidden="true">{initialOf(group.title)}</span>;
}

/** An agent on its hue disc (≤ 56 px, UI §6.1); sizes 24 and 40 have classes. */
export function AgentDisc({ agent, size }: { agent: GroupItem['agents'][number]; size: 24 | 40 }) {
  return <Cloud variant="disc" look={agent.look} stage={agent.stage} size={size} lod="icon" still label={agent.name} />;
}

/** Up to three overlapping 24 px agent discs, then "+N". */
export function AgentStack({ agents, size = 24 }: { agents: GroupItem['agents']; size?: 24 | 40 }) {
  if (!agents.length) return null;
  const extra = agents.length - 3;
  return (
    <span className="vx-avatars" aria-hidden="true">
      {agents.slice(0, 3).map((a) => (
        <AgentDisc key={a.id} agent={a} size={size} />
      ))}
      {extra > 0 && <span className={`vx-avatar disc s${size} more vx-num`}>+{extra}</span>}
    </span>
  );
}

export const groupSub = (g: GroupItem, locale: Locale = 'en') => groupsCopy[locale].sub(g.memberCount, g.agents.length, g.hasGuests);

/** Groups tab: one list of 68 px rows (board add-to-groups anatomy); a row opens its agents. */
export function GroupsScreen() {
  const locale = useNav().locale ?? 'en';
  const c = groupsCopy[locale];
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<GroupItem | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(() => {
    setLoadError(null);
    api.groups().then((r) => setGroups(r.groups)).catch((e) => setLoadError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (groups) firstLoad.current = false; }, [groups]);

  return (
    <>
      <motion.div className="vx-scroll vx-stack" layoutScroll>
        <PageHead over={c.over(groups?.length ?? 0)} title={c.title} />
        {loadError && !groups ? (
          <ErrorState title={c.loadError} reason={loadError} onRetry={load} />
        ) : groups === null ? (
          <SkeletonRows rows={3} lead="tile" label={c.loading} />
        ) : groups.length === 0 ? (
          <Empty title={c.emptyTitle} body={c.emptyBody} />
        ) : (
          <section className="vx-section">
            <div className="vx-group">
              {groups.map((g, i) => (
                <motion.div key={g.chatId} className="vx-li" initial={firstLoad.current ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={T.listItem(i)}>
                  <Row size="l" lead={<GroupTile group={g} />} title={<span className="vx-ellipsis">{g.title}</span>}
                    sub={groupSub(g, locale)} subTone={g.hasGuests ? 'warn' : undefined} end={<AgentStack agents={g.agents} />} chevron
                    aria-label={`${g.title}${locale === 'fa' ? '، ' : ', '}${groupSub(g, locale)}`} onClick={() => setOpen(g)} />
                </motion.div>
              ))}
            </div>
            <p className="vx-section-foot">{c.foot}</p>
          </section>
        )}
      </motion.div>
      <GroupSheet group={open} onClose={() => setOpen(null)} />
    </>
  );
}

function GroupSheet({ group, onClose }: { group: GroupItem | null; onClose: () => void }) {
  const nav = useNav();
  const locale = nav.locale ?? 'en';
  const c = groupsCopy[locale];
  return (
    <Sheet open={!!group} onClose={onClose} label={group?.title ?? c.group}>
      {group && (
        <div className="vx-sheet-groups">
          <div className="vx-sheet-lead">
            <GroupTile group={group} />
            <SheetHead title={group.title} sub={groupSub(group, locale)} />
          </div>
          {group.agents.length ? (
            <section className="vx-section">
              <h3 className="vx-over vx-section-head">{c.agentsHere}</h3>
              <div className="vx-group">
                {group.agents.map((a) => (
                  <Row key={a.id} lead={<AgentDisc agent={a} size={40} />}
                    title={a.name} chevron onClick={() => { onClose(); nav.push({ name: 'agent', id: a.id }); }} />
                ))}
              </div>
            </section>
          ) : <p className="vx-small vx-2 vx-sheet-note">{c.noAgentsHere}</p>}
          {group.hasGuests && (
            <p className="vx-footnote">{c.guests(nav.me.org)}</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
