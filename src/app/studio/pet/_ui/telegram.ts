'use client';

/**
 * The pet page's Telegram bridge (brief §3.5). Its own small surface, not the Studio's client.ts, so
 * the route never pulls the Studio API client. Every Mini App method is optional and wrapped: an old
 * client, the web client or a plain browser just skips what it cannot do.
 */

type Insets = { top: number; bottom: number; left: number; right: number };
type Handler = (payload?: unknown) => void;

export interface PetTelegram {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name: string; language_code?: string; allows_write_to_pm?: boolean }; start_param?: string };
  platform?: string;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  isFullscreen?: boolean;
  exitFullscreen?(): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  lockOrientation?(): void;
  unlockOrientation?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  hideKeyboard?(): void;
  /** Bot API 6.9: lets the bot message the person (the quiet 📌 copies of group saves) */
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  openTelegramLink?(url: string): void;
  onEvent?(event: string, cb: Handler): void;
  offEvent?(event: string, cb: Handler): void;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  viewportStableHeight?: number;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  /** the "Settings" item in the Mini App's ⋯ menu (Bot API 7.0) */
  SettingsButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  close?(): void;
  Accelerometer?: { start(params: { refresh_rate?: number }, cb?: (ok: boolean) => void): void; stop(cb?: (ok: boolean) => void): void; x: number; y: number; z: number };
  DeviceStorage?: {
    getItem(key: string, cb: (err: string | null, value?: string | null) => void): void;
    removeItem?(key: string, cb?: (err: string | null, ok?: boolean) => void): void;
    setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
  };
}

export function tg(): PetTelegram | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Telegram?: { WebApp?: PetTelegram } }).Telegram?.WebApp ?? null;
}

/** telegram-web-app.js throws WebAppMethodUnsupported on older clients for some methods; none of them matter enough to fail boot. */
const safely = (run: () => void) => { try { run(); } catch { /* unsupported on this client */ } };

/** The signed-in user's first name for "Hi {name}!" (display only, never identity). */
export const firstName = (): string | undefined => tg()?.initDataUnsafe?.user?.first_name || undefined;
/** `start_param` from the bot's inline button: an intent, never identity (§3.5). */
export function startIntent(): 'feed' | 'talk' | 'play' | null {
  const p = tg()?.initDataUnsafe?.start_param;
  return p === 'feed' || p === 'talk' || p === 'play' ? p : null;
}

/**
 * The group a pet opened over names (Circles S4): a launch code (`startapp=p_…`) or the DM button's `?j=`. Unverified
 * intent, sent as is; the server maps it and checks membership.
 */
export function circleCode(): string | null {
  const p = tg()?.initDataUnsafe?.start_param;
  if (p && /^p_[\w-]{14,62}$/.test(p)) return p;
  let j: string | null = null;
  try { j = new URLSearchParams(location.search).get('j'); } catch { /* no location */ }
  return j && /^[\w-]{16,53}$/.test(j) ? j : null;
}

const portrait = () => typeof window === 'undefined' || window.innerHeight >= window.innerWidth;

/**
 * Keep Telegram's normal window and dismissal gestures. Restore controls a previous surface may
 * have disabled; never expand or enter fullscreen automatically. `ready()` is NOT called here:
 * the page calls readyAfterPaint() once the
 * character is on screen, so Telegram's loading screen hands straight over to the character. The
 * safe-area vars are the page's layout effect's (syncSafeAreas, subscribed before it measures).
 */
export function bootTelegram(color: string, app: PetTelegram | null = tg()): void {
  if (!app) return;
  if (app.isFullscreen) safely(() => app.exitFullscreen?.());
  safely(() => app.enableVerticalSwipes?.());
  safely(() => app.unlockOrientation?.());
  paintChrome(color, app);
}

/** The Telegram events that move the safe areas or the viewport (the page measures again on each). */
export const LAYOUT_EVENTS = ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged', 'fullscreenChanged'] as const;

/** Header, background and bottom bar in the backdrop's edge colour (also on a stage-up hue change). */
export function paintChrome(color: string, app: PetTelegram | null = tg()) {
  if (!app) return;
  safely(() => app.setHeaderColor?.(color));
  safely(() => app.setBackgroundColor?.(color));
  safely(() => app.setBottomBarColor?.(color));
}

/** After the browser has painted the character (rAF → task), then `ready()`. */
export function readyAfterPaint(app: PetTelegram | null = tg(), then?: () => void): () => void {
  let cancelled = false;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
  raf(() => setTimeout(() => {
    if (cancelled) return;
    if (app) safely(() => app.ready());
    then?.();
  }, 0));
  return () => { cancelled = true; };
}

/**
 * Safe areas as CSS vars on <html>: `--pet-safe-top` (device + Telegram's floating close/… row),
 * `--pet-safe-bottom` and `--pet-vh` (viewportStableHeight). telegram-web-app.js sets its own
 * `--tg-*` vars too; these are ours so pet.css has one source with env() fallbacks.
 */
export function syncSafeAreas(app: PetTelegram | null = tg()): () => void {
  if (!app || typeof document === 'undefined') return () => {};
  const write = () => {
    const s = document.documentElement.style;
    const top = (app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0);
    if (app.safeAreaInset || app.contentSafeAreaInset) s.setProperty('--pet-safe-top', `${top}px`);
    if (app.safeAreaInset) s.setProperty('--pet-safe-bottom', `${app.safeAreaInset.bottom + (app.contentSafeAreaInset?.bottom ?? 0)}px`);
    if (app.viewportStableHeight) s.setProperty('--pet-vh', `${app.viewportStableHeight}px`);
  };
  write();
  for (const e of LAYOUT_EVENTS) safely(() => app.onEvent?.(e, write));
  return () => { for (const e of LAYOUT_EVENTS) safely(() => app.offEvent?.(e, write)); };
}

/**
 * Closing confirmation only while recording or awaiting a reply (§1.6). Ref-counted: each hold returns
 * its release, and the last release turns the confirmation off.
 */
let holds = 0;
export function holdClosing(app: PetTelegram | null = tg()): () => void {
  if (holds++ === 0) safely(() => app?.enableClosingConfirmation?.());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) safely(() => app?.disableClosingConfirmation?.());
  };
}

export const hideKeyboard = (app: PetTelegram | null = tg()) => safely(() => app?.hideKeyboard?.());

/** Guests talk in the DM: open the agent's bot chat (outside Telegram, a new tab). */
export function openDm(botUsername: string, app: PetTelegram | null = tg()) {
  const url = `https://t.me/${botUsername}`;
  if (app?.initData && app.openTelegramLink) safely(() => app.openTelegramLink!(url));
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

/** Telegram's BackButton while the "more" bubble is expanded (§3.5). Returns the cleanup. */
export function backButton(onBack: () => void, app: PetTelegram | null = tg()): () => void {
  const b = app?.BackButton;
  if (!b) return () => {};
  safely(() => { b.onClick(onBack); b.show(); });
  return () => safely(() => { b.offClick(onBack); b.hide(); });
}

/** Telegram's ⋯ menu "Settings" item (the page's only settings: forget my pet). Returns the cleanup. */
export function settingsButton(onClick: () => void, app: PetTelegram | null = tg()): () => void {
  const b = app?.SettingsButton;
  if (!b) return () => {};
  safely(() => { b.onClick(onClick); b.show(); });
  return () => safely(() => { b.offClick(onClick); b.hide(); });
}

/** Telegram's native confirm (a plain browser's window.confirm); false when neither exists. */
export function confirmNative(message: string, app: PetTelegram | null = tg()): Promise<boolean> {
  return new Promise((resolve) => {
    if (app?.showConfirm) { try { app.showConfirm(message, (ok) => resolve(!!ok)); return; } catch { /* unsupported on this client */ } }
    try { resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false); } catch { resolve(false); }
  });
}

export const closeApp = (app: PetTelegram | null = tg()) => safely(() => app?.close?.());

/** Pause/resume on Telegram `deactivated`/`activated` (the loop itself also reads pageActive()). */
export function onActivity(cb: (active: boolean) => void, app: PetTelegram | null = tg()): () => void {
  if (!app?.onEvent) return () => {};
  const on = () => cb(true), off = () => cb(false);
  safely(() => { app.onEvent!('activated', on); app.onEvent!('deactivated', off); });
  return () => safely(() => { app.offEvent?.('activated', on); app.offEvent?.('deactivated', off); });
}

/**
 * The shake sensor (§3.5): started after the first touch at refresh 50 ms; `accelerometerFailed`
 * (no sensor, desktop) just turns the feature off. Returns stop.
 */
export function startAccelerometer(onSample: (a: { x: number; y: number; z: number }) => void, refreshMs = 50, app: PetTelegram | null = tg()): () => void {
  const acc = app?.Accelerometer;
  if (!acc || !app?.onEvent) return () => {};
  let live = true;
  const changed = () => { if (live) onSample({ x: acc.x, y: acc.y, z: acc.z }); };
  const failed = () => stop();
  function stop() {
    if (!live) return;
    live = false;
    safely(() => { app!.offEvent?.('accelerometerChanged', changed); app!.offEvent?.('accelerometerFailed', failed); acc!.stop(); });
  }
  safely(() => {
    app.onEvent!('accelerometerChanged', changed);
    app.onEvent!('accelerometerFailed', failed);
    acc.start({ refresh_rate: refreshMs }, (ok) => { if (!ok) stop(); });
  });
  return stop;
}

/* ---------- DeviceStorage (Bot API 9.0), localStorage fallback ---------- */

/** Reads a value: localStorage synchronously first (instant paint), else DeviceStorage within `timeoutMs`. */
export function readStored(key: string, timeoutMs = 160, app: PetTelegram | null = tg()): Promise<string | null> {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (v) return Promise.resolve(v);
  } catch { /* private mode */ }
  const ds = app?.DeviceStorage;
  if (!ds) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    safely(() => ds.getItem(key, (err, value) => { clearTimeout(t); resolve(err ? null : value ?? null); }));
  });
}

export function readStoredSync(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}

export function writeStored(key: string, value: string, app: PetTelegram | null = tg()) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
  safely(() => app?.DeviceStorage?.setItem(key, value));
}

/** Migration only: erase legacy private snapshots, without ever reading their values into the UI.
 * DeviceStorage has no key enumeration here; clear the current agent and keys discovered locally.
 */
export function clearLegacyPetSnapshots(agentId: string, app: PetTelegram | null = tg()) {
  const keys = new Set([`vox-pet:${agentId}`]);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('vox-pet:')) keys.add(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
  for (const key of keys) safely(() => {
    const ds = app?.DeviceStorage;
    if (ds?.removeItem) ds.removeItem(key);
    else ds?.setItem(key, '');
  });
}
