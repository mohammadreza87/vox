import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RightsOperationsPanel } from './RightsOperationsPanel';
import { RightsClientError, type RightsOperationView } from '../_lib/rights-client';
const mocks = vi.hoisted(() => ({ session: 'operator-a', operations: vi.fn(), operate: vi.fn(), retain: vi.fn() }));
vi.mock('../_lib/client', () => ({ tg: () => ({ initData: mocks.session }) }));
vi.mock('../_lib/rights-client', async importOriginal => ({ ...await importOriginal<typeof import('../_lib/rights-client')>(), rightsApi: mocks }));
const row = (): RightsOperationView => ({ version: 1, requestId: '00000000-0000-4000-8000-000000000001', accountRef: 'a'.repeat(64), operationHandle: 'encrypted-handle', space: 'work', kind: 'erasure', revision: 1, createdAt: 1, updatedAt: 1, state: 'received', deadline: { state: 'reviewed_policy_unavailable', dueAt: null, reason: 'jurisdiction_unresolved' }, coverage: { localAccount: 'not_started', shared: 'not_started', providers: 'unsupported', backups: 'unsupported', guests: 'unsupported', deletion: 'not_implemented', formalRestriction: 'not_implemented' }, retentionReviewRequired: false, audit: [] });
beforeEach(() => { vi.resetAllMocks(); mocks.session = 'operator-a'; }); afterEach(cleanup);
it('publishes no queue when the separate server allowlist gate denies an ordinary owner', async () => {
  mocks.operations.mockRejectedValue(new RightsClientError(403)); const { container } = render(<RightsOperationsPanel />); await act(async () => {}); expect(container).toBeEmptyDOMElement(); expect(mocks.operate).not.toHaveBeenCalled();
});
it('shows metadata only, preserves exact CAS and handle, then reloads current authority', async () => {
  mocks.operations.mockResolvedValue({ policyStatus: 'available', requests: [row()] }); mocks.operate.mockResolvedValue({}); render(<RightsOperationsPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Begin review' }));
  expect(mocks.operate.mock.calls[0]).toEqual([row().requestId, { version: 1, eventId: expect.any(String), expectedRevision: 1, action: 'begin_review', reasonCode: 'review_pending', operationHandle: 'encrypted-handle' }, 'operator-a', expect.any(AbortSignal)]);
  await act(async () => {}); expect(mocks.operations).toHaveBeenCalledTimes(2); expect(screen.queryByText(/encrypted-handle|Download|Mark complete/)).not.toBeInTheDocument();
});
it('requires refresh after a lost operator acknowledgement and never retries or rebases it', async () => {
  mocks.operations.mockResolvedValue({ policyStatus: 'available', requests: [row()] }); mocks.operate.mockRejectedValue(new Error('lost acknowledgement')); render(<RightsOperationsPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Begin review' })); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Begin review' })).toBeDisabled(); expect(mocks.operate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh privacy queue' })); expect(await screen.findByRole('button', { name: 'Begin review' })).toBeEnabled(); expect(mocks.operate).toHaveBeenCalledTimes(1);
});
it('drops the queue on operator account change and ignores an old page response', async () => {
  let finish!: (v: unknown) => void; mocks.operations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockRejectedValue(new RightsClientError(403)); const view = render(<RightsOperationsPanel sessionKey="operator-a" />); mocks.session = 'operator-b'; view.rerender(<RightsOperationsPanel sessionKey="operator-b" />); await act(async () => finish({ policyStatus: 'available', requests: [row()] })); expect(view.container).toBeEmptyDOMElement();
});
it('retains Persian metadata but disables mutations while reviewed policy is unavailable', async () => {
  mocks.operations.mockResolvedValue({ policyStatus: 'unavailable', requests: [row()] }); const { container } = render(<RightsOperationsPanel locale="fa" />); expect(await screen.findByRole('button', { name: 'آغاز بررسی' })).toBeDisabled(); expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl'); expect(screen.getByText('درخواست شما ثبت شد. مهلت قابل‌اعمال آن هنوز تأیید نشده است.')).toBeInTheDocument(); expect(mocks.operate).not.toHaveBeenCalled();
});
it('offers a bounded retry after a transient queue read error without exposing request metadata', async () => {
  mocks.operations.mockRejectedValueOnce(new Error('PRIVATE_ERROR_CANARY')).mockResolvedValue({ policyStatus: 'available', requests: [row()] }); render(<RightsOperationsPanel />); await screen.findByRole('alert'); expect(screen.queryByText(row().requestId)).not.toBeInTheDocument(); expect(screen.queryByText('PRIVATE_ERROR_CANARY')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Refresh privacy queue' })); expect(await screen.findByText(row().requestId)).toBeInTheDocument();
});
it('allows explicit retention review when admission is blocked, preserves policy CAS, and requires refresh after an unknown result', async () => {
  const current = { ...row(), retentionReviewRequired: true, retentionActions: ['reassess_retention'], retentionPolicyRevision: 7, retentionAt: 50 };
  mocks.operations.mockResolvedValue({ policyStatus: 'unavailable', requests: [current] }); mocks.retain.mockRejectedValue(new Error('lost'));
  render(<RightsOperationsPanel />); const review = await screen.findByRole('button', { name: 'Reassess using reviewed retention policy' });
  expect(review).toBeEnabled(); expect(screen.getByRole('button', { name: 'Begin review' })).toBeDisabled(); fireEvent.click(review); await screen.findByRole('alert');
  expect(mocks.retain).toHaveBeenCalledWith(current.requestId, expect.objectContaining({ expectedRevision: 1, expectedPolicyRevision: 7, operationHandle: 'encrypted-handle', action: 'reassess_retention' }), 'operator-a', expect.any(AbortSignal));
  expect(review).toBeDisabled(); expect(mocks.retain).toHaveBeenCalledTimes(1); expect(mocks.operate).not.toHaveBeenCalled();
});
it('requires a separate destructive purge confirmation with Persian scope and drops old detail after refresh', async () => {
  const { rightsCopy } = await import('../_lib/rights-copy'); const c = rightsCopy.fa;
  mocks.operations.mockResolvedValueOnce({ policyStatus: 'unavailable', requests: [{ ...row(), state: 'closed_unfulfilled', retentionReviewRequired: true, retentionActions: ['reassess_retention','purge_terminal_record'], retentionPolicyRevision: 1 }] }).mockResolvedValue({ policyStatus: 'available', requests: [] });
  mocks.retain.mockResolvedValue({ outcome: 'purged' }); const view = render(<RightsOperationsPanel locale="fa" />);
  fireEvent.click(await screen.findByRole('button', { name: c.purge })); expect(mocks.retain).not.toHaveBeenCalled(); expect(screen.getByText(c.confirmPurge)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: c.purge })); await act(async () => {});
  expect(mocks.retain).toHaveBeenCalledTimes(1); expect(mocks.retain.mock.calls[0][1].action).toBe('purge_terminal_record');
  expect(screen.queryByText(row().requestId)).not.toBeInTheDocument(); expect(view.container.querySelector('section')).toHaveAttribute('dir', 'rtl');
});
