import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { AgentHero } from './AgentHero';

vi.mock('../../StudioApp', () => ({ useNav: () => ({ me: { features: {} }, snack: vi.fn(), toast: vi.fn(), tier: 'full' }), errorMessage: () => '' }));
// Only the moment handed to the face matters here.
vi.mock('../../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../Cloud')>();
  return { ...actual, Cloud: ({ label, moment }: { label: string; moment?: { kind: string } | null }) => <span role="img" aria-label={label} data-moment={moment?.kind} /> };
});

const agent = (failed: string[]): AgentView => ({
  id: 'fixture-agent', status: 'active', stage: 4, persona: { name: 'Nova', role: 'Designer' },
  look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
  bot: { username: 'nova_bot' }, profileSync: { status: failed.length ? 'error' : 'synced', failed },
  locked: true, formingDay: null, isAdmin: false, canEdit: false, canEditLook: false, canManageAccess: true, canFire: false,
}) as unknown as AgentView;

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('AgentHero wince', () => {
  it('winces when Telegram refuses the photo, but not for an error that was already there', () => {
    window.localStorage.setItem('vx:stage-seen:fixture-agent', '4');
    const { rerender } = render(<AgentHero agent={agent(['photo'])} onUpdate={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Nova' })).not.toHaveAttribute('data-moment');
    rerender(<AgentHero agent={agent([])} onUpdate={vi.fn()} />);
    rerender(<AgentHero agent={agent(['name'])} onUpdate={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Nova' })).not.toHaveAttribute('data-moment');
    rerender(<AgentHero agent={agent(['photo'])} onUpdate={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Nova' })).toHaveAttribute('data-moment', 'wince');
  });
});
