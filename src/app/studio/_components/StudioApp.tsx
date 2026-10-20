'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, haptic, initTelegram, tg, type Me } from '../_lib/client';
import { Cloud } from './Cloud';
import { Icon, Spinner } from './ui';
import { UserInfo } from './UserInfo';
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

export type Route =
  | { name: 'home' }
  | { name: 'groups' }
  | { name: 'org' }
  | { name: 'privacy' }
  | { name: 'shared-memories' }
  | { name: 'experience'; notificationId?: string }
  | { name: 'connections'; agentId?: string }
  | { name: 'agent'; id: string }
  | { name: 'spawn'; draftId?: string; successorOf?: string }
  | { name: 'call'; id: string }
  | { name: 'conversation'; id: string }
  | { name: 'memories'; id: string }
  | { name: 'fire'; id: string };

interface Nav {
  push(r: Route): void;
  /** Back as the person means it: an active back guard takes it first, otherwise one screen is popped. */
  back(): void;
  /** Replace the whole stack (first route is the tab underneath). */
  reset(...routes: Route[]): void;
  toast(message: string, tone?: 'info' | 'error'): void;
  me: Me;
  refreshMe(): Promise<void>;
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

const TABS: Array<{ route: Route['name']; label: string; icon: string }> = [
  { route: 'home', label: 'Agents', icon: 'cloud' },
  { route: 'groups', label: 'Groups', icon: 'groups' },
  { route: 'org', label: 'Org', icon: 'shield' },
  { route: 'privacy', label: 'Privacy', icon: 'lock' },
];

export function StudioApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notificationOpened = useRef(false);
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

  useEffect(() => {
    if (!me || me.member.role === 'pending' || notificationOpened.current) return;
    notificationOpened.current = true;
    const url = new URL(window.location.href);
    const notificationId = url.searchParams.get('notification');
    if (notificationId && /^[A-Za-z0-9_-]{1,128}$/.test(notificationId)) {
      // An opaque link chooses a screen only. The inbox reloads current account,
      // space, consent and agent authority before showing any notification.
      setStack([{ name: 'home' }, { name: 'experience', notificationId }]);
    }
    if (notificationId !== null) {
      url.searchParams.delete('notification');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [me]);

  // Back guards (an open sheet): while one is registered, Back closes it instead of leaving the screen.
  const backGuards = useRef<Array<{ onBack: () => void }>>([]);
  const stackDepth = useRef(1);
  const syncBackButton = useCallback(() => {
    const button = tg()?.BackButton;
    if (!button) return;
    if (stackDepth.current > 1 || backGuards.current.length) button.show(); else button.hide();
  }, []);
  const consumeBack = useCallback(() => {
    const guard = backGuards.current[backGuards.current.length - 1];
    guard?.onBack();
    return !!guard;
  }, []);
  const goBack = useCallback(() => {
    if (consumeBack() || correctionOwner.current) return;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, [consumeBack]);
  const guardBack = useCallback((onBack: () => void) => {
    const guard = { onBack };
    backGuards.current = [...backGuards.current, guard];
    syncBackButton();
    return () => {
      backGuards.current = backGuards.current.filter((g) => g !== guard);
      syncBackButton();
    };
  }, [syncBackButton]);

  const nav: Nav | null = me && {
    me,
    refreshMe: loadMe,
    push: (r) => { if (correctionOwner.current) return; haptic.tap(); setStack((s) => [...s, r]); },
    back: goBack,
    reset: (...routes) => { if (!correctionOwner.current) setStack(routes.length ? routes : [{ name: 'home' }]); },
    toast: (message, tone = 'info') => {
      if (tone === 'error') haptic.error();
      setToast({ message, tone });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3200);
    },
    guardBack,
    consumeBack,
  };

  // Telegram's native back button mirrors the in-app stack (and any open guard).
  useEffect(() => {
    stackDepth.current = stack.length;
    const back = tg()?.BackButton;
    if (!back) return;
    syncBackButton();
    back.onClick(goBack);
    return () => back.offClick(goBack);
  }, [stack.length, goBack, syncBackButton]);

  if (error) {
    return (
      <div className="vx" style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 14 }}>
        <Cloud look={{ hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } }} expr="sleeping" size={140} label="Vox" />
        <div className="vx-title-m">Can&apos;t reach Vox Studio</div>
        <p className="vx-2" style={{ margin: 0 }}>{error}</p>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => void loadMe()}>Try again</button>
        <div style={{ width: '100%', maxWidth: 360, marginTop: 8 }}><UserInfo /></div>
      </div>
    );
  }
  if (!me || !nav) {
    return (
      <div className="vx" style={{ alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
        <Cloud look={{ hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } }} expr="thinking" size={120} label="Vox" />
        <div style={{ width: '100%', maxWidth: 360 }}><UserInfo /></div>
      </div>
    );
  }
  if (me.member.role === 'pending') {
    return (
      <div className="vx" style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <Cloud look={{ hue: 'butter', family: 'drift', features: { cheeks: true, lashes: false, brows: false } }} expr="idle" size={150} label="Vox" />
        <h1 className="vx-title">Almost there</h1>
        <p className="vx-2" style={{ margin: 0, maxWidth: 300 }}>
          An admin needs to approve your access to {me.org}.
        </p>
        <div style={{ width: '100%', maxWidth: 360, marginTop: 4 }}><UserInfo member={me.member} /></div>
        <button className="vx-btn vx-btn-secondary vx-btn-sm" onClick={() => void loadMe()}>Check again</button>
      </div>
    );
  }

  const route = stack[stack.length - 1];
  const isTab = stack.length === 1;
  const key = `${stack.length}-${route.name}-${'id' in route ? route.id : ''}`;

  return (
    <NavContext.Provider value={nav}>
      <div className="vx">
        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={key} initial={{ opacity: 0, x: isTab ? 0 : 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
              {route.name === 'home' && <HomeScreen />}
              {route.name === 'groups' && <GroupsScreen />}
              {route.name === 'org' && <OrgScreen />}
              {route.name === 'privacy' && <PrivacyScreen onCorrectionPendingChange={correctionPendingChange} onShared={() => nav.push({ name: 'shared-memories' })} onExperience={() => nav.push({ name: 'experience' })} onConnections={() => nav.push({ name: 'connections' })} />}
              {route.name === 'connections' && <ConnectionsScreen onBack={nav.back} agentId={route.agentId} />}
              {route.name === 'shared-memories' && <SharedMemoriesScreen selfId={me.member.telegramId} onBack={nav.back} />}
              {route.name === 'experience' && <ExperienceScreen onBack={nav.back} role={me.member.role} notificationId={route.notificationId} />}
              {route.name === 'agent' && <AgentScreen id={route.id} />}
              {route.name === 'spawn' && <SpawnScreen draftId={route.draftId} successorOf={route.successorOf} />}
              {route.name === 'call' && <CallScreen id={route.id} />}
              {route.name === 'conversation' && <ConversationScreen id={route.id} />}
              {route.name === 'memories' && <MemoriesScreen id={route.id} />}
              {route.name === 'fire' && <FireScreen id={route.id} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {isTab && (
          <nav className="vx-tabbar" aria-label="Main" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {TABS.map((t) => {
              const active = route.name === t.route;
              return (
                <button key={t.route} className="vx-tab" disabled={correctionPending} aria-current={active ? 'page' : undefined}
                  onClick={() => { haptic.select(); nav.reset({ name: t.route } as Route); }}>
                  <span className="vx-tab-pill">
                    {active && <motion.span layoutId="tabpill" transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                      style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#282D35' }} />}
                    <span style={{ position: 'relative', display: 'flex' }}><Icon name={t.icon} /></span>
                  </span>
                  <span className="vx-tab-label">{t.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        <AnimatePresence>
          {toast && (
            <motion.div className="vx-toast" role="status" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              style={{ borderColor: toast.tone === 'error' ? 'rgba(255,107,94,.4)' : undefined }}>
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </NavContext.Provider>
  );
}

export function LoadingFill() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A9ADB5' }}><Spinner size={24} /></div>;
}
