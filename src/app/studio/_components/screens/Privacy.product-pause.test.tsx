import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { PrivacyScreen } from './Privacy';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';
const mocks = vi.hoisted(() => ({ session: 'privacy-pause-1', read: vi.fn(), correct: vi.fn(), save: vi.fn(), consent: vi.fn(), agents: vi.fn() }));
vi.mock('../../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
vi.mock('../../_lib/client', () => ({ tg: () => ({ initData: mocks.session }), api: { agents: mocks.agents } }));
vi.mock('../VoiceRecognitionPanel', () => ({ VoiceRecognitionPanel: () => null }));
const snapshot = (): AdaptiveSnapshot => ({ schemaVersion: 1, revision: 2, space: 'work', scope: 'private_account_profile',
  identity: { accountId: 'account-a', bindingId: 'binding', confirmed: true, verification: 'account_confirmation', adultDeclared: true, bindingExpiresAt: Date.now() + 86400_000 },
  purposes: [{ purpose: 'optional.personalization', state: 'granted', revision: 1, available: true, notice: { id: 'n', version: 'v', title: 'Synthetic', body: 'Synthetic', copyHash: 'h', locale: 'en' } }],
  memories: [{ id: 'note', revision: 1, text: 'Own primary note', createdAt: 1, expiresAt: Date.now() + 86400_000 }], agents: [], explicitMemoryAvailable: true, memoryCorrectionAvailable: true });
const status = (space = 'work') => ({ version: 1, accountId: 'account-a', space, available: true, productPaused: false, useEpoch: 0, commandSeq: 0, canPause: true, canResume: true });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { mocks.session += 'x'; vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); mocks.read.mockResolvedValue(snapshot()); mocks.agents.mockResolvedValue({ agents: [] }); });
it('keeps the authenticated pause channel available when optional profile and agents fail', async () => {
  mocks.read.mockRejectedValue(new Error('profile unavailable')); mocks.agents.mockRejectedValue(new Error('agents unavailable'));
  const fetcher = vi.fn(async (url: string) => Response.json(status(url.includes('personal') ? 'personal' : 'work'))); vi.stubGlobal('fetch', fetcher);
  render(<PrivacyScreen />); expect(await screen.findByRole('button', { name: 'Pause in Work' })).toBeEnabled(); await screen.findByText('Your settings could not be loaded. Please try again.');
  const card = screen.getByRole('region', { name: 'Personalization pause · Work' }); expect(card.closest('fieldset')).toBeNull();
  expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps pause independent of the note correction lock and its selected note space', async () => {
  let finishCorrection!: (value: AdaptiveSnapshot) => void; mocks.correct.mockReturnValue(new Promise(resolve => { finishCorrection = resolve; }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(status(url.includes('personal') ? 'personal' : 'work'))));
  render(<PrivacyScreen />); fireEvent.click(await screen.findByRole('button', { name: 'Edit note' })); fireEvent.change(screen.getByLabelText('Corrected note'), { target: { value: 'Corrected own note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review correction' })); fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  expect(screen.getByRole('button', { name: 'Save private memory' })).toBeDisabled();
  const card = screen.getByRole('region', { name: 'Personalization pause · Work' }); expect(within(card).getByRole('button', { name: 'Pause in Work' })).toBeEnabled();
  fireEvent.click(within(card).getByRole('button', { name: 'Personal', exact: true })); await screen.findByRole('heading', { name: 'Personalization pause · Personal' }); await screen.findByRole('button', { name: 'Pause in Personal' });
  expect(mocks.read).toHaveBeenCalledTimes(1); expect(screen.getAllByText('Own primary note').length).toBeGreaterThan(0); expect(mocks.correct.mock.calls[0][2].aborted).toBe(false);
  await act(async () => finishCorrection({ ...snapshot(), revision: 3 }));
});
it('preserves granted consent and manual note management during pending and confirmed pause, disabling stored review only', async () => {
  let finish!: (value: Response) => void; let command!: { version: 1; eventId: string; expectedCommandSeq: number; space: string; action: string };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { if (init.method === 'GET') return Response.json(status()); command = JSON.parse(String(init.body)); return new Promise<Response>(resolve => { finish = resolve; }); }));
  render(<PrivacyScreen />); await screen.findByRole('button', { name: 'Edit note' });
  fireEvent.change(screen.getByLabelText('What should Vox remember?'), { target: { value: 'New own note' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Pause in Work' }));
  expect(screen.getByRole('button', { name: 'Save private memory' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Edit note' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Create summary preview' })).toBeDisabled();
  const receipt = { eventId: command.eventId, fingerprint: createHash('sha256').update(JSON.stringify(['product-pause-command-v1', 'account-a', 'work', 0, 'pause'])).digest('hex'), seq: 1, result: 'changed', resultingUseEpoch: 1, recordedAt: 1 };
  await act(async () => finish(Response.json({ status: { ...status(), productPaused: true, commandSeq: 1, useEpoch: 1, latest: receipt }, receipt, replayed: false })));
  await screen.findByText('Consent remains granted. Use covered by this pause is blocked.');
  expect(screen.getByRole('button', { name: 'Save private memory' })).toBeEnabled(); expect(mocks.consent).not.toHaveBeenCalled();
});
