'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { forwardRef, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type UIEvent as ReactUIEvent } from 'react';
import { homeCopy, type HomeFilter } from '../../_lib/agents-copy';
import { api, haptic, openTelegram, type AgentView } from '../../_lib/client';
import { DUR, EASE, gridStagger, pressCard, SPRING, T } from '../../_lib/motion';
import { AgentFace, Cloud, PALETTE, stageFor } from '../Cloud';
import { clearFreshAgent, isFreshAgent, seenStageFor } from '../motion/useStageUp';
import { errorMessage, useNav } from '../StudioApp';
import { Empty, ErrorState, FilterChips, hueVars, Icon, Row, Sheet, SheetHead, SkeletonCards } from '../ui';

const FILTERS: readonly HomeFilter[] = ['All', 'Mine', 'Forming', 'Drafts', 'Retired'];
type Filter = HomeFilter;

const VOX_LOOK = { hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } } as const;
/** Long-press opens the card's quick menu (interaction §3.2). */
const LONG_PRESS_MS = 450;
/** The FAB folds to its icon once the grid has scrolled this far down. */
const FAB_FOLD_Y = 24;
/** Set as a style so framer corrects the pill's radius while the width morphs (a CSS 999px would squash). */
const FAB_RADIUS = { borderRadius: 28 } as const;

export function FormingRing({ day, color, size = 20 }: { day: number; color: string; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="vx-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${(c * day) / 7} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** Card status: only LOCKED keeps the tracked seal; every other state is a sentence-case pill (UI §4.2). */
export function StatusLine({ agent }: { agent: AgentView }) {
  const c = homeCopy[useNav().locale ?? 'en'];
  const pal = PALETTE[agent.look.hue];
  if (agent.status === 'fired') return <span className="vx-pill">{c.retired}</span>;
  if (agent.status === 'draft') return <span className="vx-pill warn">{c.draft}</span>;
  if (agent.status === 'awaiting_bot') return <span className="vx-pill warn"><span className="vx-pill-dot vx-glow" />{c.waitingTelegram}</span>;
  if (agent.locked) return <span className="vx-pill lock"><Icon name="lock" size={11} width={2.5} />{c.locked}</span>;
  return (
    <>
      <FormingRing day={agent.formingDay ?? 1} color={pal.base} />
      <span className="vx-small vx-2 vx-num">{c.forming(agent.formingDay ?? 1)}</span>
    </>
  );
}

const matches = (filter: Filter, a: AgentView, me: number) => {
  if (filter === 'Retired') return a.status === 'fired';
  if (a.status === 'fired') return false;
  if (filter === 'Mine') return a.createdBy === me;
  if (filter === 'Forming') return a.status === 'active' && !a.locked;
  if (filter === 'Drafts') return a.status === 'draft' || a.status === 'awaiting_bot';
  return true;
};

/**
 * The last list Home showed, by id, per app session (keyed by its agent cache). A return to Home renders
 * these cards from the cache at once, so a hero-pop has its card face to land on and the first-load
 * stagger doesn't replay (motion §3.3, §5.4); the fetch then refreshes them in place.
 */
const lastList = new WeakMap<Map<string, AgentView>, string[]>();
function seeded(cache?: Map<string, AgentView>): AgentView[] | null {
  const ids = cache && lastList.get(cache);
  if (!cache || !ids?.length) return null;
  const list = ids.map((id) => cache.get(id));
  return list.every(Boolean) ? list as AgentView[] : null;
}

/** First grapheme of a name, for the profile disc (works for Persian and emoji names too). */
const initial = (name: string) => [...name.trim()][0]?.toLocaleUpperCase() ?? '?';
const stageOf = (a: AgentView) => a.stage ?? stageFor(a.formingDay, a.status);

export function HomeScreen() {
  const nav = useNav();
  const c = homeCopy[nav.locale ?? 'en'];
  const [agents, setAgents] = useState<AgentView[] | null>(() => seeded(nav.cache));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState(false);
  const [menu, setMenu] = useState<AgentView | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Cards stagger in on the first load only; refreshes, filter changes and returns (seeded) reflow instead.
  const firstLoad = useRef(agents === null);
  const lastY = useRef(0);

  const load = useCallback(() => {
    setLoadError(null);
    api.agents()
      .then((r) => {
        setAgents(r.agents);
        if (!nav.cache) return;
        for (const a of r.agents) nav.cache.set(a.id, a);
        lastList.set(nav.cache, r.agents.map((a) => a.id));
      })
      .catch((e) => setLoadError(errorMessage(e)));
  }, [nav.cache]);
  useEffect(load, [load]);
  useEffect(() => { if (agents) firstLoad.current = false; }, [agents]);
  useEffect(() => { if (searching) searchBox.current?.focus(); }, [searching]);

  const me = nav.me.member.telegramId;
  const all = agents ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const shown = all.filter((a) => matches(filter, a, me)
    && (!needle || `${a.persona.name} ${a.persona.role}`.toLocaleLowerCase().includes(needle)));
  const active = all.filter((a) => a.status === 'active');
  const forming = active.filter((a) => !a.locked).length;
  // Counts on every chip; a chip with nothing in it hides (unless it's the one you're on).
  const chips = FILTERS.map((f) => ({ value: f, label: c.filters[f], count: all.filter((a) => matches(f, a, me)).length }))
    .filter((c) => c.value === 'All' || c.value === filter || c.count > 0);

  const open = (a: AgentView) => (a.status === 'draft' || a.status === 'awaiting_bot')
    ? nav.push({ name: 'spawn', draftId: a.id })
    : nav.push({ name: 'agent', id: a.id });
  const closeSearch = () => { setSearching(false); setQuery(''); };

  // FAB: icon-only while scrolling down the grid, label back on the way up (motion §3.5).
  const onScroll = (e: ReactUIEvent<HTMLElement>) => {
    const y = e.currentTarget.scrollTop;
    const dy = y - lastY.current;
    if (Math.abs(dy) < 6 && y > FAB_FOLD_Y) return;
    lastY.current = y;
    setFolded(y > FAB_FOLD_Y && dy > 0);
  };

  return (
    <>
      <motion.div className="vx-scroll" layoutScroll onScroll={onScroll}>
        <div className="vx-apphead">
          <div className="vx-apphead-brand">
            <Cloud look={VOX_LOOK} size={32} label="Vox" still heroId="vox-logo" />
            <span className="vx-wordmark">Vox Studio</span>
          </div>
          <div className="vx-apphead-end">
            <button type="button" className="vx-icon-btn solid" aria-label={searching ? c.closeSearch : c.searchAgents} aria-expanded={searching}
              onClick={() => (searching ? closeSearch() : setSearching(true))}>
              <Icon name={searching ? 'close' : 'search'} size={20} />
            </button>
            <button type="button" className="vx-icon-btn initial" aria-label={c.you} onClick={() => nav.reset({ name: 'privacy' })}>
              {initial(nav.me.member.name)}
            </button>
          </div>
        </div>

        <div className="vx-pagehead">
          <span className="vx-over vx-num">{c.over(nav.me.org, active.length, forming)}</span>
          <h1 className="vx-display">{c.title}</h1>
        </div>

        <AnimatePresence initial={false}>
          {searching && (
            <motion.label key="search" className="vx-search vx-home-search" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 44 }}
              exit={{ opacity: 0, height: 0 }} transition={T.morph}>
              <Icon name="search" size={18} />
              <input ref={searchBox} className="vx-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={c.searchPlaceholder} aria-label={c.searchAgents} dir="auto" onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }} />
            </motion.label>
          )}
        </AnimatePresence>

        <div className="vx-home-filters">
          <FilterChips label={c.filterLabel} options={chips} value={filter} onChange={setFilter} />
        </div>

        <div className="vx-home-grid">
          {loadError && !agents ? (
            <ErrorState title={c.loadError} reason={loadError} onRetry={load} />
          ) : agents === null ? (
            <SkeletonCards label={c.loading} />
          ) : shown.length === 0 ? (
            needle ? <Empty look={false} title={c.noMatch(query.trim())} body={c.noMatchBody} />
              : <Empty title={filter === 'All' ? c.emptyTitle : c.nothingIn(c.filters[filter])}
                expr={filter === 'All' ? 'happy' : 'sleeping'}
                body={filter === 'All' ? c.emptyBody : undefined} />
          ) : (
            <motion.div className="vx-grid" layout transition={SPRING.snappy}>
              {/* Mounts with the first cards: `initial` lets the first load stagger in; a seeded return stays at rest */}
              <AnimatePresence mode="popLayout" initial={firstLoad.current}>
                {shown.map((a, i) => (
                  <AgentCard key={a.id} agent={a} index={i} first={firstLoad.current} lifted={menu?.id === a.id}
                    onOpen={() => open(a)} onMenu={a.status === 'active' ? () => { haptic.medium(); setMenu(a); } : undefined} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </motion.div>

      <motion.button type="button" className={`vx-fab${folded ? ' folded' : ''}`} layout transition={SPRING.snappy} style={FAB_RADIUS}
        aria-label={c.spawn} onClick={() => nav.push({ name: 'spawn' })}>
        <motion.span layout="position" className="vx-fab-icon"><Icon name="plus" width={2} /></motion.span>
        <AnimatePresence initial={false}>
          {!folded && (
            <motion.span key="label" className="vx-fab-label" aria-hidden="true"
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: DUR.fast, ease: EASE.enter, delay: 0.06 } }}
              exit={{ opacity: 0, transition: { duration: DUR.instant, ease: EASE.exit } }}>{c.spawn}</motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <CardMenu agent={menu} onClose={() => setMenu(null)} />
    </>
  );
}

/**
 * One agent card (board agents-home). The face carries `heroId`, so opening the profile flies it
 * there. A volt dot marks an agent that grew since this device last saw it; the profile plays the moment.
 * Forwards its ref so popLayout can lift a filtered-out card out of the grid while the rest reflow.
 */
const AgentCard = forwardRef<HTMLButtonElement, {
  agent: AgentView; index: number; first: boolean; lifted: boolean; onOpen: () => void; onMenu?: () => void;
}>(function AgentCard({ agent: a, index, first, lifted, onOpen, onMenu }, ref) {
  const c = homeCopy[useNav().locale ?? 'en'];
  const pal = PALETTE[a.look.hue];
  const fired = a.status === 'fired';
  const stage = stageOf(a);
  // An agent that grew keeps the stage this device saw until its profile plays the moment: the card and the
  // hero flight never spoil the reveal (motion §4.8)
  const seen = a.status === 'active' ? seenStageFor(a.id) : null;
  const grew = seen !== null && seen < stage;
  // the newly spawned agent's first card condenses out of its vapor (motion §4.7), once per device
  const [fresh, setFresh] = useState(() => !fired && isFreshAgent(a.id));
  useEffect(() => { if (fresh) clearFreshAgent(a.id); }, [fresh, a.id]);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const longFired = useRef(false);   // the long-press fired: swallow the click that follows the release

  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);
  const cancel = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const down = (e: ReactPointerEvent) => {
    longFired.current = false;
    if (!onMenu || e.button !== 0) return;
    cancel();
    press.current = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press.current = null; longFired.current = true; onMenu(); }, LONG_PRESS_MS) };
  };
  const move = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancel();   // a scroll, not a hold
  };

  return (
    <motion.button ref={ref} type="button" className="vx-card vx-agent-card" style={hueVars(pal)} layout
      initial={first ? { opacity: 0, y: 12 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: lifted ? 1.03 : 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: T.fadeOut }}
      transition={first ? { ...T.listItem(0), delay: gridStagger(index) } : SPRING.snappy}
      whileTap={pressCard.whileTap}
      onPointerDown={down} onPointerMove={move} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={(e) => { if (!onMenu) return; e.preventDefault(); cancel(); if (!longFired.current) { longFired.current = true; onMenu(); } }}
      onClick={() => { if (longFired.current) { longFired.current = false; return; } onOpen(); }}
      aria-label={c.cardLabel(a.persona.name, a.persona.role)}>
      <span className="vx-card-glow" />
      {a.isAdmin && <span className="vx-pill volt vx-agent-card-pill">{c.admin}</span>}
      {grew && <span className="vx-agent-card-dot vx-head-dot" role="img" aria-label={c.grew(a.persona.name)} />}
      <span className={`vx-agent-card-face${fired ? ' dim' : ''}`}>
        <AgentFace look={a.look} size={104} stage={grew ? seen : stage} expr={fired ? 'sleeping' : 'idle'} label={a.persona.name} heroId={a.id} still={fired}
          moment={fresh ? { kind: 'poof', key: a.id } : null} onMomentEnd={() => setFresh(false)} />
      </span>
      <span className="vx-agent-card-text">
        <span className="vx-head vx-ellipsis">{a.persona.name}</span>
        <span className="vx-small vx-2 vx-ellipsis">{a.persona.role}</span>
      </span>
      <span className="vx-agent-card-status"><StatusLine agent={a} /></span>
    </motion.button>
  );
});

/** Long-press menu on a card: the four things you'd otherwise open the profile for. */
function CardMenu({ agent, onClose }: { agent: AgentView | null; onClose: () => void }) {
  const nav = useNav();
  const c = homeCopy[nav.locale ?? 'en'];
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [agent]);
  const bot = agent?.bot?.username;
  const go = (fn: () => void) => () => { onClose(); fn(); };
  const copy = async () => {
    if (!bot) return;
    try { await navigator.clipboard.writeText(`@${bot}`); setCopied(true); haptic.success(); } catch { nav.toast(`@${bot}`); }
  };
  return (
    <Sheet open={!!agent} onClose={onClose} label={agent ? c.quickActionsFor(agent.persona.name) : c.quickActions}>
      {agent && (
        <>
          <SheetHead title={agent.persona.name} sub={agent.persona.role} />
          <div className="vx-group">
            <Row plain lead={<Icon name="phone" size={20} />} title={c.call(agent.persona.name)} onClick={go(() => nav.push({ name: 'call', id: agent.id }))} />
            {bot && <Row plain lead={<Icon name="external" size={20} />} title={c.chatTelegram} onClick={go(() => openTelegram(`https://t.me/${bot}`))} />}
            <Row plain lead={<Icon name="groups" size={20} />} title={c.addToGroups} chevron onClick={go(() => nav.push({ name: 'add-groups', id: agent.id }))} />
            {bot && <Row plain lead={<Icon name={copied ? 'check' : 'attach'} size={20} />} title={copied ? c.copied : c.copy(bot)} onClick={() => void copy()} />}
          </div>
        </>
      )}
    </Sheet>
  );
}
