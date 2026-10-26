import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PetPlayView } from '@/lib/pet/play';
import { emptyPlay, fakeHost } from '../host.fixture';
import { PetError } from '../errors';
import { loadStrings, t } from '../strings';
import ClosetRoom, { PAGE, slotItems } from './ClosetRoom';

const DIGITS = /[0-9۰-۹]/;
beforeAll(async () => { await loadStrings('en'); await loadStrings('fa'); });
afterEach(() => { vi.unstubAllGlobals(); delete (window as { Telegram?: unknown }).Telegram; });

const grid = () => within(screen.getByRole('tabpanel'));

describe('Closet (design §4.3, S11)', () => {
  it('Your closet: the head slot first, earned keepsakes before the free accessories, six a page with dots, no digits', () => {
    const play = emptyPlay({ items: [{ id: 'pomegranateCrown', earnedAt: 1 }] });
    expect(slotItems(play, 'head')[0]).toBe('pomegranateCrown');
    const h = fakeHost({ play, role: 'member' });
    const { container } = render(<ClosetRoom id="closet" host={h} />);
    // a member sees only their own closet: no "{name}'s look" tab
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Your closet']);
    expect(grid().getAllByRole('button')).toHaveLength(PAGE);
    expect(grid().getAllByRole('button')[0].textContent).toBe('Pomegranate crown');
    expect(container.querySelectorAll('.pet-dots i')).toHaveLength(2);
    expect(container.textContent).not.toMatch(DIGITS);
  });

  it('a locked keepsake is a silhouette that says how it is earned (never a price); it cannot be worn', async () => {
    const h = fakeHost({ role: 'member' });
    render(<ClosetRoom id="closet" host={h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Neck' }));
    const locked = grid().getByRole('button', { name: 'Bloom pin: Bloom a seed together' });
    expect(locked).toHaveAttribute('data-locked');
    expect(grid().getByRole('button', { name: 'Spark scarf: Arrives with Chaharshanbe Suri' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(locked); });
    expect(h.play).not.toHaveBeenCalled();
  });

  it('trying one on: the wear op (this screen only), the overlay on the character, the mirror and a line in its voice; again takes it off', async () => {
    const h = fakeHost({ role: 'member' });
    const setWearing = vi.fn();
    Object.assign(h.engineFake, { setWearing });
    render(<ClosetRoom id="closet" host={h} />);
    const worn: PetPlayView = emptyPlay({ wearing: { head: 'beret' } });
    (h.play as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { h.state.view = { ...h.state.view!, play: worn }; return { play: worn, now: 0 }; });
    await act(async () => { fireEvent.click(grid().getByRole('button', { name: 'Beret' })); });
    expect(h.play).toHaveBeenCalledWith({ op: 'wear', slot: 'head', item: 'beret' });
    expect(setWearing).toHaveBeenLastCalledWith({ head: 'beret' });
    expect(h.engineFake.roomReact).toHaveBeenCalledWith('admire');
    const tryOn = vi.fn();
    Object.assign(h.engineFake, { tryOn });
    (h.play as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ play: emptyPlay({ wearing: { head: 'cap' } }), now: 0 }));
    await act(async () => { fireEvent.click(grid().getByRole('button', { name: 'Cap' })); });
    expect(tryOn).toHaveBeenCalledWith('cap');
    expect(['Does it suit me?', 'How’s this? Do I look nice?']).toContain(h.said.at(-1));
    // the creator's real look is never touched by the overlay
    expect(h.state.view!.look).toEqual({});
  });

  it('the creator\'s tab edits the real look through the pet\'s own look route (POST …/look), only after the "photo for everyone" sheet', async () => {
    const look = vi.fn(async () => ({ look: { hue: 'lagoon', accessory: 'cap' } as never }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const h = fakeHost({ role: 'owner', canEditLook: true, look: { hue: 'lagoon', accessory: 'none' } as never }, { api: { look } });
    h.patch = vi.fn();
    const setLook = vi.fn();
    Object.assign(h.engineFake, { setLook });
    render(<ClosetRoom id="closet" host={h} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mochi’s look' }));
    expect(grid().getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(grid().getByRole('button', { name: 'Cap' }));
    const sheet = screen.getByRole('dialog', { name: 'This changes Mochi’s photo for everyone.' });
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save for everyone', 'Cancel']);
    expect(look).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Save for everyone' })); });
    expect(look).toHaveBeenCalledWith('a', { look: { accessory: 'cap' } }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // never Studio's own route (its initData is the manager bot's, not this agent's)
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledWith({ look: { hue: 'lagoon', accessory: 'cap' } });
    expect(setLook).toHaveBeenCalledWith({ hue: 'lagoon', accessory: 'cap' }, 3);
    expect(h.play).not.toHaveBeenCalled();
  });

  it('Cancel saves nothing; a refusal says where the look is changed (look_forbidden: admins only), and never ends the pet', async () => {
    const look = vi.fn(async () => { throw new PetError(401, 'session_expired', 'session_expired'); });
    const h = fakeHost({ role: 'owner', canEditLook: true }, { api: { look } });
    render(<ClosetRoom id="closet" host={h} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mochi’s look' }));
    fireEvent.click(grid().getByRole('button', { name: 'Beret' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(look).not.toHaveBeenCalled();
    fireEvent.click(grid().getByRole('button', { name: 'Beret' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save for everyone' })); });
    expect(screen.getByRole('status').textContent).toBe('Change Mochi’s look in Vox Studio.');
    look.mockImplementationOnce(async () => { throw new PetError(403, 'look_forbidden', 'look_forbidden'); });
    fireEvent.click(grid().getByRole('button', { name: 'Cap' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save for everyone' })); });
    expect(screen.getByRole('status').textContent).toBe(t('closet.adminOnly', undefined, 'en'));
  });

  it('the look tab follows view.canEditLook only: an owner without it, or a member, sees just their closet', () => {
    const h = fakeHost({ role: 'owner', canEditLook: false });
    const { unmount } = render(<ClosetRoom id="closet" host={h} />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    unmount();
    render(<ClosetRoom id="closet" host={fakeHost({ role: 'member', canEditLook: true })} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('opened over a group (talk in the DM): no look tab, even for the creator', () => {
    const h = fakeHost({ role: 'owner', canEditLook: true, talkInDm: true });
    render(<ClosetRoom id="closet" host={h} />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });
});
