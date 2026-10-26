import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetPlayView } from '@/lib/pet/play';
import { emptyPlay, fakeHost } from '../host.fixture';
import { loadStrings } from '../strings';
import GardenRoom, { seedsFor } from './GardenRoom';
import { roomIntent } from './intent';

const DIGITS = /[0-9۰-۹]/;
let stage: HTMLElement;
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
beforeEach(() => { stage = document.createElement('div'); stage.className = 'pet-stage'; document.body.appendChild(stage); });
afterEach(() => { stage.remove(); localStorage.clear(); vi.useRealTimers(); });

const garden = (state: NonNullable<PetPlayView['garden']>['state'], o: Partial<NonNullable<PetPlayView['garden']>> = {}) =>
  ({ seed: 'flower' as const, plantedAt: 0, waterings: 1, state, ...o });
const answer = (h: ReturnType<typeof fakeHost>, play: PetPlayView, guard?: string) => {
  (h.play as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
    h.state.view = { ...h.state.view!, play };
    return { play, now: 0, ...(guard ? { guard } : {}) };
  });
};

describe('Garden (design §4.5, S10)', () => {
  it('an empty pot invites a seed; Seed plants the flower (the only seed out of Nowruz) through plantSeed', async () => {
    vi.useFakeTimers();
    const h = fakeHost();
    const { container } = render(<GardenRoom id="garden" host={h} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Seed', 'Rain', 'Breathe']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.said).toEqual(['Plant a seed?']);
    expect(stage.querySelector('.pet-pot')).toHaveAttribute('data-state', 'empty');
    answer(h, emptyPlay({ garden: garden('seeded', { waterings: 0 }) }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Seed' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'plantSeed', seed: 'flower' });
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('admire');
    expect(h.said.at(-1)).toBe('Tucked in. It grows while you’re away.');
    expect(container.textContent + stage.textContent).not.toMatch(DIGITS);
  });

  it('sabzeh is offered only while Nowruz is on: a picker with both seeds', async () => {
    expect(seedsFor(emptyPlay())).toEqual(['flower']);
    expect(seedsFor(emptyPlay({ season: 'yalda' }))).toEqual(['flower']);
    const h = fakeHost({ play: emptyPlay({ season: 'nowruz' }) });
    render(<GardenRoom id="garden" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seed' }));
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Flower', 'Sabzeh', 'Cancel']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sabzeh' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'plantSeed', seed: 'sabzeh' });
  });

  it('Rain: the engine rains, the drops fall, Joy gets a stroke, one watering is counted; a second one says "Watered today"', async () => {
    const h = fakeHost({ play: emptyPlay({ garden: garden('ready') }) });
    render(<GardenRoom id="garden" host={h} />);
    answer(h, emptyPlay({ garden: garden('watered', { waterings: 2 }) }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rain' })); });
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('rain');
    expect(h.act).toHaveBeenCalledWith('pet');
    expect(h.play).toHaveBeenCalledWith({ op: 'waterSeed' });
    expect(stage.querySelectorAll('.pet-rain i').length).toBeGreaterThan(0);
    expect(h.said).toContain('Drink up, little sprout.');
    expect(screen.getByRole('status').textContent).toBe('Watered today');
  });

  it('the watering that blooms it: the celebration, the bloom line, the new keepsake chip and a moment worth sharing (P7)', async () => {
    vi.useFakeTimers();
    const h = fakeHost({ play: emptyPlay({ garden: garden('ready', { waterings: 2 }) }) });
    render(<GardenRoom id="garden" host={h} />);
    answer(h, emptyPlay({ garden: garden('blooming', { waterings: 3, bloomedAt: 1 }), items: [{ id: 'bloomPin', earnedAt: 1 }], book: [{ id: 'bloom', at: 1 }] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rain' })); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('bloom');
    expect(h.said.at(-1)).toBe('It bloomed! We did that.');
    expect(screen.getByRole('status').textContent).toBe('New keepsake · Bloom pin');
    expect(h.emit).toHaveBeenCalledWith({ type: 'moment', kind: 'bloom' });
  });

  it('it never wilts: a bloomed pot rains without counting; a seed can go in again', async () => {
    const h = fakeHost({ play: emptyPlay({ garden: garden('bloomed', { waterings: 3, bloomedAt: 1 }) }) });
    render(<GardenRoom id="garden" host={h} />);
    expect(stage.querySelector('.pet-pot')).toHaveAttribute('data-state', 'bloomed');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rain' })); });
    expect(h.play).not.toHaveBeenCalledWith({ op: 'waterSeed' });
    expect(screen.getByRole('button', { name: 'Seed' })).not.toHaveAttribute('data-tired');
  });

  it('Breathe slows the breath to a six-second cycle and stops on leaving the room; the engine\'s seed replaces the drawn pot', () => {
    const h = fakeHost({ play: emptyPlay({ garden: garden('sprouting') }) });
    const setGarden = vi.fn();
    const setGuidedBreath = vi.fn();
    Object.assign(h.engineFake, { setGarden, setGuidedBreath });
    const { unmount } = render(<GardenRoom id="garden" host={h} />);
    expect(setGarden).toHaveBeenCalledWith({ state: 'sprouting', seed: 'flower' });
    expect(stage.querySelector('.pet-pot')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Breathe' }));
    expect(setGuidedBreath).toHaveBeenLastCalledWith(6);
    expect(screen.getByRole('button', { name: 'Breathe' })).toHaveAttribute('aria-pressed', 'true');
    expect(h.said.at(-1)).toBe('Breathe with me. In… and out.');
    unmount();
    expect(setGuidedBreath).toHaveBeenLastCalledWith(null);
    // the seed stays on the floor in every room
    expect(setGarden).toHaveBeenCalledTimes(1);
  });

  it('arriving from a bloom check-in replays the bloom', () => {
    vi.useFakeTimers();
    roomIntent.bloom = true;
    const h = fakeHost({ play: emptyPlay({ garden: garden('blooming', { bloomedAt: 1 }) }) });
    render(<GardenRoom id="garden" host={h} />);
    act(() => { vi.advanceTimersByTime(700); });
    expect(roomIntent.bloom).toBe(false);
    expect(h.said).toEqual(['It bloomed! We did that.']);
    expect(h.emit).toHaveBeenCalledWith({ type: 'moment', kind: 'bloom' });
  });

  it('Persian: the verbs and the seed names from the catalogue, no digits', () => {
    const h = fakeHost({ play: emptyPlay({ season: 'nowruz' }) }, { lang: 'fa' });
    const { container } = render(<GardenRoom id="garden" host={h} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['دانه', 'باران', 'نفس']);
    fireEvent.click(screen.getByRole('button', { name: 'دانه' }));
    expect(screen.getByRole('button', { name: 'سبزه' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(DIGITS);
  });
});
