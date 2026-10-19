import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreferenceLearningPanel } from './PreferenceLearningPanel';
import { LEARNING_VERSION, type LearningPublicView } from '@/lib/adaptive/personalization/learning/contracts';
const api = vi.hoisted(() => ({ read: vi.fn(), present: vi.fn(), toggle: vi.fn(), review: vi.fn(), cancel: vi.fn() }));
vi.mock('../_lib/preference-learning-client', () => ({ preferenceLearningApi: api }));
const state = (extra: Partial<LearningPublicView> = {}): LearningPublicView => ({ schemaVersion: 1, version: LEARNING_VERSION, revision: 10, agentId: 'agent1', space: 'work', available: true, enabled: false, candidates: [], ...extra });
const props = () => ({ agentId: 'agent1', space: 'work' as const, confirmed: true, revisionHint: 10, onRevision: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); api.read.mockResolvedValue(state()); api.cancel.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(['en', 'fa'] as const)('requires separate %s notice and equal opt-in/keep-off controls without optimistic success', async locale => {
  const p = props(), fa = locale === 'fa', shown = state({ revision: 11, presentation: { receipt: 'receipt-1', copyHash: 'hash', locale, expiresAt: Date.now() + 60_000 } });
  api.present.mockResolvedValue(shown);
  let complete!: (s: LearningPublicView) => void; api.toggle.mockReturnValue(new Promise(r => { complete = r; }));
  render(<PreferenceLearningPanel {...p} locale={locale} />);
  fireEvent.click(await screen.findByRole('button', { name: fa ? 'بررسی یادگیری پیشنهادها' : 'Review suggestion learning' }));
  const enable = await screen.findByRole('button', { name: fa ? 'فعال کردن پیشنهادها' : 'Enable suggestions' });
  expect(screen.getByRole('button', { name: fa ? 'خاموش بماند' : 'Keep off' })).toBeInTheDocument();
  expect(screen.getByText(/OpenAI/)).toBeInTheDocument(); expect(enable.closest('section')).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
  fireEvent.click(enable); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(api.toggle).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, receipt: 'receipt-1', version: LEARNING_VERSION, expectedRevision: 11 }), expect.any(AbortSignal));
  await act(async () => complete(state({ revision: 12, enabled: true, intentExpiresAt: Date.now() + 60_000 })));
  expect(await screen.findByRole('status')).toHaveTextContent(fa ? 'روشن است' : 'learning is on');
});
it('aborts an old-scope command and permits a new-scope command while the old network promise still hangs', async () => {
  let oldFinish!: (s: LearningPublicView) => void, nextFinish!: (s: LearningPublicView) => void;
  api.present.mockReturnValueOnce(new Promise(r => { oldFinish = r; })).mockReturnValueOnce(new Promise(r => { nextFinish = r; }));
  const p = props(), v = render(<PreferenceLearningPanel {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review suggestion learning' }));
  const oldSignal = api.present.mock.calls[0][1] as AbortSignal;
  api.read.mockResolvedValue(state({ agentId: 'agent2', space: 'personal' }));
  v.rerender(<PreferenceLearningPanel {...p} agentId="agent2" space="personal" />);
  const button = await screen.findByRole('button', { name: 'Review suggestion learning' }); expect(oldSignal.aborted).toBe(true);
  await act(async () => {}); fireEvent.click(button); expect(api.present).toHaveBeenCalledTimes(2);
  await act(async () => oldFinish(state({ presentation: { receipt: 'old', locale: 'en', copyHash: 'hash', expiresAt: Date.now() + 60_000 } })));
  expect(screen.queryByRole('button', { name: 'Enable suggestions' })).not.toBeInTheDocument(); expect(button).toBeDisabled();
  await act(async () => nextFinish(state({ agentId: 'agent2', space: 'personal', revision: 11, presentation: { receipt: 'new', locale: 'en', copyHash: 'hash', expiresAt: Date.now() + 60_000 } })));
  expect(await screen.findByRole('button', { name: 'Enable suggestions' })).toBeEnabled();
});
it('requires a fresh locale presentation and hides a late old-scope candidate', async () => {
  let finish!: (s: LearningPublicView) => void; api.read.mockReturnValueOnce(new Promise(r => { finish = r; })).mockResolvedValue(state({ agentId: 'agent2', presentation: { receipt: 'fa-only', locale: 'fa', copyHash: 'hash', expiresAt: Date.now() + 60_000 } }));
  const p = props(), v = render(<PreferenceLearningPanel {...p} />); v.rerender(<PreferenceLearningPanel {...p} agentId="agent2" />);
  await screen.findByRole('button', { name: 'Review suggestion learning' });
  await act(async () => finish(state({ enabled: true, candidates: [{ id: 'candidate-old', revision: 1, setting: { key: 'language', value: 'fa' }, reason: 'language_cue', createdAt: Date.now(), expiresAt: Date.now() + 60_000 }] })));
  expect(screen.queryByRole('button', { name: 'Use preference' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Enable suggestions' })).not.toBeInTheDocument();
});
it('does not claim Use on a conflict and never displays private server errors', async () => {
  api.read.mockResolvedValue(state({ enabled: true, intentExpiresAt: Date.now() + 60_000, candidates: [{ id: 'candidate-1', revision: 1, setting: { key: 'response_length', value: 'brief' }, reason: 'length_cue', createdAt: Date.now(), expiresAt: Date.now() + 60_000 }] }));
  api.review.mockRejectedValue(new Error('PRIVATE_ERROR_CANARY')); render(<PreferenceLearningPanel {...props()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use preference' })); expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_ERROR_CANARY'); expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('refreshes an unchanged past client deadline only once and hides its Use control', async () => {
  api.read.mockResolvedValue(state({ enabled: true, intentExpiresAt: Date.now() - 1, candidates: [{ id: 'expired-1', revision: 1, setting: { key: 'language', value: 'fa' }, reason: 'language_cue', createdAt: Date.now() - 60_000, expiresAt: Date.now() - 1 }] }));
  render(<PreferenceLearningPanel {...props()} />); await screen.findByRole('button', { name: 'Turn suggestion learning off' });
  await act(async () => { await new Promise(r => setTimeout(r, 40)); });
  expect(api.read).toHaveBeenCalledTimes(2); expect(screen.queryByRole('button', { name: 'Use preference' })).not.toBeInTheDocument();
});
