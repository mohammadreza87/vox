import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../../_lib/client';
import { AgentSettingsScreen } from './AgentSettings';

const state = vi.hoisted(() => ({
  agent: vi.fn(), groups: vi.fn(), speak: vi.fn(), voiceOptions: vi.fn(), chooseDefaultVoice: vi.fn(), updatePersona: vi.fn(), catalog: vi.fn(), members: vi.fn(),
  read: vi.fn(), grant: vi.fn(), profileSync: vi.fn(),
  nav: null as unknown as Record<string, unknown>,
}));

vi.mock('../../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../_lib/client')>();
  return { ...actual, tg: () => null, api: { ...actual.api, agent: state.agent, groups: state.groups, speak: state.speak, voiceOptions: state.voiceOptions,
    chooseDefaultVoice: state.chooseDefaultVoice, updatePersona: state.updatePersona, catalog: state.catalog, members: state.members } };
});
vi.mock('../../../_lib/adaptive-client', () => ({ adaptiveApi: { read: state.read, agent: state.grant } }));
vi.mock('../../Cloud', async (importOriginal) => ({ ...await importOriginal<typeof import('../../Cloud')>(), Cloud: () => null, AgentFace: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock('../../RelationshipPanel', () => ({ RelationshipPanel: (p: { part?: string; allAgentsNote?: boolean }) => <div data-testid="relationship" data-part={p.part} data-note={String(!!p.allAgentsNote)} /> }));
vi.mock('../../../_lib/useProfileSync', () => ({ useProfileSync: state.profileSync }));
vi.mock('../../StudioApp', () => ({ useNav: () => state.nav, errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error') }));

const ALICE = 300, ADMIN = 200, BOB = 400;

function agent(o: Partial<AgentView> = {}): AgentView {
  return {
    id: 'nova', status: 'active',
    persona: { name: 'Nova', role: 'Designer', tagline: 'Finds the fun', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '',
      languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: 'A clear, warm voice for a designer', avatarHint: '', skillIds: ['core.decision-memo', 'core.weekly-review'] },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } }, stage: 2,
    voice: { label: 'Warm · built-in', source: 'default', choiceId: 'warm' }, bot: { username: 'nova_bot' },
    locked: false, formingDay: 3, isAdmin: false, visibility: 'org', liveWeb: true, mainMiniApp: false, access: [],
    groupBehavior: { participation: 'balanced', remember: true }, createdBy: ALICE, creatorName: 'Alice Example',
    canEdit: true, canEditLook: true, canFire: false, canManageAccess: true, canManageSettings: true, canShapeIdentity: true, formingDaysLeft: 5, lockAt: '2026-10-30T00:00:00Z',
    ...o,
  };
}
const asAdmin = (o: Partial<AgentView> = {}) => agent({ canShapeIdentity: false, canFire: true, ...o });
const asMember = (o: Partial<AgentView> = {}) => agent({ canShapeIdentity: false, canManageAccess: false, canManageSettings: false, canEdit: false, canEditLook: false, ...o });

function nav(telegramId: number, role = 'member', settingsV2 = true) {
  state.nav = {
    locale: 'en', dir: 'ltr', space: 'work', setSpace: vi.fn(), tier: 'full', cache: new Map(), back: vi.fn(), push: vi.fn(), reset: vi.fn(), toast: vi.fn(), snack: vi.fn(),
    guardBack: () => () => undefined, consumeBack: () => false,
    me: { org: 'HOOR', member: { telegramId, name: 'Viewer', role }, features: { avatars: true, voices: true, calls: true, settingsV2 } },
  };
}
async function open(view: AgentView, section?: string, from?: string) {
  state.agent.mockResolvedValue({ agent: view });
  await act(async () => { render(<AgentSettingsScreen agentId={view.id} section={section} from={from} />); });
}
const rowTitles = (heading: string) => within(screen.getByRole('region', { name: heading })).getAllByRole('button').map((b) => b.querySelector('.vx-row-title')?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  state.members.mockResolvedValue({ people: [], agentAdmins: [] });
  state.groups.mockResolvedValue({ groups: [{ chatId: 1, title: 'Team', hasGuests: false, memberCount: 3, agents: [{ id: 'nova', name: 'Nova', look: {} }] }] });
  state.catalog.mockResolvedValue({ version: '1', packs: [], roles: [], skills: [
    { id: 'core.decision-memo', title: 'Decision memo', summary: 'Writes one' }, { id: 'core.weekly-review', title: 'Weekly review', summary: 'Reviews' },
  ] });
  state.voiceOptions.mockResolvedValue({ models: [], tier: 'creator', libraryAllowed: true, ttsModel: 'm',
    defaultVoices: [{ voiceId: 'warm', name: 'Warm', previewUrl: '' }, { voiceId: 'bright', name: 'Bright', previewUrl: '' }] });
});
afterEach(cleanup);

describe('agent settings hub', () => {
  it('the creator of a forming agent sees both halves, live summaries and the forming banner', async () => {
    nav(ALICE);
    await open(agent());
    expect(screen.getByRole('heading', { name: 'Nova settings' })).toBeInTheDocument();
    expect(screen.getByText('Nova is forming: 5 days left to shape its voice and skills.')).toBeInTheDocument();
    expect(rowTitles('Nova for everyone')).toEqual(['Profile & look', 'Voice', 'Skills', 'Who can talk', 'Groups & channels']);
    expect(rowTitles('Nova and you')).toEqual(['Memory', 'Permissions', 'Connectors & plugins', 'Notifications', 'Activity']);
    const everyone = within(screen.getByRole('region', { name: 'Nova for everyone' }));
    expect(everyone.getByText('Warm · built-in')).toBeInTheDocument();
    expect(everyone.getByText('2 of 8')).toBeInTheDocument();
    await waitFor(() => expect(everyone.getByText(/^1 group · /)).toBeInTheDocument());
    expect(screen.getByText('Check-in alerts · all agents in Work')).toBeInTheDocument();
    expect(state.groups).toHaveBeenCalledTimes(1);
  });

  it('rows lead to section pages, the existing memories screen and the renamed connectors page', async () => {
    nav(ALICE);
    await open(agent());
    const push = state.nav.push as ReturnType<typeof vi.fn>;
    fireEvent.click(screen.getByRole('button', { name: /^Voice/ }));
    expect(push).toHaveBeenLastCalledWith({ name: 'settings', page: 'agent', params: { agentId: 'nova', section: 'voice' } });
    fireEvent.click(screen.getByRole('button', { name: /^Memory/ }));
    expect(push).toHaveBeenLastCalledWith({ name: 'memories', id: 'nova' });
    fireEvent.click(screen.getByRole('button', { name: /^Connectors & plugins/ }));
    expect(push).toHaveBeenLastCalledWith({ name: 'settings', page: 'agent-connections', params: { agentId: 'nova' } });
    // Activity opens the agent's connector activity on its own, not the connections list again.
    fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
    expect(push).toHaveBeenLastCalledWith({ name: 'settings', page: 'agent-connections', params: { agentId: 'nova', view: 'activity' } });
    fireEvent.click(screen.getByRole('button', { name: /^Who can talk/ }));
    expect(await screen.findByRole('dialog', { name: 'Who can talk to Nova' })).toBeInTheDocument();
  });

  it('a manager who is not the creator sees the manager half; a plain user only "and you", with no group read', async () => {
    nav(ADMIN, 'admin');
    await open(asAdmin());
    expect(rowTitles('Nova for everyone')).toContain('Voice');
    cleanup(); vi.clearAllMocks();
    nav(BOB);
    await open(asMember());
    expect(screen.queryByRole('region', { name: 'Nova for everyone' })).toBeNull();
    expect(rowTitles('Nova and you')).toHaveLength(5);
    expect(state.groups).not.toHaveBeenCalled();
  });

  it('a plain user asking for a manager section gets the hub instead', async () => {
    nav(BOB);
    await open(asMember(), 'voice');
    expect(screen.queryByRole('button', { name: 'Save voice for everyone' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nova settings' })).toBeInTheDocument();
  });

  it('a retired agent shows no manager rows to anyone', async () => {
    nav(ADMIN, 'admin');
    await open(asAdmin({ status: 'fired', canManageSettings: false }));
    expect(screen.getByText('Nova is retired, so its settings can’t change.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nova for everyone' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Nova and you' })).toBeNull();
  });

  it('Permissions and Notifications pages split the relationship panel and label the alert as covering every agent', async () => {
    state.read.mockResolvedValue({ revision: 1, identity: { confirmed: true }, agents: [{ agentId: 'nova', allowed: false }] });
    nav(BOB);
    await open(asMember(), 'permissions');
    expect(await screen.findByRole('switch', { name: 'Nova: Can use your notes' })).toBeInTheDocument();
    expect(screen.getByTestId('relationship')).toHaveAttribute('data-part', 'checkins');
    expect(screen.getByRole('tab', { name: 'Work', selected: true })).toBeInTheDocument();
    cleanup();
    await open(asMember(), 'notifications');
    expect(screen.getByTestId('relationship')).toHaveAttribute('data-part', 'alerts');
    // Said once, in the panel's heading (part 'alerts'): no extra note under the switch and no footnote.
    expect(screen.getByTestId('relationship')).toHaveAttribute('data-note', 'false');
    expect(screen.queryByText(/covers every agent/)).toBeNull();
  });

  it('Back names where it goes: the agent from its profile, You from "Your agents"', async () => {
    nav(ALICE);
    await open(agent());
    expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument();
    cleanup();
    await open(agent(), undefined, 'you');
    expect(screen.getByRole('button', { name: 'Back to You' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova' })).toBeNull();
  });

  it('Profile & look keeps the Telegram profile status fresh, as the profile does', async () => {
    nav(ALICE);
    const pending = agent({ profileSync: { status: 'pending' } } as Partial<AgentView>);
    await open(pending, 'profile');
    expect(screen.getByRole('button', { name: /Update Telegram name & photo/ })).toBeInTheDocument();
    expect(state.profileSync).toHaveBeenCalledWith(expect.objectContaining({ id: 'nova', profileSync: { status: 'pending' } }), expect.any(Function));
  });
});

describe('Voice and Skills pages', () => {
  it('voice is read-only for a manager who is not the creator, naming who can shape it', async () => {
    nav(ADMIN, 'admin');
    await open(asAdmin(), 'voice');
    expect(screen.getByText('Only Alice can shape Nova while it forms.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Nova’s voice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save voice for everyone' })).toBeNull();
    expect(state.voiceOptions).not.toHaveBeenCalled();
  });

  it('voice is read-only once the agent is formed, even for its creator', async () => {
    nav(ALICE);
    await open(agent({ canShapeIdentity: false, locked: true, formingDaysLeft: null }), 'voice');
    expect(screen.getByText('Nova is formed. Its voice and skills now stay as they are, and it keeps learning from conversations.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save voice for everyone' })).toBeNull();
  });

  it('the creator picks a voice to try, and nothing changes until Save, which is for everyone', async () => {
    state.chooseDefaultVoice.mockResolvedValue({ agent: agent({ voice: { label: 'Bright · built-in', source: 'default', choiceId: 'bright' } }) });
    nav(ALICE);
    await open(agent(), 'voice');
    const save = screen.getByRole('button', { name: 'Save voice for everyone' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Everyone who talks to Nova hears the same voice/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Bright' }));
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    expect(state.chooseDefaultVoice).toHaveBeenCalledWith('nova', 'bright');
    expect(state.nav.snack).toHaveBeenCalledWith({ message: 'Voice saved', tone: 'success' });
  });

  it('picking another voice and then the one in use again leaves nothing to save', async () => {
    nav(ALICE);
    await open(agent(), 'voice');
    const save = screen.getByRole('button', { name: 'Save voice for everyone' });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Bright' }));
    expect(save).toBeEnabled();
    // The voice in use shows a Choose pill while another is picked; tapping it drops the pick.
    fireEvent.click(screen.getByRole('button', { name: 'Choose Warm' }));
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose Bright' })).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    expect(state.chooseDefaultVoice).not.toHaveBeenCalled();
  });

  it('skills are read-only for a manager who is not the creator, who still controls live web', async () => {
    nav(ADMIN, 'admin');
    await open(asAdmin(), 'skills');
    await screen.findByRole('button', { name: 'Decision memo' });
    for (const chip of screen.getAllByRole('button', { name: /Decision memo|Weekly review/ })) expect(chip).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save skills for everyone' })).toBeNull();
    expect(screen.getByRole('switch', { name: /^Live web search/ })).toBeEnabled();
  });

  it('the creator turns a skill off and saves the list for everyone', async () => {
    state.updatePersona.mockResolvedValue({ agent: agent({ persona: { ...agent().persona, skillIds: ['core.weekly-review'] } }) });
    nav(ALICE);
    await open(agent(), 'skills');
    const save = screen.getByRole('button', { name: 'Save skills for everyone' });
    expect(save).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Decision memo' }));
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    expect(state.updatePersona).toHaveBeenCalledWith('nova', { skillIds: ['core.weekly-review'] });
  });
});
