import { act, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AgentView, type GroupBehavior } from '../../_lib/client';
import { AgentScreen } from './Agent';

const state = vi.hoisted(() => ({
  agent: vi.fn(), setGroupBehavior: vi.fn(),
  nav: {
    me: { org: 'Fixture team', member: { telegramId: 7777001, role: 'member' } },
    back: vi.fn(), push: vi.fn(), toast: vi.fn(),
  },
}));

vi.mock('../../_lib/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent, setGroupBehavior: state.setGroupBehavior } };
});

vi.mock('../StudioApp', () => ({
  useNav: () => state.nav,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Unexpected operation error',
  LoadingFill: () => null,
}));

vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const element = (tag: string) => function MotionElement({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
    const domProps = Object.fromEntries(Object.entries(props).filter(([key]) =>
      !['initial', 'animate', 'exit', 'transition', 'whileTap', 'layoutId', 'layout', 'drag', 'dragConstraints', 'dragElastic', 'onDragEnd'].includes(key)));
    return createElement(tag, domProps, children);
  };
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: { div: element('div'), button: element('button'), span: element('span'), path: element('path') },
  };
});

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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    const manage = await openManage(agent({ groupBehavior: undefined }));

    expect(manage.getByRole('group', { name: 'Group replies' })).toBeVisible();
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toHaveAttribute('aria-checked', 'true');
    expect(state.setGroupBehavior).not.toHaveBeenCalled();
  });

  it('shows the current mode and memory status to viewers without exposing controls', async () => {
    const current = agent({ canManageAccess: false, groupBehavior: { participation: 'active', remember: false } });
    state.agent.mockResolvedValue({ agent: current });
    await act(async () => { render(<AgentScreen id={current.id} />); });

    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByText('Group memory').parentElement).toHaveTextContent('Off');
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(state.setGroupBehavior).not.toHaveBeenCalled();
  });

  it('preserves the memory setting while changing mode and waits for server confirmation', async () => {
    const current = agent({ groupBehavior: { participation: 'balanced', remember: false } });
    let finish!: (value: { agent: AgentView }) => void;
    state.setGroupBehavior.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const manage = await openManage(current);

    await act(async () => { fireEvent.click(manage.getByRole('radio', { name: /^Active/ })); });

    expect(state.setGroupBehavior).toHaveBeenCalledWith(current.id, { participation: 'active', remember: false });
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    for (const radio of manage.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toBeDisabled();

    await act(async () => { finish({ agent: agent({ groupBehavior: { participation: 'active', remember: false } }) }); });
    expect(manage.getByRole('radio', { name: /^Active/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toHaveAttribute('aria-checked', 'false');
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeEnabled();
  });

  it('changes remembering independently and explains context retention and Telegram delivery', async () => {
    const behavior: GroupBehavior = { participation: 'mentions', remember: false };
    state.setGroupBehavior.mockResolvedValue({ agent: agent({ groupBehavior: behavior }) });
    const manage = await openManage(agent({ groupBehavior: { ...behavior, remember: true } }));

    await act(async () => { fireEvent.click(manage.getByRole('switch', { name: 'Remember useful group facts' })); });

    expect(state.setGroupBehavior).toHaveBeenCalledWith('fixture-agent', behavior);
    expect(manage.getByRole('radio', { name: /^Mentions only/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toHaveAttribute('aria-checked', 'false');
    expect(manage.getByText(/Turning this off leaves recent context and existing memories/)).toBeVisible();
    expect(manage.getByText(/All modes can follow messages Telegram delivers/)).toBeVisible();
    expect(manage.getByRole('link', { name: 'BotFather' })).toHaveAttribute('href', 'https://t.me/BotFather');
    expect(manage.getByText(/and remove\/re-add the bot, or make it a group admin/)).toBeVisible();
  });

  it('keeps confirmed settings and allows retry when permission changes or saving fails', async () => {
    state.setGroupBehavior.mockRejectedValue(new ApiError(403, 'Access changed. Ask the creator to update this setting.'));
    const manage = await openManage();

    await act(async () => { fireEvent.click(manage.getByRole('radio', { name: /^Active/ })); });

    expect(state.nav.toast).toHaveBeenCalledWith('Access changed. Ask the creator to update this setting.', 'error');
    expect(manage.getByRole('radio', { name: /^Balanced/ })).toBeChecked();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toHaveAttribute('aria-checked', 'true');
    expect(manage.getByRole('radio', { name: /^Active/ })).toBeEnabled();
    expect(manage.getByRole('switch', { name: 'Remember useful group facts' })).toBeEnabled();
  });
});
