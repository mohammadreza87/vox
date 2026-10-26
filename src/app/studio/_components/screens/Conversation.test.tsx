import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../_lib/client';
import { expectNoRawControls, expectOneVolt } from '../ui.testing';
import { ConversationScreen } from './Conversation';

const mocks = vi.hoisted(() => ({ agent: vi.fn(), openTelegram: vi.fn(), fetch: vi.fn(), setSpace: vi.fn(), nav: { current: null as unknown } }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(),
  api: { agent: mocks.agent }, openTelegram: mocks.openTelegram, tg: () => ({ initData: 'signed-session' }) }));
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
vi.mock('../StudioApp', () => ({ useNav: () => mocks.nav.current }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => ({ coveredBlocked: false, status: null }) }));
vi.mock('@/lib/adaptive/prediction/client', () => ({ predictionHttpTransport: () => ({}),
  LivePredictionConsumer: class { startTurn = vi.fn(); update = vi.fn(); cancel = vi.fn(); suspend = vi.fn(); snapshotTurn = vi.fn(); } }));
vi.mock('../../_lib/preference-learning-client', () => ({ preferenceLearningApi: { cancel: vi.fn() } }));

const agent = (): AgentView => ({
  id: 'nova', status: 'active', stage: 4, bot: { username: 'nova_bot' },
  persona: { name: 'Nova', role: 'Designer', tagline: '', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: '', avatarHint: '' },
  look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
  locked: true, formingDay: null, isAdmin: false, visibility: 'private', liveWeb: false, groupBehavior: { participation: 'balanced', remember: true },
  access: [], createdBy: 1, canEdit: false, canEditLook: false, canFire: false, canManageAccess: false,
});
const setNav = (locale: 'en' | 'fa', space: 'work' | 'personal') => {
  mocks.nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', space, setSpace: mocks.setSpace, setLocale: vi.fn(), back: vi.fn(), push: vi.fn(),
    snack: vi.fn(), toast: vi.fn(), tier: 'full', cache: new Map() };
};
beforeEach(() => {
  for (const m of [mocks.agent, mocks.openTelegram, mocks.fetch, mocks.setSpace]) m.mockReset();
  mocks.agent.mockResolvedValue({ agent: agent() });
  vi.stubGlobal('fetch', mocks.fetch);
  setNav('en', 'personal');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Conversation screen', () => {
  it('is a chat in the app space and locale, with no per-screen language or space control', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ reply: 'Hello from Nova' }));
    const { container } = render(<ConversationScreen id="nova" />);
    await screen.findByText('Personal · Designer');
    expect(screen.queryByRole('button', { name: 'فارسی' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hi Nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(within(screen.getByRole('log')).getByText('Hi Nova')).toBeVisible();
    expect(await screen.findByText('Hello from Nova')).toBeVisible();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ agentId: 'nova', space: 'personal', text: 'Hi Nova' });
    expectOneVolt(container); expectNoRawControls(container);
  });

  it('keeps a failed message with Retry, then delivers it in place', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'PROVIDER_CANARY' }, { status: 503 })).mockResolvedValueOnce(Response.json({ reply: 'Second time lucky' }));
    render(<ConversationScreen id="nova" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Please retry me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('PROVIDER_CANARY');
    expect(screen.getByText('Please retry me')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Second time lucky')).toBeVisible();
    expect(screen.getAllByText('Please retry me')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).text).toBe('Please retry me');
  });

  it('puts space and preparation in the options sheet, and opens the bot in Telegram', async () => {
    render(<ConversationScreen id="nova" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Telegram' }));
    expect(mocks.openTelegram).toHaveBeenCalledWith('https://t.me/nova_bot');
    fireEvent.click(screen.getByRole('button', { name: 'Chat options' }));
    const sheet = await screen.findByRole('dialog', { name: 'Chat options' });
    expect(within(sheet).getByRole('switch', { name: /Prepare while I type/ })).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Work' }));
    expect(mocks.setSpace).toHaveBeenCalledWith('work');
  });

  it('renders Persian from the app locale', async () => {
    setNav('fa', 'work');
    const { container } = render(<ConversationScreen id="nova" />);
    await screen.findByRole('textbox', { name: 'پیام' });
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'ارسال' })).toBeDisabled();
  });

  it('shows the error template with Try again when the agent cannot load', async () => {
    mocks.agent.mockRejectedValueOnce(new Error('offline'));
    render(<ConversationScreen id="nova" />);
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(mocks.agent).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeEnabled();
  });
});

describe('Connectors entry (Settings v2)', () => {
  it('flag on: a Connectors button opens this agent\'s Connectors & plugins page; flag off: no button', async () => {
    setNav('en', 'personal');
    (mocks.nav.current as Record<string, unknown>).me = { features: { settingsV2: true } };
    render(<ConversationScreen id="nova" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connectors' }));
    expect((mocks.nav.current as { push: ReturnType<typeof vi.fn> }).push).toHaveBeenCalledWith({ name: 'settings', page: 'agent', params: { agentId: 'nova', section: 'connectors' } });
    cleanup();
    setNav('en', 'personal');
    (mocks.nav.current as Record<string, unknown>).me = { features: { settingsV2: false } };
    render(<ConversationScreen id="nova" />);
    await screen.findByText('Personal · Designer');
    expect(screen.queryByRole('button', { name: 'Connectors' })).toBeNull();
  });
});
