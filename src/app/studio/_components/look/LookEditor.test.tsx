import { act, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_LOOKS, normalizeLook } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import type { AgentView } from '../../_lib/client';
import { LookEditor, REEL_MS } from './LookEditor';
import { TOUR_STEP_MS } from './StageScrubber';
import { LOOK_DEBOUNCE_MS } from './useLookDraft';

const state = vi.hoisted(() => ({
  setLook: vi.fn(), syncProfile: vi.fn(),
  nav: { me: { features: { avatars: true } }, snack: vi.fn(), toast: vi.fn(), tier: 'full', dir: 'ltr' },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, setLook: state.setLook, syncProfile: state.syncProfile } };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}));

const LOOK: CharacterLook = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } };

function agent(look: Partial<CharacterLook> = {}, extra: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'draft', stage: 4, persona: { name: 'Nova', role: 'Designer' },
    look: { ...LOOK, ...look }, locked: false, formingDay: null, canEdit: true, canEditLook: true, ...extra,
  } as AgentView;
}

function Host({ initial, mode = 'draft', onDone }: { initial: AgentView; mode?: 'draft' | 'live'; onDone?: () => void }) {
  const [a, setA] = useState(initial);
  return <LookEditor agent={a} onUpdate={setA} mode={mode} title="Shape Nova’s character" onDone={onDone} />;
}

const echo = () => state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const rail = (name: string) => screen.getByRole('radiogroup', { name });
const openTab = async (name: string) => { fireEvent.click(screen.getByRole('tab', { name })); await tick(50); };

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [state.setLook, state.syncProfile, state.nav.snack, state.nav.toast]) fn.mockReset();
  state.nav.tier = 'full';
  state.nav.dir = 'ltr';
  // The growth tour plays once per agent per device; most tests start past it.
  window.localStorage.setItem('vx:look-tour:fixture-agent', '1');
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('LookEditor', () => {
  it('picks a species optimistically, saves once after the debounce, announces it and offers Undo', async () => {
    echo();
    render(<Host initial={agent()} />);
    expect(within(rail('Species')).getByRole('radio', { name: 'Cloud' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(rail('Species')).getByRole('radio', { name: 'Cat' }));
    expect(within(rail('Species')).getByRole('radio', { name: 'Cat' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.getByText('Nova is now a sky cat, day 7 look')).toBeInTheDocument();
    expect(state.setLook).not.toHaveBeenCalled();
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ species: 'cat' }), { sync: false });
    expect(screen.getByText('Saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo · cat/i }));
    expect(within(rail('Species')).getByRole('radio', { name: 'Cloud' })).toHaveAttribute('aria-checked', 'true');
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenLastCalledWith('fixture-agent', expect.objectContaining({ species: 'cloud' }), { sync: false });
  });

  it('the undo pill leaves after 4 s', async () => {
    echo();
    render(<Host initial={agent()} />);
    fireEvent.click(within(rail('Body')).getByRole('radio', { name: 'Tower' }));
    expect(screen.getByRole('button', { name: /undo · tower/i })).toBeInTheDocument();
    await tick(4500);
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('an incompatible option is aria-disabled, explains itself, and is never sent', async () => {
    echo();
    render(<Host initial={agent({ hair: 'bun' })} />);
    await openTab('Accessory');
    const cap = within(rail('Accessory')).getByRole('radio', { name: 'Cap' });
    expect(cap).toHaveAttribute('aria-disabled', 'true');
    expect(cap).toHaveAccessibleDescription('Hats sit flat, so they can’t go over this hairstyle.');
    fireEvent.click(cap);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cap · Hats sit flat, so they can’t go over this hairstyle.');
    expect(cap).toHaveAttribute('aria-checked', 'false');
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).not.toHaveBeenCalled();
    // The species rail blocks the other way round: an owl can't keep the bun.
    await openTab('Species');
    expect(within(rail('Species')).getByRole('radio', { name: 'Owl' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('suggests accessories for the role first', async () => {
    render(<Host initial={agent({}, { persona: { name: 'Nova', role: 'Customer support' } } as Partial<AgentView>)} />);
    await openTab('Accessory');
    expect(screen.getByText('✦ Suggested for Customer support')).toBeInTheDocument();
    const names = within(rail('Accessory')).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names.slice(0, 2).map((n) => n?.replace('✦', ''))).toEqual(['None', 'Headset']);
  });

  it('a new accessory brings its colour; the colour row edits the accent', async () => {
    echo();
    render(<Host initial={agent()} />);
    await openTab('Accessory');
    fireEvent.click(within(rail('Accessory')).getByRole('radio', { name: 'Beanie' }));
    const colours = screen.getByRole('radiogroup', { name: 'Beanie colour' });
    expect(within(colours).getByRole('radio', { name: 'Coral' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(colours).getByRole('radio', { name: 'Navy' }));
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ accessory: 'beanie', accent: 'navy' }), { sync: false });
  });

  it('face features toggle independently', async () => {
    echo();
    render(<Host initial={agent()} />);
    await openTab('Face');
    const face = screen.getByRole('group', { name: 'Face' });
    const lashes = within(face).getByRole('checkbox', { name: 'Lashes' });
    expect(lashes).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(lashes);
    expect(lashes).toHaveAttribute('aria-checked', 'true');
    expect(within(face).getByRole('checkbox', { name: 'Brows' })).toHaveAttribute('aria-checked', 'true');
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ features: { cheeks: true, lashes: true, brows: true } }), { sync: false });
  });

  it('arrow keys move the choice, swapped in RTL', async () => {
    echo();
    render(<div dir="rtl"><Host initial={agent()} /></div>);
    const cloud = within(rail('Species')).getByRole('radio', { name: 'Cloud' });
    fireEvent.keyDown(cloud, { key: 'ArrowLeft' });
    expect(within(rail('Species')).getByRole('radio', { name: 'Cat' })).toHaveAttribute('aria-checked', 'true');
    expect(within(rail('Species')).getByRole('radio', { name: 'Cat' })).toHaveFocus();
  });

  it('colour swatches are a radiogroup', async () => {
    echo();
    render(<Host initial={agent()} />);
    await openTab('Colour');
    fireEvent.click(within(rail('Colour')).getByRole('radio', { name: 'Rosé' }));
    expect(within(rail('Colour')).getByRole('radio', { name: 'Rosé' })).toHaveAttribute('aria-checked', 'true');
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ hue: 'rose' }), { sync: false });
  });

  it('a failed save rolls back with an inline Retry', async () => {
    state.setLook.mockRejectedValueOnce(new Error('Network down'));
    render(<Host initial={agent()} />);
    fireEvent.click(within(rail('Species')).getByRole('radio', { name: 'Dog' }));
    await tick(LOOK_DEBOUNCE_MS);
    expect(within(rail('Species')).getByRole('radio', { name: 'Cloud' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Couldn’t save')).toBeInTheDocument();
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
    echo();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(within(rail('Species')).getByRole('radio', { name: 'Dog' })).toHaveAttribute('aria-checked', 'true');
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('the dice spins through six looks and lands on a preset', async () => {
    echo();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<Host initial={agent()} />);
    fireEvent.click(screen.getByRole('button', { name: /random look/i }));
    expect(screen.getByRole('button', { name: 'Poke Nova' })).toBeDisabled();
    await tick(REEL_MS.reduce((a, b) => a + b, 0));
    expect(screen.getByRole('button', { name: 'Poke Nova' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /undo · surprise look/i })).toBeInTheDocument();
    await tick(LOOK_DEBOUNCE_MS);
    expect(state.setLook).toHaveBeenCalledTimes(1);
    const sent = normalizeLook(state.setLook.mock.calls[0][1]);
    expect(PRESET_LOOKS.some((p) => JSON.stringify(normalizeLook(p)) === JSON.stringify(sent))).toBe(true);
  });

  it('reduced motion: the dice lands at once and the growth tour never plays', async () => {
    echo();
    state.nav.tier = 'reduced';
    window.localStorage.clear();
    render(<Host initial={agent({}, { status: 'active', stage: 2 })} mode="live" />);
    expect(screen.getByRole('slider')).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: /random look/i }));
    expect(screen.getByRole('button', { name: /undo · surprise look/i })).toBeInTheDocument();
  });
});

describe('LookEditor growth preview', () => {
  it('plays Day 1 → 7 once on first entry, then rests on the real stage', async () => {
    window.localStorage.clear();
    render(<Host initial={agent({}, { status: 'active', stage: 2 })} mode="live" />);
    const slider = screen.getByRole('slider', { name: 'Preview Nova’s growth' });
    await tick(0);
    expect(slider).toHaveValue('1');
    expect(slider).toHaveAttribute('aria-valuetext', 'Day 1 · Newborn');
    await tick(TOUR_STEP_MS * 3);
    expect(slider).toHaveValue('4');
    await tick(TOUR_STEP_MS + 300);
    expect(slider).toHaveValue('2');
    expect(screen.getByText('Today · Day 3 · Opens eyes')).toBeInTheDocument();
    cleanup();
    render(<Host initial={agent({}, { status: 'active', stage: 2 })} mode="live" />);
    await tick(TOUR_STEP_MS);
    expect(screen.getByRole('slider')).toHaveValue('2');
  });

  it('drafts rest fully formed; editing a part the preview can’t show yet jumps to its day', async () => {
    echo();
    render(<Host initial={agent()} />);
    expect(screen.getByText('Fully formed (day 7)')).toBeInTheDocument();
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(slider).toHaveAttribute('aria-valuetext', 'Day 1 · Newborn');
    expect(screen.getByText('Scrub to preview how Nova grows')).toBeInTheDocument();
    await openTab('Hair');
    expect(slider).toHaveValue('3');
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.click(within(rail('Hair')).getByRole('radio', { name: 'Curls' }));
    expect(slider).toHaveValue('3');
  });
});

describe('LookEditor live', () => {
  it('Done saves what is waiting and pushes to Telegram once; closing after Done pushes nothing more', async () => {
    echo();
    state.syncProfile.mockResolvedValue({ agent: agent({}, { status: 'active' }), failed: [] });
    const onDone = vi.fn();
    const { unmount } = render(<Host initial={agent({}, { status: 'active' })} mode="live" onDone={onDone} />);
    fireEvent.click(within(rail('Species')).getByRole('radio', { name: 'Bear' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    await tick(0);
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledWith('fixture-agent', { force: false });
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
    await tick(1000);
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
  });

  it('unmounting with edits pushes once', async () => {
    echo();
    state.syncProfile.mockResolvedValue({ agent: agent({}, { status: 'active' }), failed: [] });
    const { unmount } = render(<Host initial={agent({}, { status: 'active' })} mode="live" />);
    fireEvent.click(within(rail('Species')).getByRole('radio', { name: 'Bunny' }));
    await tick(LOOK_DEBOUNCE_MS);
    unmount();
    await tick(0);
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledWith('fixture-agent', { force: false });
  });
});
