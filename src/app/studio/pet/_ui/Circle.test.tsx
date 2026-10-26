import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetCircle, PetNotesResponse } from '@/lib/pet/types';
import type { PetApi } from './contract';
import { Circle } from './Circle';
import { PetError } from './errors';

const CODE = 'p_AbCdEf12_abcdefghijklmnopqrstuv';
const NOTICE = '🐾 Cookie can keep notes for this group: only things someone here asks to save. Adults (18+) only.';
const base = (over: Partial<PetCircle> = {}): PetCircle => ({
  chatTitle: 'HOOR family', agents: ['Cookie'], joined: 1, total: 2, on: false, myState: null,
  card: { copy: { notice: NOTICE, join: 'Join · 18+', reply: 'Only reply to me', decline: 'Not me' }, copyHash: 'a'.repeat(64), revision: 'gcard0000001', locale: 'en' }, ...over,
});
const NOTES: PetNotesResponse = {
  group: [{ copyId: 'a1-aaaaaaaaaaaa', text: 'Shiraz in May', savedAt: '2026-10-20T10:00:00.000Z', groupTitle: 'HOOR family' }],
  mine: [{ copyId: 'a1-bbbbbbbbbbbb', text: 'Tea with cardamom', savedAt: '2026-10-19T10:00:00.000Z', byMe: true }],
};

function fake(initial: PetCircle, fail?: PetError) {
  let circle = initial;
  const send = vi.fn(async (_agentId: string, method: string, action: string, body?: unknown): Promise<unknown> => {
    if (fail) throw fail;
    if (action.startsWith('circle?')) return circle;
    if (action === 'circle/decision') {
      const choice = (body as { choice: PetCircle['myState'] }).choice;
      circle = { ...circle, myState: choice, ...(choice === 'joined' ? { joined: 2, on: true, members: ['Reza'] } : { joined: 1, on: false }) };
      return circle;
    }
    if (action === 'circle/leave') { circle = { ...circle, myState: 'withdrawn', joined: 1, on: false }; return { left: true }; }
    if (action.startsWith('notes?')) return structuredClone(NOTES);
    if (method === 'DELETE') return { erased: true };
    throw new Error(`unexpected ${method} ${action}`);
  });
  const api = { get: vi.fn(), care: vi.fn(), talk: vi.fn(), talkVoice: vi.fn(), send } as unknown as PetApi;
  return { api, send };
}

function telegram(language_code?: string, allows_write_to_pm?: boolean) {
  const app = {
    initData: 'signed', initDataUnsafe: { user: { id: 1, first_name: 'Parastoo', ...(language_code ? { language_code } : {}), ...(allows_write_to_pm ? { allows_write_to_pm } : {}) }, start_param: CODE },
    requestWriteAccess: vi.fn((cb?: (ok: boolean) => void) => cb?.(true)),
    openTelegramLink: vi.fn(),
    showConfirm: vi.fn((_m: string, cb: (ok: boolean) => void) => cb(true)),
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
  return app;
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('the pet over a group (Circles S4)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete (window as { Telegram?: unknown }).Telegram; });

  it("opens the Join sheet by itself, once, for someone who never chose, with the group card's exact copy", async () => {
    telegram();
    const { send, api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    expect(send).toHaveBeenCalledWith('ag1', 'GET', `circle?code=${CODE}`, undefined);
    expect(screen.getByRole('button', { name: /Join group notes/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await flush(1500);
    const sheet = screen.getByRole('dialog', { name: 'HOOR family' });
    expect(sheet).toHaveTextContent(NOTICE);
    expect(['Join · 18+', 'Only reply to me', 'Not me'].map((name) => screen.getByRole('button', { name }))).toHaveLength(3);
    // Not now closes it; nothing opens it again by itself.
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    await flush(10_000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Join posts the card revision, hops with joy, asks Telegram for write access once, and never re-prompts', async () => {
    const app = telegram();
    const onJoy = vi.fn();
    const { send, api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={onJoy} />);
    await flush(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush();
    expect(send).toHaveBeenCalledWith('ag1', 'POST', 'circle/decision', { code: CODE, choice: 'joined', revision: 'gcard0000001', eventId: expect.stringMatching(/^[A-Za-z0-9_-]{8,40}$/) });
    expect(app.requestWriteAccess).toHaveBeenCalledTimes(1);
    await flush(400);
    expect(onJoy).toHaveBeenCalledWith('bond');
    expect(screen.getByRole('button', { name: /2 of 2 here/ })).toHaveAttribute('data-joy');
    await flush(1500);
    // Everyone's in: the full-house sparkle.
    expect(onJoy).toHaveBeenLastCalledWith('win');
    await flush(20_000);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(send.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
  });

  it('after a choice the sheet opens only when tapped, and says what was chosen', async () => {
    telegram();
    const { api } = fake(base({ myState: 'declined' }));
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Group notes/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You chose: Not me');
    expect(screen.getByRole('button', { name: 'Not me' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('My notes: polaroids by section, the other joined by first name, Erase removes only that copy, Leave asks first', async () => {
    const app = telegram();
    const { send, api } = fake(base({ myState: 'joined', joined: 2, on: true, members: ['Reza'] }));
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /2 of 2 here/ }));
    await flush();
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('Here with Reza');
    expect(screen.getByRole('region', { name: 'From this group' })).toHaveTextContent('Shiraz in May');
    expect(screen.getByRole('region', { name: 'My notes' })).toHaveTextContent('Tea with cardamom');
    expect(screen.getByRole('region', { name: 'My notes' })).toHaveTextContent('saved by you');
    fireEvent.click(screen.getAllByRole('button', { name: 'Erase' })[0]);
    await flush();
    expect(app.showConfirm).toHaveBeenCalledWith('Erase your copy of this note? Everyone else keeps theirs.', expect.any(Function));
    expect(send).toHaveBeenCalledWith('ag1', 'DELETE', 'notes/a1-aaaaaaaaaaaa', undefined);
    expect(screen.queryByText('Shiraz in May')).toBeNull();
    expect(screen.getByText('Tea with cardamom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave group notes' }));
    await flush(400);
    expect(app.showConfirm).toHaveBeenLastCalledWith(expect.stringContaining("Notes saved while you were here stay with everyone who was here."), expect.any(Function));
    expect(send).toHaveBeenCalledWith('ag1', 'POST', 'circle/leave', { code: CODE });
    expect(screen.getByRole('status')).toHaveTextContent("You're out of this group's notes.");
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('someone not in the group gets one quiet line and nothing about it; Circles off shows nothing at all', async () => {
    telegram();
    const { api } = fake(base(), new PetError(403, 'circle_not_member', 'no'));
    const { container, unmount } = render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent("This link is for a group you're not in.");
    expect(container.textContent).not.toContain('HOOR');
    await flush(5000);
    expect(container.textContent).toBe('');
    unmount();
    const off = fake(base(), new PetError(404, 'circle_unavailable', 'off'));
    const again = render(<Circle api={off.api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(3000);
    expect(again.container.textContent).toBe('');
  });

  it('a card that changed meanwhile is shown fresh, with a note, never retried silently', async () => {
    telegram();
    const { api, send } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    send.mockImplementationOnce(async () => { throw new PetError(409, 'circle_stale', 'stale'); });
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('The card just changed. Here is the newest one.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(send.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
  });

  it('speaks Persian to a Persian Telegram (the notice stays the card’s own copy)', async () => {
    telegram('fa');
    const { api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    expect(screen.getByRole('button', { name: /پیوستن به یادداشت‌های گروه/ })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('dialog')).toHaveTextContent(NOTICE);
    expect(screen.getByRole('button', { name: 'الان نه' })).toBeInTheDocument();
  });

  it('a tap before the auto-open cancels it: no sheet slides up again after a quick choice', async () => {
    telegram();
    const { api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Join group notes/ }));
    await flush(100);
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush(400);
    expect(screen.queryByRole('dialog')).toBeNull();
    await flush(1500);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Opening and dismissing before it fires cancels it too.
    const other = fake(base());
    const again = render(<Circle api={other.api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    fireEvent.click(again.getAllByRole('button', { name: /Join group notes/ }).at(-1)!);
    fireEvent.click(again.getByRole('button', { name: 'Not now' }));
    await flush(3000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("opened through the manager bot (dm set), Join never asks write access for it: it offers the agent's own DM", async () => {
    const app = telegram();
    const { api } = fake(base({ dm: { bot: 'CookieBot', name: 'Cookie' } }));
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush(400);
    expect(app.requestWriteAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '📌 Get your copies in Cookie’s chat' }));
    expect(app.openTelegramLink).toHaveBeenCalledWith('https://t.me/CookieBot');
    expect(screen.queryByRole('button', { name: /Get your copies/ })).toBeNull();
    // The notes sheet keeps the way there.
    fireEvent.click(screen.getByRole('button', { name: /2 of 2 here/ }));
    await flush();
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('button', { name: '📌 Get your copies in Cookie’s chat' }));
  });

  it('the agent\'s own Mini App asks write access only when the bot may not message them yet', async () => {
    const app = telegram(undefined, true);
    const { api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush(400);
    expect(app.requestWriteAccess).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Get your copies/ })).toBeNull();
  });

  it('a failing first load retries twice, then the halo offers a retry; circle_* refusals are never retried', async () => {
    telegram();
    const { api, send } = fake(base());
    const network = () => { throw new PetError(0, 'network', 'offline'); };
    send.mockImplementationOnce(async () => network()).mockImplementationOnce(async () => network()).mockImplementationOnce(async () => network());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    expect(screen.queryByRole('button')).toBeNull();
    await flush(1200 + 3600);
    expect(send).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: /Group notes · tap to retry/ }));
    await flush();
    expect(screen.getByRole('button', { name: /Join group notes/ })).toBeInTheDocument();
    const refused = fake(base(), new PetError(404, 'circle_unavailable', 'off'));
    render(<Circle api={refused.api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(10_000);
    expect(refused.send).toHaveBeenCalledTimes(1);
  });

  it('notes load behind a placeholder; a store failure says so in the sheet', async () => {
    telegram();
    const { api, send } = fake(base({ myState: 'joined', joined: 2, on: true }));
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    let release: (v: PetNotesResponse) => void = () => undefined;
    send.mockImplementationOnce(() => new Promise((r) => { release = r as typeof release; }));
    fireEvent.click(screen.getByRole('button', { name: /2 of 2 here/ }));
    await flush();
    expect(document.querySelectorAll('.pc-ghost')).toHaveLength(2);
    await act(async () => { release(structuredClone(NOTES)); });
    expect(document.querySelectorAll('.pc-ghost')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush(300);
    send.mockImplementationOnce(async () => { throw new PetError(503, 'circle_failed', 'store'); });
    fireEvent.click(screen.getByRole('button', { name: /2 of 2 here/ }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("That didn't work. Try again?");
  });

  it.each([['en', 'Your notes open in Vox now: tap ⋯, then Settings.'], ['fa', 'یادداشت‌هایتان حالا در وکس باز می‌شوند: ⋯ و بعد «تنظیمات» را بزنید.']])
  ('agent-signed notes are refused (circle_use_vox): the sheet points to Vox, in %s', async (lang, line) => {
    telegram(lang);
    const { api, send } = fake(base({ myState: 'joined', joined: 2, on: true }));
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush();
    send.mockImplementationOnce(async () => { throw new PetError(403, 'circle_use_vox', 'vox'); });
    fireEvent.click(screen.getByRole('button', { name: lang === 'fa' ? /۲ از ۲ اینجا/ : /2 of 2 here/ }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(line);
  });

  it.each([['en', 'Close and reopen me to choose here.'], ['fa', 'برای انتخاب اینجا، مرا ببندید و دوباره باز کنید.']])
  ('a choice past the 1 h window (401 session_expired) asks to reopen, in %s, and the sheet stays', async (lang, line) => {
    telegram(lang);
    const { api, send } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    send.mockImplementationOnce(async () => { throw new PetError(401, 'session_expired', 'expired'); });
    // the buttons are the group card's own copy (English here), the explanation follows the person's language
    fireEvent.click(screen.getByRole('button', { name: 'Join · 18+' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(line);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a sheet takes focus when it opens (even by itself) and gives it back to the halo when it closes', async () => {
    telegram();
    const { api } = fake(base());
    render(<Circle api={api} agentId="ag1" code={CODE} onJoy={vi.fn()} />);
    await flush(1500);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'HOOR family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush(300);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Join group notes/ }));
  });
});
