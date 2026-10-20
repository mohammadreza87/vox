import { requireLocalUseCapacity, validateLocalUseLedger } from './local-use-state';
import { brandError, publicDomainError } from '../../error-contract';
import type { AdaptiveStorage } from '../persistence/storage';
import { ledgerSchema, legacyLedgerSchema, type AccountLedger, type RequestRecord } from './contracts';
export class RightsError extends Error {
  readonly name = 'RightsError';
  constructor(readonly status: number, readonly code: string) { super(code); brandError(this, this.name); }
  static is(error: unknown): error is RightsError { return publicDomainError(error, 'RightsError'); }
}
export const fail = (status: number, code: string): never => { throw new RightsError(status, code); };
function validAudit(row: RequestRecord, audit: RequestRecord['audit'][number], index: number): boolean {
  if (audit.action === 'request_received') return index === 0 && audit.from === null && audit.to === 'received' && audit.actor === 'requester';
  if (audit.action === 'retention_reassessed') return index > 0 && audit.actor === 'privacy_operator' && audit.from === audit.to && audit.reasonCode === (index === 1 ? 'review_pending' : row.audit[index - 1].reasonCode);
  if (index === 0 || audit.from === null || audit.from === 'closed_unfulfilled') return false;
  switch (audit.action) {
    case 'review_started': return audit.actor === 'privacy_operator' && audit.from === 'received' && audit.to === 'operator_review' && audit.reasonCode === 'review_pending';
    case 'requester_action_requested': return audit.actor === 'privacy_operator' && ['received','operator_review','operator_action_pending'].includes(audit.from) && audit.to === 'awaiting_requester' && audit.reasonCode === 'requester_action_required';
    case 'operator_pending': return audit.actor === 'privacy_operator' && ['received','operator_review','awaiting_requester'].includes(audit.from) && audit.to === 'operator_action_pending' && ['review_pending','supported_scope_only'].includes(audit.reasonCode ?? '');
    case 'local_export_prepared': return row.kind === 'access_export' && audit.actor === 'service' && audit.to === 'local_export_prepared' && audit.reasonCode === 'supported_scope_only';
    case 'request_closed': return audit.to === 'closed_unfulfilled' && (audit.actor === 'requester' && audit.reasonCode === 'requester_withdrew' || audit.actor === 'privacy_operator' && ['outside_supported_scope','duplicate_request','unable_to_verify','service_unavailable'].includes(audit.reasonCode ?? ''));
  }
}
export class RightsRepository {
  constructor(readonly storage: AdaptiveStorage & { observeRightsTime?: (now: number) => void }) {}
  observeTime(now: number): void {
    try { if (!this.storage.observeRightsTime) return fail(503, 'rights_clock_unavailable'); this.storage.observeRightsTime(now); } catch (error) { if (RightsError.is(error)) throw error; return fail(503, 'rights_clock_unavailable'); }
  }
  private parse(accountId: string, raw: unknown): AccountLedger {
    const legacy = legacyLedgerSchema.safeParse(raw);
    if (legacy.success && legacy.data.requests.some(r => r.retention.auditRetainUntil !== undefined || r.retention.terminalRetainUntil !== undefined || r.audit.some(a => a.action === 'retention_reassessed'))) return fail(503, 'rights_storage_unavailable');
    const parsed = ledgerSchema.safeParse(legacy.success ? { ...legacy.data, version: 2, tombstones: [] } : raw);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(raw)) > 65_536) return fail(503, 'rights_storage_unavailable');
    const d = parsed.data;
    if (d.accountId !== accountId || d.requests.some(r => r.accountId !== accountId || r.updatedAt < r.createdAt || r.updatedAt > d.observedServerTime ||
      r.audit.some((a, index) => !validAudit(r, a, index) || a.seq !== index + 1 || a.at > r.updatedAt || (index === 0 ? a.from !== null || a.action !== 'request_received' : a.from !== r.audit[index - 1].to || a.at < r.audit[index - 1].at)) ||
      r.audit[0].at !== r.createdAt || r.audit[0].to !== 'received' || r.audit[0].actor !== 'requester' || r.audit.at(-1)!.at !== r.updatedAt ||
      r.audit.at(-1)!.to !== r.state || r.audit.length > 1 && r.audit.at(-1)!.reasonCode !== r.reasonCode || r.revision !== r.audit.length || r.retention.reviewOrExpiryAt <= r.createdAt ||
      r.retention.auditRetainUntil !== undefined && r.retention.auditRetainUntil <= r.createdAt ||
      r.retention.terminalRetainUntil !== undefined && (r.state !== 'closed_unfulfilled' || r.retention.terminalRetainUntil <= (r.audit.find(a => a.action === 'request_closed')?.at ?? Number.MAX_SAFE_INTEGER)) ||
      r.deadline.state === 'scheduled' && (r.deadline.anchorAt !== r.createdAt || r.deadline.dueAt <= r.deadline.anchorAt) ||
      (r.localExport !== undefined && (r.kind !== 'access_export' || r.localExport.accountRevision < 1 || r.localExport.preparedAt < r.createdAt || r.localExport.preparedAt > r.updatedAt || r.audit.filter(a => a.action === 'local_export_prepared').at(-1)?.at !== r.localExport.preparedAt)) || (r.state === 'local_export_prepared' && !r.localExport) ||
      (r.coverage.localAccount === 'export_prepared') !== !!r.localExport || (r.coverage.shared === 'currently_authorized_published_only') !== !!r.localExport) ||
      new Set(d.requests.map(r => r.requestId)).size !== d.requests.length || new Set(d.commandReceipts.map(r => r.eventId)).size !== d.commandReceipts.length ||
      new Set(d.tombstones.map(r => r.requestId)).size !== d.tombstones.length ||
      d.tombstones.some(t => t.purgedAt > d.observedServerTime || t.retainUntil <= t.purgedAt || d.requests.some(r => r.requestId === t.requestId)) ||
      d.commandReceipts.some(r => r.recordedAt > d.observedServerTime || r.retainUntil <= r.recordedAt || !d.requests.some(request => request.requestId === r.requestId && request.revision >= r.resultingRequestRevision) && !d.tombstones.some(t => t.requestId === r.requestId && t.lastRevision >= r.resultingRequestRevision && t.retainUntil >= r.retainUntil))) return fail(503, 'rights_storage_unavailable');
    validateLocalUseLedger(d);
    return d;
  }
  read(accountId: string): AccountLedger | null {
    const value = this.storage.readCommittedForEffect?.(accountId);
    if (!value || value.status !== 'ready') return fail(503, 'rights_storage_busy');
    return value.document === null ? null : this.parse(accountId, value.document);
  }
  /** Explicit administrative preparation only; never called by status/preview or policy activation. */
  async migrateToV3(accountId: string, clock: () => number, fence: () => void): Promise<void> {
    try {
      await this.storage.transact(accountId, raw => {
        if (raw === null) return fail(409, 'rights_conversion_not_eligible');
        const before = this.parse(accountId, raw), now = clock();
        if (before.observedServerTime > now) return fail(503, 'rights_clock_unavailable');
        if (before.version === 3) throw new RightsReplay();
        const next: AccountLedger = { ...before, version: 3, revision: before.revision + 1, observedServerTime: now, localUse: { version: 1, intents: [], acknowledgements: [] } };
        this.parse(accountId, next); requireLocalUseCapacity(next);
        return { document: next, result: undefined };
      }, fence);
    } catch (e) { if (e instanceof RightsReplay) return; if (RightsError.is(e)) throw e; return fail(503, 'rights_storage_busy'); }
  }
  async transaction<T>(accountId: string, clock: () => number, mutate: (ledger: AccountLedger) => T, fence: () => void): Promise<T> {
    try {
      return await this.storage.transact(accountId, raw => {
        const now = clock();
        const d = raw === null ? { version: 2 as const, accountId, revision: 1, observedServerTime: now, requests: [], commandReceipts: [], tombstones: [] } : this.parse(accountId, raw);
        if (d.observedServerTime > now) return fail(503, 'rights_clock_unavailable');
        const result = mutate(d); d.observedServerTime = clock();
        if (d.observedServerTime < now) return fail(503, 'rights_clock_unavailable');
        if (Buffer.byteLength(JSON.stringify(d)) > 65_536) return fail(409, 'rights_capacity');
        this.parse(accountId, d); requireLocalUseCapacity(d);
        return { document: d, result };
      }, fence);
    } catch (error) { if (RightsError.is(error) || error instanceof RightsReplay) throw error; return fail(503, 'rights_storage_busy'); }
  }
}
/** An exact concurrent retry aborts the draft without another physical commit. */
export class RightsReplay extends Error {}
