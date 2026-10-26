import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { care, emptyPlay, fakeHost } from '../host.fixture';
import { LANG_KEY, loadStrings } from '../strings';
import BedroomRoom from './BedroomRoom';
import BookRoom from './BookRoom';
import PlayRoom from './PlayRoom';

const DIGITS = /[0-9۰-۹]/;
const leafText = () => screen.getByRole('tabpanel').querySelector('div')!.textContent!;
let stage: HTMLElement;
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
beforeEach(() => { stage = document.createElement('div'); stage.className = 'pet-stage'; document.body.appendChild(stage); });
afterEach(() => { stage.remove(); localStorage.clear(); });

describe('Play room (design §4.2, S8, S9)', () => {
  it('the picker: Bop and Starfall in the dock, Zen as the switch in the top corner (P-06), no digits; Bop is the Home ball', () => {
    const h = fakeHost();
    const { container } = render(<PlayRoom id="play" host={h} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Bop', 'Starfall', 'Zen']);
    expect(container.textContent).not.toMatch(DIGITS);
    fireEvent.click(screen.getByRole('button', { name: 'Bop' }));
    expect(h.toyEvent).toHaveBeenCalledWith({ type: 'ballTap' });
  });

  it('a Starfall round plays over the stage with pips (never a number), and Done sends one play action and the outcome', async () => {
    const h = fakeHost({ play: emptyPlay({ games: { starfall: { rounds: 'one', best: false, zen: false } } }) });
    render(<PlayRoom id="play" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Starfall' }));
    expect(h.state.busy.has('game')).toBe(true);
    expect(stage.querySelector('.pet-field')).toBeTruthy();
    const pips = screen.getByRole('img', { name: 'Round progress' });
    expect(pips.querySelectorAll('i')).toHaveLength(10);
    expect(stage.textContent).not.toMatch(DIGITS);
    expect(h.said).toEqual(['Catch the stars with me!']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(h.act).toHaveBeenCalledTimes(1);
    expect(h.act).toHaveBeenCalledWith('play');
    expect(h.play).toHaveBeenCalledWith(expect.objectContaining({ op: 'gameRound', game: 'starfall', outcome: 'finished', round: expect.stringMatching(/^[a-z0-9]{16}$/) }));
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('roundEnd', { won: false, zen: false });
    expect(h.engineFake.setGaze).toHaveBeenLastCalledWith(null);
    expect(h.said.at(-1)).toBe('So close! That one was shy.');
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'round', zen: false }));
    expect(stage.querySelector('.pet-field')).toBeNull();
    // the end card's Again and Done, and the Zen switch back at the top once the round is over
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Again', 'Done', 'Zen']);
  });

  it('Zen: no pips, no end screen; the first round says how to play', async () => {
    const h = fakeHost();
    render(<PlayRoom id="play" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Starfall' }));
    expect(h.said).toEqual(['Drag me under the stars.']);
    expect(screen.queryByRole('img', { name: 'Round progress' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(h.play).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'zen' }));
    expect(h.said.at(-1)).toBe('That was dreamy.');
    expect(screen.getByRole('button', { name: 'Starfall' })).toBeInTheDocument();
  });

  it('tired (Energy under the care rule): "Nap first?", a refuse, and the way to the Bedroom; no round starts', () => {
    const h = fakeHost({ care: care({ energy: 10 }) });
    render(<PlayRoom id="play" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Starfall' }));
    expect(h.engineFake.fire).toHaveBeenCalledWith({ type: 'refuse', why: 'tired' });
    expect(h.said).toEqual(['Nap first?']);
    expect(stage.querySelector('.pet-field')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Bedroom ›' }));
    expect(h.setRoom).toHaveBeenCalledWith('bedroom');
  });

  it('in Persian the cards and the pips are Persian, with no digits', () => {
    localStorage.setItem(LANG_KEY, 'fa');
    const h = fakeHost({}, { lang: 'fa' });
    render(<PlayRoom id="play" host={h} />);
    // the Zen switch sits at the top of the page (a portal), the games in the dock
    expect(document.body.textContent).toContain('بی‌عجله');
    expect(document.body.textContent).toContain('روپایی');
    expect(document.body.textContent).not.toMatch(DIGITS);
  });
});

describe('Bedroom (design §4.4, S12)', () => {
  it('the lamp dims the room; the story hums instead (no story this wave); members only', () => {
    const h = fakeHost();
    render(<BedroomRoom id="bedroom" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lamp' }));
    expect(stage.querySelector('.pet-lamp')).toHaveAttribute('data-on');
    expect(h.said).toEqual(['Lights low…']);
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(h.said.at(-1)).toBe('Let me just hum you one tonight.');
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('storyNod');
    const g = fakeHost({ role: 'guest' });
    render(<BedroomRoom id="bedroom" host={g} />);
    expect(screen.getAllByRole('button', { name: 'Story' })).toHaveLength(1);
  });

  it('the moon tucks in through the sleep action, says it is not sleepy with Energy high, and asleep it is the gentle wake tap', () => {
    const h = fakeHost({ care: care({ energy: 40 }) });
    const { rerender } = render(<BedroomRoom id="bedroom" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Moon' }));
    expect(h.said).toEqual(['Mmm, blanket time.']);
    expect(h.toyEvent).toHaveBeenCalledWith({ type: 'moonTap' });
    rerender(<BedroomRoom id="bedroom" host={h} asleep />);
    fireEvent.click(screen.getByRole('button', { name: 'Moon' }));
    expect(h.toyEvent).toHaveBeenCalledTimes(2);
    expect(stage.querySelector('.pet-lamp')).toHaveAttribute('data-on');
    // it woke: the lamp comes back up
    rerender(<BedroomRoom id="bedroom" host={h} asleep={false} />);
    expect(stage.querySelector('.pet-lamp')).not.toHaveAttribute('data-on');
    const awake = fakeHost({ care: care({ energy: 95 }) });
    render(<BedroomRoom id="bedroom" host={awake} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Moon' }).at(-1)!);
    expect(awake.said).toEqual(['Not sleepy yet, but cozy is nice.']);
    expect(awake.toyEvent).not.toHaveBeenCalled();
  });
});

describe('Life Book (design §4.7, §4.11, S13)', () => {
  const growth = {
    mine: ['room-play'],
    moments: [
      { id: 'release', kind: 'taught' as const, title: 'I learned how you plan a release', hint: 'Tell me how your team plans a release', lit: { at: '2026-10-25T10:00:00Z' } },
      { id: 'report', kind: 'task' as const, title: 'I wrote our first report', hint: 'Ask me for a weekly report' },
      { id: 'room-play', kind: 'room' as const, title: 'We found the Play room together', hint: 'Peek into the Play room' },
    ],
  };

  it('Pages: the server page ids as their lines with their why; an empty book still has page one', () => {
    const empty = fakeHost();
    const { unmount } = render(<BookRoom id="book" host={empty} />);
    expect(leafText()).toBe('Page one: we met.The first day you met Mochi.');
    unmount();
    const h = fakeHost({ play: emptyPlay({ book: [{ id: 'stage2', at: 2 }, { id: 'met', at: 1 }] }) });
    render(<BookRoom id="book" host={h} />);
    expect(leafText()).toContain('Page one: we met.');
    fireEvent.click(screen.getByRole('button', { name: 'more ›' }));
    expect(leafText()).toContain('I got a mouth. First cookie!');
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('pageFlip');
  });

  it('What I\'ve learned: lit moments with their why line, unlit ones as hints only, never a count', () => {
    const h = fakeHost({ growth });
    const { container } = render(<BookRoom id="book" host={h} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Learned' }));
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(leafText()!);
      const next = screen.getByRole('button', { name: 'more ›' });
      if (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
    }
    expect(seen[0]).toContain('I learned how you plan a release');
    expect(seen[0]).toContain('Lit when someone taught Mochi this.');
    expect(seen[1]).toContain('Lit the first time you visited this room.');
    expect(seen[2]).toContain('Ask me for a weekly report');
    expect(seen[2]).not.toContain('I wrote our first report');
    expect(container.textContent).not.toMatch(DIGITS);
  });

  it('empty Learned tab, keepsakes with how they were earned, and About me', () => {
    const h = fakeHost({ play: emptyPlay({ items: [{ id: 'bloomPin', earnedAt: 1 }] }) });
    render(<BookRoom id="book" host={h} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Learned' }));
    expect(leafText()).toBe('Nothing here yet. Teach me something and say “remember this”.');
    fireEvent.click(screen.getByRole('tab', { name: 'Keepsakes' }));
    expect(leafText()).toBe('Bloom pinBloom a seed together');
    fireEvent.click(screen.getByRole('tab', { name: 'About me' }));
    expect(leafText()).toBe('I’m Mochi, an AI colleague. This little cloud is a game we play together.');
  });

  it('P10 Visits: asked once; a yes records the answer, then sets the visits flag (setVisits); a no sets nothing', async () => {
    const h = fakeHost();
    const { unmount } = render(<BookRoom id="book" host={h} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Visits' }));
    expect(h.play).toHaveBeenCalledWith({ op: 'askSeen', ask: 'P10' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, they can visit' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P10' });
    expect(h.play).toHaveBeenLastCalledWith({ op: 'setVisits', open: true });
    expect(leafText()).toContain('Visits arrive in a later update.');
    unmount();
    const n = fakeHost();
    render(<BookRoom id="book" host={n} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Visits' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not now' })); });
    expect(n.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P10' });
    expect(n.play).not.toHaveBeenCalledWith({ op: 'setVisits', open: true });
  });
});
