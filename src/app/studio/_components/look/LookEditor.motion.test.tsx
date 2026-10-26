import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { LookEditor } from './LookEditor';

/*
 * The category panel with real springs, in a file of its own: framer's frame loop runs on jsdom's
 * requestAnimationFrame (a 60 Hz setInterval) and reads performance.now(); both follow the fake clock here,
 * one 16 ms frame per act. A test elsewhere that drops a pending frame with its fake timers leaves the
 * loop asleep for the rest of that file, so these frames would never run there.
 */
const state = vi.hoisted(() => ({ nav: { me: { features: { avatars: true } }, snack: vi.fn(), toast: vi.fn(), tier: 'full', dir: 'ltr' } }));
vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, setLook: vi.fn(async (_id: string, look: unknown) => ({ agent: { ...AGENT, look } })), syncProfile: vi.fn() } };
});
vi.mock('../StudioApp', () => ({ useNav: () => state.nav, errorMessage: () => 'Unexpected error' }));

const AGENT = {
  id: 'fixture-agent', status: 'draft', stage: 4, persona: { name: 'Nova', role: 'Designer' },
  look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
  locked: false, formingDay: null, canEdit: true, canEditLook: true,
} as unknown as AgentView;
function Host() {
  const [a, setA] = useState(AGENT);
  return <LookEditor agent={a} onUpdate={setA} mode="draft" title="Shape Nova’s character" />;
}

const realNow = performance.now.bind(performance);
async function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) await act(async () => { vi.advanceTimersByTime(16); });
}
beforeEach(() => {
  window.localStorage.setItem('vx:look-tour:fixture-agent', '1');   // past the growth tour
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  Object.defineProperty(performance, 'now', { configurable: true, value: () => Date.now() });
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(async () => {
  cleanup();
  await frames(200);
  vi.useRealTimers();
  Object.defineProperty(performance, 'now', { configurable: true, value: realNow });
  MotionGlobalConfig.skipAnimations = true;
  window.localStorage.clear();
});

const panels = () => screen.getAllByRole('tabpanel').map((p) => p.getAttribute('aria-label'));

describe('LookEditor category panel', () => {
  it('a switch back the other way while the old panel still fades out shows the chosen panel', async () => {
    render(<Host />);
    expect(panels()).toEqual(['Species']);
    fireEvent.click(screen.getByRole('tab', { name: 'Hair' }));     // to the right…
    await frames(32);
    fireEvent.click(screen.getByRole('tab', { name: 'Colour' }));   // …then left, inside Species' 90 ms fade
    await frames(1000);
    // before: Species' exit was turned round and never ended, and `mode="wait"` held every later panel back
    expect(panels()).toEqual(['Colour']);
  });

  it('a plain switch slides the new panel in', async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('tab', { name: 'Hair' }));
    await frames(1000);
    expect(panels()).toEqual(['Hair']);
  });
});
