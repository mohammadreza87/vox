import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { ProfileSyncStatus } from './ProfileSyncStatus';
import { TelegramPhoto } from './TelegramPhoto';
import { stepList, syncState } from './syncState';

function agent(sync?: AgentView['profileSync'], overrides: Partial<AgentView> = {}, look: Partial<AgentView['look']> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'active', stage: 1,
    persona: { name: 'Nova' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true }, ...look },
    profileSync: sync,
    ...overrides,
  } as AgentView;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('ProfileSyncStatus', () => {
  it('walks updating → updated → up to date with the ring on the photo', async () => {
    const { container, rerender } = render(<ProfileSyncStatus agent={agent({ status: 'pending', failed: [] })} photo={44} />);
    expect(screen.getByRole('status')).toHaveTextContent('Updating Telegram…Usually a few seconds');
    expect(container.querySelector('[data-sync="syncing"] .vx-sync-ring')).not.toBeNull();
    rerender(<ProfileSyncStatus agent={agent({ status: 'synced', failed: [] })} photo={44} />);
    expect(screen.getByRole('status')).toHaveTextContent('Updated in TelegramJust now · chats may lag a minute');
    expect(container.querySelector('[data-sync="synced"] .vx-sync-badge.ok')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2400); });
    expect(screen.getByRole('status')).toHaveTextContent('Telegram photo · up to date');
    expect(container.querySelector('.vx-sync-ring')).toBeNull();
  });

  it('a refused photo shows the error, a red ring, the auto-retry countdown and Retry', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const retryAt = new Date(Date.now() + 112_000).toISOString();
    const { container } = render(<ProfileSyncStatus agent={agent({ status: 'error', failed: ['photo'], retryAt })} photo={44} onRetry={onRetry} />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t update the photoAuto-retry in 1:52');
    expect(container.querySelector('[data-sync="error-photo"] .vx-sync-badge.err')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('status')).toHaveTextContent('Auto-retry in 1:50');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Telegram profile' })); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a name-only failure stays neutral: the photo is fine', () => {
    const { container } = render(<ProfileSyncStatus agent={agent({ status: 'error', failed: ['name', 'description'] })} photo={44} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Telegram profile still updatingPhoto is fine · name and description pending');
    expect(screen.queryByText(/couldn’t update the photo/i)).not.toBeInTheDocument();
    expect(container.querySelector('.vx-sync-ring')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry Telegram profile' })).toBeEnabled();
  });

  it('an outdated portrait offers Regenerate and Use character', () => {
    const onRegenerate = vi.fn();
    const onUseCharacter = vi.fn();
    render(<ProfileSyncStatus agent={agent({ status: 'synced', failed: [] }, {}, { avatar: 'av-1.jpg', avatarStale: true })} onRegenerate={onRegenerate} onUseCharacter={onUseCharacter} />);
    expect(screen.getByRole('status')).toHaveTextContent('Photo out of dateLook changed · not sent yet');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use character' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onUseCharacter).toHaveBeenCalledTimes(1);
  });

  it('compact: one line, Update instead of the two stale actions', () => {
    const onRegenerate = vi.fn();
    render(<ProfileSyncStatus agent={agent(undefined, {}, { avatarStale: true })} compact onRegenerate={onRegenerate} onUseCharacter={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Photo out of date$/);
    expect(screen.queryByRole('button', { name: 'Use character' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for drafts and fired agents', () => {
    const { container } = render(<><ProfileSyncStatus agent={agent(undefined, { status: 'draft' })} /><ProfileSyncStatus agent={agent(undefined, { status: 'fired' })} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TelegramPhoto', () => {
  it('shows the chosen picture, or the character at stage ≥ 2 on its halo', () => {
    const { rerender } = render(<TelegramPhoto agent={agent(undefined, {}, { avatar: 'av-1.jpg' })} size={28} />);
    expect(screen.getByRole('img', { name: 'Nova in Telegram' })).toHaveAttribute('src', '/api/studio/media/av-1.jpg');
    rerender(<TelegramPhoto agent={agent()} size={28} />);
    expect(screen.getByRole('img', { name: 'Nova in Telegram' }).getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf8,/);
  });
});

describe('sync helpers', () => {
  it('maps profile state', () => {
    expect(syncState(agent())).toBe('in-sync');
    expect(syncState(agent({ status: 'pending', failed: [] }, {}, { avatarStale: true }))).toBe('syncing');
    expect(syncState(agent({ status: 'error', failed: ['photo', 'name'] }))).toBe('error-photo');
    expect(syncState(agent({ status: 'error', failed: ['commands'] }))).toBe('error-other');
    expect(stepList(['webhook'])).toBe('connection');
    expect(stepList(['name', 'short description', 'commands'])).toBe('name, short description and commands');
  });
});
