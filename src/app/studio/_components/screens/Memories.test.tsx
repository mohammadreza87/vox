import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, MemoryItem } from '../../_lib/client';
import { MemoriesScreen } from './Memories';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), memories: vi.fn(), members: vi.fn(), me: vi.fn(),
  shareMemory: vi.fn(), revokeMemory: vi.fn(), forget: vi.fn(),
  toast: vi.fn(), back: vi.fn(),
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock('../Cloud', () => ({ AgentFace: () => null }));
vi.mock('../RelationshipPanel', () => ({ RelationshipPanel: () => null }));
vi.mock('../StudioApp', () => ({
  useNav: () => ({ toast: mocks.toast, back: mocks.back }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));
vi.mock('../ui', () => ({ Empty: () => null, Icon: () => null, TopBar: () => null }));
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => function MotionElement({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) {
    const domProps = Object.fromEntries(Object.entries(props).filter(([key]) =>
      !['initial', 'animate', 'exit', 'transition', 'layoutId', 'layout'].includes(key)));
    return createElement(tag, domProps, children);
  };
  return { AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: element('div') } };
});

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
  vi.resetAllMocks();
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
    expect(screen.queryByRole('button', { name: 'Share', exact: true })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/auto forms/i);
    expect(mocks.shareMemory).not.toHaveBeenCalled();
  });

  it('preserves the existing explicit recipient-sharing flow when the feature is true', async () => {
    mocks.me.mockResolvedValue({ features: { legacyMemorySharing: true } });

    render(<MemoriesScreen id="synthetic-agent" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share', exact: true }));
    fireEvent.click(await screen.findByLabelText('Bob'));
    fireEvent.click(screen.getByRole('button', { name: 'Share with selected' }));

    await waitFor(() => expect(mocks.shareMemory).toHaveBeenCalledWith('synthetic-agent', 'synthetic-memory', [2]));
    expect(screen.queryByText('Choose who can see this memory. You can take access away later.')).not.toBeInTheDocument();
    expect(screen.getByText('Shared with selected people')).toBeInTheDocument();
  });
});
