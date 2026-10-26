import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineCue, PetEngine, PetEngineOptions } from './contract';
import { BUBBLE_LINES, layoutOf, type HeightClass } from './layout';
import { createMockApi } from './mock';
import { ROOM_IDS } from './rooms';

/*
 * The no-scroll layout (design §9) at the five classes, the room rail and the Persian page. jsdom does no layout, so
 * these tests pin what the page decides (the class, the tokens pet.css gives that class, the structure, the hidden
 * parts, the bubble's line budget) and that no CSS on the route can scroll. What only a device can confirm: real
 * glyph widths in Onest/Vazirmatn against the page budgets, Telegram's viewportChanged timing as the keyboard opens,
 * iOS visual-viewport behaviour, and that the rail's labels fit at 320 px in Persian.
 */

const engines: { opts: PetEngineOptions; e: PetEngine & Record<string, ReturnType<typeof vi.fn>> }[] = [];
vi.mock('../_engine/loop', () => ({
  createPetEngine: (opts: PetEngineOptions) => {
    const fn = () => vi.fn();
    const e = {
      rig: {}, body: {}, dim: motionValue(0), glow: motionValue(0),
      setLook: fn(), setSize: fn(), setTier: fn(), setMood: fn(), setScene: fn(), setBond: fn(), pointer: vi.fn(() => false), accel: fn(), toy: fn(),
      talk: fn(), micLevel: fn(), speakText: fn(), speakAudio: fn(), stopSpeaking: fn(), fire: fn(), attach: vi.fn(() => () => {}),
      start: fn(), stop: fn(), dispose: fn(), setRoom: fn(),
    };
    engines.push({ opts, e: e as never });
    return e;
  },
}));

const { PetApp } = await import('./PetApp');

const CSS = readFileSync(join(process.cwd(), 'src/app/studio/pet/pet.css'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): Record<string, string> {
  const at = RULES.split('}').find((r) => r.split('{')[0].trim() === sel);
  if (!at) throw new Error(`no rule ${sel}`);
  return Object.fromEntries(at.split('{')[1].split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d[0]).map(([k, ...v]) => [k, v.join(':')]));
}
/** A class's custom property: its own rule, else the root default. */
const token = (h: HeightClass | 'wide', name: string) =>
  (h === 'wide' ? rule('.pet-root[data-layout=wide]') : h === 'regular' ? {} : rule(`.pet-root[data-h=${h}]`))[name] ?? rule('.pet-root')[name];

type Handler = () => void;
function telegram(o: { stable: number; top?: number; bottom?: number; lang?: string }) {
  const handlers = new Map<string, Set<Handler>>();
  const app = {
    initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara', language_code: o.lang } },
    viewportStableHeight: o.stable, viewportHeight: o.stable,
    safeAreaInset: { top: o.top ?? 0, bottom: o.bottom ?? 0, left: 0, right: 0 }, contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    ready: vi.fn(), expand: vi.fn(), close: vi.fn(), enableVerticalSwipes: vi.fn(), unlockOrientation: vi.fn(), setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), hideKeyboard: vi.fn(), enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(),
    onEvent: vi.fn((e: string, cb: Handler) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(cb); }),
    offEvent: vi.fn((e: string, cb: Handler) => { handlers.get(e)?.delete(cb); }),
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  const emit = (e: string) => act(() => { for (const cb of [...(handlers.get(e) ?? [])]) cb(); });
  return { app, emit };
}

function screenOf(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

/** jsdom has no layout: the bottom stack reports where it would sit (its top), so the character box is realistic. */
function bottomStackAt(top: () => number) {
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('pet-bottom')) return { top: top(), left: 0, width: window.innerWidth, height: 200, right: window.innerWidth, bottom: top() + 200, x: 0, y: top(), toJSON() {} } as DOMRect;
    return real.call(this);
  });
}

const root = (c: HTMLElement) => c.querySelector('main.pet-root') as HTMLElement;
const api = () => createMockApi({ latency: { care: 0, talk: 0 } });
async function open(c: HTMLElement) {
  await waitFor(() => expect(c.querySelector('.pet-rail')).toBeTruthy());
  await waitFor(() => expect(engines.at(-1)!.e.fire).toHaveBeenCalled());
}

describe('the no-scroll layout at the five classes (design §9)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x');
  });
  afterEach(() => {
    delete (window as { Telegram?: unknown }).Telegram;
    for (const v of ['--pet-vh', '--pet-safe-top', '--pet-safe-bottom']) document.documentElement.style.removeProperty(v);
    localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks();
  });

  const SIZES: { name: HeightClass | 'wide'; w: number; stable: number; top: number; bottom: number; h: HeightClass }[] = [
    { name: 'peek', w: 390, stable: 430, top: 0, bottom: 0, h: 'peek' }, // a half-height Telegram sheet
    { name: 'short', w: 360, stable: 640, top: 24, bottom: 0, h: 'short' }, // 360 × 640 phone
    { name: 'regular', w: 390, stable: 760, top: 47, bottom: 34, h: 'regular' }, // 390 × 844 under Telegram's header
    { name: 'tall', w: 430, stable: 932, top: 59, bottom: 34, h: 'tall' }, // 430 × 932 fullscreen
    { name: 'wide', w: 820, stable: 1180, top: 24, bottom: 20, h: 'tall' }, // tablet
  ];

  it.each(SIZES)('$name: the root takes the class, its tokens size the dock and pill, nothing can scroll', async (s) => {
    screenOf(s.w, s.stable);
    telegram({ stable: s.stable, top: s.top, bottom: s.bottom });
    bottomStackAt(() => s.stable - s.bottom - 230);
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    const r = root(container);
    expect(r).toHaveAttribute('data-layout', s.name);
    expect(r).toHaveAttribute('data-h', s.h);
    expect(layoutOf(s.w, s.stable - s.top - s.bottom).cls).toBe(s.name);
    // the class's tokens (design §9.2): toy 56/60/68, pill 48/52, gap; Wide: a 480 px column
    const toy = { peek: '56px', short: '60px', regular: '68px', tall: '68px', wide: '68px' }[s.name];
    expect(token(s.name === 'wide' ? 'regular' : s.h, '--pet-toy')).toBe(toy);
    expect(token(s.h, '--pet-pill')).toBe(s.h === 'short' ? '48px' : '52px');
    if (s.name === 'wide') expect(token('wide', '--pet-col')).toBe('480px');
    // the structure: rail → dock row → pill (Peek: a round talk button in the row instead of the pill)
    const bottom = r.querySelector('.pet-bottom')!;
    expect([...bottom.children].map((e) => e.className)).toEqual(s.h === 'peek' ? ['pet-rail', 'pet-row'] : ['pet-rail', 'pet-row', '']);
    expect(r.querySelectorAll('[data-toy]')).toHaveLength(3);
    expect(!!screen.queryByRole('button', { name: 'Talk' })).toBe(s.h === 'peek');
    expect(!!screen.queryByRole('textbox')).toBe(s.h !== 'peek');
    // nothing inside the root may scroll (no inline overflow; the stylesheet is checked below)
    for (const el of r.querySelectorAll<HTMLElement>('*')) expect(el.style.overflow + el.style.overflowY + el.style.overflowX).not.toMatch(/auto|scroll/);
    // the character fits between the safe top and the bottom stack
    const char = r.querySelector('.pet-char') as HTMLElement;
    expect(parseFloat(char.style.top)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(char.style.top) + parseFloat(char.style.height)).toBeLessThanOrEqual(s.stable - s.bottom - 230 + 1);
    // Wide: the character stands in the centred column
    if (s.name === 'wide') expect(Math.abs(parseFloat(char.style.left) + parseFloat(char.style.width) / 2 - s.w / 2)).toBeLessThanOrEqual(1);
    // the bubble's line budget is the class's, or fewer when the head is near the top, never more
    act(() => { engines.at(-1)!.opts.onCue?.({ type: 'say', line: 'learned' } satisfies EngineCue); });
    const lines = Number((r.querySelector('.pet-bubble') as HTMLElement).style.getPropertyValue('--pet-lines'));
    expect(lines).toBeGreaterThanOrEqual(1);
    expect(lines).toBeLessThanOrEqual(BUBBLE_LINES[s.h]);
    if (s.h === 'tall') expect(lines).toBe(5);
  });

  it('the stylesheet: the root is fixed, viewport-high and clipped; no rule anywhere on the route scrolls', () => {
    const r = rule('.pet-root');
    expect(r.position).toBe('fixed');
    expect(r.height).toBe('var(--pet-vh,100dvh)');
    expect(r.overflow).toBe('hidden');
    expect(CSS).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    const fx = readFileSync(join(process.cwd(), 'src/app/studio/pet/_ui/fx.css'), 'utf8');
    const rooms = readFileSync(join(process.cwd(), 'src/app/studio/pet/_ui/rooms/rooms.css'), 'utf8');
    expect(fx + rooms).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    // the one scrolling box on the pet's pages is a sheet's body, inside a sheet capped at 84% of the root
    const circle = readFileSync(join(process.cwd(), 'src/app/studio/pet/_ui/circle.css'), 'utf8');
    expect(circle.match(/^[^{}]*\{[^}]*overflow(-y)?:\s*auto/gm)?.map((m) => m.split('{')[0].trim())).toEqual(['.pc-scroll']);
    expect(circle).toMatch(/\.pc-sheet \{[^}]*max-height: 84%/);
  });

  it('Persian type is 16/24 and the small size 14 (design §9.5); the bubble and room labels follow the tokens', () => {
    expect(rule('.pet-root[lang=fa]')).toMatchObject({ '--pet-fs': '16px', '--pet-lh': '24px', '--pet-sm': '14px' });
    expect(rule('.pet-root')).toMatchObject({ '--pet-fs': '15px', '--pet-lh': '21px', '--pet-sm': '13px' });
    expect(CSS).toMatch(/\.pet-bubble \{[^}]*font: 500 var\(--pet-fs\)\/var\(--pet-lh\)/);
    // touch targets: rail chips, toys and the close button are at least 44 px
    expect(rule('.pet-room')).toMatchObject({ 'min-width': '44px', height: '44px' });
    expect(rule('.pet-close')['min-height']).toBe('44px');
  });

  it('the keyboard: with the talk field focused and the viewport down, the class drops to Short and the rail and dock hide', async () => {
    screenOf(390, 844);
    const { app, emit } = telegram({ stable: 844 });
    bottomStackAt(() => app.viewportStableHeight - 230);
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    expect(root(container)).toHaveAttribute('data-h', 'tall');
    fireEvent.focus(screen.getByRole('textbox'));
    app.viewportStableHeight = 520; app.viewportHeight = 520;
    emit('viewportChanged');
    await waitFor(() => expect(root(container)).toHaveAttribute('data-kb'));
    expect(root(container)).toHaveAttribute('data-h', 'short');
    expect(CSS).toMatch(/\.pet-root:is\(\[data-kb\], \[data-talkopen\]\) :is\(\.pet-rail, \.pet-row\) \{ display: none; \}/);
    fireEvent.blur(screen.getByRole('textbox'));
    app.viewportStableHeight = 844; app.viewportHeight = 844;
    emit('viewportChanged');
    await waitFor(() => expect(root(container)).not.toHaveAttribute('data-kb'));
    expect(root(container)).toHaveAttribute('data-h', 'tall');
  });

  it('Peek: the round talk button opens the pill (focused) in place of the rail and dock; letting go closes it', async () => {
    screenOf(390, 430);
    telegram({ stable: 430 });
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    fireEvent.click(screen.getByRole('button', { name: 'Talk' }));
    const input = await screen.findByRole('textbox', { name: 'Talk to Mochi' });
    expect(root(container)).toHaveAttribute('data-talkopen');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(root(container)).not.toHaveAttribute('data-talkopen');
  });

  it('Peek, rail: only the current room shows, by name (CSS), and it stays a working tab', () => {
    expect(CSS).toMatch(/\.pet-root\[data-h=peek\] \.pet-room:not\(\[aria-selected=true\]\), \.pet-root\[data-h=peek\] \.pet-room svg \{ display: none; \}/);
    // Short hides every label, Regular all but the current one: visually only, they stay the tabs' names
    expect(CSS).toMatch(/\.pet-sr, \.pet-root:not\(\[data-layout=wide\]\)\[data-h=short\] \.pet-room-label, \.pet-root:not\(\[data-layout=wide\]\)\[data-h=regular\] \.pet-room:not\(\[aria-selected=true\]\) \.pet-room-label/);
  });
});

describe('rooms on the page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    engines.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.history.replaceState({}, '', '/studio/pet/x');
    screenOf(390, 844);
  });
  afterEach(() => { delete (window as { Telegram?: unknown }).Telegram; localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('Home is the care surface; a chip opens a room (loaded lazily) in the dock’s place; the character stays', async () => {
    telegram({ stable: 844 });
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Play', 'Garden', 'Closet', 'Bedroom', 'Life Book']);
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'pet-room-tab-home');
    expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy();
    const char = container.querySelector('.pet-char');
    fireEvent.click(screen.getByRole('tab', { name: 'Garden' }));
    expect(await screen.findByText('Seed · Rain · Breathe')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Garden');
    expect(root(container)).toHaveAttribute('data-room', 'garden');
    expect(container.querySelector('[data-toy="cookie"]')).toBeNull();
    expect(container.querySelector('.pet-char')).toBe(char);
    expect(engines).toHaveLength(1);
    // the engine plays its room transition (design §10.5)
    expect(engines[0].e.setRoom).toHaveBeenLastCalledWith('garden', {});
    expect(screen.getByRole('textbox', { name: 'Talk to Mochi' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(container.querySelector('[data-toy="cookie"]')).toBeTruthy();
  });

  it('every room’s placeholder names the room and its three verbs, with no digits', async () => {
    telegram({ stable: 844 });
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    for (const name of ['Play', 'Garden', 'Closet', 'Bedroom', 'Life Book']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      await waitFor(() => expect(container.querySelector('.pet-soon b')?.textContent).toBe(name));
      expect(container.querySelector('.pet-soon span')!.textContent!.split(' · ')).toHaveLength(3);
      expect(container.querySelector('.pet-rail')!.textContent + container.querySelector('.pet-soon')!.textContent).not.toMatch(/\d/);
    }
  });

  it('a fast sideways flick on the background moves one room; a slow drag (gaze) does not', async () => {
    telegram({ stable: 844 });
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await open(container);
    const stage = container.querySelector('.pet-stage')!;
    const now = vi.spyOn(performance, 'now');
    const flick = (x0: number, x1: number, ms: number) => {
      now.mockReturnValue(1000);
      fireEvent.pointerDown(stage, { pointerId: 7, clientX: x0, clientY: 300 });
      now.mockReturnValue(1000 + ms);
      fireEvent.pointerUp(stage, { pointerId: 7, clientX: x1, clientY: 310 });
    };
    flick(300, 120, 900);
    expect(root(container)).toHaveAttribute('data-room', 'home');
    flick(300, 120, 150);
    expect(root(container)).toHaveAttribute('data-room', 'play');
    flick(120, 300, 150);
    expect(root(container)).toHaveAttribute('data-room', 'home');
  });

  it('Persian: the page is rtl and Persian, the rail mirrors (a rightward flick is "next"), names keep Persian', async () => {
    telegram({ stable: 844, lang: 'fa' });
    const { container } = render(<PetApp agentId="x" api={api()} />);
    await waitFor(() => expect(container.querySelector('.pet-rail')).toBeTruthy());
    const r = root(container);
    expect(r).toHaveAttribute('dir', 'rtl');
    expect(r).toHaveAttribute('lang', 'fa');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['خانه', 'بازی', 'باغچه', 'کمد', 'اتاق خواب', 'دفتر خاطرات']);
    expect(screen.getByRole('button', { name: 'غذا دادن' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'با ⁨Mochi⁩ حرف بزنید…');
    const stage = container.querySelector('.pet-stage')!;
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    fireEvent.pointerDown(stage, { pointerId: 8, clientX: 100, clientY: 300 });
    now.mockReturnValue(1100);
    fireEvent.pointerUp(stage, { pointerId: 8, clientX: 300, clientY: 300 });
    expect(r).toHaveAttribute('data-room', 'play');
    expect(engines.at(-1)!.e.setRoom).toHaveBeenLastCalledWith('play', { dir: -1 });
    // the keyboard follows the eye: → goes back toward Home (to the right in rtl)
    const play = screen.getByRole('tab', { name: 'بازی' });
    fireEvent.keyDown(play, { key: 'ArrowRight' });
    expect(r).toHaveAttribute('data-room', 'home');
    expect(ROOM_IDS).toHaveLength(6);
  });
});
