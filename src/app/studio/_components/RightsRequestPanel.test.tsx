import { rightsCopy, RIGHTS_COPY_VERSION } from '@/lib/adaptive/rights-intake/notice';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RightsRequestPanel } from './RightsRequestPanel';
import type { LocalErasureView, RightsRequestView, RightsSnapshot } from '../_lib/rights-client';
import { rightsErasureCopy } from '../_lib/rights-erasure-copy';
const mocks = vi.hoisted(() => ({ session: 'account-a', read: vi.fn(), create: vi.fn(), act: vi.fn(), privateNoteErasure: vi.fn(), privateNoteErasurePlan: vi.fn(), privateNoteErasureExecute: vi.fn() }));
vi.mock('../_lib/client', () => ({ tg: () => ({ initData: mocks.session }) }));
vi.mock('../_lib/rights-client', () => ({ rightsApi: mocks }));
const ref = '00000000-0000-4000-8000-000000000001';
const row = (space: 'work' | 'personal' = 'work'): RightsRequestView => ({ version: 1, requestId: ref, space, kind: 'access_export', revision: 1, createdAt: 1, updatedAt: 1, localeAtSubmission: 'en', intakePolicy: { id: 'synthetic', revision: 1, copyVersion: RIGHTS_COPY_VERSION }, requester: { assurance: 'signed_telegram_account', personVerification: 'not_established' }, state: 'received', deadline: { state: 'reviewed_policy_unavailable', dueAt: null, reason: 'jurisdiction_unresolved' }, coverage: { localAccount: 'not_started', shared: 'not_started', providers: 'unsupported', backups: 'unsupported', guests: 'unsupported', deletion: 'not_implemented', formalRestriction: 'not_implemented' }, retention: { policyId: 'synthetic', policyRevision: 1, reviewOrExpiryAt: 10000 }, retentionReviewRequired: false });
const status = (requests: RightsRequestView[] = []): RightsSnapshot => ({ available: true, policyStatus: 'available', supportedKinds: ['access_export'], intakePolicy: row().intakePolicy, requests, supportContact: 'info@joyixir.com' });
beforeEach(() => { vi.resetAllMocks(); mocks.session = 'account-a'; mocks.read.mockResolvedValue(status()); mocks.create.mockResolvedValue({ replayed: false, request: row(), policyStatus: 'available' }); });
afterEach(cleanup);
it('records a metadata-only request once while busy and shows the durable reference without a guessed deadline', async () => {
  let finish!: (v: unknown) => void; mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<RightsRequestPanel space="work" />); const submit = await screen.findByRole('button', { name: 'Submit request' }); fireEvent.click(submit); fireEvent.click(submit);
  expect(mocks.create).toHaveBeenCalledTimes(1); expect(submit).toBeDisabled(); expect(mocks.create.mock.calls[0][0]).toEqual({ version: 1, eventId: expect.any(String), space: 'work', kind: 'access_export', locale: 'en', expectedIntakePolicyRevision: 1 });
  await act(async () => finish({ replayed: false, request: row(), policyStatus: 'available' })); expect(await screen.findByText(ref)).toBeInTheDocument(); expect(screen.getByText('Your request was recorded. Its applicable deadline has not been confirmed.')).toBeInTheDocument();
  expect(screen.queryByText(/30 days|45 days|completed successfully/i)).not.toBeInTheDocument();
});
it('keeps unavailable intake honest in Persian, with support and no mutation', async () => {
  mocks.read.mockResolvedValue({ ...status([row()]), available: false, policyStatus: 'unavailable', supportedKinds: [], intakePolicy: undefined }); const { container } = render(<RightsRequestPanel space="work" locale="fa" />);
  expect(await screen.findByText('دریافت درخواست تا بررسی سیاست مربوط در دسترس نیست. همچنان می‌توانید از کنترل‌های موجود حریم خصوصی استفاده کنید.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ارسال درخواست' })).toBeDisabled(); expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl'); expect(screen.getByRole('link', { name: 'info@joyixir.com' })).toHaveAttribute('href', 'mailto:info@joyixir.com'); expect(mocks.create).not.toHaveBeenCalled();
});
it('hides old rows immediately on scope/account changes and ignores late responses', async () => {
  let finish!: (v: RightsSnapshot) => void; mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(status());
  const view = render(<RightsRequestPanel space="work" sessionKey="account-a" />); view.rerender(<RightsRequestPanel space="personal" sessionKey="account-a" />);
  await screen.findByText('No recorded requests in this space.'); await act(async () => finish(status([row()]))); expect(screen.queryByText(ref)).not.toBeInTheDocument();
  mocks.read.mockResolvedValue(status([row('personal')])); view.rerender(<RightsRequestPanel space="work" sessionKey="account-a" />); view.rerender(<RightsRequestPanel space="personal" sessionKey="account-a" />); await screen.findByText(ref);
  mocks.session = 'account-b'; mocks.read.mockResolvedValue(status()); view.rerender(<RightsRequestPanel space="personal" sessionKey="account-b" />); expect(screen.queryByText(ref)).not.toBeInTheDocument(); await screen.findByText('No recorded requests in this space.');
});
it('reconciles a lost create acknowledgement through GET before allowing another deliberate action', async () => {
  mocks.create.mockRejectedValue(new Error('private server error')); render(<RightsRequestPanel space="work" />); fireEvent.click(await screen.findByRole('button', { name: 'Submit request' })); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled(); expect(screen.queryByText('private server error')).not.toBeInTheDocument();
  mocks.read.mockResolvedValue(status([row()])); fireEvent.click(screen.getByRole('button', { name: 'Refresh request status' })); await screen.findByText(ref); expect(mocks.create).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
});
it('offers a standing status refresh only once requests exist, and re-reads without closing', async () => {
  mocks.read.mockResolvedValue(status([row()])); render(<RightsRequestPanel space="work" />); await screen.findByText(ref);
  mocks.read.mockResolvedValue(status([{ ...row(), state: 'local_export_prepared', revision: 2 }])); fireEvent.click(screen.getByRole('button', { name: 'Refresh request status' }));
  await screen.findByText(ref); expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.getAllByRole('button', { name: 'Refresh request status' })).toHaveLength(1);
});
it('a prepared replay shows current metadata without downloading a historical export; closure needs confirmation', async () => {
  mocks.read.mockResolvedValue(status([row()])); mocks.act.mockResolvedValue({ type: 'metadata', value: { replayed: true, policyStatus: 'available', request: { ...row(), state: 'local_export_prepared', revision: 2 } } });
  const makeURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); render(<RightsRequestPanel space="work" />); fireEvent.click(await screen.findByRole('button', { name: 'Prepare current local export' })); await screen.findByText('Local account export prepared. Provider/backup data and delivery are unverified.'); expect(makeURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close request without fulfillment' })); expect(mocks.act).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Keep request open' })); expect(screen.queryByRole('button', { name: 'Confirm close without fulfillment' })).not.toBeInTheDocument(); makeURL.mockRestore();
});
it('erasure and restriction requests expose no automated completion or export action', async () => {
  mocks.read.mockResolvedValue(status([{ ...row(), kind: 'erasure' }, { ...row(), requestId: '00000000-0000-4000-8000-000000000002', kind: 'restriction' }])); render(<RightsRequestPanel space="work" />); const articles = await screen.findAllByRole('article'); expect(articles).toHaveLength(2); articles.forEach(article => { expect(within(article).queryByRole('button', { name: 'Prepare current local export' })).toBeNull(); expect(within(article).getByText('Local actions do not complete the full request. Provider and backup copies are not handled here.')).toBeInTheDocument(); }); expect(mocks.act).not.toHaveBeenCalled();
});
it.each((['en', 'fa'] as const).flatMap(locale => ([
  { technical: 'note_content_removed', recording: 'recorded' },
  { technical: 'note_content_removed', recording: 'acknowledgement_pending' },
  { technical: 'unknown', recording: 'recorded' },
] as const).map(result => ({ locale, ...result }))))('separates request submission from $technical / $recording in $locale', async ({ locale, technical, recording }) => {
  mocks.read.mockResolvedValue(status([{ ...row(), kind: 'erasure' }]));
  const view: LocalErasureView = { version: 1, requestId: ref, requestRevision: 1, space: 'work', available: false, operations: [{
    operationRef: 'a'.repeat(64), technical, recording, observedAt: technical === 'unknown' ? null : 1800000000000, effectRevision: technical === 'unknown' ? null : 2,
    coverage: { canonicalSelectedNote: technical === 'unknown' ? 'unknown' : 'removed', canonicalDependentNotes: technical === 'unknown' ? 'unknown' : 'no_active_payloads', queuedDerivedUse: 'unknown', noncanonicalDerivativeCopies: 'unverified', noncanonicalDerivativeUse: 'unverified', sharedCopies: 'not_implemented', otherPrivateData: 'outside_selected_scope', storageFileRemnants: 'unverified', providers: 'not_implemented', backups: 'not_implemented', requestFulfillment: 'not_established' },
  }] };
  mocks.privateNoteErasure.mockResolvedValue(view);
  const { container } = render(<RightsRequestPanel space="work" locale={locale} />);
  const c = rightsCopy[locale], local = rightsErasureCopy[locale];
  await screen.findByText(technical === 'unknown' ? local.unknown : local.effect);
  expect(screen.getByText(c.states.received)).toBeVisible();
  expect(screen.getByText(c.intro)).toBeVisible();
  expect(screen.getByText(c.coverage)).toBeVisible();
  expect(screen.getByText(recording === 'recorded' ? local.recorded : local.pending)).toBeVisible();
  expect(screen.getByText(local.residual)).toBeVisible();
  expect(screen.getByText(local.newActionLabel).closest('p')).toHaveTextContent(`${local.newActionLabel} ${local.unavailable}`);
  expect(container).not.toHaveTextContent('No data has been deleted and no processing has been stopped by this request.');
  expect(container).not.toHaveTextContent('Deletion and formal restriction are not implemented by this request.');
  expect(container).not.toHaveTextContent('این درخواست به‌تنهایی داده‌ای را حذف نکرده و پردازشی را متوقف نکرده است.');
  expect(container).not.toHaveTextContent('حذف داده و محدودسازی رسمی با این درخواست اجرا نمی‌شوند.');
  expect(screen.queryByRole('button', { name: local.action })).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.act).not.toHaveBeenCalled();
  expect(mocks.privateNoteErasurePlan).not.toHaveBeenCalled(); expect(mocks.privateNoteErasureExecute).not.toHaveBeenCalled();
  if (technical === 'unknown') { expect(screen.queryByText(local.effect)).toBeNull(); expect(screen.getByRole('alert')).toHaveFocus(); }
  expect(container.querySelector('section')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
});
it('downloads only after a deliberate fresh export, releases object URLs and reads current metadata before another preparation', async () => {
  const prepared = { ...row(), revision: 2, state: 'local_export_prepared' as const };
  mocks.read.mockResolvedValueOnce(status([row()])).mockResolvedValue(status([prepared]));
  mocks.act.mockResolvedValue({ type: 'export', value: { space: 'work', currentProjection: true } });
  const makeURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current-export'), revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}), download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<RightsRequestPanel space="work" />); fireEvent.click(await screen.findByRole('button', { name: 'Prepare current local export' })); await act(async () => {});
  expect(download).toHaveBeenCalledTimes(1); expect(revokeURL).toHaveBeenCalledWith('blob:current-export'); expect(screen.queryByRole('link', { name: /export/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare current local export' })); await act(async () => {}); expect(mocks.act).toHaveBeenCalledTimes(2); expect(mocks.act.mock.calls[1][1]).toMatchObject({ action: 'prepare_local_export', expectedRevision: 2 }); expect(makeURL).toHaveBeenCalledTimes(2); expect(revokeURL).toHaveBeenCalledTimes(2);
  makeURL.mockRestore(); revokeURL.mockRestore(); download.mockRestore();
});
it('offers only the current reviewed policy kinds, with no native select and no standing Refresh', async () => {
  mocks.read.mockResolvedValueOnce({ ...status(), supportedKinds: ['erasure'] }).mockResolvedValue({ ...status(), supportedKinds: ['restriction'] });
  mocks.create.mockResolvedValue({ replayed: false, request: { ...row(), kind: 'erasure' }, policyStatus: 'available' });
  const view = render(<RightsRequestPanel space="work" />); await screen.findByText('Erasure');
  expect(view.container.querySelector('select')).toBeNull(); expect(screen.queryByRole('button', { name: 'Refresh request status' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' })); await act(async () => {}); expect(mocks.create.mock.calls[0][0].kind).toBe('erasure');
  view.rerender(<RightsRequestPanel space="personal" />); await screen.findByText('Formal restriction'); expect(screen.queryByText('Erasure')).not.toBeInTheDocument();
});
it('two or three kinds are a segmented control; more open a picker', async () => {
  mocks.read.mockResolvedValue({ ...status(), supportedKinds: ['access_export', 'erasure'] });
  const view = render(<RightsRequestPanel space="work" />);
  const seg = await screen.findByRole('tablist', { name: 'Request type' });
  fireEvent.click(within(seg).getByRole('tab', { name: 'Erasure' })); expect(within(seg).getByRole('tab', { name: 'Erasure' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' })); await act(async () => {}); expect(mocks.create.mock.calls[0][0].kind).toBe('erasure');
  view.unmount();
  mocks.read.mockResolvedValue({ ...status(), supportedKinds: ['access_export', 'erasure', 'restriction', 'correction'] });
  render(<RightsRequestPanel space="personal" />);
  fireEvent.click(await screen.findByRole('button', { name: /Request type/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Correction' }));
  expect(await screen.findByRole('button', { name: /Request type.*Correction/ })).toBeInTheDocument();
});
it('renders the volt Submit into the host sheet dock when given one', async () => {
  const dock = document.createElement('div'); document.body.appendChild(dock);
  render(<RightsRequestPanel space="work" dock={dock} />);
  expect(await within(dock).findByRole('button', { name: 'Submit request' })).toHaveClass('vx-btn-primary');
  dock.remove();
});

it.each(['en','fa'] as const)('shows minimal expiry continuity in %s without old detail or fulfillment claims', async locale => {
  const { rightsCopy } = await import('../_lib/rights-copy');
  mocks.read.mockResolvedValue({ ...status(), expiredRequests: [{ requestId: ref, space: 'work', lastRevision: 2, purgedAt: 1000, retainUntil: 2000 }] });
  render(<RightsRequestPanel space="work" locale={locale} />); await screen.findByText(ref);
  expect(screen.getByText(new RegExp(rightsCopy[locale].expiredRecord))).toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: rightsCopy[locale].prepare })).not.toBeInTheDocument();
});
