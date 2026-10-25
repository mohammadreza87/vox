import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';
import { PrivacyScreen } from './Privacy';

const mocks = vi.hoisted(() => ({ read: vi.fn(), agent: vi.fn(), agents: vi.fn(), push: vi.fn(), nav: { current: null as unknown } }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: { read: mocks.read, agent: mocks.agent } }));
vi.mock('../ProductPausePanel', () => ({ ProductPausePanel: () => null }));
vi.mock('../VoiceRecognitionPanel', () => ({ VoiceRecognitionPanel: () => null }));
vi.mock('../Cloud', () => ({ AgentFace: () => null, Cloud: () => null }));
vi.mock('../../_lib/product-pause-client', () => ({ useProductPause: () => ({ coveredBlocked: false, status: null }) }));
vi.mock('../../_lib/client', async importOriginal => ({ ...await importOriginal<typeof import('../../_lib/client')>(), tg: () => null, api: { agents: mocks.agents } }));
vi.mock('./settings/useInboxBadge', () => ({ useInboxBadge: () => 0 }));
vi.mock('../StudioApp', () => ({ useNav: () => mocks.nav.current }));

const snapshot = (): AdaptiveSnapshot => ({
  schemaVersion: 1, revision: 2, space: 'work', scope: 'private_account_profile',
  identity: { accountId: 'synthetic-account', personId: 'synthetic-person', confirmed: true, verification: 'account_confirmation', adultDeclared: true },
  purposes: [{ purpose: 'optional.personalization', state: 'not_asked', revision: 1, available: true,
    notice: { id: 'synthetic-notice', version: 'synthetic-v1', title: 'Personalization terms', body: 'Synthetic exact notice.', copyHash: 'synthetic-hash', locale: 'en' } }],
  memories: [], agents: [], explicitMemoryAvailable: true,
} as AdaptiveSnapshot);

function show(settingsV2: boolean | undefined, role = 'member') {
  mocks.nav.current = { locale: 'en', dir: 'ltr', setLocale: vi.fn(), space: 'work', setSpace: vi.fn(), snack: vi.fn(), toast: vi.fn(), push: mocks.push, back: vi.fn(), tier: 'full',
    me: { org: 'HOOR', member: { telegramId: 1, name: 'Reza', role }, ...(settingsV2 === undefined ? {} : { features: { avatars: true, voices: true, calls: true, settingsV2 } }) } };
  return render(<PrivacyScreen />);
}
const sectionTitles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const rowsUnder = (title: string) => within(screen.getByRole('region', { name: title })).getAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  for (const m of Object.values(mocks)) if (typeof m === 'function') m.mockReset();
  mocks.read.mockResolvedValue(snapshot());
  mocks.agents.mockResolvedValue({ agents: [
    { id: 'nova', status: 'active', persona: { name: 'Nova' }, look: {}, stage: 2 },
    { id: 'old', status: 'fired', persona: { name: 'Old' }, look: {}, stage: 2 },
  ] });
});
afterEach(cleanup);

const LEGACY = ['Your identity', 'What Vox may do', 'Your notes', 'Sharing', 'Experience', 'Control', 'Language'];

describe('You tab with and without Settings v2', () => {
  it('flag off (or an older me without features): the You tab is exactly today’s, with no agent hubs', async () => {
    for (const flag of [false, undefined]) {
      show(flag);
      await screen.findByRole('switch', { name: /^Personalization/ });
      expect(sectionTitles()).toEqual(LEGACY);
      expect(rowsUnder('Sharing')).toEqual(['Shared memories', expect.stringMatching(/^Agent access/), 'Connections']);
      expect(screen.queryByRole('heading', { name: 'Your agents' })).toBeNull();
      cleanup();
    }
  });

  it('flag on: regrouped by the registry’s sections, the same controls, and each active agent links to its hub', async () => {
    show(true);
    await screen.findByRole('switch', { name: /^Personalization/ });
    expect(sectionTitles()).toEqual(['General', 'Language', 'Notifications', 'Voice recognition', 'Privacy & data', 'What Vox may do', 'Your notes', 'Account', 'Your agents']);
    expect(rowsUnder('Notifications')).toEqual(['Inbox', 'Reminders']);
    expect(rowsUnder('Privacy & data').map((t) => t?.split(/(?=\d|None)/)[0])).toEqual(['Agent access', 'Shared memories', 'Connections', 'Request a copy or deletion']);
    expect(within(screen.getByRole('region', { name: 'Privacy & data' })).getByRole('switch', { name: /^Pause/ })).toBeInTheDocument();
    // Only active agents; tapping opens that agent's settings hub.
    expect(rowsUnder('Your agents')).toEqual(['NovaSettings']);
    fireEvent.click(screen.getByRole('button', { name: /Nova/ }));
    expect(mocks.push).toHaveBeenCalledWith({ name: 'settings', page: 'agent', params: { agentId: 'nova', from: 'you' } });
  });

  it('flag on: owners also get the admin rows, last', async () => {
    show(true, 'owner');
    await screen.findByRole('switch', { name: /^Personalization/ });
    expect(sectionTitles().at(-1)).toBe('Admin');
    expect(rowsUnder('Admin')).toEqual(['Diagnostics', 'Privacy requests']);
  });
});
