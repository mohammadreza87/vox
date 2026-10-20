import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { fail } from '../rights-intake/repository';
import { closeSchema, createSchema, credentialInputSchema, ledgerSchema, operatorInputSchema, type GuestLedger, type GuestRecord, type GuestView, type GuestCredential, type GuestCreate, type GuestClose, type GuestOperatorInput } from './contracts';
import { guestPolicySchema, type GuestPolicy } from './policy';
import type { GuestRightsStorage } from './storage';
export interface GuestRightsOptions {
    policy: () => unknown;
    key: () => Buffer | undefined;
    clock?: () => number;
    assertOperatorNow: (id: number) => void;
    assertRequestNow?: () => void;
}
type Result = {
    request: GuestView;
    replayed: boolean;
} | {
    expired: true;
    requestId: string;
    retainUntil: number;
};
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const add = (a: number, b: number) => { const n = a + b; if (!Number.isSafeInteger(n) || n <= a)
    return fail(503, 'guest_policy_unavailable'); return n; };
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const envelope = z.object({ version: z.literal(1), type: z.enum(['draft', 'operation']), requestId: z.string().uuid(), credentialHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), operatorRef: z.string().regex(/^[a-f0-9]{64}$/).optional(), revision: z.number().int().positive().optional(), policy: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: z.number().int().nonnegative().safe(), expiresAt: z.number().int().nonnegative().safe() }).strict();
function validAudit(a: GuestRecord['audit'][number], index: number): boolean {
    if (index === 0) return a.action === 'request_received' && a.actor === 'requester' && a.from === null && a.to === 'received';
    if (a.from === null) return false;
    if (a.action === 'reassess_retention') return a.actor === 'privacy_operator' && a.from === a.to;
    if (a.from === 'closed_unfulfilled') return false;
    if (a.action === 'close_unfulfilled') return a.to === 'closed_unfulfilled';
    if (a.actor !== 'privacy_operator') return false;
    if (a.action === 'begin_review') return a.from === 'received' && a.to === 'operator_review';
    if (a.action === 'request_requester_action') return ['received','operator_review','operator_action_pending'].includes(a.from) && a.to === 'awaiting_requester';
    if (a.action === 'mark_operator_pending') return ['received','operator_review','awaiting_requester'].includes(a.from) && a.to === 'operator_action_pending';
    return false;
}
export class GuestRightsService {
    private observed = 0;
    constructor(readonly storage: GuestRightsStorage, readonly options: GuestRightsOptions) { }
    forRequest(guard: () => void) { return new GuestRightsService(this.storage, { ...this.options, assertRequestNow: () => { this.options.assertRequestNow?.(); guard(); } }); }
    private key() { const key = this.options.key(); if (key?.length !== 32)
        return fail(503, 'guest_unavailable'); return key; }
    private ref(domain: string, value: string) { return createHmac('sha256', this.key()).update(`vox-guest-rights:${domain}:v1\0${value}`).digest('hex'); }
    private keyId() { return this.ref('continuity', 'guest-ledger'); }
    private now(d?: GuestLedger | null) { this.options.assertRequestNow?.(); const n = (this.options.clock ?? Date.now)(); if (!Number.isSafeInteger(n) || n < 0 || n < this.observed || n < (d?.observedAt ?? 0))
        return fail(503, 'guest_clock_unavailable'); this.storage.observe(n); this.options.assertRequestNow?.(); this.observed = n; return n; }
    private parse(raw: unknown): GuestLedger { const parsed = ledgerSchema.safeParse(raw); if (!parsed.success)
        return fail(503, 'guest_storage_unavailable'); const d = parsed.data; if (!same(d.keyId, this.keyId()))
        return fail(503, 'guest_key_continuity_required'); const ids = new Set(d.requests.map(r => r.requestId)); if (ids.size !== d.requests.length || new Set(d.tombstones.map(r => r.requestId)).size !== d.tombstones.length || new Set(d.receipts.map(r => r.eventHash)).size !== d.receipts.length || d.tombstones.some(t => ids.has(t.requestId) || t.purgedAt > d.observedAt || t.retainUntil <= t.purgedAt) || d.admission.windowStart > d.observedAt || d.requests.some(r => r.revision !== r.audit.length || r.createdAt > r.updatedAt || r.updatedAt > d.observedAt || r.retention.reviewAt <= r.createdAt || r.retention.auditUntil <= r.createdAt || r.audit[0].action !== 'request_received' || r.audit[0].from !== null || r.audit[0].to !== 'received' || r.audit[0].actor !== 'requester' || r.audit[0].at !== r.createdAt || r.audit.at(-1)!.to !== r.state || r.audit.at(-1)!.at !== r.updatedAt || r.audit.some((a, i) => !validAudit(a, i) || a.seq !== i + 1 || a.at > r.updatedAt || i > 0 && (a.from !== r.audit[i - 1].to || a.at < r.audit[i - 1].at)) || r.state === 'closed_unfulfilled' && (r.retention.terminalUntil === undefined || r.retention.terminalUntil <= (r.audit.find(a => a.action === 'close_unfulfilled')?.at ?? Number.MAX_SAFE_INTEGER)) || r.state !== 'closed_unfulfilled' && r.retention.terminalUntil !== undefined) || d.receipts.some(c => c.at > d.observedAt || c.retainUntil <= c.at || !d.requests.some(r => r.requestId === c.requestId && r.revision >= c.revision) && !d.tombstones.some(t => t.requestId === c.requestId && t.lastRevision >= c.revision && t.retainUntil >= c.retainUntil)))
        return fail(503, 'guest_storage_unavailable'); return d; }
    private read() { this.key(); const value = this.storage.read(); if (value.status !== 'ready')
        return fail(503, 'guest_storage_busy'); return value.document === null ? null : this.parse(value.document); }
    private policy(now: number) { const result = guestPolicySchema.safeParse(this.options.policy()); if (!result.success || this.options.key()?.length !== 32)
        return; const p = result.data; if (p.effectiveAt > now || p.expiresAt <= now || [p.draftLifetimeMs, p.operationLifetimeMs, p.admission.windowMs, ...Object.values(p.retention)].some(ms => !Number.isSafeInteger(now + ms)))
        return; if (!p.privacyOperatorIds.some(id => { try {
        this.options.assertOperatorNow(id);
        return true;
    }
    catch {
        return false;
    } }))
        return; return p; }
    private requirePolicy(now: number, expected?: GuestPolicy) { this.options.assertRequestNow?.(); const p = this.policy(now); this.options.assertRequestNow?.(); if (!p || expected && hash(expected) !== hash(p))
        return fail(503, 'guest_policy_unavailable'); return p; }
    private operator(id: number, now: number, expected?: GuestPolicy) { this.options.assertOperatorNow(id); const p = this.requirePolicy(now, expected); if (!p.privacyOperatorIds.includes(id))
        return fail(403, 'guest_operator_required'); this.options.assertOperatorNow(id); return p; }
    private seal(v: z.infer<typeof envelope>) { const body = Buffer.from(JSON.stringify(v)).toString('base64url'); return body + '.' + this.ref('ticket', body); }
    private open(raw: string, type: 'draft' | 'operation', p: GuestPolicy, now: number) { try {
        const parts = raw.split('.');
        if (parts.length !== 2 || !/^[A-Za-z0-9_-]{1,1800}$/.test(parts[0]) || !same(parts[1], this.ref('ticket', parts[0])))
            return fail(403, 'guest_handle_invalid');
        const token = envelope.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
        if (token.type !== type || token.policy !== hash(p) || token.issuedAt > now || token.expiresAt <= now || token.expiresAt <= token.issuedAt || type === 'draft' && (!token.credentialHash || token.operatorRef || token.revision) || type === 'operation' && (!token.operatorRef || !token.revision || token.credentialHash))
            return fail(403, 'guest_handle_invalid');
        return token;
    }
    catch {
        return fail(403, 'guest_handle_invalid');
    } }
    private view(r: GuestRecord, now: number): GuestView {
        return { requestId: r.requestId, context: r.context, kind: r.kind, locale: r.locale, revision: r.revision,
            createdAt: r.createdAt, updatedAt: r.updatedAt, state: r.state, policy: structuredClone(r.policy),
            deadline: structuredClone(r.deadline), retention: structuredClone(r.retention), retentionReviewRequired: r.retention.reviewAt <= now };
    }
    private authorized(d: GuestLedger | null, input: GuestCredential) { const digest = this.ref('credential', input.credential), r = d?.requests.find(r => r.requestId === input.requestId); if (r && same(r.credentialHash, digest))
        return r; const t = d?.tombstones.find(t => t.requestId === input.requestId && same(t.credentialHash, digest)); if (t && t.retainUntil > this.observed)
        return t; return fail(404, 'guest_not_found'); }
    private current(r: GuestRecord | GuestLedger['tombstones'][number], now: number, replayed = false): Result { return 'purgedAt' in r ? { expired: true, requestId: r.requestId, retainUntil: r.retainUntil } : { request: this.view(r, now), replayed }; }
    notice() { if (this.options.key()?.length !== 32 || !guestPolicySchema.safeParse(this.options.policy()).success)
        return { available: false, supportedKinds: [] }; const d = this.read(), now = this.now(d), p = this.policy(now); return { available: !!p?.admissionEnabled, supportedKinds: p?.admissionEnabled ? p.supportedKinds : [], ...(p ? { policyRevision: p.revision } : {}), copyVersion: 'guest-rights-gi1-v1' }; }
    draft() { const d = this.read(), now = this.now(d), p = this.requirePolicy(now); if (!p.admissionEnabled)
        return fail(503, 'guest_admission_disabled'); const requestId = randomUUID(), credential = randomBytes(32).toString('base64url'), expiresAt = Math.min(add(now, p.draftLifetimeMs), p.expiresAt); return { version: 1 as const, requestId, credential, ticket: this.seal({ version: 1, type: 'draft', requestId, credentialHash: this.ref('credential', credential), policy: hash(p), issuedAt: now, expiresAt }), expiresAt, policyRevision: p.revision }; }
    status(value: GuestCredential): Result { const input = credentialInputSchema.parse(value), d = this.read(), now = this.now(d); return this.current(this.authorized(d, input), now); }
    private async transaction<T>(mutate: (d: GuestLedger, now: number) => T, fence: (d: GuestLedger) => void) { let draft: GuestLedger | undefined; return this.storage.transact(raw => { const existing = raw === null ? null : this.parse(raw), now = this.now(existing); const d: GuestLedger = existing ?? { schemaVersion: 1, keyId: this.keyId(), revision: 1, observedAt: now, admission: { windowStart: now, count: 0 }, requests: [], tombstones: [], receipts: [] }; draft = d; d.tombstones = d.tombstones.filter(t => t.retainUntil > now); d.receipts = d.receipts.filter(r => r.retainUntil > now); const result = mutate(d, now); d.observedAt = this.now(d); if (!Number.isSafeInteger(d.revision + 1))
        return fail(503, 'guest_storage_unavailable'); d.revision++; this.parse(d); return { document: d, result }; }, () => { if (!draft)
        return fail(503, 'guest_storage_unavailable'); if (!same(draft.keyId, this.keyId()))
        return fail(503, 'guest_key_continuity_required'); fence(draft); }); }
    private replay(d: GuestLedger, eventId: string, input: unknown, requestId: string) { const eventHash = this.ref('event', eventId), prior = d.receipts.find(r => r.eventHash === eventHash); if (prior && (prior.fingerprint !== hash(input) || prior.requestId !== requestId))
        return fail(409, 'guest_event_conflict'); return !!prior; }
    private receipt(d: GuestLedger, eventId: string, input: unknown, r: GuestRecord, p: GuestPolicy, now: number) { if (d.receipts.length >= 128)
        return fail(409, 'guest_capacity'); d.receipts.push({ eventHash: this.ref('event', eventId), fingerprint: hash(input), requestId: r.requestId, revision: r.revision, at: now, retainUntil: add(now, p.retention.receiptMs) }); }
    async create(value: GuestCreate): Promise<Result> { const input = createSchema.parse(value); let approved: GuestPolicy | undefined; return this.transaction((d, now) => { if (this.replay(d, input.eventId, input, input.requestId))
        return this.current(this.authorized(d, input), now, true); if (d.requests.some(r => r.requestId === input.requestId) || d.tombstones.some(t => t.requestId === input.requestId))
        return fail(409, 'guest_reference_conflict'); const p = this.requirePolicy(now); approved = p; if (!p.admissionEnabled)
        return fail(503, 'guest_admission_disabled'); if (input.expectedPolicyRevision !== p.revision || !p.supportedKinds.includes(input.kind))
        return fail(409, 'guest_policy_changed'); const ticket = this.open(input.ticket, 'draft', p, now); if (ticket.requestId !== input.requestId || !same(ticket.credentialHash!, this.ref('credential', input.credential)))
        return fail(403, 'guest_handle_invalid'); if (d.requests.length >= p.admission.maxRecords || d.requests.filter(r => r.state !== 'closed_unfulfilled').length >= p.admission.maxOpen)
        return fail(409, 'guest_capacity'); if (now >= add(d.admission.windowStart, p.admission.windowMs))
        d.admission = { windowStart: now, count: 0 }; if (d.admission.count >= p.admission.maxPerWindow)
        return fail(429, 'guest_admission_limited'); d.admission.count++; const r: GuestRecord = { requestId: input.requestId, credentialHash: ticket.credentialHash!, context: input.context, kind: input.kind, locale: input.locale, revision: 1, createdAt: now, updatedAt: now, state: 'received', policy: { id: p.id, revision: p.revision, copyVersion: p.copyVersion }, deadline: { state: 'unresolved' }, retention: { reviewAt: add(now, p.retention.reviewAfterMs), auditUntil: add(now, p.retention.auditMs) }, audit: [{ seq: 1, at: now, actor: 'requester', actorRef: this.ref('requester', input.requestId), action: 'request_received', from: null, to: 'received', policyRevision: p.revision }] }; d.requests.push(r); this.receipt(d, input.eventId, input, r, p, now); return this.current(r, now); }, d => { const now = this.now(d); if (approved)
        this.requirePolicy(now, approved); }); }
    private audit(r: GuestRecord, action: GuestRecord['audit'][number]['action'], actor: 'requester' | 'privacy_operator', actorRef: string, to: GuestRecord['state'], p: GuestPolicy, now: number) { if (r.audit.length >= 32)
        return fail(409, 'guest_audit_capacity'); r.audit.push({ seq: r.audit.length + 1, at: now, actor, actorRef, action, from: r.state, to, policyRevision: p.revision }); r.state = to; r.revision++; r.updatedAt = now; }
    async close(value: GuestClose): Promise<Result> { const input = closeSchema.parse(value); let approved: GuestPolicy | undefined; return this.transaction((d, now) => { const r = this.authorized(d, input); if (this.replay(d, input.eventId, input, input.requestId))
        return this.current(r, now, true); if ('purgedAt' in r)
        return this.current(r, now); const p = this.requirePolicy(now); approved = p; if (r.revision !== input.expectedRevision)
        return fail(409, 'guest_revision_conflict'); if (r.state === 'closed_unfulfilled')
        return fail(409, 'guest_state_conflict'); this.audit(r, 'close_unfulfilled', 'requester', this.ref('requester', r.requestId), 'closed_unfulfilled', p, now); r.retention.terminalUntil = add(now, p.retention.terminalMs); this.receipt(d, input.eventId, input, r, p, now); return this.current(r, now); }, d => { const now = this.now(d); if (approved)
        this.requirePolicy(now, approved); }); }
    operations(id: number) { const d = this.read(), now = this.now(d), p = this.operator(id, now); const requests = (d?.requests ?? []).map(r => ({ ...this.view(r, now), operationHandle: this.seal({ version: 1, type: 'operation', requestId: r.requestId, operatorRef: this.ref('operator', String(id)), revision: r.revision, policy: hash(p), issuedAt: now, expiresAt: Math.min(add(now, p.operationLifetimeMs), p.expiresAt) }), audit: r.audit.map(entry => ({seq:entry.seq,at:entry.at,actor:entry.actor,action:entry.action,from:entry.from,to:entry.to,policyRevision:entry.policyRevision})) })); this.operator(id, this.now(d), p); return { requests, policyRevision: p.revision, admissionEnabled: p.admissionEnabled }; }
    async operatorAction(id: number, value: GuestOperatorInput) { const input = operatorInputSchema.parse(value); let approved: GuestPolicy | undefined; return this.transaction((d, now) => { const p = this.operator(id, now); approved = p; if (p.revision !== input.expectedPolicyRevision)
        return fail(409, 'guest_policy_changed'); const token = this.open(input.operationHandle, 'operation', p, now); if (token.requestId !== input.requestId || token.revision !== input.expectedRevision || !same(token.operatorRef!, this.ref('operator', String(id))))
        return fail(403, 'guest_handle_invalid'); if (this.replay(d, input.eventId, input, input.requestId))
        return { requestId: input.requestId, replayed: true }; const r = d.requests.find(r => r.requestId === input.requestId); if (!r)
        return fail(404, 'guest_not_found'); if (r.revision !== input.expectedRevision)
        return fail(409, 'guest_revision_conflict'); if (input.action === 'purge_terminal_record') {
        if (r.state !== 'closed_unfulfilled' || r.retention.auditUntil > now || !r.retention.terminalUntil || r.retention.terminalUntil > now)
            return fail(409, 'guest_retention_not_due');
        if (d.tombstones.length >= 128)
            return fail(409, 'guest_capacity');
        const retainUntil = Math.max(add(now, p.retention.continuityMs), ...d.receipts.filter(c => c.requestId === r.requestId).map(c => c.retainUntil));
        for (const c of d.receipts.filter(c => c.requestId === r.requestId))
            c.retainUntil = retainUntil;
        this.receipt(d, input.eventId, input, r, p, now);
        d.receipts.at(-1)!.retainUntil = retainUntil;
        d.tombstones.push({ requestId: r.requestId, credentialHash: r.credentialHash, lastRevision: r.revision, purgedAt: now, retainUntil });
        d.requests = d.requests.filter(row => row !== r);
        return { requestId: r.requestId, replayed: false };
    } if (input.action === 'reassess_retention') {
        const closed = r.audit.find(a => a.action === 'close_unfulfilled');
        this.audit(r, input.action, 'privacy_operator', this.ref('operator', String(id)), r.state, p, now);
        r.retention = { reviewAt: add(now, p.retention.reviewAfterMs), auditUntil: add(r.createdAt, p.retention.auditMs), ...(closed ? { terminalUntil: add(closed.at, p.retention.terminalMs) } : {}) };
    }
    else {
        if (r.state === 'closed_unfulfilled')
            return fail(409, 'guest_state_conflict');
        const next = input.action === 'begin_review' ? 'operator_review' : input.action === 'request_requester_action' ? 'awaiting_requester' : input.action === 'mark_operator_pending' ? 'operator_action_pending' : 'closed_unfulfilled';
        if (input.action === 'begin_review' && r.state !== 'received' || next === r.state)
            return fail(409, 'guest_state_conflict');
        this.audit(r, input.action, 'privacy_operator', this.ref('operator', String(id)), next, p, now);
        if (next === 'closed_unfulfilled')
            r.retention.terminalUntil = add(now, p.retention.terminalMs);
    } this.receipt(d, input.eventId, input, r, p, now); return { requestId: r.requestId, replayed: false }; }, d => { this.operator(id, this.now(d), approved); }); }
}
