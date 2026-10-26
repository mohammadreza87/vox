import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_ACTION_KINDS } from '@/lib/pet/types';
import { care, fakeHost } from './host.fixture';
import { actionOf, perform, PET_ACTION_MIN, watchPetActions } from './petAction';
import { roomIntent } from './rooms/intent';

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
afterEach(() => { vi.useRealTimers(); delete roomIntent.guess; });

const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };
const reply = (kind: string, confidence = 0.9) => ({ type: 'reply' as const, saved: false, said: 'x', action: { kind: kind as never, confidence } });

describe('pet_action (design §8.4)', () => {
  it('acts only at confidence ≥ 0.75 on a known kind; none, unknown and malformed are nothing', () => {
    expect(PET_ACTION_MIN).toBe(0.75);
    expect(actionOf({ kind: 'sleep', confidence: 0.75 })).toBe('sleep');
    expect(actionOf({ kind: 'sleep', confidence: 0.74 })).toBeNull();
    expect(actionOf({ kind: 'none', confidence: 1 })).toBeNull();
    expect(actionOf({ kind: 'dance' as never, confidence: 1 })).toBeNull();
    expect(actionOf({ kind: 'feed', confidence: Number.NaN })).toBeNull();
    expect(actionOf(undefined)).toBeNull();
  });

  it('acts on exactly the server\'s kind set (pet/types.ts PET_ACTION_KINDS)', () => {
    for (const kind of PET_ACTION_KINDS) expect(actionOf({ kind, confidence: 0.9 }), kind).toBe(kind);
  });

  it('waits for the spoken reply to end, then a beat, then the reversible move (the moon, through the toy and its animation)', () => {
    const h = fakeHost();
    h.state.talk = 'speaking';
    watchPetActions(h, later);
    h.fire(reply('sleep'));
    vi.advanceTimersByTime(5000);
    expect(h.toyEvent).not.toHaveBeenCalled();
    h.state.talk = 'idle';
    vi.advanceTimersByTime(300);
    expect(h.toyEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(h.toyEvent).toHaveBeenCalledWith({ type: 'moonTap' });
    expect(h.act).not.toHaveBeenCalled();
  });

  it('never while a sheet or a game is open (dropped, not queued), never under the bar, and a newer reply supersedes it', () => {
    const h = fakeHost();
    watchPetActions(h, later);
    h.state.busy.add('sheet');
    h.fire(reply('feed'));
    vi.advanceTimersByTime(2000);
    h.state.busy.clear();
    vi.advanceTimersByTime(5000);
    expect(h.toyEvent).not.toHaveBeenCalled();
    h.fire(reply('feed', 0.6));
    vi.advanceTimersByTime(2000);
    expect(h.toyEvent).not.toHaveBeenCalled();
    h.state.talk = 'speaking';
    h.fire(reply('open_garden'));
    h.fire({ type: 'reply', saved: false, said: 'y' });
    h.state.talk = 'idle';
    vi.advanceTimersByTime(2000);
    expect(h.setRoom).not.toHaveBeenCalled();
  });

  it('the moves: rooms through the rail, care verbs from Home (going there first), Guess in Play; asleep: no tuck-in', () => {
    const h = fakeHost();
    perform(h, 'open_life_book', later);
    expect(h.setRoom).toHaveBeenLastCalledWith('book');
    perform(h, 'feed', later);
    expect(h.setRoom).toHaveBeenLastCalledWith('home');
    expect(h.toyEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(h.toyEvent).toHaveBeenCalledWith({ type: 'cookieTap' });
    h.state.room = 'play';
    perform(h, 'play_ball', later);
    expect(h.toyEvent).toHaveBeenLastCalledWith({ type: 'ballTap' });
    perform(h, 'start_guess', later);
    expect(roomIntent.guess).toBe('start');
    expect(h.emit).toHaveBeenCalledWith({ type: 'room', room: 'play' });
    h.state.room = 'home';
    perform(h, 'start_guess', later);
    expect(h.setRoom).toHaveBeenLastCalledWith('play');
    const asleep = fakeHost({ care: care({ asleep: true }) });
    perform(asleep, 'sleep', later);
    expect(asleep.toyEvent).not.toHaveBeenCalled();
  });
});
