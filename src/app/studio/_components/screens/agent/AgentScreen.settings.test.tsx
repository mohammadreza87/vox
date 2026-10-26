import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { AgentScreen } from '../Agent';

const state = vi.hoisted(() => ({ agent: vi.fn(), groups: vi.fn(), nav: null as unknown as Record<string, unknown> }));

vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, groups: state.groups } };
});
vi.mock('../../Cloud', async (importOriginal) => ({ ...await importOriginal<typeof import('../../Cloud')>(), Cloud: () => null, AgentFace: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock('../../StudioApp', () => ({ useNav: () => state.nav, errorMessage: (e: unknown) => String(e), LoadingFill: () => null }));

const view = (o: Partial<AgentView> = {}): AgentView => ({
  id: 'nova', status: 'active',
  persona: { name: 'Nova', role: 'Designer', tagline: '', backstory: '', personality: 'Curious', communicationStyle: '', values: [], expertise: [], wontDo: '',
    languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: '', avatarHint: '' },
  look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
  locked: true, formingDay: null, isAdmin: false, visibility: 'org', access: [], liveWeb: true, mainMiniApp: false,
  createdBy: 1, canEdit: false, canEditLook: false, canFire: false, canManageAccess: true, groupBehavior: { participation: 'balanced', remember: true },
  ...o,
} as AgentView);

function show(settingsV2: boolean | undefined, current = view()) {
  state.nav = {
    locale: 'en', back: vi.fn(), push: vi.fn(), toast: vi.fn(), snack: vi.fn(), cache: new Map(),
    me: { org: 'HOOR', member: { telegramId: 1, role: 'member' }, ...(settingsV2 === undefined ? {} : { features: { avatars: true, voices: true, calls: true, settingsV2 } }) },
  };
  state.agent.mockResolvedValue({ agent: current });
  return act(async () => { render(<AgentScreen id={current.id} />); });
}

beforeEach(() => { vi.clearAllMocks(); state.groups.mockResolvedValue({ groups: [] }); });
afterEach(cleanup);

describe('agent settings entry points', () => {
  it('flag off (or an older me): no Settings action on the profile and no shortcut in Manage', async () => {
    for (const flag of [false, undefined]) {
      await show(flag);
      expect(screen.queryByRole('button', { name: 'Open Nova’s settings' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
      expect(within(screen.getByRole('dialog', { name: 'Manage Nova' })).queryByRole('button', { name: 'All settings' })).toBeNull();
      cleanup();
    }
  });

  it('flag on: a Settings action for anyone, and a shortcut in Manage, both opening the hub', async () => {
    await show(true, view({ canManageAccess: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Nova’s settings' }));
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'settings', page: 'agent', params: { agentId: 'nova' } });
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
    cleanup();
    await show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Manage Nova' })).getByRole('button', { name: 'All settings' }));
    expect(state.nav.push).toHaveBeenLastCalledWith({ name: 'settings', page: 'agent', params: { agentId: 'nova' } });
  });

  it('flag on: a retired agent has no Settings action', async () => {
    await show(true, view({ status: 'fired' }));
    expect(screen.queryByRole('button', { name: 'Open Nova’s settings' })).toBeNull();
  });
});
