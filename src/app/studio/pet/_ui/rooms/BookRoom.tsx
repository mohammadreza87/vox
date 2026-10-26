'use client';

import { useEffect, useRef, useState } from 'react';
import { KEEPSAKES, type KeepsakeId } from '@/lib/pet/play';
import { isLit, momentWhy, pageKeys } from '../growth';
import { Sheet } from '../Sheet';
import { t, type PetStringKey } from '../strings';
import type { RoomProps } from '.';
import { Doodle, ItemIcon, TabIcon, type BookTab } from './art';
import './rooms.css';

type Tab = BookTab;
/** One line each, in both languages (P-11): What I've learned is `book.tab.learned` here; `growth.tab` names it in full elsewhere. */
const TABS: readonly [Tab, PetStringKey][] = [['pages', 'book.tab.pages'], ['keepsakes', 'book.tab.keepsakes'], ['learned', 'book.tab.learned'], ['about', 'book.tab.about']];
interface Leaf { key: string; title: string; why?: string; unlit?: boolean; item?: KeepsakeId }

const earnKey = (id: KeepsakeId): PetStringKey => {
  const e = KEEPSAKES[id].earn;
  return 'season' in e ? `closet.lock.${e.season}` as PetStringKey : 'bloom' in e ? 'closet.lock.bloom' : 'closet.lock.bond';
};

/** The leaves of one tab, in the book's order (never a count anywhere). */
export function leaves(tab: Tab, host: NonNullable<RoomProps['host']>): Leaf[] {
  const v = host.view();
  const name = v?.name ?? '';
  if (tab === 'pages') {
    const book = [...(v?.play?.book ?? [])].sort((a, b) => a.at - b.at);
    // an empty book still has its first page (§11: "Page one: we met.")
    const ids = book.length ? book.map((b) => b.id) : ['met' as const];
    return ids.map((id) => { const k = pageKeys(id); return { key: id, title: t(k.title, { name }), why: t(k.why, { name }) }; });
  }
  if (tab === 'keepsakes') {
    const items = v?.play?.items ?? [];
    if (!items.length) return [{ key: 'none', title: t('closet.empty') }];
    return items.map((i) => ({ key: i.id, title: t(`item.${i.id}` as PetStringKey), why: t(earnKey(i.id)), item: i.id }));
  }
  if (tab === 'learned') {
    const g = v?.growth;
    const ms = g?.moments ?? [];
    if (!ms.length) return [{ key: 'none', title: t('book.learned.empty') }];
    // lit first (newest first), then what could be learned, as hints only
    const lit = ms.filter((m) => isLit(m, g)).sort((a, b) => (b.lit?.at ?? '').localeCompare(a.lit?.at ?? ''));
    const open = ms.filter((m) => !isLit(m, g));
    return [
      ...lit.map((m) => ({ key: m.id, title: m.title, why: t(momentWhy(m, g), { name }) })),
      ...open.map((m) => ({ key: m.id, title: m.hint, why: t('growth.unlit.label'), unlit: true })),
    ];
  }
  return [{ key: 'about', title: t('book.about', { name }) }];
}

/**
 * Life Book (design §4.7, §4.11, S13): a small book, one leaf at a time with dots, ‹ › and a swipe. Pages are the
 * server's page ids (`book.page.<id>` with their shared why line); Keepsakes say how each was earned; What I've
 * learned shows every lit growth moment with its why line and every unlit one as its hint only; About me is the AI
 * disclosure in the pet's voice. No counts, no progress bar, nothing that scrolls.
 */
export default function BookRoom({ host }: RoomProps) {
  const [tab, setTab] = useState<Tab>('pages');
  const [at, setAt] = useState(0);
  const [visits, setVisits] = useState<'note' | 'ask' | null>(null);
  const swipe = useRef<number | null>(null);
  useEffect(() => { host?.busy('visits', visits === 'ask'); return () => host?.busy('visits', false); }, [host, visits]);
  if (!host) return null;
  const list = leaves(tab, host);
  const i = Math.min(at, list.length - 1);
  const leaf = list[i];
  const rtl = host.lang === 'fa';
  const go = (by: 1 | -1) => {
    const n = Math.max(0, Math.min(list.length - 1, i + by));
    if (n === i) return;
    setAt(n);
    host.engine()?.roomReact?.('pageFlip');
  };
  const pick = (next: Tab) => { setTab(next); setAt(0); setVisits(null); host.engine()?.roomReact?.('pageFlip'); };
  const name = host.view()?.name ?? '';
  /** P10 (§4.8, §6.2): the first time Visits opens, the opt-in; Visits itself is phase 3, so it says it comes later */
  const openVisits = () => {
    const play = host.view()?.play;
    const guest = host.view()?.role === 'guest';
    if (play && !guest && !play.asks.P10) { setVisits('ask'); void host.play({ op: 'askSeen', ask: 'P10' }); return; }
    setVisits('note');
  };
  const answerVisits = (yes: boolean) => {
    setVisits('note');
    // the answer is recorded, and a yes is the visits flag itself (`setVisits`, PetPlay.visitsOpen): Visits stays phase 3
    void host.play({ op: yes ? 'askAccepted' : 'askDeclined', ask: 'P10' }).then(() => (yes ? host.play({ op: 'setVisits', open: true }) : null));
    host.say(t(yes ? 'perm.P10.after.yes' : 'perm.P10.after.no', undefined, host.lang));
  };

  // a cream spread in the tray above the rail (the drawing on the first page, the line on the second), the four tabs as
  // the room's verbs in the dock slot under it: the rail never moves (P-05, P-11)
  return (
    <>
      <div className="pet-tray pet-book" data-room="book">
        <div className="pet-spread" role="tabpanel" data-unlit={leaf.unlit ? '' : undefined}
          onPointerDown={(e) => { swipe.current = e.clientX; }}
          onPointerUp={(e) => { const x = swipe.current; swipe.current = null; if (x === null || Math.abs(e.clientX - x) < 36) return; go((e.clientX < x) !== rtl ? 1 : -1); }}>
          {leaf.item && !visits ? <span className="pet-doodle"><ItemIcon id={leaf.item} /></span> : <Doodle faint={leaf.unlit || leaf.key === 'none'} />}
          <div aria-live="polite">
            {visits ? <small>{t('visits.later', { name }, host.lang)}</small> : <><b>{leaf.title}</b>{leaf.why && <small>{leaf.why}</small>}</>}
          </div>
        </div>
        {/* one row under the spread: ‹, the dots (or About me's Visits link), ›; a single page has no row at all (N-4) */}
        {(list.length > 1 || (tab === 'about' && !visits)) && <div className="pet-nav">
          <button type="button" aria-label={t('book.prev')} disabled={i === 0} onClick={() => go(-1)}>‹</button>
          {list.length > 1 && <div className="pet-dots" aria-hidden="true">{list.map((l, k) => <i key={l.key} data-on={k === i ? '' : undefined} />)}</div>}
          {/* About me is one leaf (no dots): Visits opens from under it (§4: "Visits open from the Life Book") */}
          {tab === 'about' && !visits && <button type="button" className="pet-link" onClick={openVisits}>{t('toy.book.visits')}</button>}
          <button type="button" aria-label={t('ui.more')} disabled={i >= list.length - 1} onClick={() => go(1)}>›</button>
        </div>}
      </div>
      <div className="pet-verbs" role="tablist" aria-label={t('room.book')} data-room="book">
        {TABS.map(([id, k]) => <button key={id} type="button" role="tab" className="pet-verb" aria-selected={tab === id} onClick={() => pick(id)}><i><TabIcon tab={id} /></i><span>{t(k)}</span></button>)}
      </div>
      {visits === 'ask' && <Sheet title={t('perm.P10.title', { name })} body={t('perm.P10.body', { name, group: t('visits.group', undefined, host.lang) })}
        yes={t('perm.P10.yes')} no={t('perm.P1.no')} onYes={() => answerVisits(true)} onNo={() => answerVisits(false)} />}
    </>
  );
}
