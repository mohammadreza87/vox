import { act, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { AgentHero, formingProgress } from './AgentHero';

const state = vi.hoisted(() => ({
  agent: vi.fn(), syncProfile: vi.fn(), chooseAvatar: vi.fn(), generateAvatars: vi.fn(), setLook: vi.fn(),
  nav: { me: { features: { avatars: true } }, snack: vi.fn(), toast: vi.fn(), locale: 'en' as 'en' | 'fa' },
}));

vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, syncProfile: state.syncProfile, chooseAvatar: state.chooseAvatar, generateAvatars: state.generateAvatars, setLook: state.setLook } };
});

vi.mock('../../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}));

function agent(overrides: Partial<AgentView> = {}, look: Partial<AgentView['look']> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'active', stage: 4,
    persona: { name: 'Nova', role: 'Designer' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true }, avatar: 'av-1.jpg', avatarVariants: ['av-1.jpg'], ...look },
    bot: { username: 'nova_bot' }, profileSync: { status: 'synced', failed: [] },
    locked: true, formingDay: null, isAdmin: false, canEdit: false, canEditLook: true, canManageAccess: true, canFire: false,
    ...overrides,
  } as AgentView;
}

function Host({ initial, onRetryProfile }: { initial: AgentView; onRetryProfile?: () => void }) {
  const [a, setA] = useState(initial);
  return <AgentHero agent={a} onUpdate={setA} onRetryProfile={onRetryProfile} />;
}

/** Only this file's mocks: resetAllMocks would also wipe the shared matchMedia stub framer-motion reads. */
const resetMocks = () => { for (const fn of [state.agent, state.syncProfile, state.chooseAvatar, state.generateAvatars, state.nav.snack, state.nav.toast, state.setLook]) fn.mockReset(); };

beforeEach(() => { vi.useFakeTimers(); resetMocks(); state.nav.me.features.avatars = true; });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); window.localStorage.clear(); });

describe('AgentHero Telegram row', () => {
  it('shows the live character as the face and the bot photo in the status row', () => {
    render(<Host initial={agent()} />);
    expect(screen.getByRole('heading', { name: 'Nova' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Telegram photo · up to date');
    const photos = screen.getAllByRole('img').filter((el) => el.tagName === 'IMG');
    expect(photos).toHaveLength(1); // only the 28 px Telegram photo is a picture; the hero is the vector character
    expect(photos[0]).toHaveAccessibleName('Nova in Telegram');
  });

  it('a refused photo shows the inline error; Retry force-pushes the profile', async () => {
    const failed = agent({ profileSync: { status: 'error', failed: ['photo'] } });
    state.syncProfile.mockResolvedValueOnce({ agent: agent(), failed: [] });
    render(<Host initial={failed} />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t update the photo');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(state.syncProfile).toHaveBeenCalledWith(failed.id);
    expect(screen.getByRole('status')).toHaveTextContent('Updated in Telegram');
  });

  it('uses the screen’s retry when it passes one', async () => {
    const onRetryProfile = vi.fn();
    render(<Host initial={agent({ profileSync: { status: 'error', failed: ['photo'] } })} onRetryProfile={onRetryProfile} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(onRetryProfile).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).not.toHaveBeenCalled();
  });

  it('a name-only failure reads neutral, never as a photo error', () => {
    render(<Host initial={agent({ profileSync: { status: 'error', failed: ['name'] } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Telegram profile still updating');
    expect(screen.getByRole('status')).not.toHaveTextContent(/photo/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers no repair to a viewer who can’t edit or manage', () => {
    render(<Host initial={agent({ canEdit: false, canManageAccess: false, profileSync: { status: 'error', failed: ['photo'] } })} />);
    expect(screen.queryByRole('button', { name: 'Retry Telegram profile' })).not.toBeInTheDocument();
  });

  it('a locked agent with an outdated photo opens the look sheet when the look may change', async () => {
    state.generateAvatars.mockRejectedValue(new Error('offline'));
    render(<Host initial={agent({}, { avatarStale: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Photo out of date');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update' })); });
    const sheet = screen.getByRole('dialog', { name: 'Nova’s look' });
    await tick(0);
    expect(within(sheet).getByRole('button', { name: 'Regenerate' })).toBeEnabled();
    state.chooseAvatar.mockResolvedValueOnce({ agent: agent({}, { avatar: undefined, avatarStale: false }) });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Use character' })); });
    expect(state.chooseAvatar).toHaveBeenCalledWith('fixture-agent', null);
  });

  it('without canEditLook there is no way into the look sheet', () => {
    render(<Host initial={agent({ canEditLook: false }, { avatarStale: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Photo out of date');
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drafts have no Telegram row', () => {
    render(<Host initial={agent({ status: 'draft', bot: undefined, profileSync: undefined })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('AgentHero look after the lock (D3)', () => {
  it('a locked agent with canEditLook says the look can still change, and the edit badge opens the look sheet', async () => {
    window.localStorage.setItem('vx:look-tour:fixture-agent', '1');
    render(<Host initial={agent()} />);
    expect(screen.getByText('Personality is locked. Photo and look can still change.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Nova’s look' })); });
    const sheet = screen.getByRole('dialog', { name: 'Nova’s look' });
    expect(within(sheet).getByRole('tab', { name: 'Character' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getByRole('radiogroup', { name: 'Species' })).toBeInTheDocument();
  });

  it('without canEditLook there is no edit entry and no look copy', () => {
    render(<Host initial={agent({ canEditLook: false })} />);
    expect(screen.queryByRole('button', { name: /edit nova’s look/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/photo and look can still change/i)).not.toBeInTheDocument();
  });

  it('a long press on the character opens the look; a tap only pokes it', async () => {
    window.localStorage.setItem('vx:look-tour:fixture-agent', '1');
    render(<Host initial={agent()} />);
    const face = screen.getByRole('button', { name: 'Poke Nova' });
    fireEvent.pointerDown(face);
    fireEvent.pointerUp(face);
    fireEvent.click(face);
    await tick(600);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.pointerDown(face);
    await tick(500);
    expect(screen.getByRole('dialog', { name: 'Nova’s look' })).toBeInTheDocument();
  });

  it('closing the sheet after an edit saves it and pushes to Telegram once', async () => {
    window.localStorage.setItem('vx:look-tour:fixture-agent', '1');
    state.setLook.mockImplementation(async (_id: string, look: AgentView['look']) => ({ agent: agent({}, look) }));
    state.syncProfile.mockResolvedValue({ agent: agent({ profileSync: { status: 'pending', failed: [] } }), failed: [] });
    render(<Host initial={agent()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Nova’s look' })); });
    const sheet = screen.getByRole('dialog', { name: 'Nova’s look' });
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'Species' })).getByRole('radio', { name: 'Cat' }));
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Done' })); });
    await tick(1000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ species: 'cat' }), { sync: false });
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledWith('fixture-agent', { force: false });
  });

  it('an outdated photo opens the sheet on the photo tab and starts drawing at once', async () => {
    state.generateAvatars.mockReturnValue(new Promise(() => {}));
    render(<Host initial={agent({}, { avatarStale: true })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update' })); });
    expect(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Telegram photo' })).toHaveAttribute('aria-selected', 'true');
    expect(state.generateAvatars).toHaveBeenCalledTimes(2);
    expect(state.generateAvatars).toHaveBeenCalledWith('fixture-agent', 1, { select: false });
  });

  it('the edit badge opens the sheet without drawing', async () => {
    window.localStorage.setItem('vx:look-tour:fixture-agent', '1');
    render(<Host initial={agent({}, { avatarStale: true })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Nova’s look' })); });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Telegram photo' }));
    expect(state.generateAvatars).not.toHaveBeenCalled();
  });
});

describe('AgentHero forming', () => {
  it('fills the halo to the hour, not the whole day', () => {
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    const lockAt = new Date(Date.now() + 3.5 * 86_400_000).toISOString();
    expect(formingProgress({ lockAt, formingDay: 4 }, Date.now())).toBeCloseTo(3.5, 5);
    const { container } = render(<Host initial={agent({ locked: false, formingDay: 4, stage: 3, lockAt })} />);
    expect(container.querySelector('.vx-halo')).toHaveAttribute('data-progress', '3.50');
    expect(container.querySelector('.vx-halo .vx-head-dot')).toBeInTheDocument();
    expect(container.querySelectorAll('.vx-halo-fill')).toHaveLength(4);
  });

  it('plays the stage-up once: the pill names the new stage, then the stage is recorded', async () => {
    window.localStorage.setItem('vx:stage-seen:fixture-agent', '2');
    render(<Host initial={agent({ locked: false, formingDay: 4, stage: 3 })} />);
    expect(screen.getByText('Nova grew · stage 3 of 4')).toBeInTheDocument();
    await tick(3000);
    expect(window.localStorage.getItem('vx:stage-seen:fixture-agent')).toBe('3');
    await tick(2000);
    expect(screen.queryByText(/grew/)).not.toBeInTheDocument();
  });

  it('opened as a hero, the stage-up waits for the face to land', async () => {
    window.localStorage.setItem('vx:stage-seen:fixture-agent', '2');
    const { container } = render(<div className="vx-screen" data-arrive="hero"><Host initial={agent({ locked: false, formingDay: 4, stage: 3 })} /></div>);
    const face = () => container.querySelector('.vx-hero-face .vx-char');
    expect(screen.queryByText(/grew/)).not.toBeInTheDocument();
    // in flight the face is still the stage this device saw: it never shows stage 3, then drops back to 2
    expect(face()).toHaveAttribute('data-stage', '2');
    await tick(200);
    expect(face()).toHaveAttribute('data-stage', '2');
    await tick(300);
    expect(screen.getByText('Nova grew · stage 3 of 4')).toBeInTheDocument();
  });

  it('names the stage-up in Persian on a Persian session', async () => {
    state.nav.locale = 'fa';
    try {
      window.localStorage.setItem('vx:stage-seen:fixture-agent', '2');
      render(<Host initial={agent({ locked: false, formingDay: 4, stage: 3, isAdmin: true })} />);
      expect(screen.getByText('Nova رشد کرد · مرحلهٔ ۳ از ۴')).toBeInTheDocument();
      expect(screen.getByText('عامل مدیر')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'تلنگر به Nova' })).toBeInTheDocument();
    } finally { state.nav.locale = 'en'; }
  });

  it('the first view of an agent only records its stage', () => {
    render(<Host initial={agent({ locked: false, formingDay: 2, stage: 2 })} />);
    expect(screen.queryByText(/grew/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vx:stage-seen:fixture-agent')).toBe('2');
  });
});
