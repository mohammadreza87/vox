import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rightsApi, rightsExportSchema, rightsSnapshotSchema, RightsClientError } from './rights-client';
const auth = vi.hoisted(() => ({ session: 'signed-current-account' }));
vi.mock('./client', () => ({ tg: () => ({ initData: auth.session }) }));
const requestId = '00000000-0000-4000-8000-000000000001', eventId = '00000000-0000-4000-8000-000000000002';
const row = () => ({ version: 1 as const, requestId, space: 'work' as const, kind: 'access_export' as const, revision: 1, createdAt: 1, updatedAt: 1, localeAtSubmission: 'en' as const, intakePolicy: { id: 'synthetic', revision: 1, copyVersion: 'rights-intake-ri1-v1' }, requester: { assurance: 'signed_telegram_account' as const, personVerification: 'not_established' as const }, state: 'received' as const, deadline: { state: 'reviewed_policy_unavailable' as const, dueAt: null, reason: 'jurisdiction_unresolved' as const }, coverage: { localAccount: 'not_started' as const, shared: 'not_started' as const, providers: 'unsupported' as const, backups: 'unsupported' as const, guests: 'unsupported' as const, deletion: 'not_implemented' as const, formalRestriction: 'not_implemented' as const }, retention: { policyId: 'synthetic', policyRevision: 1, reviewOrExpiryAt: 50000 }, retentionReviewRequired: false });
const snapshot = () => ({ available: true, policyStatus: 'available', supportedKinds: ['access_export'], intakePolicy: row().intakePolicy, requests: [row()], supportContact: 'info@joyixir.com' });
const exportData = () => ({ schemaVersion: 1, accountId: 'telegram-account:1', space: 'work', generatedAt: 1, revision: 1, confirmedUntil: 50, memories: [], preferences: [], preferenceChanges: [], preferenceLearning: null, purposes: [], agents: [], settings: { inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false, dailyCap: 1, quietStartHour: 22, quietEndHour: 8 }, reminders: [], observations: [], checkIns: [], observerEvents: [], sharedContributions: [], coverage: { privateAccount: 'included', shared: 'not_configured', providers: 'unavailable', backups: 'unavailable' } });
const input = { version: 1 as const, eventId, space: 'work' as const, kind: 'access_export' as const, locale: 'en' as const, expectedIntakePolicyRevision: 1 };
beforeEach(() => { auth.session = 'signed-current-account'; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('uses only authenticated no-store requests and rejects wrong scope and additional private fields', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(snapshot())).mockResolvedValueOnce(Response.json({ ...snapshot(), requests: [{ ...row(), space: 'personal' }] })).mockResolvedValueOnce(Response.json({ ...snapshot(), requests: [{ ...row(), accountId: 'private-canary' }] })); vi.stubGlobal('fetch', fetcher);
  expect((await rightsApi.read('work', auth.session)).requests).toHaveLength(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { 'X-Telegram-Init-Data': auth.session } });
  await expect(rightsApi.read('work', auth.session)).rejects.toThrow(); await expect(rightsApi.read('work', auth.session)).rejects.toThrow();
  expect(rightsSnapshotSchema.safeParse({ ...snapshot(), available: true, policyStatus: 'unavailable' }).success).toBe(false);
  expect(rightsSnapshotSchema.safeParse({ ...snapshot(), intakePolicy: { ...row().intakePolicy, copyVersion: 'unknown-copy' } }).success).toBe(false);
});
it('returns current metadata on a deliberate same-event replay, never a historical export', async () => {
  const current = { ...row(), revision: 3, state: 'closed_unfulfilled', updatedAt: 3 }; const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ replayed: true, request: current, policyStatus: 'unavailable' })); vi.stubGlobal('fetch', fetcher);
  const value = await rightsApi.create(input, auth.session); expect(value.request.state).toBe('closed_unfulfilled'); expect(value.replayed).toBe(true);
  expect((await rightsApi.create(input, auth.session)).request.state).toBe('closed_unfulfilled'); expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  const result = await rightsApi.act(row(), { version: 1, eventId: '00000000-0000-4000-8000-000000000003', expectedRevision: 1, action: 'prepare_local_export' }, auth.session); expect(result.type).toBe('metadata');
});
it('accepts only the scoped current attachment allowlist and matching request header', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(exportData(), { headers: { 'Content-Disposition': 'attachment; filename="current.json"', 'X-Vox-Rights-Request-Id': requestId } })).mockResolvedValueOnce(Response.json(exportData(), { headers: { 'Content-Disposition': 'attachment; filename="current.json"', 'X-Vox-Rights-Request-Id': eventId } })); vi.stubGlobal('fetch', fetcher);
  expect((await rightsApi.act(row(), { version: 1, eventId, expectedRevision: 1, action: 'prepare_local_export' }, auth.session)).type).toBe('export');
  await expect(rightsApi.act(row(), { version: 1, eventId, expectedRevision: 1, action: 'prepare_local_export' }, auth.session)).rejects.toThrow();
  expect(rightsExportSchema.safeParse({ ...exportData(), secret: 'private-canary' }).success).toBe(false);
  expect(rightsExportSchema.safeParse({ ...exportData(), coverage: { ...exportData().coverage, providers: 'included' } }).success).toBe(false);
});
it('discards a response after the signed-in account changes and never retries a mutation', async () => {
  let resolve!: (r: Response) => void; const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetcher);
  const result = rightsApi.create(input, auth.session); auth.session = 'other-account'; resolve(Response.json({ replayed: false, request: row(), policyStatus: 'available' }));
  await expect(result).rejects.toBeInstanceOf(RightsClientError); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds waiting to 15 seconds without retrying or inventing a receipt', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))); vi.stubGlobal('fetch', fetcher);
  const pending = rightsApi.create(input, auth.session), outcome = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(15000); await outcome; expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects internal operator metadata and cannot turn a bare reference into account authority', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ policyStatus: 'available', requests: [{ ...row(), accountId: 'telegram-account:2', accountRef: 'a'.repeat(64), operationHandle: 'opaque', audit: [] }] })));
  await expect(rightsApi.operations(auth.session)).rejects.toThrow();
});
