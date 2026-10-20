import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { GuestRightsService } from './service';
import { GuestRightsStorage } from './storage';
import { syntheticGuestPolicy, GUEST_TEST_NOW } from './fixtures';
import { guestPolicySchema } from './policy';
function fixture() { const dir = mkdtempSync('/tmp/vox-guest-author-'); let now = GUEST_TEST_NOW, policy: unknown = syntheticGuestPolicy(), key: Buffer | undefined = Buffer.alloc(32, 7), allowed = true; const storage = new GuestRightsStorage(join(dir, 'guest-rights', 'v1')); const options = { clock: () => now, policy: () => policy, key: () => key, assertOperatorNow: (id: number) => { if (!allowed || id !== 123)
        throw Error('denied'); } }; const service = new GuestRightsService(storage, options); return { dir, storage, service, options, time: (n: number) => now = n, policy: (p: unknown) => policy = p, key: (k: Buffer | undefined) => key = k, revoke: () => allowed = false }; }
async function created(f: ReturnType<typeof fixture>) {
    const draft = f.service.draft();
    const body = {version:1 as const, requestId:draft.requestId,credential:draft.credential,ticket:draft.ticket,eventId:randomUUID(),kind:'erasure' as const,context:'unknown' as const,locale:'en' as const,expectedPolicyRevision:draft.policyRevision};
    const result=await f.service.create(body); return {draft,body,result};
}
function currentView(f:ReturnType<typeof fixture>,draft:ReturnType<GuestRightsService['draft']>) { const result=f.service.status({version:1,requestId:draft.requestId,credential:draft.credential}); if('expired' in result) throw Error('Expected current record'); return result.request; }
const credential = (draft: ReturnType<GuestRightsService['draft']>) => ({ version: 1 as const, requestId: draft.requestId, credential: draft.credential });
function operation(f: ReturnType<typeof fixture>, action: 'close_unfulfilled' | 'reassess_retention' | 'purge_terminal_record' | 'begin_review' = 'begin_review') { const queue = f.service.operations(123), r = queue.requests[0]; return { version: 1 as const, requestId: r.requestId, eventId: randomUUID(), expectedRevision: r.revision, expectedPolicyRevision: queue.policyRevision, action, operationHandle: r.operationHandle }; }
describe('guest metadata-only tracking', () => {
    it('default off creates no data and never mints a weak or caller-selected credential', () => { const f = fixture(); f.key(undefined); expect(f.service.notice().available).toBe(false); expect(() => f.service.draft()).toThrow('guest_unavailable'); expect(existsSync(f.storage.directory)).toBe(false); });
    it('mint allocates no request ledger; create/status work with no account or contact', async () => { const f = fixture(), a = await created(f); expect(a.draft.credential).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a.result).toMatchObject({ request: { context: 'unknown', state: 'received', deadline: { state: 'unresolved' } } }); expect(f.service.status(credential(a.draft))).toMatchObject({ request: { requestId: a.draft.requestId } }); const raw = readFileSync(join(f.storage.directory, GuestRightsStorage.filename), 'utf8'); expect(raw).not.toContain(a.draft.credential); expect(raw).not.toContain(a.draft.ticket); expect(raw).not.toMatch(/telegram-account|email|transcript/); });
    it('draft alone has no ledger row or persisted credential', () => { const f = fixture(), d = f.service.draft(); expect(existsSync(join(f.storage.directory, GuestRightsStorage.filename))).toBe(false); expect(readdirSync(f.storage.directory)).toEqual(['.clock-v1.json']); expect(readFileSync(join(f.storage.directory, '.clock-v1.json'), 'utf8')).not.toContain(d.credential); });
    it('idempotent create returns current state and conflicts are not reinterpreted', async () => { const f = fixture(), a = await created(f); const closed = await f.service.close({ ...credential(a.draft), eventId: randomUUID(), expectedRevision: 1 }); expect(closed).toMatchObject({ request: { state: 'closed_unfulfilled' } }); expect(await f.service.create(a.body)).toMatchObject({ replayed: true, request: { state: 'closed_unfulfilled' } }); await expect(f.service.create({ ...a.body, kind: 'correction' })).rejects.toMatchObject({ status: 409, code: 'guest_event_conflict' }); });
    it.each(['credential', 'reference', 'payload', 'ticket'] as const)('rejects wrong %s without revealing detail', async (mode) => { const f = fixture(), a = await created(f); if (mode === 'credential')
        expect(() => f.service.status({ ...credential(a.draft), credential: 'b'.repeat(43) })).toThrow('guest_not_found'); if (mode === 'reference')
        expect(() => f.service.status({ ...credential(a.draft), requestId: randomUUID() })).toThrow('guest_not_found'); if (mode === 'payload')
        await expect(f.service.create({ ...a.body, text: 'PRIVATE' } as never)).rejects.toThrow(); if (mode === 'ticket') {
        const d = f.service.draft();
        const input = { ...a.body, ...credential(d), eventId: randomUUID(), ticket: a.draft.ticket };
        await expect(f.service.create(input)).rejects.toThrow('guest_handle_invalid');
    } });
    it('disabled admissions preserve credential status and current operator retention management', async () => { const f = fixture(), a = await created(f); f.policy({ ...syntheticGuestPolicy(), admissionEnabled: false }); expect(f.service.notice().available).toBe(false); expect(() => f.service.draft()).toThrow('guest_admission_disabled'); expect(f.service.status(credential(a.draft))).toMatchObject({ request: { state: 'received' } }); expect(f.service.operations(123).requests).toHaveLength(1); await expect(f.service.operatorAction(123, operation(f))).resolves.toMatchObject({ replayed: false }); });
    it('expiry and missing policy preserve status but disable new admissions and operator mutations', async () => { const f = fixture(), a = await created(f); f.policy(undefined); expect(f.service.status(credential(a.draft))).toMatchObject({ request: { state: 'received' } }); expect(() => f.service.operations(123)).toThrow('guest_policy_unavailable'); f.policy(syntheticGuestPolicy()); f.time(GUEST_TEST_NOW + 1000001); expect(f.service.status(credential(a.draft))).toMatchObject({ request: { state: 'received' } }); expect(() => f.service.draft()).toThrow('guest_policy_unavailable'); });
    it('key replacement/loss cannot initialize or reset retained ledger; same-key restart retains status', async () => { const f = fixture(), a = await created(f), path = join(f.storage.directory, GuestRightsStorage.filename), before = readFileSync(path); f.key(Buffer.alloc(32, 8)); expect(() => f.service.status(credential(a.draft))).toThrow('guest_key_continuity_required'); expect(() => f.service.draft()).toThrow('guest_key_continuity_required'); expect(readFileSync(path)).toEqual(before); f.key(undefined); expect(() => f.service.status(credential(a.draft))).toThrow('guest_unavailable'); f.key(Buffer.alloc(32, 7)); expect(new GuestRightsService(new GuestRightsStorage(f.storage.directory), f.options).status(credential(a.draft))).toMatchObject({ request: { state: 'received' } }); });
    it('current operator membership/allowlist/handles and revision are all required', async () => { const f = fixture(); await created(f); const old = operation(f); await f.service.operatorAction(123, old); await expect(f.service.operatorAction(123, { ...old, eventId: randomUUID() })).rejects.toThrow('guest_revision_conflict'); await expect(f.service.operatorAction(124, operation(f))).rejects.toThrow(); f.revoke(); expect(() => f.service.operations(123)).toThrow(); });
    it('durable admission limit survives fresh service and clock rollback cannot reopen a window', async () => { const f = fixture(); f.policy({ ...syntheticGuestPolicy(), admission: { ...syntheticGuestPolicy().admission, maxPerWindow: 1 } }); await created(f); const next = new GuestRightsService(new GuestRightsStorage(f.storage.directory), f.options), d = next.draft(); await expect(next.create({ version: 1, requestId: d.requestId, credential: d.credential, ticket: d.ticket, eventId: randomUUID(), kind: 'erasure', context: 'unknown', locale: 'en', expectedPolicyRevision: 1 })).rejects.toThrow('guest_admission_limited'); f.time(GUEST_TEST_NOW - 1); expect(() => new GuestRightsService(new GuestRightsStorage(f.storage.directory), f.options).notice()).toThrow(); });
    it('policy shortening preserves both floors until explicit reassessment; purge has finite private410 continuity', async () => {
        const f=fixture(),a=await created(f); f.time(GUEST_TEST_NOW+1);
        await f.service.operatorAction(123,operation(f,'close_unfulfilled'));
        const original=currentView(f,a.draft); expect(original.retention.terminalUntil).toBe(GUEST_TEST_NOW+2001);
        f.time(GUEST_TEST_NOW+1100); f.policy({...syntheticGuestPolicy(),revision:2,retention:{reviewAfterMs:1,auditMs:2,terminalMs:3,continuityMs:100,receiptMs:100}});
        expect(currentView(f,a.draft).retention).toEqual(original.retention);
        await expect(f.service.operatorAction(123,operation(f,'purge_terminal_record'))).rejects.toThrow('guest_retention_not_due');
        await f.service.operatorAction(123,operation(f,'reassess_retention'));
        expect(currentView(f,a.draft).retention.auditUntil).toBe(GUEST_TEST_NOW+2);
        expect(currentView(f,a.draft).retention.terminalUntil).toBe(GUEST_TEST_NOW+4);
        const purge=operation(f,'purge_terminal_record'); await f.service.operatorAction(123,purge);
        expect(f.service.status(credential(a.draft))).toMatchObject({expired:true,requestId:a.draft.requestId});
        expect(()=>f.service.status({...credential(a.draft),credential:'z'.repeat(43)})).toThrow('guest_not_found');
        await expect(f.service.operatorAction(123,purge)).resolves.toMatchObject({replayed:true});
        f.time(GUEST_TEST_NOW+1205); expect(()=>f.service.status(credential(a.draft))).toThrow('guest_not_found');
    });
    it.each(['received','operator_review','awaiting_requester','operator_action_pending'] as const)('unresolved %s is never purged by age', async state => {
        const f=fixture(); await created(f);
        if(state==='operator_review') await f.service.operatorAction(123,operation(f,'begin_review'));
        if(state==='awaiting_requester'||state==='operator_action_pending') { const row=f.service.operations(123).requests[0]; await f.service.operatorAction(123,{...operation(f),action:state==='awaiting_requester'?'request_requester_action':'mark_operator_pending',expectedRevision:row.revision}); }
        f.time(GUEST_TEST_NOW+10000);
        await expect(f.service.operatorAction(123,operation(f,'purge_terminal_record'))).rejects.toThrow('guest_retention_not_due');
        expect(f.service.operations(123).requests[0].state).toBe(state);
    });
    it('notice copy hashes, durations and legal-deadline claims cannot be silently defaulted', () => { const p = syntheticGuestPolicy(); expect(guestPolicySchema.safeParse({ ...p, noticeHashes: { ...p.noticeHashes, fa: '0'.repeat(64) } }).success).toBe(false); expect(guestPolicySchema.safeParse({ ...p, retention: { ...p.retention, auditMs: 0 } }).success).toBe(false); expect(guestPolicySchema.safeParse({ ...p, deadlineRules: [] }).success).toBe(false); });
});
it('audit capacity preserves unresolved evidence instead of dropping history',async()=>{const f=fixture(),a=await created(f);for(let i=1;i<32;i++){const q=f.service.operations(123),r=q.requests[0];await f.service.operatorAction(123,{version:1,requestId:r.requestId,eventId:randomUUID(),expectedRevision:r.revision,expectedPolicyRevision:1,action:r.state==='awaiting_requester'?'mark_operator_pending':'request_requester_action',operationHandle:r.operationHandle});}const path=join(f.storage.directory,GuestRightsStorage.filename),before=readFileSync(path);await expect(f.service.close({...credential(a.draft),eventId:randomUUID(),expectedRevision:32})).rejects.toThrow('guest_audit_capacity');expect(readFileSync(path)).toEqual(before);expect(f.service.operations(123).requests[0].audit).toHaveLength(32);});

it('purge binds its new receipt horizon from actual purge time even when continuity is shorter', async () => {
    const f = fixture();
    f.policy({...syntheticGuestPolicy(), retention:{reviewAfterMs:100,auditMs:1000,terminalMs:100,continuityMs:100,receiptMs:5000}});
    const a=await created(f);
    await f.service.close({...credential(a.draft),eventId:randomUUID(),expectedRevision:1});
    f.time(GUEST_TEST_NOW+1000);
    const purge=operation(f,'purge_terminal_record');
    await f.service.operatorAction(123,purge);
    const ledger=JSON.parse(readFileSync(join(f.storage.directory,GuestRightsStorage.filename),'utf8'));
    expect(ledger.receipts).toHaveLength(3);
    expect(ledger.receipts.every((r:{retainUntil:number})=>r.retainUntil>=GUEST_TEST_NOW+6000)).toBe(true);
    expect(ledger.tombstones[0].retainUntil).toBeGreaterThanOrEqual(GUEST_TEST_NOW+6000);
    f.time(GUEST_TEST_NOW+5001);
    const restarted=new GuestRightsService(new GuestRightsStorage(f.storage.directory),f.options);
    expect(restarted.status(credential(a.draft))).toMatchObject({expired:true,retainUntil:GUEST_TEST_NOW+6000});
    await expect(restarted.operatorAction(123,purge)).resolves.toMatchObject({replayed:true});
    f.time(GUEST_TEST_NOW+6001);
    expect(()=>restarted.status(credential(a.draft))).toThrow('guest_not_found');
});
