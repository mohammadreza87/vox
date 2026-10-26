import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { motion, MotionGlobalConfig, PresenceContext, type TargetAndTransition } from 'framer-motion';
import { useContext, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic } from '../../_lib/client';
import type { NavCtx } from '../../_lib/motion';
import { StudioApp, useNav } from '../StudioApp';

/*
 * Stuck screens (release 7371086): a second navigation of another kind landing while a screen was still
 * leaving re-targeted its exit, framer never finished it, and every later leaving screen piled up behind it,
 * half transparent, over the current one. These drive the real shell with real springs on a controlled clock
 * and check that, whatever the timing, exactly one screen is left at rest.
 */
const mocks = vi.hoisted(() => ({
  me: vi.fn(), backs: new Set<() => void>(), settings: new Set<() => void>(),
  events: new Map<string, Set<() => void>>(), active: true,
  /** Simulates any lost exit completion: every screen exit runs for 1000 s */
  hang: false,
  reentryProbe: false,
}));
vi.mock('../../_lib/client', () => ({
  api: { me: mocks.me }, ApiError: class extends Error {}, initTelegram: vi.fn(),
  haptic: { tap: vi.fn(), select: vi.fn(), error: vi.fn(), light: vi.fn() },
  tg: () => ({
    initDataUnsafe: { user: { language_code: 'en' } },
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: (fn: () => void) => mocks.backs.add(fn), offClick: (fn: () => void) => mocks.backs.delete(fn) },
    SettingsButton: { show: vi.fn(), hide: vi.fn(), onClick: (fn: () => void) => mocks.settings.add(fn), offClick: (fn: () => void) => mocks.settings.delete(fn) },
  }),
}));
vi.mock('../../_lib/motion', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../_lib/motion')>();
  const exit = m.screenVariants.exit as (c: NavCtx) => TargetAndTransition;
  return { ...m, screenVariants: { ...m.screenVariants, exit: (c: NavCtx) => (mocks.hang ? { opacity: 0.4, transition: { duration: 1000 } } : exit(c)) } };
});
vi.mock('../Cloud', () => ({ Cloud: () => null }));
vi.mock('../UserInfo', () => ({ UserInfo: () => null }));
vi.mock('../screens/Home', () => ({ HomeScreen: function Home() {
  const nav = useNav();
  return (
    <>
      <h1>Home probe</h1>
      {mocks.reentryProbe && <ReentryProbe />}
      <span data-hero="face-h" />
      <button onClick={() => nav.push({ name: 'agent', id: 'a' })}>Open agent</button>
      <button onClick={() => { nav.cache.set('h', { id: 'h' } as never); nav.push({ name: 'agent', id: 'h' }); }}>Fly agent</button>
      <button onClick={() => nav.push({ name: 'spawn' })}>Hire</button>
      <button onClick={() => nav.reset({ name: 'privacy' })}>Profile</button>
    </>
  );
} }));

/** A descendant with its own initial animation and state that must survive a retained exit. */
function ReentryProbe() {
  const presence = useContext(PresenceContext);
  const [value, setValue] = useState('');
  return <>
    <motion.span data-testid="child-initial" data-presence-initial={String(presence?.initial)}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
    <input aria-label="Retained draft" value={value} onChange={(e) => setValue(e.target.value)} />
  </>;
}
vi.mock('../screens/Agent', () => ({ AgentScreen: function Agent({ id }: { id: string }) {
  const nav = useNav();
  return (
    <>
      <h1>Agent {id}</h1>
      <button onClick={() => nav.push({ name: 'conversation', id })}>Chat</button>
      <button onClick={() => nav.push({ name: 'spawn', draftId: id, refine: true })}>Refine</button>
    </>
  );
} }));
vi.mock('../screens/Spawn', () => ({ SpawnScreen: function Spawn() {
  const nav = useNav();
  return <><h1>Spawn probe</h1><button onClick={nav.back}>Close</button></>;
} }));
vi.mock('../screens/Conversation', () => ({ ConversationScreen: () => <h1>Chat probe</h1> }));
vi.mock('../screens/Privacy', () => ({ PrivacyScreen: () => <h1>You probe</h1> }));
vi.mock('../screens/Groups', () => ({ GroupsScreen: () => <h1>Groups probe</h1> }));
vi.mock('../screens/Org', () => ({ OrgScreen: () => <h1>Org probe</h1> }));

/*
 * framer's frame loop runs on jsdom's requestAnimationFrame (a 60 Hz setInterval) and reads performance.now();
 * both follow the fake clock, one 16 ms frame per act. Each test lets the loop go idle before real timers
 * return: a fake interval dropped mid-flight would leave jsdom, and so the next test, without frames.
 */
const realNow = performance.now.bind(performance);
async function wait(ms: number) {
  for (let t = 0; t < ms; t += 16) await act(async () => { vi.advanceTimersByTime(16); });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.backs.clear(); mocks.settings.clear(); mocks.events.clear(); mocks.active = true; mocks.hang = false;
  mocks.reentryProbe = false;
  mocks.me.mockResolvedValue({ member: { role: 'member', telegramId: 1 }, org: 'Synthetic' });
  // Bot API 8.0 activity events, read by motion/activity
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: {
    get isActive() { return mocks.active; },
    onEvent: (e: string, cb: () => void) => { if (!mocks.events.has(e)) mocks.events.set(e, new Set()); mocks.events.get(e)!.add(cb); },
    offEvent: (e: string, cb: () => void) => mocks.events.get(e)?.delete(cb),
  } };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  Object.defineProperty(performance, 'now', { configurable: true, value: () => Date.now() });
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(async () => {
  cleanup();
  await wait(200);
  vi.useRealTimers();
  Object.defineProperty(performance, 'now', { configurable: true, value: realNow });
  MotionGlobalConfig.skipAnimations = true;
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

const screens = () => [...document.body.querySelectorAll<HTMLElement>('.vx-screen')];
const heading = () => screens().map((s) => s.querySelector('h1')?.textContent ?? '?');
const atRest = (el: HTMLElement) => {
  const t = el.style.transform;
  return (t === '' || t === 'none') && (el.style.opacity === '' || el.style.opacity === '1');
};
/** A tap on a button of the screen in front (leaving screens are aria-hidden); nothing when it isn't there. */
async function tap(name: string) {
  const button = screen.queryByRole('button', { name });
  if (button) await act(async () => { fireEvent.click(button); });
}
const telegramBack = () => act(async () => { for (const back of mocks.backs) back(); });
const telegramSettings = () => act(async () => { for (const open of mocks.settings) open(); });
async function boot() {
  render(<StudioApp />);
  await act(async () => { await Promise.resolve(); });
  await wait(32);
  expect(heading()).toEqual(['Home probe']);
}
/** After any sequence: one screen, at rest, not hidden by the safety net, input open. */
async function expectOneScreen(label: string, top?: string) {
  await wait(2000);
  expect(heading(), label).toHaveLength(1);
  if (top) expect(heading(), label).toEqual([top]);
  expect(screens()[0].hasAttribute('data-stuck'), label).toBe(false);
  expect(atRest(screens()[0]), `${label}: ${screens()[0].getAttribute("style")}`).toBe(true);
  expect(document.body.querySelector('.vx-stage[data-busy]'), label).toBeNull();
}

describe('stuck screens: the reported sequences', () => {
  it('profile, then Refine as input unlocks (cover over a page still sliding)', async () => {
    for (const gap of [420, 470, 520]) {
      await boot();
      await tap('Open agent');
      await wait(gap);
      await tap('Refine');
      await expectOneScreen(`Refine @${gap}`);
      cleanup();
    }
  });

  it('profile, then Refine at the first frame it is taken', async () => {
    await boot();
    await tap('Open agent');
    for (let t = 0; t < 1000 && !heading().includes('Spawn probe'); t += 16) { await tap('Refine'); await wait(16); }
    await expectOneScreen('Refine at first chance', 'Spawn probe');
  });

  it('a tab, then an agent 40 ms later, then its chat', async () => {
    await boot();
    await tap('Groups');
    await wait(1500);
    await tap('Agents');
    await wait(40);
    await tap('Open agent');
    await wait(600);
    await tap('Chat');
    await expectOneScreen('tab, agent, chat', 'Chat probe');
  });

  it('two pushes, Back as input unlocks, then a card', async () => {
    await boot();
    await tap('Open agent');
    await wait(1500);
    await tap('Chat');
    await wait(1500);
    await telegramBack();
    await wait(420);
    await tap('Refine');
    await expectOneScreen('push, push, back, cover');
  });

  it('a card closed after 520 ms, then a page', async () => {
    await boot();
    await tap('Hire');
    await wait(1500);
    await tap('Close');
    await wait(520);
    await tap('Open agent');
    await expectOneScreen('cover, uncover, push', 'Agent a');
  });

  it('Telegram’s Settings during a slide waits for it, then opens You', async () => {
    for (const gap of [16, 100, 250, 420]) {
      await boot();
      await tap('Open agent');
      await wait(gap);
      await telegramSettings();
      await expectOneScreen(`Settings @${gap}`, 'You probe');
      cleanup();
    }
  });

  it('Home’s profile button and the tab bar during a slide also wait for it', async () => {
    await boot();
    await tap('Groups');
    await wait(40);
    await tap('You');                     // the bar stays tappable through a tab fade
    await expectOneScreen('tab, tab', 'You probe');
    await tap('Agents');
    await wait(1500);
    await tap('Hire');
    await wait(100);
    await telegramBack();                 // queued until the card lands
    await wait(30);
    await tap('Profile');                 // the leaving Home is inert: nothing happens
    await expectOneScreen('cover, back', 'Home probe');
  });
});

describe('stuck screens: navigation kind x gap', () => {
  /** First moves from Home, each a different kind */
  const FIRST: Record<string, () => Promise<void>> = {
    push: () => tap('Open agent'),
    hero: () => tap('Fly agent'),
    cover: () => tap('Hire'),
    tab: () => tap('Groups'),
    replace: async () => { await tap('Open agent'); await wait(1500); await telegramSettings(); },
  };
  /** Second moves, whatever screen is in front */
  const SECOND: Record<string, () => Promise<void>> = {
    back: telegramBack,
    settings: telegramSettings,
    next: async () => { for (const name of ['Refine', 'Chat', 'Close', 'Open agent', 'Agents']) { if (screen.queryByRole('button', { name })) { await tap(name); return; } } },
  };
  for (const [a, first] of Object.entries(FIRST)) {
    for (const [b, second] of Object.entries(SECOND)) {
      it(`${a}, then ${b} at 40/250/420/520/650 ms`, async () => {
        for (const gap of [40, 250, 420, 520, 650]) {
          await boot();
          await first();
          await wait(gap);
          await second();
          await wait(gap);
          await SECOND.next();
          await expectOneScreen(`${a} → ${b} @${gap} → next`);
          cleanup();
        }
      });
    }
  }
});

describe('stuck screens: input after a screen lands', () => {
  it('keeps first paint still and restores a completed exiting screen with its descendant state', async () => {
    mocks.reentryProbe = true;
    await boot();
    const home = screens()[0];
    const child = screen.getByTestId('child-initial');
    const draft = screen.getByRole('textbox', { name: 'Retained draft' });
    expect(atRest(home)).toBe(true);
    expect(child).toHaveAttribute('data-presence-initial', 'false');
    expect(child).toHaveStyle({ opacity: '1' });
    fireEvent.change(draft, { target: { value: 'Synthetic unsaved draft' } });

    await tap('Hire');
    await wait(420);
    await telegramSettings();
    await wait(420);
    await tap('Agents');
    await expectOneScreen('completed cover exit returns', 'Home probe');

    expect(screens()[0]).toBe(home);
    expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft);
    expect(draft).toHaveValue('Synthetic unsaved draft');
    expect(screen.getByTestId('child-initial')).toBe(child);
    expect(child).toHaveStyle({ opacity: '1' });
  });

  it('a tap once the new page has landed runs on the tap, while the old page is still parallaxing away under it', async () => {
    await boot();
    await tap('Open agent');
    await wait(432);                                   // past LOCK_MS.push: Agent is at rest, Home's exit has ~80 ms left
    expect(heading()).toEqual(['Home probe', 'Agent a']);
    expect(document.body.querySelector('.vx-stage[data-busy]')).toBeNull();
    await tap('Chat');
    expect(haptic.tap).toHaveBeenCalledTimes(2);       // felt on the tap…
    await wait(16);
    expect(heading()).toContain('Chat probe');         // …and seen on the next frame, not after Home's hidden exit
    await expectOneScreen('push, push on landing', 'Chat probe');
  });

  it('a second tab 40 ms after the first moves the content with the haptic', async () => {
    await boot();
    await tap('Groups');
    await wait(40);
    await tap('You');
    expect(haptic.select).toHaveBeenCalledTimes(2);
    await wait(16);
    expect(heading()).toContain('You probe');
    expect(screen.getByRole('button', { name: 'You' })).toHaveAttribute('aria-current', 'page');
    await expectOneScreen('tab, tab', 'You probe');
  });
});

describe('stuck screens: safety net', () => {
  it('drops a leaving screen that misses its deadline then and there; the next navigation plays in full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await boot();
    mocks.hang = true;
    await tap('Open agent');
    const home = screens().find((s) => s.querySelector('h1')?.textContent === 'Home probe')!;
    await wait(1100);
    expect(home.isConnected).toBe(true);
    expect(home.hasAttribute('data-stuck')).toBe(false);
    await wait(200);
    expect(home).toHaveAttribute('data-stuck');
    expect(home.isConnected).toBe(false);               // removed alone, at its deadline
    expect(heading()).toEqual(['Agent a']);
    expect(atRest(screens()[0])).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    mocks.hang = false;
    await tap('Chat');
    await wait(48);
    // The page at rest keeps its own exit (no remount, no hard cut) while the new one slides in over it
    const [agent, chat] = screens();
    expect(heading()).toEqual(['Agent a', 'Chat probe']);
    expect(agent.style.transform).toMatch(/translateX\(-/);
    expect(chat.style.transform).toMatch(/translateX\((?!0)/);
    await expectOneScreen('after the deadline', 'Chat probe');
    warn.mockRestore();
  });

  it('a long main-thread task over a healthy exit leaves nothing behind for the next navigation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await boot();
    await tap('Open agent');
    await wait(100);
    await act(async () => { vi.advanceTimersByTime(1200); });   // one long task: the deadline timer comes due mid-exit
    await wait(2000);
    expect(heading()).toEqual(['Agent a']);
    await tap('Chat');
    await wait(16);
    expect(heading()).toEqual(['Agent a', 'Chat probe']);       // Agent still slides out: no hard cut
    expect(atRest(screens()[0])).toBe(false);
    await expectOneScreen('after a long task', 'Chat probe');
    vi.mocked(console.warn).mockRestore();
  });

  for (const [what, leave, come] of [
    ['Telegram’s activated event', () => { mocks.active = false; for (const cb of mocks.events.get('deactivated') ?? []) cb(); },
      () => { mocks.active = true; for (const cb of mocks.events.get('activated') ?? []) cb(); }],
    ['visibilitychange', () => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); },
      () => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }],
  ] as const) {
    it(`runs the check again on ${what}, never while the app is in the background`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await boot();
      mocks.hang = true;
      await tap('Open agent');
      await wait(100);
      await act(async () => { leave(); });
      await wait(1500);                         // past the deadline, but in the background: the exit is only paused
      expect(screens().some((s) => s.hasAttribute('data-stuck'))).toBe(false);
      const home = screens().find((s) => s.querySelector('h1')?.textContent === 'Home probe')!;
      await act(async () => { come(); });
      await wait(48);                           // two frames for the exit to finish first
      expect(home).toHaveAttribute('data-stuck');
      expect(home.isConnected).toBe(false);
      mocks.hang = false;
      await tap('Chat');
      await expectOneScreen(`healed after ${what}`, 'Chat probe');
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      vi.mocked(console.warn).mockRestore();
    });
  }

  it('a normal exit never trips it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await boot();
    await tap('Hire');
    await wait(3000);
    expect(document.body.querySelector('[data-stuck]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
