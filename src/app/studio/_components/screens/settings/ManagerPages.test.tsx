import { act } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { AgentSettingsScreen } from './AgentSettings';

const state = vi.hoisted(() => ({ agent: vi.fn(), groups: vi.fn(), connectorUsage: vi.fn(), agentHistory: vi.fn(), nav: null as unknown as Record<string, unknown> }));
vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, tg: () => null, api: { ...actual.api, agent: state.agent, groups: state.groups, connectorUsage: state.connectorUsage, agentHistory: state.agentHistory } };
});
vi.mock('../../Cloud', async (importOriginal) => ({ ...await importOriginal<typeof import('../../Cloud')>(), Cloud: () => null, AgentFace: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock('../../RelationshipPanel', () => ({ RelationshipPanel: () => null }));
vi.mock('../../../_lib/useProfileSync', () => ({ useProfileSync: vi.fn() }));
vi.mock('../../StudioApp', () => ({ useNav: () => state.nav, errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error') }));

const agent = (o: Partial<AgentView> = {}): AgentView => ({
  id: 'nova', status: 'active', persona: { name: 'Nova', skillIds: [] } as unknown as AgentView['persona'], look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } } as AgentView['look'],
  stage: 2, locked: false, formingDay: 3, isAdmin: false, visibility: 'org', liveWeb: true, mainMiniApp: false, access: [], groupBehavior: { participation: 'balanced', remember: true },
  createdBy: 300, canEdit: true, canEditLook: true, canFire: false, canManageAccess: true, canManageSettings: true, canShapeIdentity: false, ...o,
});
function setNav(locale: 'en' | 'fa' = 'en', settingsV2 = true) {
  state.nav = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', space: 'work', setSpace: vi.fn(), cache: new Map(), back: vi.fn(), push: vi.fn(), reset: vi.fn(), snack: vi.fn(), toast: vi.fn(), tier: 'full',
    me: { org: 'HOOR', member: { telegramId: 300, name: 'Viewer', role: 'admin' }, features: { settingsV2 } } };
}
async function open(view: AgentView, section?: string) {
  state.agent.mockResolvedValue({ agent: view });
  await act(async () => { render(<AgentSettingsScreen agentId={view.id} section={section} />); });
}

beforeEach(() => {
  vi.clearAllMocks(); setNav();
  state.groups.mockResolvedValue({ groups: [] });
  state.connectorUsage.mockResolvedValue({ providers: [{ id: 'gmail', name: 'Gmail', people: 4 }, { id: 'remote_mcp', name: 'Custom MCP servers', people: 1 }] });
  state.agentHistory.mockResolvedValue({ history: [
    { at: '2026-10-24T10:00:00.000Z', actor: 'you', action: 'access', detail: 'people:2' },
    { at: '2026-10-23T10:00:00.000Z', actor: 'admin', action: 'visibility', detail: 'public' },
    { at: '2026-10-22T10:00:00.000Z', actor: 'agent', action: 'unblock' },
  ] });
});
afterEach(cleanup);

describe('manager pages', () => {
  it('the hub summarises counts on the "Connectors people use" row', async () => {
    await open(agent());
    const everyone = within(screen.getByRole('region', { name: 'Nova for everyone' }));
    expect(await everyone.findByText('Gmail · 4, Custom MCP servers · 1')).toBeInTheDocument();
    expect(everyone.getByText('Who changed what, when')).toBeInTheDocument();
  });

  it('Connectors people use: counts only, with the privacy note; an empty agent says so', async () => {
    await open(agent(), 'connector-usage');
    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('4 people')).toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();
    expect(screen.getByText('Counts only, not including you. An app shows once at least 3 people use it, so no one can be singled out. Each person’s accounts and data stay private to them.')).toBeInTheDocument();
    cleanup();
    state.connectorUsage.mockResolvedValue({ providers: [] });
    await open(agent(), 'connector-usage');
    expect(await screen.findByText('No app is connected to Nova by enough people to show yet.')).toBeInTheDocument();
  });

  it('Change history: what changed and who by role, never a person', async () => {
    await open(agent(), 'history');
    expect(await screen.findByText('Who can talk → 2 people')).toBeInTheDocument();
    expect(screen.getByText('Who can find it → Public')).toBeInTheDocument();
    expect(screen.getByText('Someone was unblocked')).toBeInTheDocument();
    expect(screen.getByText(/^You · /)).toBeInTheDocument();
    expect(screen.getByText(/^An admin · /)).toBeInTheDocument();
    expect(screen.getByText(/^Nova · /)).toBeInTheDocument();
    // Each subtitle reads as a label: it never starts with a lowercase fragment.
    expect(screen.queryAllByText(/^[a-z][^·]* · /)).toEqual([]);
  });

  it('Persian copy with Persian digits', async () => {
    setNav('fa');
    await open(agent(), 'history');
    expect(await screen.findByText('چه کسی می‌تواند صحبت کند ← ۲ نفر')).toBeInTheDocument();
  });

  it('a plain user asking for a manager page gets the hub and no aggregate read', async () => {
    await open(agent({ canManageAccess: false, canManageSettings: false }), 'connector-usage');
    expect(screen.getByRole('heading', { name: 'Nova settings' })).toBeInTheDocument();
    expect(state.connectorUsage).not.toHaveBeenCalled();
    expect(state.agentHistory).not.toHaveBeenCalled();
  });

  it('flag off: no Part 2 rows, no counts read', async () => {
    setNav('en', false);
    await open(agent());
    expect(screen.queryByText('Connectors people use')).toBeNull();
    expect(screen.queryByText('Change history')).toBeNull();
    expect(state.connectorUsage).not.toHaveBeenCalled();
  });
});
