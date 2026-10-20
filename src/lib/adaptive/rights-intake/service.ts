import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { accountIdFor, digest } from '../persistence/repository';
import { createInputSchema, integer, operatorActionSchema, reference, requesterActionSchema, spaceSchema,
  type AccountLedger, type CreateInput, type OperatorAction, type RequestRecord, type RequesterAction,
  type RightsMutation, type RightsOperations, type RightsOperationView, type RightsRequestView, type RightsSnapshot, type RightsSpace } from './contracts';
import { rightsPolicySchema, type RightsPolicy } from './policy';
import { fail, RightsError, RightsReplay, RightsRepository } from './repository';
export interface PreparedRightsExport { data: { revision: number; [key: string]: unknown }; revalidate: () => void }
export interface RightsOptions {
  policy: () => unknown;
  /** Dedicated provisioned 256-bit key. Never derive from a bot token or expose to clients. */
  key?: Buffer;
  clock?: () => number;
  /** Per-request signed authentication; never stored in the ledger. */
  assertRequestNow?: () => void;
  assertAccountNow: (telegramId: number) => void;
  assertOperatorNow: (telegramId: number) => void;
  prepareExport?: (telegramId: number, space: RightsSpace) => Promise<PreparedRightsExport>;
}
const tokenSchema = z.object({ version: z.literal(1), type: z.enum(['operation', 'cursor']), operatorRef: z.string().regex(/^[a-f0-9]{64}$/), policy: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: integer, expiresAt: integer,
  accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/).optional(), requestId: reference.optional(), space: spaceSchema.optional(), after: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
type Envelope = z.infer<typeof tokenSchema>;
const terminal = (r: RequestRecord) => r.state === 'closed_unfulfilled';
const safeAdd = (a: number, b: number) => { const n = a + b; if (!Number.isSafeInteger(n) || n <= a) return fail(503, 'reviewed_policy_unavailable'); return n; };
const bump = (n: number) => { if (!Number.isSafeInteger(n + 1)) return fail(503, 'rights_clock_unavailable'); return n + 1; };

/** Metadata-only intake. Account authentication never establishes natural-person identity. */
export class RightsIntakeService {
  private observedTime = 0;
  constructor(readonly repository: RightsRepository, readonly options: RightsOptions) {}
  /** Request-local guard avoids mutating a shared service while awaits overlap. */
  forRequest(assertRequestNow: () => void): RightsIntakeService {
    return new RightsIntakeService(this.repository, { ...this.options, assertRequestNow: () => { this.options.assertRequestNow?.(); assertRequestNow(); } });
  }
  private now(ledger?: AccountLedger | null): number {
    this.options.assertRequestNow?.();
    const value = (this.options.clock ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < this.observedTime || value < (ledger?.observedServerTime ?? 0)) return fail(503, 'rights_clock_unavailable');
    this.repository.observeTime(value); this.options.assertRequestNow?.(); this.observedTime = value; return value;
  }
  private policy(now: number): RightsPolicy | undefined {
    const result = rightsPolicySchema.safeParse(this.options.policy());
    if (!result.success || this.options.key?.length !== 32 || result.data.effectiveAt > now || result.data.expiresAt <= now) return undefined;
    const p = result.data;
    if ([p.retention.requestReviewAfterMs, p.retention.auditRetentionMs, p.retention.receiptRetentionMs, p.handleLifetimeMs,
      ...p.deadlineRules.map(rule => rule.dueAfterMs)].some(duration => !Number.isSafeInteger(now + duration))) return undefined;
    // Intake needs a currently configured privacy operator, as well as an
    // explicit allowlist. A removed/non-owner member cannot keep it enabled.
    if (!p.privacyOperatorIds.some(id => { try { this.options.assertOperatorNow(id); return true; } catch { return false; } })) return undefined;
    return p;
  }
  private requirePolicy(now: number, expected?: RightsPolicy): RightsPolicy {
    this.options.assertRequestNow?.();
    const p = this.policy(now);
    this.options.assertRequestNow?.();
    if (!p || expected && digest(p) !== digest(expected)) return fail(503, 'reviewed_policy_unavailable');
    return p;
  }
  private ref(domain: string, value: string): string {
    if (this.options.key?.length !== 32) return fail(503, 'reviewed_policy_unavailable');
    return createHmac('sha256', this.options.key).update(`vox-rights:${domain}:v1\0${value}`).digest('hex');
  }
  private key(): Buffer { return createHmac('sha256', this.options.key!).update('vox-rights:envelope:v1').digest(); }
  private seal(value: Envelope): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv); cipher.setAAD(Buffer.from('vox-rights:envelope:v1'));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  private open(raw: string, operator: number, p: RightsPolicy, type: Envelope['type']): Envelope {
    try {
      if (!/^[A-Za-z0-9_-]{40,2048}$/.test(raw)) return fail(403, 'operation_handle_invalid');
      const bytes = Buffer.from(raw, 'base64url');
      if (bytes.toString('base64url') !== raw) return fail(403, 'operation_handle_invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from('vox-rights:envelope:v1')); decipher.setAuthTag(bytes.subarray(12, 28));
      const token = tokenSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'))), now = this.now();
      if (token.type !== type || token.operatorRef !== this.ref('operator', String(operator)) || token.policy !== digest(p) || token.issuedAt > now || token.expiresAt <= now || token.expiresAt <= token.issuedAt ||
        type === 'operation' && (!token.accountId || !token.requestId || !token.space || token.after) || type === 'cursor' && (!token.after || token.accountId || token.requestId || token.space)) return fail(403, 'operation_handle_invalid');
      return token;
    } catch (error) { if (RightsError.is(error) && error.code === 'authentication_required') throw error; return fail(403, 'operation_handle_invalid'); }
  }
  private operator(id: number, expected?: RightsPolicy): RightsPolicy {
    this.options.assertOperatorNow(id);
    const p = this.requirePolicy(this.now(), expected);
    if (!p.privacyOperatorIds.includes(id)) return fail(403, 'privacy_operator_required');
    return p;
  }
  private read(id: number): AccountLedger | null {
    this.options.assertAccountNow(id); const d = this.repository.read(accountIdFor(id)); this.now(d); return d;
  }
  private available(d: AccountLedger | null, now: number): boolean {
    return !!this.policy(now) && !(d?.requests.some(r => r.retention.reviewOrExpiryAt <= now));
  }
  private view(r: RequestRecord, now: number): RightsRequestView {
    return { version: r.version, requestId: r.requestId, space: r.space, kind: r.kind, revision: r.revision,
      createdAt: r.createdAt, updatedAt: r.updatedAt, localeAtSubmission: r.localeAtSubmission, intakePolicy: r.intakePolicy,
      requester: r.requester, state: r.state, ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}), deadline: r.deadline,
      coverage: r.coverage, ...(r.localExport ? { localExport: r.localExport } : {}), retention: r.retention,
      retentionReviewRequired: r.retention.reviewOrExpiryAt <= now };
  }
  private row(d: AccountLedger | null, requestId: string, space: RightsSpace): RequestRecord {
    const r = d?.requests.find(r => r.requestId === requestId && r.space === space);
    if (!r) return fail(404, 'not_found'); return r;
  }
  snapshot(id: number, space: RightsSpace): RightsSnapshot {
    spaceSchema.parse(space); const d = this.read(id), now = this.now(d), p = this.policy(now), available = this.available(d, now);
    const result: RightsSnapshot = { supportedKinds: available && p ? [...p.supportedKinds] : [], available, policyStatus: available ? 'available' : 'unavailable',
      ...(available && p ? { intakePolicy: { id: p.id, revision: p.revision, copyVersion: p.copyVersion } } : {}),
      requests: (d?.requests ?? []).filter(r => r.space === space).map(r => this.view(r, now)), supportContact: 'info@joyixir.com' };
    this.options.assertAccountNow(id); this.now(d); return result;
  }
  detail(id: number, space: RightsSpace, requestId: string): Pick<RightsMutation, 'request' | 'policyStatus'> {
    reference.parse(requestId); spaceSchema.parse(space); const d = this.read(id), now = this.now(d), r = this.row(d, requestId, space);
    this.options.assertAccountNow(id); return { request: this.view(r, now), policyStatus: this.available(d, this.now(d)) ? 'available' : 'unavailable' };
  }
  private replay(d: AccountLedger | null, eventId: string, fingerprint: string, now: number): RequestRecord | undefined {
    const receipt = d?.commandReceipts.find(r => r.eventId === eventId && r.retainUntil > now);
    if (!receipt) return undefined;
    if (receipt.fingerprint !== fingerprint) return fail(409, 'rights_conflict');
    return d!.requests.find(r => r.requestId === receipt.requestId) ?? fail(503, 'rights_storage_unavailable');
  }
  private async readForMutation(id: number): Promise<AccountLedger | null> {
    const deadline = Date.now() + 3000;
    while (true) {
      try { return this.read(id); }
      catch (error) {
        if (!RightsError.is(error) || error.code !== 'rights_storage_busy' || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  private async replayResult(id: number, space: RightsSpace, eventId: string, fp: string): Promise<RightsMutation | undefined> {
    const d = await this.readForMutation(id), now = this.now(d), row = this.replay(d, eventId, fp, now);
    if (!row) return undefined;
    if (row.space !== space) return fail(409, 'rights_conflict');
    return { ...this.detail(id, space, row.requestId), replayed: true };
  }
  private admit(d: AccountLedger, p: RightsPolicy, now: number): void {
    if (d.requests.some(r => r.retention.reviewOrExpiryAt <= now)) return fail(503, 'rights_retention_review_required');
    // Only expired command receipts are removable. Unresolved requests/audits are never evicted.
    d.commandReceipts = d.commandReceipts.filter(r => r.retainUntil > now);
    if (d.commandReceipts.length >= 128) return fail(409, 'rights_capacity');
    this.requirePolicy(now, p);
  }
  private receipt(d: AccountLedger, row: RequestRecord, input: { eventId: string; action?: string }, fp: string, now: number, p: RightsPolicy): void {
    d.commandReceipts.push({ eventId: input.eventId, fingerprint: fp, requestId: row.requestId, resultingRequestRevision: row.revision,
      action: input.action ?? 'create', recordedAt: now, retainUntil: safeAdd(now, p.retention.receiptRetentionMs) }); d.revision = bump(d.revision);
  }
  async create(id: number, raw: CreateInput): Promise<RightsMutation> {
    const input = createInputSchema.parse(raw), accountId = accountIdFor(id), fp = digest(['create', accountId, input]);
    const replay = await this.replayResult(id, input.space, input.eventId, fp); if (replay) return replay;
    const p = this.requirePolicy(this.now());
    if (!p.supportedKinds.includes(input.kind)) return fail(400, 'unsupported_action');
    if (p.revision !== input.expectedIntakePolicyRevision) return fail(409, 'rights_conflict');
    const requestId = randomUUID();
    try {
      await this.repository.transaction(accountId, () => this.now(), d => {
        const now = this.now(d);
        if (this.replay(d, input.eventId, fp, now)) throw new RightsReplay();
        this.admit(d, p, now);
        if (d.requests.length >= 100 || d.requests.filter(r => !terminal(r)).length >= 20) return fail(409, 'rights_capacity');
        const rule = p.deadlineRules.find(r => r.accountId === accountId && r.space === input.space && r.kind === input.kind);
        const row: RequestRecord = { version: 1, requestId, accountId, space: input.space, kind: input.kind, revision: 1, createdAt: now, updatedAt: now,
          localeAtSubmission: input.locale, intakePolicy: { id: p.id, revision: p.revision, copyVersion: p.copyVersion }, requester: { assurance: 'signed_telegram_account', personVerification: 'not_established' }, state: 'received', reasonCode: 'review_pending',
          deadline: rule ? { state: 'scheduled', dueAt: safeAdd(now, rule.dueAfterMs), policyId: p.id, policyRevision: p.revision, ruleId: rule.id, anchorAt: now } : { state: 'reviewed_policy_unavailable', dueAt: null, reason: 'no_matching_rule' },
          coverage: { localAccount: 'not_started', shared: 'not_started', providers: 'unsupported', backups: 'unsupported', guests: 'unsupported', deletion: 'not_implemented', formalRestriction: 'not_implemented' },
          retention: { policyId: p.id, policyRevision: p.revision, reviewOrExpiryAt: safeAdd(now, p.retention.requestReviewAfterMs) },
          audit: [{ seq: 1, at: now, action: 'request_received', actor: 'requester', actorRef: this.ref('requester', accountId), from: null, to: 'received', policyRevision: p.revision }] };
        d.requests.push(row); this.receipt(d, row, input, fp, now, p);
      }, () => { this.options.assertAccountNow(id); this.requirePolicy(this.now(), p); });
    } catch (e) { if (e instanceof RightsReplay) return (await this.replayResult(id, input.space, input.eventId, fp))!; throw e; }
    this.requirePolicy(this.now(), p); return { ...this.detail(id, input.space, requestId), replayed: false };
  }
  private transition(r: RequestRecord, action: string, reason: RequestRecord['reasonCode'], actor: 'requester' | 'privacy_operator' | 'service', actorId: string, now: number, p: RightsPolicy): void {
    if (terminal(r)) return fail(409, 'rights_conflict');
    if (r.audit.length >= 32) return fail(409, 'rights_capacity');
    const from = r.state;
    let to: RequestRecord['state'], audit: RequestRecord['audit'][number]['action'];
    if (action === 'withdraw_request' || action === 'close_unfulfilled') { to = 'closed_unfulfilled'; audit = 'request_closed'; }
    else if (action === 'prepare_local_export' && r.kind === 'access_export') { to = 'local_export_prepared'; audit = 'local_export_prepared'; }
    else if (action === 'begin_review' && from === 'received' && reason === 'review_pending') { to = 'operator_review'; audit = 'review_started'; }
    else if (action === 'request_requester_action' && ['received','operator_review','operator_action_pending'].includes(from) && reason === 'requester_action_required') { to = 'awaiting_requester'; audit = 'requester_action_requested'; }
    else if (action === 'mark_operator_pending' && ['received','operator_review','awaiting_requester'].includes(from) && ['review_pending','supported_scope_only'].includes(reason ?? '')) { to = 'operator_action_pending'; audit = 'operator_pending'; }
    else return fail(400, 'unsupported_action');
    if (action === 'close_unfulfilled' && !['outside_supported_scope','duplicate_request','unable_to_verify','service_unavailable'].includes(reason ?? '')) return fail(400, 'unsupported_action');
    r.revision = bump(r.revision); r.updatedAt = now; r.state = to; r.reasonCode = reason;
    r.audit.push({ seq: r.audit.length + 1, at: now, action: audit, actor, actorRef: this.ref(actor, actorId), from, to, ...(reason ? { reasonCode: reason } : {}), policyRevision: p.revision });
  }
  async requesterAction(id: number, space: RightsSpace, requestId: string, raw: RequesterAction): Promise<{ result: RightsMutation; prepared?: PreparedRightsExport }> {
    reference.parse(requestId); spaceSchema.parse(space); const input = requesterActionSchema.parse(raw), accountId = accountIdFor(id), fp = digest(['requester', accountId, space, requestId, input]);
    const replay = await this.replayResult(id, space, input.eventId, fp); if (replay) return { result: replay };
    const p = this.requirePolicy(this.now()), initial = this.row(this.read(id), requestId, space);
    if (initial.revision !== input.expectedRevision) return fail(409, 'rights_conflict');
    if (terminal(initial)) return fail(409, 'rights_conflict');
    if (input.action === 'prepare_local_export' && initial.kind !== 'access_export') return fail(400, 'unsupported_action');
    const prepared = input.action === 'prepare_local_export' ? await (this.options.prepareExport?.(id, space) ?? fail(503, 'export_unavailable')) : undefined;
    try {
      await this.repository.transaction(accountId, () => this.now(), d => {
        const now = this.now(d); if (this.replay(d, input.eventId, fp, now)) throw new RightsReplay(); this.admit(d, p, now);
        const r = this.row(d, requestId, space); if (r.revision !== input.expectedRevision) return fail(409, 'rights_conflict');
        this.transition(r, input.action, input.action === 'withdraw_request' ? 'requester_withdrew' : 'supported_scope_only', prepared ? 'service' : 'requester', accountId, now, p);
        if (prepared) { prepared.revalidate(); r.localExport = { preparedAt: now, accountRevision: prepared.data.revision, scope: 'authorized_local_account_projection', delivery: 'unverified' }; r.coverage.localAccount = 'export_prepared'; r.coverage.shared = 'currently_authorized_published_only'; }
        this.receipt(d, r, input, fp, now, p);
      }, () => { this.options.assertAccountNow(id); this.requirePolicy(this.now(), p); prepared?.revalidate(); });
    } catch (e) { if (e instanceof RightsReplay) return { result: (await this.replayResult(id, space, input.eventId, fp))! }; throw e; }
    this.requirePolicy(this.now(), p); prepared?.revalidate();
    return { result: { ...this.detail(id, space, requestId), replayed: false }, ...(prepared ? { prepared: { data: prepared.data, revalidate: () => { this.requirePolicy(this.now(), p); this.options.assertAccountNow(id); prepared.revalidate(); this.requirePolicy(this.now(), p); } } } : {}) };
  }
  private operationView(r: RequestRecord, operator: number, p: RightsPolicy, now: number): RightsOperationView {
    const { version, requestId, space, kind, revision, createdAt, updatedAt, state, reasonCode, deadline, coverage, retentionReviewRequired } = this.view(r, now);
    return { version, requestId, space, kind, revision, createdAt, updatedAt, state, ...(reasonCode ? { reasonCode } : {}), deadline, coverage, retentionReviewRequired,
      accountRef: this.ref('account', r.accountId), operationHandle: this.seal({ version: 1, type: 'operation', operatorRef: this.ref('operator', String(operator)), policy: digest(p), issuedAt: now, expiresAt: safeAdd(now, p.handleLifetimeMs), accountId: r.accountId, requestId, space }),
      audit: r.audit.map(a => ({ seq: a.seq, at: a.at, action: a.action, actor: a.actor, from: a.from, to: a.to, ...(a.reasonCode ? { reasonCode: a.reasonCode } : {}), policyRevision: a.policyRevision })) };
  }
  async operations(operator: number, cursor?: string): Promise<RightsOperations> {
    const p = this.operator(operator), token = cursor === undefined ? undefined : this.open(cursor, operator, p, 'cursor');
    // One account/page bounds requests to 100 without skipping part of an aggregate.
    const page = await (this.repository.storage.listAccounts?.({ limit: 1, ...(token?.after ? { after: token.after } : {}) }) ?? fail(503, 'rights_storage_unavailable'));
    const now = this.now(), rows = page.accountIds.flatMap(id => { const d = this.repository.read(id); this.now(d); return d?.requests ?? []; });
    this.operator(operator, p);
    const requests = rows.map(r => this.operationView(r, operator, p, now));
    const nextCursor = page.next ? this.seal({ version: 1, type: 'cursor', operatorRef: this.ref('operator', String(operator)), policy: digest(p), issuedAt: now, expiresAt: safeAdd(now, p.handleLifetimeMs), after: page.next }) : undefined;
    this.operator(operator, p);
    return { requests, ...(nextCursor ? { nextCursor } : {}), policyStatus: rows.some(r => r.retention.reviewOrExpiryAt <= this.now()) ? 'unavailable' : 'available' };
  }
  async operatorAction(operator: number, requestId: string, raw: OperatorAction): Promise<{ replayed: boolean; request: RightsOperationView; policyStatus: 'available' | 'unavailable' }> {
    reference.parse(requestId); const input = operatorActionSchema.parse(raw), p = this.operator(operator), token = this.open(input.operationHandle, operator, p, 'operation');
    if (token.requestId !== requestId) return fail(403, 'operation_handle_invalid');
    const accountId = token.accountId!, space = token.space!, command = { version: input.version, eventId: input.eventId, expectedRevision: input.expectedRevision, action: input.action, reasonCode: input.reasonCode };
    const fp = digest(['operator', operator, accountId, space, requestId, command, token]), current = this.repository.read(accountId), now = this.now(current);
    let replayed = !!this.replay(current, input.eventId, fp, now);
    if (!replayed) {
      try { await this.repository.transaction(accountId, () => this.now(), d => {
        const at = this.now(d); if (this.replay(d, input.eventId, fp, at)) throw new RightsReplay(); this.admit(d, p, at);
        const r = this.row(d, requestId, space); if (r.revision !== input.expectedRevision) return fail(409, 'rights_conflict');
        this.transition(r, input.action, input.reasonCode, 'privacy_operator', String(operator), at, p); this.receipt(d, r, input, fp, at, p);
      }, () => { this.operator(operator, p); this.open(input.operationHandle, operator, p, 'operation'); }); }
      catch (e) { if (e instanceof RightsReplay) replayed = true; else throw e; }
    }
    const d = this.repository.read(accountId), at = this.now(d); this.operator(operator, p);
    return { replayed, request: this.operationView(this.row(d, requestId, space), operator, p, at), policyStatus: this.available(d, at) ? 'available' : 'unavailable' };
  }
}
