import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewedMemoryPanel } from './ReviewedMemoryPanel';
import type { AdaptiveSnapshot } from '../_lib/adaptive-client';
import type { AgentView } from '../_lib/client';
const api = vi.hoisted(() => ({ reviewedPreview: vi.fn(), reviewedAccept: vi.fn() }));
vi.mock('../_lib/adaptive-client', () => ({ adaptiveApi: api }));
const snapshot = (space: 'work' | 'personal' = 'work') => ({ revision: 2, space, identity: { confirmed: true, bindingId: 'binding' },
  agents: [{ agentId: 'agent', allowed: true }], memories: [{ id: 'one', revision: 1, text: 'Launch March 5' }, { id: 'two', revision: 2, text: 'Tentative date' }] } as unknown as AdaptiveSnapshot);
const agents = [{ id: 'agent', persona: { name: 'Synthetic Agent' } }] as AgentView[];
const preview = () => ({ text: '<script>NOT_HTML</script> reviewed draft', receipt: 'signed-receipt', expiresAt: Date.now() + 120000, sourceRefs: [{ id: 'one', revision: 1 }, { id: 'two', revision: 2 }] });
const select = (fa = false) => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'agent' } }); for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box); fireEvent.click(screen.getByRole('button', { name: fa ? 'ساخت پیش‌نمایش خلاصه' : 'Create summary preview' })); };
beforeEach(() => { vi.resetAllMocks(); api.reviewedPreview.mockResolvedValue(preview()); api.reviewedAccept.mockResolvedValue({ memoryId: 'summary', snapshot: snapshot() }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('requires selected notes and a separate explicit save; uses exact source versions and plain preview text', async () => {
  const saved = vi.fn(); const view = render(<ReviewedMemoryPanel snapshot={snapshot()} agents={agents} locale="en" disabled={false} onSaved={saved} />);
  expect(api.reviewedPreview).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Create summary preview' })).toBeDisabled();
  select(); await screen.findByText(preview().text); expect(view.container.querySelector('script')).toBeNull();
  expect(api.reviewedPreview).toHaveBeenCalledWith({ space: 'work', agentId: 'agent', locale: 'en', sourceRefs: [{ id: 'one', revision: 1 }, { id: 'two', revision: 2 }] }, expect.any(AbortSignal));
  expect(api.reviewedAccept).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed summary' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(api.reviewedAccept).toHaveBeenCalledWith(expect.objectContaining({ space: 'work', agentId: 'agent', receipt: 'signed-receipt' }), expect.any(AbortSignal));
});
it('aborts an in-flight preview on scope change and ignores a late response', async () => {
  let resolve!: (value: ReturnType<typeof preview>) => void; api.reviewedPreview.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<ReviewedMemoryPanel snapshot={snapshot()} agents={agents} locale="en" disabled={false} onSaved={vi.fn()} />); select();
  const signal = api.reviewedPreview.mock.calls[0][1] as AbortSignal;
  view.rerender(<ReviewedMemoryPanel snapshot={snapshot('personal')} agents={agents} locale="en" disabled={false} onSaved={vi.fn()} />);
  expect(signal.aborted).toBe(true); await act(async () => { resolve(preview()); }); expect(screen.queryByText(preview().text)).toBeNull(); expect(api.reviewedAccept).not.toHaveBeenCalled();
});
it('invalidates a late accepted snapshot on unmount and provides Persian private controls', async () => {
  let resolve!: (value: unknown) => void; const saved = vi.fn(); api.reviewedAccept.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<ReviewedMemoryPanel snapshot={snapshot('personal')} agents={agents} locale="fa" disabled={false} onSaved={saved} />);
  expect(screen.getByText('شخصی · فقط برای شما')).toBeInTheDocument(); select(true); await screen.findByText(preview().text);
  fireEvent.click(screen.getByRole('button', { name: 'ذخیرهٔ خلاصهٔ بررسی‌شده' })); view.unmount(); await act(async () => { resolve({ memoryId: 'summary', snapshot: snapshot() }); }); expect(saved).not.toHaveBeenCalled();
});
it('expires the preview locally without treating it as a saved memory', async () => {
  api.reviewedPreview.mockResolvedValue({ ...preview(), expiresAt: Date.now() - 1 });
  render(<ReviewedMemoryPanel snapshot={snapshot()} agents={agents} locale="en" disabled={false} onSaved={vi.fn()} />); select();
  await screen.findByText('This preview expired. Request a new preview.'); expect(screen.getByRole('button', { name: 'Save reviewed summary' })).toBeDisabled(); expect(api.reviewedAccept).not.toHaveBeenCalled();
});

it('invalidates an existing preview on product pause while keeping original notes visible, and never revives it on resume', async () => {
  const saved = vi.fn(); const props = { snapshot: snapshot(), agents, locale: 'en' as const, disabled: false, onSaved: saved };
  const view = render(<ReviewedMemoryPanel {...props} />); select(); await screen.findByText(preview().text);
  view.rerender(<ReviewedMemoryPanel {...props} pauseBlocked personalizationPaused pauseEpoch={1} />);
  expect(screen.queryByText(preview().text)).toBeNull(); expect(screen.getByRole('button', { name: 'Create summary preview' })).toBeDisabled();
  expect(screen.getByText('Summaries of saved notes are unavailable while personalization is paused in Work. You can still manage the original notes where allowed.')).toBeVisible();
  expect(screen.getByText('Launch March 5')).toBeVisible(); expect(api.reviewedAccept).not.toHaveBeenCalled();
  view.rerender(<ReviewedMemoryPanel {...props} pauseEpoch={2} />); expect(screen.queryByRole('button', { name: 'Save reviewed summary' })).toBeNull();
});
it('discards a late preview that arrives after a product-pause boundary', async () => {
  let finish!: (value: ReturnType<typeof preview>) => void; api.reviewedPreview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const props = { snapshot: snapshot(), agents, locale: 'en' as const, disabled: false, onSaved: vi.fn() };
  const view = render(<ReviewedMemoryPanel {...props} />); select(); const signal = api.reviewedPreview.mock.calls[0][1] as AbortSignal;
  view.rerender(<ReviewedMemoryPanel {...props} pauseBlocked personalizationPaused pauseEpoch={1} />); expect(signal.aborted).toBe(true);
  await act(async () => finish(preview())); expect(screen.queryByText(preview().text)).toBeNull();
});
