import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, MemoryItem } from '../../_lib/client';
import { MemoriesScreen } from './Memories';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), memories: vi.fn(), members: vi.fn(), me: vi.fn(),
  shareMemory: vi.fn(), revokeMemory: vi.fn(), forget: vi.fn(),
  toast: vi.fn(), back: vi.fn(),
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
vi.mock('../RelationshipPanel', () => ({ RelationshipPanel: () => null }));
vi.mock('../StudioApp', () => ({
  useNav: () => ({ toast: mocks.toast, snack: mocks.toast, back: mocks.back, push: vi.fn(), locale: 'en', dir: 'ltr', space: 'work', tier: 'full', cache: new Map() }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

function agent(): AgentView {
  return {
    id: 'synthetic-agent', status: 'active',
    persona: { name: 'Nova', role: 'Designer', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: '', avatarHint: '' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: true, formingDay: null, isAdmin: false, visibility: 'private', liveWeb: false,
    groupBehavior: { participation: 'balanced', remember: true }, access: [], createdBy: 1,
    canEdit: false, canFire: false, canManageAccess: false,
  };
}

const memory: MemoryItem = {
  id: 'synthetic-memory', content: 'Synthetic note', type: 'fact', scope: 'private',
  scopeLabel: 'Private to you', from: 'Alice', mine: true,
  at: '2026-10-19T08:00:00.000Z', sensitivity: 'ordinary',
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.agent.mockResolvedValue({ agent: agent() });
  mocks.memories.mockResolvedValue({ memories: [memory] });
  mocks.members.mockResolvedValue({ people: [
    { telegramId: 1, name: 'Alice', role: 'member' },
    { telegramId: 2, name: 'Bob', role: 'member' },
  ] });
  mocks.me.mockResolvedValue({ features: {} });
  mocks.shareMemory.mockResolvedValue(undefined);
  mocks.revokeMemory.mockResolvedValue(undefined);
  mocks.forget.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Legacy memory sharing gate', () => {
  it.each([
    ['feature absent', undefined],
    ['explicitly false', false],
  ])('hides legacy Share when the feature is %s', async (_label, feature) => {
    mocks.me.mockResolvedValue({ features: feature === undefined ? {} : { legacyMemorySharing: feature } });

    render(<MemoriesScreen id="synthetic-agent" />);

    await screen.findByText('Synthetic note');
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Memory options' }));
    await screen.findByRole('dialog', { name: 'Memory' });
    expect(screen.getByRole('button', { name: 'Forget' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Share', exact: true })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/auto forms/i);
    expect(mocks.shareMemory).not.toHaveBeenCalled();
  });

  it('preserves the existing explicit recipient-sharing flow when the feature is true', async () => {
    mocks.me.mockResolvedValue({ features: { legacyMemorySharing: true } });

    render(<MemoriesScreen id="synthetic-agent" />);

    await screen.findByText('Synthetic note');
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Memory options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Share', exact: true }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share with selected' }));

    await waitFor(() => expect(mocks.shareMemory).toHaveBeenCalledWith('synthetic-agent', 'synthetic-memory', [2]));
    expect(screen.queryByText('Choose who can see this memory. You can take access away later.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Shared with selected people').length).toBeGreaterThan(0);
  });
});

describe('Forget', () => {
  it('asks in the sheet, then removes the row and confirms with a snackbar', async () => {
    const { container } = render(<MemoriesScreen id="synthetic-agent" />);
    await screen.findByText('Synthetic note');
    expectOneVolt(container); expectNoRawControls(container);
    fireEvent.click(screen.getByRole('button', { name: 'Memory options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget' }));
    expect(mocks.forget).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Forget memory confirmation' });
    expect(confirm).toHaveTextContent('Nova will forget this for good.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(mocks.forget).toHaveBeenCalledWith('synthetic-agent', 'synthetic-memory'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Synthetic note/ })).toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Forgotten' }));
  });

  it('keeps the memory and shows the reason when forgetting fails', async () => {
    mocks.forget.mockRejectedValue(new Error('Server said no'));
    render(<MemoriesScreen id="synthetic-agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Memory options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Forget memory confirmation' })).getByRole('button', { name: 'Forget' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
    expect(screen.getAllByText('Synthetic note').length).toBeGreaterThan(0);
  });

  it('shows the error template with Retry when loading fails', async () => {
    mocks.memories.mockRejectedValueOnce(new Error('Offline'));
    render(<MemoriesScreen id="synthetic-agent" />);
    expect(await screen.findByText('Offline')).toBeVisible();
    mocks.memories.mockResolvedValue({ memories: [memory] });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(mocks.memories).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Synthetic note')).toBeVisible();
  });
});
