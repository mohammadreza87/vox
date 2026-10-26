import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { askOk, p1Due, p9Due, PAUSED_KEY, replayOf } from './askRules';
import { Asks } from './Asks';
import type { CheckinPrefs, CheckinsRequest } from './contract';
import { emptyPlay, fakeHost } from './host.fixture';
import { roomIntent } from './rooms/intent';
import { loadStrings } from './strings';
import { countDay, GAME_BIT, NO_SIGNALS, writeSignals, type TipSignals } from './tips';

const DAY = 86_400_000;
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance'] }); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); delete (window as { Telegram?: unknown }).Telegram; for (const k of Object.keys(roomIntent)) delete (roomIntent as Record<string, unknown>)[k]; });

const signals = (o: Partial<TipSignals>) => writeSignals('a', { ...NO_SIGNALS, ...o });
const prefs = (o: Partial<CheckinPrefs> = {}): CheckinPrefs => ({ enabled: false, types: { growingUp: true, seasons: true, garden: true, hellos: false, careNudges: false }, sound: false, sentThisWeek: 0, live: true, ...o });
function withCheckins(p: CheckinPrefs = prefs()) {
  const checkins = vi.fn(async (_id: string, req?: CheckinsRequest) => (req && 'enabled' in req && req.enabled ? prefs({ enabled: true, types: { ...p.types, ...req.types } }) : p));
  return checkins;
}
function telegram(o: { write?: boolean; home?: string } = {}) {
  const app = {
    initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Sara', allows_write_to_pm: o.write } },
    isVersionAtLeast: () => true, requestWriteAccess: vi.fn((cb: (ok: boolean) => void) => cb(true)),
    checkHomeScreenStatus: vi.fn((cb: (s: string) => void) => cb(o.home ?? 'missed')), addToHomeScreen: vi.fn(),
    onEvent: vi.fn(), offEvent: vi.fn(), openTelegramLink: vi.fn(),
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return app;
}
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('the ask rules (§6.1, §6.2)', () => {
  it('the re-ask rule on the record: a yes never again, one decline only after thirty days, two never; no record, no ask', () => {
    const now = 100 * DAY;
    expect(askOk(undefined, 'P1', now)).toBe(false);
    expect(askOk(emptyPlay(), 'P1', now)).toBe(true);
    expect(askOk(emptyPlay({ asks: { P1: { lastAskedAt: now - DAY, declined: 0 } } }), 'P1', now)).toBe(true);
    expect(askOk(emptyPlay({ asks: { P1: { lastAskedAt: now - DAY, declined: 1 } } }), 'P1', now)).toBe(false);
    expect(askOk(emptyPlay({ asks: { P1: { lastAskedAt: now - 31 * DAY, declined: 1 } } }), 'P1', now)).toBe(true);
    expect(askOk(emptyPlay({ asks: { P1: { lastAskedAt: now - 99 * DAY, declined: 2 } } }), 'P1', now)).toBe(false);
    expect(askOk(emptyPlay({ asks: { P1: { lastAskedAt: 0, declined: 0, accepted: true } } }), 'P1', now)).toBe(false);
  });

  it('triggers: P1 on a second different day or the day before a stage-up; P9 after several games on several days', () => {
    const s = countDay({ ...NO_SIGNALS }, '2026-10-25');
    expect(p1Due(s, null)).toBeNull();
    countDay(s, '2026-10-25');
    expect(s.days).toBe(1);
    countDay(s, '2026-10-26');
    expect(p1Due(s, null)).toBe('plain');
    expect(p1Due({ ...NO_SIGNALS, days: 1 }, 3)).toBe('forming');
    expect(p1Due({ ...NO_SIGNALS, days: 1 }, 4)).toBeNull();
    expect(p9Due({ ...NO_SIGNALS, games: GAME_BIT.bop, gameDays: 5 })).toBe(false);
    expect(p9Due({ ...NO_SIGNALS, games: GAME_BIT.bop | GAME_BIT.guess, gameDays: 3 })).toBe(true);
  });

  it('a check-in reference names its moment: catalogue ids and names; anything else is a plain hello', () => {
    expect(['C2', 'C3', 'C5', 'C7', 'C11', 'bloom', 'nowruz', 'stageUp', 'what'].map(replayOf)).toEqual(['stage', 'formed', 'bloom', 'yalda', 'guess', 'bloom', 'nowruz', 'stage', 'hello']);
  });
});

describe('P1 check-ins and P2 write access (§5.2, §6.2)', () => {
  it('end of a session on a second day: the sheet (equal buttons), "Choose moments" switches, the yes posts the chosen types, then P2', async () => {
    const app = telegram({ write: false });
    signals({ days: 2 });
    const checkins = withCheckins();
    const h = fakeHost({}, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(0);
    expect(checkins).toHaveBeenCalledWith('a');
    // nothing yet: the person has not done anything this session
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => h.fire({ type: 'reply', saved: false, said: 'ok bye!' }));
    await tick(1500);
    const sheet = screen.getByRole('dialog', { name: 'Can Mochi check in now and then?' });
    expect(h.play).toHaveBeenCalledWith({ op: 'askSeen', ask: 'P1' });
    expect(h.state.busy.has('ask')).toBe(true);
    expect(sheet.textContent).toContain('At most one a day, silent, never 21:00–08:00.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose moments' }));
    const sw = within(sheet).getAllByRole('switch') as HTMLInputElement[];
    expect(sw.map((s) => s.checked)).toEqual([true, true, true, false, false]);
    expect(within(sheet).getByText('Tell me when Mochi gets sleepy')).toBeInTheDocument();
    fireEvent.click(sw[1]);
    fireEvent.click(sw[3]);
    const buttons = within(sheet).getAllByRole('button').slice(-2);
    expect(buttons.map((b) => b.textContent)).toEqual(['Yes, check in', 'Not now']);
    await act(async () => { fireEvent.click(buttons[0]); });
    expect(checkins).toHaveBeenLastCalledWith('a', { enabled: true, types: { growingUp: true, seasons: false, garden: true, hellos: true, careNudges: false },
      consent: { variant: 'default', lang: 'en', eventId: expect.stringMatching(/^[a-z0-9]{12}$/), presentedAt: expect.any(Number) } });
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P1' });
    expect(h.said).toContain('I promise to keep it short!');
    // P2: the bot cannot write yet (a group launch); Telegram's prompt only after Continue
    const p2 = screen.getByRole('dialog', { name: 'One more step' });
    expect(app.requestWriteAccess).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(p2).getByRole('button', { name: 'Continue' })); });
    expect(app.requestWriteAccess).toHaveBeenCalledTimes(1);
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P2' });
    await tick(0);
    expect(h.said.at(-1)).toBe('All set!');
  });

  it('never asked while the server has check-ins switched off (live: false), however due', async () => {
    telegram({ write: true });
    signals({ days: 2 });
    const checkins = withCheckins(prefs({ live: false }));
    const h = fakeHost({}, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'ok bye!' }));
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.play).not.toHaveBeenCalledWith({ op: 'askSeen', ask: 'P1' });
  });

  it('every moment switched off in "Choose moments" is a no: nothing is posted', async () => {
    telegram({ write: true });
    signals({ days: 2 });
    const checkins = withCheckins();
    const h = fakeHost({}, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'ok bye!' }));
    await tick(1500);
    const sheet = screen.getByRole('dialog', { name: 'Can Mochi check in now and then?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose moments' }));
    for (const sw of within(sheet).getAllByRole('switch') as HTMLInputElement[]) if (sw.checked) fireEvent.click(sw);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, check in' })); });
    expect(checkins).toHaveBeenCalledTimes(1);
    expect(h.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P1' });
  });

  it('Decisions\' ask: null means no ask this session; it never makes an ask due', async () => {
    telegram({ write: true });
    signals({ days: 2 });
    const checkins = withCheckins();
    const h = fakeHost({ suggest: { ask: null } }, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'ok bye!' }));
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
    // a hint for an ask that is not due shows nothing either
    const n = fakeHost({ suggest: { ask: 'P8' } }, { api: { checkins: withCheckins(prefs({ enabled: true })) } });
    render(<Asks host={n} />);
    await tick(0);
    await tick(60_000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Not now" is recorded, the pet is unbothered, nothing is turned on, and no other ask follows this session', async () => {
    telegram({ write: true });
    signals({ days: 3 });
    const checkins = withCheckins();
    const h = fakeHost({ stageUp: { from: 2, to: 3 } }, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'good night' }));
    await tick(1500);
    // P1 before P7 (the stage-up) and P8 (third day): one ask a session
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not now' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P1' });
    expect(checkins).toHaveBeenCalledTimes(1);
    expect(h.said).toEqual(['Okay! I’ll be right here.']);
    await tick(60_000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never while something owns the moment (a talk turn, a sheet, a game, a care animation), never asleep, never for a guest', async () => {
    signals({ days: 2 });
    const h = fakeHost({}, { api: { checkins: withCheckins() } });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'bye' }));
    h.state.talk = 'speaking';
    await tick(3000);
    expect(screen.queryByRole('dialog')).toBeNull();
    h.state.talk = 'idle';
    h.state.busy.add('game');
    await tick(3000);
    expect(screen.queryByRole('dialog')).toBeNull();
    h.state.busy.delete('game');
    act(() => h.fire({ type: 'care', action: 'feed' }));
    await tick(2000);
    expect(screen.queryByRole('dialog')).toBeNull();
    await tick(3000);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const guest = fakeHost({ role: 'guest' }, { api: { checkins: withCheckins() } });
    render(<Asks host={guest} />);
    act(() => guest.fire({ type: 'reply', saved: false, said: 'bye' }));
    await tick(5000);
    expect(guest.play).not.toHaveBeenCalled();
  });

  it('already on, or a server without the route: no P1', async () => {
    signals({ days: 2 });
    const on = fakeHost({}, { api: { checkins: withCheckins(prefs({ enabled: true })) } });
    render(<Asks host={on} />);
    const none = fakeHost();
    render(<Asks host={none} />);
    await tick(0);
    act(() => { on.fire({ type: 'reply', saved: false, said: 'bye' }); none.fire({ type: 'reply', saved: false, said: 'bye' }); });
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the paused note (§5.4)', () => {
  it('once per pause, when the server says it is due: "Yes, send them" resumes; not again for the same pause on this device', async () => {
    const checkins = withCheckins(prefs({ enabled: true, pausedAt: 1234, pausedNote: true }));
    const h = fakeHost({}, { api: { checkins } });
    const { unmount } = render(<Asks host={h} />);
    await tick(2000);
    const sheet = screen.getByRole('dialog', { name: 'I paused my messages since they weren’t landing. Want them back?' });
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes, send them', 'Keep paused']);
    expect(localStorage.getItem(PAUSED_KEY('a'))).toBe('1234');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, send them' })); });
    expect(checkins).toHaveBeenLastCalledWith('a', { op: 'resume' });
    expect(h.said).toEqual(['I promise to keep it short!']);
    unmount();
    const again = fakeHost({ checkins: prefs({ enabled: true, pausedAt: 1234, pausedNote: true }) });
    render(<Asks host={again} />);
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('read from the view when it carries the preferences (no extra GET); "Keep paused" is sent as such', async () => {
    const checkins = withCheckins();
    const h = fakeHost({ checkins: prefs({ enabled: true, pausedAt: 99, pausedNote: true }) }, { api: { checkins } });
    render(<Asks host={h} />);
    await tick(2000);
    expect(checkins).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep paused' })); });
    expect(checkins).toHaveBeenCalledWith('a', { op: 'keepPaused' });
    expect(h.said).toEqual([]);
  });

  it('a pause the server already showed (no pausedNote): no note', async () => {
    const h = fakeHost({ checkins: prefs({ enabled: true, pausedAt: 99 }) });
    render(<Asks host={h} />);
    await tick(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('?ci= replay (§5.1, S4)', () => {
  it('a stage-up check-in: the stage celebration (the hello is PetApp\'s to skip), then P7 can offer the card', async () => {
    const h = fakeHost({ checkin: { ref: 'r', momentId: 'C2' } });
    render(<Asks host={h} />);
    await tick(300);
    expect(h.engineFake.fire).toHaveBeenCalledWith({ type: 'celebrate', why: 'stage' });
    expect(h.engineFake.fire).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }));
    await tick(2000);
    expect(screen.getByRole('dialog', { name: 'Share Mochi’s moment?' })).toBeInTheDocument();
  });

  it('a bloom check-in opens the Garden on the bloom; a festival plays its greeting and records the celebration; a hello is a hello', async () => {
    const b = fakeHost({ checkin: { ref: 'r', momentId: 'C5' } });
    render(<Asks host={b} />);
    await tick(300);
    expect(b.setRoom).toHaveBeenCalledWith('garden');
    expect(roomIntent.bloom).toBe(true);
    const n = fakeHost({ checkin: { ref: 'r', momentId: 'C9' } });
    render(<Asks host={n} />);
    await tick(300);
    expect(n.said).toEqual(['Happy Nowruz! The haft-sin is set.']);
    expect(n.play).toHaveBeenCalledWith({ op: 'seasonCelebrated', season: 'nowruz' });
    const g = fakeHost({ checkin: { ref: 'r', momentId: 'C11' } });
    render(<Asks host={g} />);
    await tick(300);
    expect(g.setRoom).toHaveBeenCalledWith('play');
    expect(roomIntent.guess).toBe('resume');
    const hi = fakeHost({ checkin: { ref: 'r', momentId: 'C4' } });
    render(<Asks host={hi} />);
    await tick(300);
    expect(hi.engineFake.fire).toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }));
  });
});

describe('P7 share, P8 home screen, P9 favourites', () => {
  it('P7 after a bloom: Share opens Telegram\'s chat picker with the card\'s line (no chat content) and is recorded; Not now keeps it in the book', async () => {
    const app = telegram();
    const h = fakeHost();
    render(<Asks host={h} />);
    act(() => h.fire({ type: 'moment', kind: 'bloom' }));
    await tick(1500);
    const sheet = screen.getByRole('dialog', { name: 'Share Mochi’s moment?' });
    expect(sheet.textContent).toContain('Nothing from your chats.');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Share' })); });
    // the card's chunk (share.ts) loads on demand: wait for the import, not a timer, so a busy machine cannot race it
    await act(async () => { await vi.dynamicImportSettled(); });
    await tick(0);
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P7' });
    expect(app.openTelegramLink).toHaveBeenCalledWith(`https://t.me/share/url?url=${encodeURIComponent('https://t.me/b')}&text=${encodeURIComponent('Our seed bloomed.')}`);
    expect(h.said.at(-1)).toBe('Hope it makes them smile!');
  });

  it('P7 outside Telegram: the line is copied and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const h = fakeHost();
    render(<Asks host={h} />);
    act(() => h.fire({ type: 'moment', kind: 'stage' }));
    await tick(1500);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share' })); });
    await act(async () => { await vi.dynamicImportSettled(); });
    await tick(0);
    expect(writeText).toHaveBeenCalledWith('Mochi grew up a little');
    expect(screen.getByRole('status').textContent).toBe('Copied. Paste it anywhere.');
  });

  it('P8 on a third day when Telegram can add the shortcut and it is missing; P9 after several games on several days', async () => {
    const app = telegram({ home: 'missed' });
    signals({ days: 3 });
    const h = fakeHost();
    render(<Asks host={h} />);
    await tick(1500);
    const sheet = screen.getByRole('dialog', { name: 'Keep Mochi on your home screen?' });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add to home screen' })); });
    expect(app.addToHomeScreen).toHaveBeenCalled();
    expect(h.play).toHaveBeenCalledWith({ op: 'askAccepted', ask: 'P8' });

    localStorage.clear();
    telegram({ home: 'added' });
    signals({ days: 3, games: GAME_BIT.bop | GAME_BIT.starfall, gameDays: 3 });
    const p9 = fakeHost();
    render(<Asks host={p9} />);
    await tick(1500);
    expect(screen.queryByRole('dialog', { name: 'Keep Mochi on your home screen?' })).toBeNull();
    act(() => p9.fire({ type: 'round', ms: 30_000, zen: false, game: 'starfall' }));
    await tick(1500);
    const s9 = screen.getByRole('dialog', { name: 'Let Mochi learn which games you like?' });
    await act(async () => { fireEvent.click(within(s9).getByRole('button', { name: 'Keep it off' })); });
    expect(p9.play).toHaveBeenCalledWith({ op: 'askDeclined', ask: 'P9' });
    expect(p9.said.at(-1)).toBe('Okay, I’ll ask fresh each time.');
  });

  it('Persian: the P1 sheet in the catalogue\'s words, no Latin digits', async () => {
    signals({ days: 2 });
    const h = fakeHost({}, { api: { checkins: withCheckins() }, lang: 'fa' });
    render(<Asks host={h} />);
    await tick(0);
    act(() => h.fire({ type: 'reply', saved: false, said: 'خداحافظ' }));
    await tick(1500);
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('فعلاً نه');
    expect(sheet.textContent).not.toMatch(/[0-9]/);
  });
});
