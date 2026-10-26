import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeHost } from '../host.fixture';
import { loadStrings } from '../strings';
import { UNFINISHED } from './Guess';
import { roomIntent } from './intent';
import PlayRoom from './PlayRoom';

const DIGITS = /[0-9۰-۹]/;
beforeAll(async () => { await loadStrings('en'); });
afterEach(() => { localStorage.clear(); });

const withSend = () => {
  const h = fakeHost();
  h.send = vi.fn(async () => true);
  return h;
};
const pips = () => screen.getByRole('img', { name: 'Round progress' }).querySelectorAll('i[data-on]').length;

describe('Guess my word (design §4.2)', () => {
  it('the card is in the picker where the page can send talk turns (a Wave B page without the glue shows none)', () => {
    render(<PlayRoom id="play" host={withSend()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Bop', 'Starfall', 'Guess my word', 'Zen']);
  });

  it('the pet takes a word in talk; each answer lights a pip (never a number); Done is one play action and the round', async () => {
    const h = withSend();
    const { container } = render(<PlayRoom id="play" host={h} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guess my word' })); });
    expect(h.send).toHaveBeenCalledWith('Think of a word, and I’ll guess it with yes-or-no questions!');
    expect(h.state.busy.has('game')).toBe(true);
    expect(screen.getByText('Guesses are talk: they go to our chat.')).toBeInTheDocument();
    expect(localStorage.getItem(UNFINISHED('a'))).toBe('1');
    // the first answer is the pet taking its word; questions after it light pips
    act(() => { h.fire({ type: 'reply', saved: false, said: 'start' }); });
    expect(pips()).toBe(0);
    act(() => { h.fire({ type: 'reply', saved: false, said: 'is it alive?' }); h.fire({ type: 'reply', saved: false, said: 'is it big?' }); });
    expect(pips()).toBe(2);
    expect(container.textContent).not.toMatch(DIGITS);
    fireEvent.click(screen.getByRole('button', { name: 'Ask or guess' }));
    expect(h.focusTalk).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.act).toHaveBeenCalledTimes(1);
    expect(h.act).toHaveBeenCalledWith('play');
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('roundEnd', { won: true, zen: false });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'round', game: 'guess', zen: false }));
    // the outcome only (the words stay in talk): the first round played to the end is the best one, with its page
    expect(h.play).toHaveBeenCalledWith({ op: 'gameRound', game: 'guess', outcome: 'best', round: expect.stringMatching(/^[A-Za-z0-9_-]{8,40}$/) });
    expect(h.said.at(-1)).toBe('We guessed it together!');
    expect(screen.getByRole('status').textContent).toBe('New page in the Life Book');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(localStorage.getItem(UNFINISHED('a'))).toBeNull();
    expect(screen.getByRole('button', { name: 'Guess my word' })).toBeInTheDocument();
  });

  it('"I give up" asks for the word in the person\'s words, then ends the round', async () => {
    const h = withSend();
    render(<PlayRoom id="play" host={h} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guess my word' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'I give up. What was it?' })); });
    expect(h.send).toHaveBeenLastCalledWith('I give up. What was it?');
    expect(h.act).toHaveBeenCalledWith('play');
    // giving up is a finished round, never the best one
    expect(h.play).toHaveBeenCalledWith(expect.objectContaining({ op: 'gameRound', game: 'guess', outcome: 'finished' }));
  });

  it('Zen: no pips, a hint on request instead of giving up', async () => {
    const h = withSend();
    render(<PlayRoom id="play" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zen' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guess my word' })); });
    expect(screen.queryByRole('img', { name: 'Round progress' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'A hint, please?' }));
    expect(h.send).toHaveBeenLastCalledWith('A hint, please?');
    expect(screen.queryByRole('button', { name: 'I give up. What was it?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.play).toHaveBeenCalledWith(expect.objectContaining({ op: 'gameRound', game: 'guess', outcome: 'zen' }));
  });

  it('left mid-way: the next Guess resumes the same word (no new opening line)', async () => {
    localStorage.setItem(UNFINISHED('a'), '1');
    const h = withSend();
    render(<PlayRoom id="play" host={h} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guess my word' })); });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.said).toEqual(['I still have my word. Want to keep guessing?']);
  });

  it('asked for from elsewhere (start_guess, a "keep guessing" check-in): Play opens straight into Guess', async () => {
    roomIntent.guess = 'start';
    const h = withSend();
    await act(async () => { render(<PlayRoom id="play" host={h} />); });
    expect(roomIntent.guess).toBeUndefined();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('a guest\'s turn cannot be taken here (it opens the DM): the card goes back to the picker', async () => {
    const h = fakeHost({ role: 'guest' });
    h.send = vi.fn(async () => false);
    render(<PlayRoom id="play" host={h} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guess my word' })); });
    expect(screen.getByRole('button', { name: 'Guess my word' })).toBeInTheDocument();
    expect(h.act).not.toHaveBeenCalled();
  });
});
