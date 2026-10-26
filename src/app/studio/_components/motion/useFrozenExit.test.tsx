import { act, cleanup, render } from '@testing-library/react';
import { AnimatePresence, motion, MotionGlobalConfig, type Variants } from 'framer-motion';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barVariants, DUR, EASE, screenVariants, SPRING, type NavCtx, type NavKind } from '../../_lib/motion';
import { useFrozenExit } from './useFrozenExit';

/*
 * Real springs on a controlled clock: framer's frame loop runs on jsdom's requestAnimationFrame, which is a
 * 60 Hz setInterval, and reads performance.now(); both follow the fake clock here, one 16 ms frame per act.
 * jsdom keeps one interval while any frame is pending, so each test lets the loop go idle before the real
 * timers return (a fake interval dropped mid-flight would leave the next test without frames).
 */
const realNow = performance.now.bind(performance);
beforeEach(() => {
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
});
async function wait(ms: number) {
  for (let t = 0; t < ms; t += 16) await act(async () => { vi.advanceTimersByTime(16); });
}

/** A screen as StudioApp's Page renders it; `frozen: false` is the code before the fix (the control). */
function Screen({ k, ctx, variants, frozen }: { k: string; ctx: NavCtx; variants: Variants; frozen: boolean }) {
  const exit = useFrozenExit(variants, ctx);
  return <motion.div data-k={k} className="vx-screen" custom={ctx} variants={variants} initial="initial" animate="enter" exit={frozen ? exit : 'exit'} />;
}
const DELTA: Record<NavKind, number> = { push: 1, pop: -1, hero: 1, 'hero-pop': -1, cover: 1, uncover: -1, tab: 1, replace: 0 };
const nav = (kind: NavKind): NavCtx => ({ kind, delta: DELTA[kind], rtl: false, reduced: false });
let go: (kind: NavKind) => void = () => undefined;
function Stage({ variants = screenVariants, frozen = true }: { variants?: Variants; frozen?: boolean }) {
  const [s, setS] = useState({ n: 0, ctx: nav('replace') });
  go = (kind) => setS((p) => ({ n: p.n + 1, ctx: nav(kind) }));
  return (
    <AnimatePresence initial={false} custom={s.ctx}>
      <Screen key={s.n} k={String(s.n)} ctx={s.ctx} variants={variants} frozen={frozen} />
    </AnimatePresence>
  );
}
const screens = () => [...document.body.querySelectorAll<HTMLElement>('.vx-screen')];
const atRest = (el: HTMLElement) => {
  const t = el.style.transform;
  return (t === '' || t === 'none') && (el.style.opacity === '' || el.style.opacity === '1');
};

const KINDS: NavKind[] = ['push', 'pop', 'hero', 'hero-pop', 'cover', 'uncover', 'tab', 'replace'];
const GAPS = [60, 250, 420, 520, 650];

describe('useFrozenExit', () => {
  it('upstream control: exits finish without the hook when a second navigation changes kind', async () => {
    const same = render(<Stage frozen={false} />);
    await act(async () => go('push'));
    await wait(420);
    await act(async () => go('push'));   // same kind: the re-resolved target is equal, nothing restarts
    await wait(2000);
    expect(screens()).toHaveLength(1);
    same.unmount();

    render(<Stage frozen={false} />);
    await act(async () => go('push'));
    await wait(420);
    await act(async () => go('cover'));
    await wait(2000);
    // Framer 12.43 no longer reprocesses an already-active exit. Keep a healthy
    // upstream control alongside the frozen-target regression matrix below.
    expect(screens()).toHaveLength(1);
    expect(atRest(screens()[0])).toBe(true);
  });

  for (const first of KINDS) {
    for (const second of KINDS.filter((k) => k !== first)) {
      it(`${first}, then ${second} at ${GAPS.join('/')} ms: one screen, at rest`, async () => {
        for (const gap of GAPS) {
          const view = render(<Stage />);
          await act(async () => go(first));
          await wait(gap);
          await act(async () => go(second));
          await wait(1500);
          expect(screens(), `${first} → ${second} @${gap}`).toHaveLength(1);
          expect(atRest(screens()[0])).toBe(true);
          view.unmount();
        }
      });
    }
  }

  it('freezes the tab bar exit too (push, then cover while it slides away)', async () => {
    render(<Stage variants={barVariants} />);
    await act(async () => go('push'));
    await wait(200);
    await act(async () => go('cover'));
    await wait(1500);
    expect(screens()).toHaveLength(1);
  });

  it('keeps a mode="wait" presence moving when the direction flips mid-exit (Spawn steps)', async () => {
    // SpawnScreen's step variants: the exit direction follows the latest move
    type Step = { d: number };
    const steps: Variants = {
      enter: (c: Step) => ({ opacity: 0, x: 24 * c.d }),
      center: { opacity: 1, x: 0, transition: { x: SPRING.page, opacity: { duration: 0.21, ease: EASE.enter } } },
      exit: (c: Step) => ({ opacity: 0, x: -24 * c.d, transition: { duration: DUR.instant, ease: EASE.exit } }),
    };
    function Pane({ k, ctx, frozen }: { k: string; ctx: Step; frozen: boolean }) {
      const exit = useFrozenExit(steps, ctx);
      return <motion.div data-k={k} className="vx-step" custom={ctx} variants={steps} initial="enter" animate="center" exit={frozen ? exit : 'exit'} />;
    }
    let move: (k: string, d: number) => void = () => undefined;
    function Board({ frozen }: { frozen: boolean }) {
      const [s, setS] = useState({ k: 'brief', ctx: { d: 1 } });
      move = (k, d) => setS({ k, ctx: { d } });
      return <AnimatePresence mode="wait" initial={false} custom={s.ctx}><Pane key={s.k} k={s.k} ctx={s.ctx} frozen={frozen} /></AnimatePresence>;
    }
    const shown = () => [...document.body.querySelectorAll<HTMLElement>('.vx-step')].map((e) => e.dataset.k);
    for (const frozen of [false, true]) {
      const view = render(<Board frozen={frozen} />);
      await act(async () => move('draft', 1));   // Next…
      await wait(32);
      await act(async () => move('voice', -1));  // …and another move the other way while Brief still fades out
      await wait(1000);
      // Both the upstream fix and our frozen target must let the latest step arrive.
      expect(shown()).toEqual(['voice']);
      view.unmount();
    }
  });

  it('re-arms a screen that comes back before it finished leaving', async () => {
    let show: (on: boolean) => void = () => undefined;
    let ctx = nav('replace');
    function Toggle() {
      const [on, setOn] = useState(true);
      show = setOn;
      return (
        <AnimatePresence initial={false} custom={ctx}>
          {on && <Screen key="a" k="a" ctx={ctx} variants={screenVariants} frozen />}
          {!on && <Screen key="b" k="b" ctx={ctx} variants={screenVariants} frozen />}
        </AnimatePresence>
      );
    }
    render(<Toggle />);
    ctx = nav('push'); await act(async () => show(false));
    await wait(100);
    ctx = nav('pop'); await act(async () => show(true));    // Back while "a" is still sliding away: it returns
    await wait(1500);
    expect(screens().map((e) => e.dataset.k)).toEqual(['a']);
    expect(atRest(screens()[0])).toBe(true);
    ctx = nav('cover'); await act(async () => show(false));  // and its next exit follows the new navigation
    await wait(1500);
    expect(screens().map((e) => e.dataset.k)).toEqual(['b']);
  });
});
