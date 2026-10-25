import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView, type GroupBehavior } from '../../_lib/client';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { AgentScreen } from './Agent';

const state = vi.hoisted(() => ({
  agent: vi.fn(), setGroupBehavior: vi.fn(), groups: vi.fn(), setVisibility: vi.fn(), members: vi.fn(), speak: vi.fn(), setLiveWeb: vi.fn(), setMainMiniApp: vi.fn(),
  nav: {
    locale: 'en' as 'en' | 'fa',
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' } },
    back: vi.fn(), push: vi.fn(), toast: vi.fn(), snack: vi.fn(), cache: new Map<string, AgentView>(),
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, setGroupBehavior: state.setGroupBehavior, groups: state.groups,
    setVisibility: state.setVisibility, members: state.members, speak: state.speak, setLiveWeb: state.setLiveWeb, setMainMiniApp: state.setMainMiniApp } };
});

// The character renderer is another stream's work; these tests are about layout and behaviour.
vi.mock('../Cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Cloud')>();
  const Face = ({ label }: { label?: string }) => <span role="img" aria-label={label} />;
  // Photo avatars still render through the real AgentFace (an <img>, no renderer involved).
  const PhotoOrFace = (p: Parameters<typeof actual.AgentFace>[0]) => ((p.look as { avatar?: string }).avatar ? actual.AgentFace(p) : <Face label={p.label} />);
  return { ...actual, Cloud: Face, AgentFace: PhotoOrFace };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));


function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'active',
    persona: {
      name: 'Nova', role: 'Designer', tagline: 'Finds the fun', backstory: 'A helpful teammate.',
      personality: 'Curious', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
      wontDo: 'Legal advice', languages: ['English'], culture: '', presentation: 'neutral',
      age: '30s', accent: '', voiceBrief: 'A clear voice.', avatarHint: '',
    },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    locked: true, formingDay: null, isAdmin: false, visibility: 'private', access: [],
    createdBy: 7777001, canEdit: false, canFire: false, canManageAccess: true,
    groupBehavior: { participation: 'balanced', remember: true },
    ...overrides,
  };
}

async function openManage(current = agent()) {
  state.agent.mockResolvedValue({ agent: current });
  await act(async () => { render(<AgentScreen id={current.id} />); });
  fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
  return within(screen.getByRole('dialog', { name: 'Manage Nova' }));
}

/** Group behaviour lives in its own sheet, opened from a Manage row. */
async function openGroupBehavior(current = agent()) {
  const manage = await openManage(current);
  fireEvent.click(manage.getByRole('button', { name: /^Group behaviour/ }));
  return within(screen.getByRole('dialog', { name: 'Group behaviour' }));
}

const REMEMBER = /^Remember useful group facts/;

beforeEach(() => { vi.clearAllMocks(); state.nav.cache.clear(); state.nav.locale = 'en'; state.groups.mockResolvedValue({ groups: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Agent profile in Persian', () => {
  it('speaks Persian on a Persian session: actions, panel, facts, dock, Manage and its sheets', async () => {
    state.nav.locale = 'fa';
    state.groups.mockResolvedValue({ groups: [{ chatId: 1, title: 'Crit', hasGuests: false, memberCount: 3, agents: [{ id: 'fixture-agent', name: 'Nova' }] }] });
    const current = agent({ locked: false, formingDay: 3, lockAt: new Date(Date.now() + 2 * 86_400_000 + 5_400_000).toISOString(), voice: { label: 'Aria · built-in', source: 'default' } });
    state.agent.mockResolvedValue({ agent: current });
    const { container } = await act(async () => render(<AgentScreen id={current.id} />));
    const actions = [...container.querySelectorAll('.vx-actions > .vx-action')].map((b) => b.textContent);
    expect(actions).toEqual(['گفتگو', 'تماس', 'گروه‌ها', 'حافظه‌ها']);
    expect(screen.getByText('در حال شکل‌گیری · روز ۳ از ۷')).toBeInTheDocument();
    expect(container.querySelector('.vx-strip-main')).toHaveTextContent(/^در حال شکل‌گیری · روز ۳ از ۷شخصیت تا ۲ روز و ۱ ساعت دیگر قابل ویرایش است$/);
    expect(screen.getByRole('region', { name: 'Nova کیست' })).toBeInTheDocument();
    expect(screen.getByText('در ۱ گروه')).toBeInTheDocument();
    expect(screen.getByText('خصوصی')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /تماس با Nova/ })).toHaveClass('vx-btn-primary');
    expect(container.querySelector('.vx-profile-body')?.textContent).not.toMatch(/Forming|Personality editable|Who Nova|Private|In 1 group|Chat|Memories/);
    fireEvent.click(screen.getByRole('button', { name: 'مدیریت' }));
    const manage = within(screen.getByRole('dialog', { name: 'مدیریت Nova' }));
    expect(manage.getByRole('button', { name: /^چه کسانی با Nova صحبت کنند/ })).toBeInTheDocument();
    fireEvent.click(manage.getByRole('button', { name: /^رفتار در گروه/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'رفتار در گروه' }));
    expect(sheet.getByRole('radio', { name: /^متعادل/ })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Agent quick actions', () => {
  it('shows exactly Chat, Call, Groups and Memories, and Groups opens Add to groups', async () => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    const { container } = await act(async () => render(<AgentScreen id={current.id} />));
    const actions = [...container.querySelectorAll('.vx-actions > .vx-action')].map((b) => b.textContent);
    expect(actions).toEqual(['Chat', 'Call', 'Groups', 'Memories']);
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'add-groups', id: current.id });
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'conversation', id: current.id });
  });
});

describe('Agent group behavior settings', () => {
  it('sends both independent settings through the authenticated client endpoint', async () => {
    const actual = await vi.importActual<typeof import('../../_lib/client')>('../../_lib/client');
    const behavior: GroupBehavior = { participation: 'active', remember: false };
    const response = { agent: agent({ groupBehavior: behavior }) };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetchMock);

    expect(await actual.api.setGroupBehavior('fixture/agent', behavior)).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith('/api/studio/agents/fixture%2Fagent/group-behavior', expect.objectContaining({
      method: 'PUT', body: JSON.stringify(behavior),
      headers: expect.objectContaining({ 'X-Telegram-Init-Data': '', Accept: 'application/json', 'Content-Type': 'application/json' }),
    }));
  });

  it('uses balanced participation with remembering on when a stale response has no group settings', async () => {
    const manage = await openGroupBehavior(agent({ groupBehavior: undefined }));

    expect(manage.getByRole('radiogroup', { name: 'Group replies' })).toBeVisible();
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: REMEMBER })).toHaveAttribute('aria-checked', 'true');
    expect(state.setGroupBehavior).not.toHaveBeenCalled();
  });

  it('shows the current mode and memory status to viewers without exposing controls', async () => {
    const current = agent({ canManageAccess: false, groupBehavior: { participation: 'active', remember: false } });
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<AgentScreen id={current.id} />); });

    expect(screen.getByText('Group replies · Active')).toHaveClass('vx-meta');
    expect(screen.getByText('Group memory off')).toHaveClass('vx-meta');
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(state.setGroupBehavior).not.toHaveBeenCalled();
  });

  it('preserves the memory setting while changing mode and waits for server confirmation', async () => {
    const current = agent({ groupBehavior: { participation: 'balanced', remember: false } });
    let finish!: (value: { agent: AgentView }) => void;
    state.setGroupBehavior.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const manage = await openGroupBehavior(current);

    await act(async () => { fireEvent.click(manage.getByRole('radio', { name: /^Active/ })); });

    expect(state.setGroupBehavior).toHaveBeenCalledWith(current.id, { participation: 'active', remember: false });
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    for (const radio of manage.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(manage.getByRole('switch', { name: REMEMBER })).toBeDisabled();

    await act(async () => { finish({ agent: agent({ groupBehavior: { participation: 'active', remember: false } }) }); });
    expect(manage.getByRole('radio', { name: /^Active/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: REMEMBER })).toHaveAttribute('aria-checked', 'false');
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeEnabled();
  });

  it('changes remembering independently and explains context retention and Telegram delivery', async () => {
    const behavior: GroupBehavior = { participation: 'mentions', remember: false };
    state.setGroupBehavior.mockResolvedValue({ agent: agent({ groupBehavior: behavior }) });
    const manage = await openGroupBehavior(agent({ groupBehavior: { ...behavior, remember: true } }));

    await act(async () => { fireEvent.click(manage.getByRole('switch', { name: REMEMBER })); });

    expect(state.setGroupBehavior).toHaveBeenCalledWith('fixture-agent', behavior);
    expect(manage.getByRole('radio', { name: /^Mentions only/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: REMEMBER })).toHaveAttribute('aria-checked', 'false');
    expect(manage.getByText(/Turning this off leaves recent context and existing memories/)).toBeVisible();
    expect(manage.getByText(/All modes can follow messages Telegram delivers/)).toBeVisible();
    expect(manage.getByRole('link', { name: 'BotFather' })).toHaveAttribute('href', 'https://t.me/BotFather');
    expect(manage.getByText(/and remove\/re-add the bot, or make it a group admin/)).toBeVisible();
  });

  it('keeps confirmed settings and allows retry when permission changes or saving fails', async () => {
    state.setGroupBehavior.mockRejectedValue(new ApiError(403, 'Access changed. Ask the creator to update this setting.'));
    const manage = await openGroupBehavior();

    await act(async () => { fireEvent.click(manage.getByRole('radio', { name: /^Active/ })); });

    expect(state.nav.toast).toHaveBeenCalledWith('Access changed. Ask the creator to update this setting.', 'error');
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: REMEMBER })).toHaveAttribute('aria-checked', 'true');
    expect(manage.getByRole('radio', { name: /^Active/ })).toBeEnabled();
    expect(manage.getByRole('switch', { name: REMEMBER })).toBeEnabled();
  });
});

describe('Agent profile (board agent-profile-forming)', () => {
  it('renders at once from the nav cache, then refreshes and writes the fresh agent back', async () => {
    const cached = agent({ persona: { ...agent().persona, name: 'Nova' } });
    const fresh = agent({ persona: { ...cached.persona, personality: 'Fresh from the server' } });
    state.nav.cache.set(cached.id, cached);
    let finish!: (v: { agent: AgentView }) => void;
    state.agent.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { render(<AgentScreen id={cached.id} />); });
    expect(screen.getByRole('heading', { name: 'Nova' })).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Loading agent' })).toBeNull();
    await act(async () => { finish({ agent: fresh }); });
    expect(screen.getByText('Fresh from the server')).toBeInTheDocument();
    expect(state.nav.cache.get(cached.id)).toBe(fresh);
  });

  it('keeps a cached profile when a refresh fails, dimmed with Retry', async () => {
    const cached = agent();
    state.nav.cache.set(cached.id, cached);
    state.agent.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ agent: cached });
    await act(async () => { render(<AgentScreen id={cached.id} />); });
    expect(state.nav.back).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn’t refresh Nova/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    expect(screen.queryByText(/Couldn’t refresh Nova/)).toBeNull();
  });

  it('shows a profile skeleton, not a spinner, while an uncached agent loads', async () => {
    state.agent.mockReturnValue(new Promise(() => {}));
    await act(async () => { render(<AgentScreen id="fixture-agent" />); });
    expect(screen.getByRole('status', { name: 'Loading agent' })).toHaveAttribute('aria-busy', 'true');
  });

  it('the back chevron names the tab underneath, and is bare from anywhere deeper', async () => {
    const current = agent();
    state.agent.mockResolvedValue({ agent: current });
    const { unmount } = await act(async () => render(<AgentScreen id={current.id} from="home" />));
    expect(screen.getByRole('button', { name: 'Agents' })).toHaveTextContent('Agents');
    unmount();
    await act(async () => { render(<AgentScreen id={current.id} from="org" />); });
    expect(screen.getByRole('button', { name: 'Org' })).toHaveTextContent('Org');
    cleanup();
    await act(async () => { render(<AgentScreen id={current.id} from="conversation" />); });
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveClass('icon');
    expect(back).toHaveTextContent('');
  });

  it('“Who X is” holds the personality and a voice row that plays a sample; facts are meta chips', async () => {
    const current = agent({ voice: { label: 'Designed voice · warm alto', source: 'design' }, creatorName: 'Reza', visibility: 'org', liveWeb: true });
    state.agent.mockResolvedValue({ agent: current });
    state.groups.mockResolvedValue({ groups: [
      { chatId: 1, title: 'A', hasGuests: false, memberCount: 3, agents: [{ id: current.id, name: 'Nova', look: current.look }] },
      { chatId: 2, title: 'B', hasGuests: false, memberCount: 3, agents: [{ id: current.id, name: 'Nova', look: current.look }] },
      { chatId: 3, title: 'C', hasGuests: false, memberCount: 3, agents: [] },
    ] });
    state.speak.mockResolvedValue(new Blob(['x']));
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:sample'; });
    const play = vi.fn(() => Promise.resolve());
    vi.stubGlobal('Audio', vi.fn(function Audio() { return { play, pause: vi.fn() }; }));
    const { container } = await act(async () => render(<AgentScreen id={current.id} />));

    const who = within(screen.getByRole('region', { name: 'Who Nova is' }));
    expect(who.getByText('Curious')).toBeInTheDocument();  // blocks rise in (opacity) after the hero lands
    expect(who.getByText('Designed voice · warm alto')).toBeInTheDocument();
    await act(async () => { fireEvent.click(who.getByRole('button', { name: 'Play Nova’s voice' })); });
    expect(state.speak).toHaveBeenCalledWith(current.id, expect.stringContaining('Nova'));
    expect(play).toHaveBeenCalled();

    const facts = [...container.querySelectorAll('.vx-metas')].at(-1)!;
    const metas = [...facts.querySelectorAll(':scope > .vx-meta')].map((m) => m.textContent);
    // Board: three plain facts; Live web and group behaviour are Manage settings
    expect(metas).toEqual(['In 2 groups', 'Everyone in Fixture team', 'Hired by Reza']);
    expect(facts.querySelector('svg')).toBeNull();
    // Settings moved to Manage: no key/value table on the profile
    expect(screen.queryByText('Who can talk')).toBeNull();
    expect(screen.getByText('More about Nova').closest('details')).toHaveClass('vx-disclosure');
    expectOneVolt(container);
    expectNoRawControls(container);
  });

  it('Manage is rows only: settings, Telegram and access, then Fire in its own danger group', async () => {
    const manage = await openManage(agent({ canFire: true, locked: false, formingDay: 3, liveWeb: false, bot: { username: 'nova_bot' }, profileSync: { status: 'synced', failed: [] } }));
    expect(manage.getByRole('button', { name: /^Who can talk to Nova/ })).toHaveClass('vx-row-btn');
    expect(manage.getByRole('switch', { name: /^Live web search/ })).toHaveAttribute('aria-checked', 'false');
    expect(manage.getByRole('button', { name: /^Group behaviour.*Balanced/ })).toBeVisible();
    expect(manage.getByRole('button', { name: /^Update Telegram name & photo.*@nova_bot/ })).toBeVisible();
    const fire = manage.getByRole('button', { name: 'Fire Nova' });
    expect(fire).toHaveClass('danger');
    expect(fire.parentElement?.children).toHaveLength(1);
    fireEvent.click(fire);
    expect(state.nav.push).toHaveBeenCalledWith({ name: 'fire', id: 'fixture-agent' });
  });

  it('Circles S4: the owner marks the bot’s own Main Mini App set, so its group cards open the pet directly', async () => {
    state.setMainMiniApp.mockResolvedValue({ agent: agent({ bot: { username: 'nova_bot' }, mainMiniApp: true }) });
    const manage = await openManage(agent({ bot: { username: 'nova_bot' }, mainMiniApp: false }));
    const toggle = manage.getByRole('switch', { name: /^Pet opens in groups/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Its own pet page (the menu button's), never /studio: Studio verifies only the manager bot's initData.
    expect(manage.getByText(/Main Mini App in BotFather/)).toHaveTextContent(`to its pet link: ${window.location.origin}/studio/pet/fixture-agent`);
    await act(async () => { fireEvent.click(toggle); });
    expect(state.setMainMiniApp).toHaveBeenCalledWith('fixture-agent', true);
    // No bot yet: nothing to set in BotFather, no switch.
    cleanup();
    const bare = await openManage(agent());
    expect(bare.queryByRole('switch', { name: /^Pet opens in groups/ })).toBeNull();
  });

  it('asks before making an agent public, and uses radio rows', async () => {
    const current = agent({ visibility: 'org' });
    state.members.mockResolvedValue({ people: [] });
    state.setVisibility.mockResolvedValue({ agent: agent({ visibility: 'public' }) });
    const manage = await openManage(current);
    fireEvent.click(manage.getByRole('button', { name: /^Who can talk to Nova/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Who can talk to Nova' }));
    expect(sheet.getByRole('radio', { name: /^Everyone in Fixture team/ })).toHaveAttribute('aria-checked', 'true');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => { fireEvent.click(sheet.getByRole('radio', { name: /^Public/ })); });
    expect(confirm).toHaveBeenCalledWith('Make Nova public?');
    expect(state.setVisibility).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(sheet.getByRole('radio', { name: /^Public/ })); });
    expect(state.setVisibility).toHaveBeenCalledWith('fixture-agent', 'public');
  });
});
