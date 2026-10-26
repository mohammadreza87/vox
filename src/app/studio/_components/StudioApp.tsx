'use client';

import { AnimatePresence, MotionConfig, motion, PresenceContext, useIsPresent } from 'framer-motion';
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, haptic, initTelegram, tg, type AgentView, type Me } from '../_lib/client';
import { dirOf, initialLocale, persistLocale, type Dir, type Locale } from '../_lib/i18n';
import { COVER_ROUTES, detectTier, kindFor, screenVariants, SPRING, TAB_ROUTES, type MotionTier, type NavCtx, type NavKind } from '../_lib/motion';
import { Cloud } from './Cloud';
import { ConfirmProvider, SheetHostContext, Spinner, UiLocaleProvider } from './ui';
import { UserInfo } from './UserInfo';
import { pageActive, REDUCED_MOTION_QUERY, subscribeActivity, useMediaQuery } from './motion/activity';
import { captureScroll, restoreScroll, SCROLLERS } from './motion/scrollMemory';
import { Snackbar, snackDuration, type SnackItem } from './motion/Snackbar';
import { TabBar, type TabItem } from './motion/TabBar';
import { TierProvider } from './motion/tier';
import { useExitWatch } from './motion/useExitWatch';
import { useFrozenExit } from './motion/useFrozenExit';
import { HomeScreen } from './screens/Home';
import { AgentScreen } from './screens/Agent';
import { SpawnScreen } from './screens/Spawn';
import { CallScreen } from './screens/Call';
import { ConversationScreen } from './screens/Conversation';
import { MemoriesScreen } from './screens/Memories';
import { FireScreen } from './screens/Fire';
import { OrgScreen } from './screens/Org';
import { GroupsScreen } from './screens/Groups';
import { PrivacyScreen } from './screens/Privacy';
import { SharedMemoriesScreen } from './screens/SharedMemories';
import { ExperienceScreen } from './screens/Experience';
import { ConnectionsScreen } from './screens/Connections';
import { AddToGroupsScreen } from './screens/AddToGroups';
import { ChannelsScreen } from './screens/Channels';
import { SettingsRouter } from './screens/settings/SettingsRouter';

export type Route =
  | { name: 'home' }
  | { name: 'groups' }
  | { name: 'org' }
  | { name: 'privacy' }
  | { name: 'shared-memories' }
  | { name: 'experience'; notificationId?: string }
  | { name: 'connections'; agentId?: string }
  | { name: 'agent'; id: string }
  | { name: 'spawn'; draftId?: string; successorOf?: string; refine?: boolean }
  | { name: 'call'; id: string }
  | { name: 'conversation'; id: string }
  | { name: 'memories'; id: string }
  | { name: 'fire'; id: string }
  | { name: 'add-groups'; id: string }
  | { name: 'channels'; id: string }
  | { name: 'settings'; page: SettingsPage; params?: Record<string, string> };

export type SettingsPage = 'preferences' | 'inbox' | 'reminders' | 'diagnostics' | 'requests' | 'connection' | 'voice-recognition' | 'agent-access';
export type { Locale };
export type Space = 'work' | 'personal';

export interface Snack {
  message: string;
  tone?: 'info' | 'success' | 'error';
  /** One action (Undo / Retry / View); the snack stays 5 s */
  action?: { label: string; run(): void };
  /** Override the duration (info 3.2 s, action 5 s, error until dismissed) */
  ms?: number;
}

export interface Nav {
  push(r: Route): void;
  /** Back as the person means it: an active back guard takes it first, otherwise one screen is popped. */
  back(): void;
  /** Replace the whole stack (first route is the tab underneath). */
  reset(...routes: Route[]): void;
  /** Alias of snack() */
  toast(message: string, tone?: 'info' | 'error'): void;
  /** Bottom snackbar, 12 px above the tab bar or dock, with an optional action */
  snack(s: Snack): void;
  me: Me;
  refreshMe(): Promise<void>;
  /** App-level language; defaults to Telegram's language_code, persisted */
  locale: Locale;
  dir: Dir;
  setLocale(l: Locale): void;
  /** App-level Work/Personal space, persisted */
  space: Space;
  setSpace(s: Space): void;
  /** Agents seen this session; hero targets render from it before their fetch lands */
  cache: Map<string, AgentView>;
  tier: MotionTier;
  /**
   * While registered, Back (Telegram's button, `back()`, a screen's top bar) calls `onBack`
   * instead of leaving the screen, e.g. to close an open sheet. Guards stack: the newest wins.
   * Returns the unregister function; call it when the guard ends and on unmount.
   */
  guardBack(onBack: () => void): () => void;
  /** Offers one Back press to the newest guard; true when a guard took it. For screens whose Back is not a plain pop. */
  consumeBack(): boolean;
}

const NavContext = createContext<Nav | null>(null);
export const useNav = () => {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside StudioApp');
  return nav;
};

export function errorMessage(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong';
}

// The `privacy` route is the "You" settings hub.
const TABS: Record<Locale, ReadonlyArray<TabItem<Route['name']>>> = {
  en: [
    { route: 'home', label: 'Agents', icon: 'cloud' },
    { route: 'groups', label: 'Groups', icon: 'groups' },
    { route: 'org', label: 'Org', icon: 'shield' },
    { route: 'privacy', label: 'You', icon: 'user' },
  ],
  fa: [
    { route: 'home', label: 'عامل‌ها', icon: 'cloud' },
    { route: 'groups', label: 'گروه‌ها', icon: 'groups' },
    { route: 'org', label: 'سازمان', icon: 'shield' },
    { route: 'privacy', label: 'شما', icon: 'user' },
  ],
};
const TABS_LABEL: Record<Locale, string> = { en: 'Main', fa: 'اصلی' };

/** Telegram fields the shell uses beyond client.ts's bridge type (all feature-detected). */
interface ShellTelegram {
  initDataUnsafe?: { user?: { language_code?: string } };
  SettingsButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}
const shell = () => tg() as ShellTelegram | null;

function stored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = window.localStorage.getItem(key);
    return (allowed as readonly unknown[]).includes(v) ? v as T : null;
  } catch { return null; }
}
function store(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: session only */ }
}

const routeKey = (r: Route, depth: number) => `${depth}-${r.name}-${'id' in r ? r.id : 'page' in r ? r.page : ''}`;
const isTabRoot = (s: readonly Route[]) => s.length === 1 && TAB_ROUTES.includes(s[0].name);
const top = (s: readonly Route[]) => s[s.length - 1];
/** Input stays locked until the incoming screen settles, or this long at most (t90 + margin). */
const LOCK_MS: Partial<Record<NavKind, number>> = { push: 420, pop: 420, hero: 460, 'hero-pop': 460, cover: 520, uncover: 520 };
/**
 * A screen still leaving this long after it started lost its exit (safety net, see Page): the slowest exit
 * (a cover's scale-down, ~660 ms) with margin. Exits are frozen when they start (useFrozenExit), so a
 * navigation landing on a screen still leaving is safe, and only the arrival holds input.
 */
const EXIT_DEADLINE_MS = 1200;
let warnedStuck = false;
/** A persistent error snack survives the navigation it arrived with (`toast(e); back()`), not the next one. */
const SNACK_NAV_GRACE_MS = 400;
/** motion.css `vxArriveDone`: a hero screen's staged arrival */
const HERO_ARRIVE_MS = 640;

export function StudioApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale(shell()?.initDataUnsafe?.user?.language_code));
  const [space, setSpaceState] = useState<Space>(() => stored<Space>('vx:space', ['work', 'personal']) ?? 'work');
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const tier = useMemo<MotionTier>(() => detectTier(reduced), [reduced]);
  const dir = dirOf(locale);
  const cache = useRef(new Map<string, AgentView>()).current;
  const notificationOpened = useRef(false);

  /* ---- unsaved-correction guard (Privacy owns the token) ---- */
  const correctionOwner = useRef<string | null>(null);
  const [correctionPending, setCorrectionPending] = useState(false);
  const correctionPendingChange = useCallback((token: string, pending: boolean): boolean => {
    if (pending) {
      if (correctionOwner.current && correctionOwner.current !== token) return false;
      correctionOwner.current = token; setCorrectionPending(true);
    } else {
      if (correctionOwner.current !== token) return false;
      correctionOwner.current = null; setCorrectionPending(false);
    }
    return true;
  }, []);
  useEffect(() => {
    if (!correctionPending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [correctionPending]);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    initTelegram();
    void loadMe();
  }, [loadMe]);

  /* ---- background pause (P8): CSS loops stop via .vx[data-paused], without re-rendering the app ---- */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => subscribeActivity(() => rootRef.current?.toggleAttribute('data-paused', !pageActive())), []);
  useEffect(() => { rootRef.current?.toggleAttribute('data-paused', !pageActive()); });

  /* ---- navigation state (refs: transitions read the latest stack synchronously) ---- */
  const stackRef = useRef(stack);
  const kinds = useRef<NavKind[]>(['replace']);            // how each stack entry was entered; back plays the inverse
  const navCtx = useRef<{ kind: NavKind; delta: number }>({ kind: 'replace', delta: 0 });
  const scrollMemory = useRef(new Map<string, number[]>()).current;
  const busy = useRef(false);
  const busyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A Back or reset asked for while the incoming screen arrives runs once it lands (the newest wins). */
  const pending = useRef<(() => void) | null>(null);
  const backRef = useRef<() => void>(() => undefined);
  const resetRef = useRef<(...routes: Route[]) => void>(() => undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  /** The screen that is arriving or at rest (a leaving screen is inert). */
  const currentScreen = useCallback(() => stageRef.current?.querySelector<HTMLElement>('.vx-screen:not([inert])') ?? null, []);

  /* ---- snackbar ---- */
  const [snack, setSnackState] = useState<(SnackItem & { at: number }) | null>(null);
  const [snackLift, setSnackLift] = useState<number | null>(null);
  const snackSeq = useRef(0);
  /** Distance from the stage bottom to the top of the tab bar, the dock or a `data-snack-anchor`; null = none. */
  const measureLift = useCallback((): number | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const anchor = (isTabRoot(stackRef.current) ? stage.querySelector('.vx-tabbar') : null)
      ?? currentScreen()?.querySelector('[data-snack-anchor], .vx-dock');
    if (!anchor) return null;
    const gap = stage.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top;
    return gap > 0 ? Math.round(gap) : null;
  }, [currentScreen]);
  const showSnack = useCallback(({ message, tone = 'info', action, ms }: Snack) => {
    if (tone === 'error') haptic.error();
    setSnackLift(measureLift());
    setSnackState({ id: ++snackSeq.current, message, tone, action, ms: snackDuration(tone, !!action, ms), at: performance.now() });
  }, [measureLift]);
  const dismissSnack = useCallback((id: number) => setSnackState((s) => (s?.id === id ? null : s)), []);

  /* ---- navigation ---- */
  const unlock = useCallback(() => {
    clearTimeout(busyTimer.current);
    if (!busy.current) return;
    busy.current = false;
    stageRef.current?.removeAttribute('data-busy');
    const next = pending.current;
    pending.current = null;
    next?.();
  }, []);
  useEffect(() => () => clearTimeout(busyTimer.current), []);

  const commit = useCallback((next: Route[], k: { kind: NavKind; delta: number }, entered: NavKind[]) => {
    const prev = stackRef.current;
    const screen = currentScreen();
    scrollMemory.set(routeKey(top(prev), prev.length), captureScroll(screen));
    if (screen?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    navCtx.current = k;
    stackRef.current = next;
    kinds.current = entered;
    const ms = reduced ? 170 : LOCK_MS[k.kind];
    if (ms) {
      busy.current = true;
      stageRef.current?.setAttribute('data-busy', '');
      clearTimeout(busyTimer.current);
      busyTimer.current = setTimeout(unlock, ms);
    }
    setSnackState((s) => (s && s.ms === null && performance.now() - s.at > SNACK_NAV_GRACE_MS ? null : s));
    setStack(next);
  }, [currentScreen, reduced, scrollMemory, unlock]);

  /** The source screen shows this agent's face and the target can render from cache: the face can fly. */
  const heroReady = useCallback((id: string | undefined) =>
    !!id && cache.has(id) && !!currentScreen()?.querySelector(`[data-hero=${JSON.stringify(`face-${id}`)}]`), [cache, currentScreen]);

  const push = useCallback((r: Route) => {
    if (correctionOwner.current || busy.current) return;   // a second tap during a transition is a double tap
    const s = stackRef.current;
    const k = kindFor('push', top(s), r, { hero: heroReady('id' in r ? r.id : undefined) });
    haptic.tap();
    commit([...s, r], k, [...kinds.current.slice(0, s.length), k.kind]);
  }, [commit, heroReady]);

  // The newest sheet guard consumes Back without disturbing the animated screen stack.
  const backGuards = useRef<Array<{ onBack: () => void }>>([]);
  const syncBackButton = useCallback(() => {
    const button = tg()?.BackButton;
    if (!button) return;
    if (stackRef.current.length > 1 || backGuards.current.length) button.show(); else button.hide();
  }, []);
  const consumeBack = useCallback(() => {
    const guard = backGuards.current[backGuards.current.length - 1];
    guard?.onBack();
    return !!guard;
  }, []);
  const guardBack = useCallback((onBack: () => void) => {
    const guard = { onBack };
    backGuards.current = [...backGuards.current, guard];
    syncBackButton();
    return () => {
      backGuards.current = backGuards.current.filter(item => item !== guard);
      syncBackButton();
    };
  }, [syncBackButton]);
  const back = useCallback(() => {
    if (consumeBack() || correctionOwner.current) return;
    if (busy.current) { pending.current = () => backRef.current(); return; }   // e.g. a load error during the push: pop once it lands
    const s = stackRef.current;
    if (s.length < 2) return;
    const k = kindFor('back', top(s), s[s.length - 2], { hero: kinds.current[s.length - 1] === 'hero' });
    scrollMemory.delete(routeKey(top(s), s.length));
    commit(s.slice(0, -1), k, kinds.current.slice(0, s.length - 1));
  }, [commit, scrollMemory, consumeBack]);
  backRef.current = back;

  const reset = useCallback((...routes: Route[]) => {
    if (correctionOwner.current) return;
    // The tab bar, Telegram's Settings and in-app jumps mid-transition: take the person there once it lands
    if (busy.current) { pending.current = () => resetRef.current(...routes); return; }
    const next = routes.length ? routes : [{ name: 'home' } as Route];
    const s = stackRef.current;
    if (s.length === 1 && next.length === 1 && routeKey(s[0], 1) === routeKey(next[0], 1)) {
      // Re-selecting the current tab scrolls it home, like iOS.
      const scroller = currentScreen()?.querySelector<HTMLElement>(SCROLLERS);
      if (scroller?.scrollTo) scroller.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      else if (scroller) scroller.scrollTop = 0;
      return;
    }
    const to = top(next);
    const k = kindFor('reset', top(s), to, { hero: heroReady('id' in to ? to.id : undefined), fromDepth: s.length, toDepth: next.length });
    for (const key of [...scrollMemory.keys()]) if (!key.startsWith('1-')) scrollMemory.delete(key);
    pending.current = null;
    commit(next, k, next.map((_, i) => (i === next.length - 1 ? k.kind : i === 0 ? 'replace' : 'push')));
  }, [commit, currentScreen, heroReady, reduced, scrollMemory]);
  resetRef.current = reset;

  const setLocale = useCallback((l: Locale) => { setLocaleState(l); persistLocale(l); }, []);
  const setSpace = useCallback((s: Space) => { setSpaceState(s); store('vx:space', s); }, []);
  const toast = useCallback((message: string, tone: 'info' | 'error' = 'info') => showSnack({ message, tone }), [showSnack]);

  const nav = useMemo<Nav | null>(() => me && {
    me, refreshMe: loadMe, push, back, reset, toast, snack: showSnack,
    locale, dir, setLocale, space, setSpace, cache, tier, guardBack, consumeBack,
  }, [me, loadMe, push, back, reset, toast, showSnack, locale, dir, setLocale, space, setSpace, cache, tier, guardBack, consumeBack]);

  useEffect(() => {
    if (!me || me.member.role === 'pending' || notificationOpened.current) return;
    notificationOpened.current = true;
    const url = new URL(window.location.href);
    const notificationId = url.searchParams.get('notification');
    if (notificationId && /^[A-Za-z0-9_-]{1,128}$/.test(notificationId)) {
      // An opaque link chooses a screen only. The inbox reloads current account,
      // space, consent and agent authority before showing any notification.
      commit([{ name: 'home' }, { name: 'settings', page: 'reminders', params: { notificationId } }], { kind: 'replace', delta: 0 }, ['replace', 'push']);
    }
    if (notificationId !== null) {
      url.searchParams.delete('notification');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [me, commit]);

  // Telegram's native back button mirrors the in-app stack and pops with the same transition.
  useEffect(() => {
    const button = tg()?.BackButton;
    if (!button) return;
    const onBack = () => backRef.current();
    syncBackButton();
    button.onClick(onBack);
    return () => button.offClick(onBack);
  }, [stack.length, syncBackButton]);

  // Telegram's ⋯ menu "Settings" opens You (D14).
  const ready = !!me && me.member.role !== 'pending';
  useEffect(() => {
    const settings = shell()?.SettingsButton;
    if (!ready || !settings) return;
    const open = () => reset({ name: 'privacy' });
    settings.onClick(open);
    settings.show();
    return () => { settings.offClick(open); settings.hide(); };
  }, [ready, reset]);

  /** The incoming screen finished: release input, focus it for assistive tech, and re-seat the snackbar. */
  const settled = useCallback(() => {
    unlock();
    const screen = currentScreen();
    const focus = document.activeElement;
    if (screen && (!focus || focus === document.body || !focus.isConnected)) screen.focus({ preventScroll: true });
    setSnackLift(measureLift());
  }, [currentScreen, measureLift, unlock]);

  // Locale and tier come from Telegram and the device, which the server can't know: the splash may hydrate with defaults.
  const shellProps = { dir, lang: locale, 'data-motion': tier, suppressHydrationWarning: true } as const;

  if (error) {
    return (
      <div className="vx" {...shellProps} style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 14 }}>
        <Cloud look={{ hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } }} expr="sleeping" size={140} label="Vox" />
        <div className="vx-title-m">Can&apos;t reach Vox Studio</div>
        <p className="vx-2" style={{ margin: 0 }}>{error}</p>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => void loadMe()}>Try again</button>
        <div style={{ width: '100%', maxWidth: 360, marginTop: 8 }}><UserInfo locale={locale} /></div>
      </div>
    );
  }
  if (!me || !nav) {
    return (
      <div className="vx" {...shellProps} style={{ alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
        {/* layoutId face-vox-logo: the splash cloud flies into the Home header logo when the app arrives */}
        <Cloud look={{ hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } }} expr="thinking" size={120} label="Vox" heroId="vox-logo" />
        <div style={{ width: '100%', maxWidth: 360 }}><UserInfo locale={locale} /></div>
      </div>
    );
  }
  if (me.member.role === 'pending') {
    return (
      <div className="vx" {...shellProps} style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <Cloud look={{ hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } }} expr="idle" size={150} label="Vox" />
        <h1 className="vx-title">Almost there</h1>
        <p className="vx-2" style={{ margin: 0, maxWidth: 300 }}>
          An admin needs to approve your access to {me.org}.
        </p>
        <div style={{ width: '100%', maxWidth: 360, marginTop: 4 }}><UserInfo member={me.member} locale={locale} /></div>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => void loadMe()}>Check again</button>
      </div>
    );
  }

  const route = top(stack);
  const key = routeKey(route, stack.length);
  const ctx: NavCtx = { ...navCtx.current, rtl: dir === 'rtl', reduced: tier === 'reduced' };
  const layer = stack.length === 1 ? 'root' : COVER_ROUTES.has(route.name) ? 'cover' : 'page';

  return (
    <MotionConfig reducedMotion={tier === 'reduced' ? 'always' : 'user'}>
      <TierProvider value={tier}>
        {/* No app-wide LayoutGroup: layoutId pairs globally anyway, and a root group makes every exit
            re-render every motion node and re-measure every layout node (framer forceRender) */}
        <NavContext.Provider value={nav}>
         <UiLocaleProvider value={locale}>
          {/* Inside .vx so the confirm sheet gets the tokens and sits in the app frame */}
          <div ref={rootRef} className="vx" {...shellProps}>
            <ConfirmProvider>
              <div ref={stageRef} className="vx-stage">
                {/* `custom` is the navigation in flight; a leaving Page freezes its exit from it once (useFrozenExit) */}
                <AnimatePresence initial={false} custom={ctx}>
                  <Page key={key} ctx={ctx} layer={layer} saved={scrollMemory.get(key)} onSettled={settled}>
                    {route.name === 'home' && <HomeScreen />}
                    {route.name === 'groups' && <GroupsScreen />}
                    {route.name === 'org' && <OrgScreen />}
                    {route.name === 'privacy' && <PrivacyScreen onCorrectionPendingChange={correctionPendingChange} />}
                    {route.name === 'connections' && <ConnectionsScreen onBack={nav.back} agentId={route.agentId} />}
                    {route.name === 'shared-memories' && <SharedMemoriesScreen selfId={me.member.telegramId} onBack={nav.back} />}
                    {route.name === 'experience' && <ExperienceScreen onBack={nav.back} role={me.member.role} notificationId={route.notificationId} />}
                    {route.name === 'agent' && <AgentScreen id={route.id} from={stack[stack.length - 2]?.name} />}
                    {route.name === 'spawn' && <SpawnScreen draftId={route.draftId} successorOf={route.successorOf} refine={route.refine} />}
                    {route.name === 'call' && <CallScreen id={route.id} />}
                    {route.name === 'conversation' && <ConversationScreen id={route.id} />}
                    {route.name === 'memories' && <MemoriesScreen id={route.id} />}
                    {route.name === 'fire' && <FireScreen id={route.id} />}
                    {route.name === 'add-groups' && <AddToGroupsScreen id={route.id} />}
                    {route.name === 'channels' && <ChannelsScreen id={route.id} />}
                    {route.name === 'settings' && <SettingsRouter page={route.page} params={route.params} />}
                  </Page>
                </AnimatePresence>

                <AnimatePresence initial={false} custom={ctx}>
                  {isTabRoot(stack) && (
                    <TabBar key="tabbar" tabs={TABS[locale]} label={TABS_LABEL[locale]} current={route.name} disabled={correctionPending} ctx={ctx}
                      onSelect={(r) => { haptic.select(); reset({ name: r } as Route); }} />
                  )}
                </AnimatePresence>
              </div>

              <motion.div className="vx-snack-lift" data-anchored={snackLift !== null || undefined}
                initial={false} animate={{ y: -(snackLift ?? 0) }} transition={SPRING.page}>
                <Snackbar snack={snack} onDismiss={dismissSnack} />
              </motion.div>
            </ConfirmProvider>
          </div>
         </UiLocaleProvider>
        </NavContext.Provider>
      </TierProvider>
    </MotionConfig>
  );
}

/**
 * One screen in the stack. Direction-aware variants come from `ctx`; while it leaves it is inert
 * (taps fall through to the screen arriving underneath) and hidden from assistive tech.
 *
 * It leaves the way the navigation that removed it says, fixed when it starts (useFrozenExit). Should an exit
 * still not have finished EXIT_DEADLINE_MS later, the screen is hidden (`data-stuck`) and released then and
 * there (useExitWatch): it goes alone, and every other screen keeps its own exit. The check waits two frames
 * so an exit a long task held up can finish first, and runs again when Telegram or the tab brings the app
 * back, since a background webview throttles timers and pauses the exit itself.
 */
const Page = forwardRef<HTMLDivElement, { ctx: NavCtx; layer: 'root' | 'page' | 'cover'; saved?: number[]; onSettled(): void; children: ReactNode }>(
  function Page({ ctx, layer, saved, onSettled, children }, ref) {
    const present = useIsPresent();
    const exit = useFrozenExit(screenVariants, ctx);
    const { context: presence, hung, release } = useExitWatch();
    // Framer 12.43 remembers presence.initial=false on the visual element and
    // suppresses its enter after a completed exit is reused. Keep first paint
    // still with the node's own initial=false instead; descendants retain the
    // original context so their initial animations and exit tracking are unchanged.
    const pagePresence = useMemo(() => presence?.initial === false ? { ...presence, initial: undefined } : presence, [presence]);
    const el = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => el.current as HTMLDivElement);
    // The screen hosts its own sheets (ui.Sheet portals here), so nested sheets cover the screen.
    const [host, setHost] = useState<HTMLElement | null>(null);
    const attach = useCallback((node: HTMLDivElement | null) => { el.current = node; setHost(node); }, []);
    // Restore once, on mount; screens that refetch get the offset as their content arrives.
    const initial = useRef(saved);
    // How this screen arrived (hero: its content stages in around the landing face; motion.css), cleared once settled
    const arrive = useRef(ctx.kind === 'hero' && !ctx.reduced ? 'hero' : undefined);
    // A hero's own enter is instant (the face flies, the content stages in through CSS): it settles when that
    // arrival ends (vxArriveDone), and input stays locked until then or LOCK_MS.hero, never from the first frame.
    const heroArrival = arrive.current === 'hero';
    const live = useRef({ present, onSettled });
    live.current = { present, onSettled };
    const arrived = useCallback(() => {
      if (!el.current?.hasAttribute('data-arrive')) return;
      el.current.removeAttribute('data-arrive');
      if (live.current.present) live.current.onSettled();
    }, []);
    // If the CSS arrival never runs (e.g. the OS asks for less motion but the tier was overridden), settle at its nominal end.
    useEffect(() => {
      if (!heroArrival) return;
      const t = setTimeout(arrived, HERO_ARRIVE_MS + 120);
      return () => clearTimeout(t);
    }, [heroArrival, arrived]);
    useLayoutEffect(() => (el.current && initial.current?.length ? restoreScroll(el.current, initial.current) : undefined), []);
    // Safety net: a leaving screen whose exit is still unfinished at the deadline is hidden and released (never
    // while the app is in the background, where its exit is only paused; each check first gives it two frames)
    useEffect(() => {
      // Released but still kept for another screen's exit, then brought back by a Back: show it again
      if (present) { el.current?.removeAttribute('data-stuck'); return; }
      const since = performance.now();
      let frame = 0;
      const check = () => {
        const node = el.current;
        if (!node?.isConnected || !pageActive() || performance.now() - since < EXIT_DEADLINE_MS || !hung()) return;
        node.setAttribute('data-stuck', '');
        if (!warnedStuck && process.env.NODE_ENV !== 'production') console.warn('[studio] a leaving screen never finished its exit; released at its deadline');
        warnedStuck = true;
        release();
      };
      const soon = () => {
        cancelAnimationFrame(frame);
        if (pageActive()) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(check); });
      };
      const timer = setTimeout(soon, EXIT_DEADLINE_MS);
      const off = subscribeActivity(soon);
      return () => { clearTimeout(timer); cancelAnimationFrame(frame); off(); };
    }, [present, hung, release]);
    return (
      <PresenceContext.Provider value={pagePresence}>
        <motion.div ref={attach} className="vx-screen" data-layer={layer} tabIndex={-1} custom={ctx} variants={screenVariants}
          data-arrive={arrive.current} initial={presence?.initial === false ? false : 'initial'} animate="enter" exit={exit} inert={!present} aria-hidden={present ? undefined : true}
          onAnimationComplete={(def) => { if (def === 'enter' && present && !heroArrival) onSettled(); }}
          onAnimationEnd={(e) => { if (e.target === el.current && e.animationName === 'vxArriveDone') arrived(); }}>
          <PresenceContext.Provider value={presence}>
            <SheetHostContext.Provider value={host}>{children}</SheetHostContext.Provider>
          </PresenceContext.Provider>
        </motion.div>
      </PresenceContext.Provider>
    );
  },
);

export function LoadingFill() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}><Spinner size={24} /></div>;
}
