import { act, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookKey } from '@/lib/studio/character';
import { ApiError, type AgentView } from '../../_lib/client';
import { PhotoPicker, generateCopy } from './PhotoPicker';

const state = vi.hoisted(() => ({
  agent: vi.fn(), generateAvatars: vi.fn(), chooseAvatar: vi.fn(), syncProfile: vi.fn(), uploadAvatar: vi.fn(),
  nav: { me: { features: { avatars: true } }, snack: vi.fn(), toast: vi.fn() },
}));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, generateAvatars: state.generateAvatars, chooseAvatar: state.chooseAvatar,
    syncProfile: state.syncProfile, uploadAvatar: state.uploadAvatar } };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}));

const LOOK = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } } as const;

function agent(overrides: Partial<AgentView> = {}, look: Partial<AgentView['look']> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'active', stage: 3,
    persona: { name: 'Nova', role: 'Designer' },
    look: { ...LOOK, avatar: 'av-old.jpg', avatarSource: 'generated', avatarVariants: ['av-old.jpg'], ...look },
    bot: { username: 'nova_bot' }, profileSync: { status: 'synced', failed: [] },
    locked: false, formingDay: 3, canEdit: true, canEditLook: true, canManageAccess: true,
    ...overrides,
  } as AgentView;
}

/** A screen that owns the agent, like LookStep / LookSheet hosts. */
function Host({ initial, onChange }: { initial: AgentView; onChange?: (a: AgentView) => void }) {
  const [a, setA] = useState(initial);
  return <PhotoPicker agent={a} onUpdate={(next) => { setA(next); onChange?.(next); }} />;
}

const withVariants = (base: AgentView, files: string[], extra: Partial<AgentView> = {}): AgentView =>
  ({ ...base, ...extra, look: { ...base.look, avatarVariants: [...files, ...(base.look.avatarVariants ?? [])] } });

/** Only this file's mocks: resetAllMocks would also wipe the shared matchMedia stub framer-motion reads. */
const resetMocks = () => { for (const fn of [state.agent, state.syncProfile, state.chooseAvatar, state.generateAvatars, state.nav.snack, state.nav.toast, ...[state.uploadAvatar]]) fn.mockReset(); };

beforeEach(() => {
  vi.useFakeTimers();
  resetMocks();
  state.nav.me.features.avatars = true;
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

const tiles = () => within(screen.getByRole('radiogroup', { name: /telegram photo/i })).getAllByRole('radio');

describe('PhotoPicker generate', () => {
  it('draws two portraits with select:false, chooses the newest once, then offers Undo when Telegram has it', async () => {
    const base = agent();
    let landA!: (v: { agent: AgentView }) => void;
    let landB!: (v: { agent: AgentView }) => void;
    state.generateAvatars.mockReturnValueOnce(new Promise((r) => { landA = r; })).mockReturnValueOnce(new Promise((r) => { landB = r; }));
    const chosen = { ...withVariants(base, ['av-b.jpg', 'av-a.jpg']), profileSync: { status: 'pending' as const, failed: [] } };
    chosen.look = { ...chosen.look, avatar: 'av-b.jpg' };
    state.chooseAvatar.mockResolvedValueOnce({ agent: chosen });
    state.agent.mockResolvedValueOnce({ agent: { ...chosen, profileSync: { status: 'synced', failed: [] } } });
    render(<Host initial={base} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 more portraits/i })); });
    expect(state.generateAvatars).toHaveBeenCalledTimes(2);
    expect(state.generateAvatars).toHaveBeenNthCalledWith(1, base.id, 1, { select: false });
    expect(state.generateAvatars).toHaveBeenNthCalledWith(2, base.id, 1, { select: false });
    expect(screen.getAllByRole('img', { name: /drawing portrait/i })).toHaveLength(2);
    expect(screen.getByText('Gathering mist…')).toBeInTheDocument();
    // Every tile waits while portraits are drawn
    for (const t of tiles()) expect(t).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toHaveAttribute('aria-disabled', 'true');

    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByText('Still painting, almost there…')).toBeInTheDocument();

    await act(async () => { landA({ agent: withVariants(base, ['av-a.jpg']) }); });
    expect(screen.getByText('1 of 2 ready')).toBeInTheDocument();
    expect(state.chooseAvatar).not.toHaveBeenCalled();
    await act(async () => { landB({ agent: withVariants(base, ['av-b.jpg', 'av-a.jpg']) }); });

    expect(state.chooseAvatar).toHaveBeenCalledTimes(1);
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, 'av-b.jpg');
    expect(screen.getByText('Updating Telegram…')).toBeInTheDocument();
    expect(state.nav.snack).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Updated in Telegram')).toBeInTheDocument();
    expect(state.nav.snack).toHaveBeenCalledTimes(1);
    const snack = state.nav.snack.mock.calls[0][0];
    expect(snack).toMatchObject({ message: 'Telegram photo updated', action: { label: 'Undo' } });
    expect(tiles().find((t) => t.getAttribute('aria-checked') === 'true')).toHaveAccessibleName('Portrait');

    // Undo puts the previous photo back
    state.chooseAvatar.mockResolvedValueOnce({ agent: { ...chosen, look: { ...chosen.look, avatar: 'av-old.jpg' }, profileSync: { status: 'synced', failed: [] } } });
    await act(async () => { snack.action.run(); });
    expect(state.chooseAvatar).toHaveBeenLastCalledWith(base.id, 'av-old.jpg');
    expect(state.nav.snack).toHaveBeenCalledTimes(1);
  });

  it('shows a countdown from retryAfter on 429 and keeps Generate off until it ends', async () => {
    state.generateAvatars.mockRejectedValue(new ApiError(429, 'Too many requests.', 125));
    render(<Host initial={agent()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 more portraits/i })); });
    const button = screen.getByRole('button', { name: /next portrait in 2:05/i });
    expect(button).toBeDisabled();
    expect(state.chooseAvatar).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('button', { name: /next portrait in 2:00/i })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(121_000); });
    expect(screen.getByRole('button', { name: /draw 2 more portraits/i })).toBeEnabled();
  });

  it('hides Generate when the server has no image generation (503)', async () => {
    state.generateAvatars.mockRejectedValue(new ApiError(503, 'Avatar generation needs OPENAI_API_KEY.'));
    render(<Host initial={agent()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 more portraits/i })); });
    expect(screen.queryByRole('button', { name: /portraits/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENAI/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).not.toHaveAttribute('aria-disabled');
  });

  it('reports a failed batch inline with Retry', async () => {
    state.generateAvatars.mockRejectedValue(new Error('Image model refused.'));
    render(<Host initial={agent()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 more portraits/i })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t draw new portraits. Image model refused.');
    state.generateAvatars.mockClear();
    await act(async () => { fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })); });
    expect(state.generateAvatars).toHaveBeenCalledTimes(2);
  });

  it('on a draft, chooses the newest and offers Undo right away', async () => {
    const base = agent({ status: 'draft', profileSync: undefined, bot: undefined }, { avatar: undefined, avatarVariants: [] });
    state.generateAvatars
      .mockResolvedValueOnce({ agent: withVariants(base, ['av-a.jpg']) })
      .mockResolvedValueOnce({ agent: withVariants(base, ['av-b.jpg', 'av-a.jpg']) });
    state.chooseAvatar.mockResolvedValueOnce({ agent: { ...withVariants(base, ['av-b.jpg', 'av-a.jpg']), look: { ...base.look, avatar: 'av-b.jpg', avatarVariants: ['av-b.jpg', 'av-a.jpg'] } } });
    render(<Host initial={base} />);
    expect(screen.getByText(/becomes the bot photo when you hire nova/i)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 portraits/i })); });
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, 'av-b.jpg');
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Using the newest portrait', action: expect.objectContaining({ label: 'Undo' }) }));
    state.chooseAvatar.mockResolvedValueOnce({ agent: base });
    await act(async () => { state.nav.snack.mock.calls[0][0].action.run(); });
    expect(state.chooseAvatar).toHaveBeenLastCalledWith(base.id, null);
  });
});

describe('PhotoPicker after the sheet closes', () => {
  it('unmounting mid-generation still chooses the newest portrait and hands the agent to the parent', async () => {
    const base = agent();
    let landA!: (v: { agent: AgentView }) => void;
    let landB!: (v: { agent: AgentView }) => void;
    state.generateAvatars.mockReturnValueOnce(new Promise((r) => { landA = r; })).mockReturnValueOnce(new Promise((r) => { landB = r; }));
    const chosen = { ...withVariants(base, ['av-b.jpg', 'av-a.jpg']), profileSync: { status: 'pending' as const, failed: [] } };
    chosen.look = { ...chosen.look, avatar: 'av-b.jpg' };
    state.chooseAvatar.mockResolvedValueOnce({ agent: chosen });
    const onChange = vi.fn();
    const { unmount } = render(<Host initial={base} onChange={onChange} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /draw 2 more portraits/i })); });
    unmount(); // Done / swipe-down / Next while the portraits form
    await act(async () => { landA({ agent: withVariants(base, ['av-a.jpg']) }); });
    await act(async () => { landB({ agent: withVariants(base, ['av-b.jpg', 'av-a.jpg']) }); });
    expect(state.chooseAvatar).toHaveBeenCalledTimes(1);
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, 'av-b.jpg');
    expect(onChange).toHaveBeenLastCalledWith(chosen);
    // The picker is gone, so the snack (with Undo) comes now rather than after the sync poll.
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Using the newest portrait', action: expect.objectContaining({ label: 'Undo' }) }));
    const reverted = { ...chosen, look: { ...chosen.look, avatar: 'av-old.jpg' } };
    state.chooseAvatar.mockResolvedValueOnce({ agent: reverted });
    await act(async () => { state.nav.snack.mock.calls[0][0].action.run(); });
    expect(state.chooseAvatar).toHaveBeenLastCalledWith(base.id, 'av-old.jpg');
    expect(onChange).toHaveBeenLastCalledWith(reverted);
  });

  it('Undo from the snack after the sheet closed updates the parent too', async () => {
    const base = agent({}, { avatarVariants: ['av-new.jpg', 'av-old.jpg'] });
    const changed = { ...base, look: { ...base.look, avatar: 'av-new.jpg' } };
    state.chooseAvatar.mockResolvedValueOnce({ agent: changed });
    const onChange = vi.fn();
    const { unmount } = render(<Host initial={base} onChange={onChange} />);
    await act(async () => { fireEvent.click(tiles()[1]); });
    const snack = state.nav.snack.mock.calls[0][0];
    expect(snack).toMatchObject({ message: 'Telegram photo updated', action: { label: 'Undo' } });
    unmount();
    state.chooseAvatar.mockResolvedValueOnce({ agent: base });
    await act(async () => { snack.action.run(); });
    expect(state.chooseAvatar).toHaveBeenLastCalledWith(base.id, 'av-old.jpg');
    expect(onChange).toHaveBeenLastCalledWith(base);
  });
});

describe('PhotoPicker tiles', () => {
  it('is one tab stop; arrows move focus without choosing, and focus stays put while a choice saves', async () => {
    const base = agent({}, { avatarVariants: ['av-new.jpg', 'av-old.jpg'] });
    let land!: (v: { agent: AgentView }) => void;
    state.chooseAvatar.mockReturnValueOnce(new Promise((r) => { land = r; }));
    render(<Host initial={base} />);
    const [character, newer, older] = tiles();
    expect(older).toHaveAttribute('aria-checked', 'true');
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    older.focus();
    fireEvent.keyDown(older, { key: 'ArrowRight' });
    expect(character).toHaveFocus(); // wraps
    fireEvent.keyDown(character, { key: 'ArrowRight' });
    expect(newer).toHaveFocus();
    expect(state.chooseAvatar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(newer); });
    expect(newer).toHaveFocus();
    expect(newer).not.toBeDisabled();
    await act(async () => { land({ agent: { ...base, look: { ...base.look, avatar: 'av-new.jpg' } } }); });
    expect(newer).toHaveFocus();
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('commits a tapped tile immediately and disables every tile while it is in flight', async () => {
    const base = agent({}, { avatarVariants: ['av-new.jpg', 'av-old.jpg'] });
    let land!: (v: { agent: AgentView }) => void;
    state.chooseAvatar.mockReturnValueOnce(new Promise((r) => { land = r; }));
    render(<Host initial={base} />);
    const [character, newer] = tiles();
    expect(character).toHaveAccessibleName('Character · grows with Nova');
    await act(async () => { fireEvent.click(newer); });
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, 'av-new.jpg');
    expect(newer).toHaveAttribute('aria-checked', 'true'); // optimistic ring
    for (const t of tiles()) expect(t).toHaveAttribute('aria-disabled', 'true');
    // Tapping another tile while one saves does nothing
    await act(async () => { fireEvent.click(tiles()[0]); });
    expect(state.chooseAvatar).toHaveBeenCalledTimes(1);
    await act(async () => { land({ agent: { ...base, look: { ...base.look, avatar: 'av-new.jpg' } } }); });
    for (const t of tiles()) expect(t).not.toHaveAttribute('aria-disabled');
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Telegram photo updated' }));
  });

  it('reverts the optimistic choice on failure and retries inline', async () => {
    const base = agent({}, { avatarVariants: ['av-new.jpg', 'av-old.jpg'] });
    state.chooseAvatar.mockRejectedValueOnce(new Error('Network down'));
    render(<Host initial={base} />);
    await act(async () => { fireEvent.click(tiles()[1]); });
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(tiles().find((t) => t.getAttribute('aria-checked') === 'true')).toHaveAccessibleName('Portrait');
    expect(tiles()[2]).toHaveAttribute('aria-checked', 'true');
    state.chooseAvatar.mockResolvedValueOnce({ agent: { ...base, look: { ...base.look, avatar: 'av-new.jpg' } } });
    await act(async () => { fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })); });
    expect(state.chooseAvatar).toHaveBeenLastCalledWith(base.id, 'av-new.jpg');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks portraits from an older look and sinks them below current ones', () => {
    const current = lookKey(LOOK);
    const base = agent({}, { avatar: 'av-1.jpg', avatarVariants: ['av-1.jpg', 'av-2.jpg'], avatarLooks: { 'av-1.jpg': 'older', 'av-2.jpg': current } });
    render(<Host initial={base} />);
    const [, first, second] = tiles();
    expect(first).toHaveAccessibleName('Portrait');
    expect(second).toHaveAccessibleName('Portrait · old look');
    expect(within(second).getByText('Old look')).toBeInTheDocument();
  });
});

describe('PhotoPicker stale photo', () => {
  it('active: the status row offers Regenerate and Use character', async () => {
    const base = agent({}, { avatarStale: true });
    state.chooseAvatar.mockResolvedValueOnce({ agent: { ...base, look: { ...base.look, avatar: undefined, avatarStale: false } } });
    state.generateAvatars.mockResolvedValue({ agent: base });
    render(<Host initial={base} />);
    expect(screen.getByText('Photo out of date')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use character' })); });
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, null);
    cleanup();
    render(<Host initial={base} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })); });
    expect(state.generateAvatars).toHaveBeenCalledWith(base.id, 1, { select: false });
  });

  it('draft: a note offers the same two actions', async () => {
    const base = agent({ status: 'draft', profileSync: undefined }, { avatarStale: true });
    state.generateAvatars.mockResolvedValue({ agent: base });
    state.chooseAvatar.mockResolvedValueOnce({ agent: { ...base, look: { ...base.look, avatar: undefined, avatarStale: false } } });
    render(<Host initial={base} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('This portrait was drawn from an older look.');
    await act(async () => { fireEvent.click(within(note).getByRole('button', { name: 'Regenerate' })); });
    expect(state.generateAvatars).toHaveBeenCalledTimes(2);
    expect(state.generateAvatars).toHaveBeenCalledWith(base.id, 1, { select: false });
    cleanup();
    render(<Host initial={base} />);
    await act(async () => { fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'Use character' })); });
    expect(state.chooseAvatar).toHaveBeenCalledWith(base.id, null);
  });
});

describe('PhotoPicker upload', () => {
  it('uploads through the + tile and offers Undo', async () => {
    const base = agent({ status: 'draft', profileSync: undefined });
    state.uploadAvatar.mockResolvedValueOnce({ agent: { ...withVariants(base, ['up-1.jpg']), look: { ...base.look, avatar: 'up-1.jpg', avatarVariants: ['up-1.jpg', 'av-old.jpg'] } } });
    const { container } = render(<Host initial={base} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(state.uploadAvatar).toHaveBeenCalledWith(base.id, file);
    expect(state.chooseAvatar).not.toHaveBeenCalled();
    expect(state.nav.snack).toHaveBeenCalledWith(expect.objectContaining({ message: 'Using your photo' }));
  });
});

describe('generateCopy', () => {
  it('rotates, then holds', () => {
    expect(generateCopy(0, 'Nova')).toBe('Gathering mist…');
    expect(generateCopy(3.5, 'Nova')).toBe('Finding Nova’s smile…');
    expect(generateCopy(6.5, 'Nova', 'headset')).toBe('Fitting the headset…');
    expect(generateCopy(6.5, 'Nova', 'none')).toBe('Adding the soft vinyl finish…');
    expect(generateCopy(20, 'Nova')).toBe('Still painting, almost there…');
    expect(generateCopy(50, 'Nova')).toBe('Taking longer than usual · keep this open');
  });
});
