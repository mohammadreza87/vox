import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage, MemoryAdaptiveStorage } from '../persistence/storage';
import { SharedMemoryRepository } from '../shared/repository';
import { SharedMemoryService } from '../shared/service';
import { AdaptiveLifecycleService } from './service';
import { AdaptiveMaintenanceRunner } from './maintenance';

const START = 1_800_000_000_000, DAY = 86_400_000;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(count = 3) {
  const root = await mkdtemp(join(tmpdir(), 'vox-lifecycle-')); roots.push(root);
  let now = START;
  const ids = Array.from({ length: count }, (_, n) => 101 + n);
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-lifecycle', enabledCapabilities: ['core_text', 'personalization'],
    accounts: ids.map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, n) => ({ schemaVersion: 1, id: `approval-${n}`, revision: 1,
      createdAt: START, updatedAt: START, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-lifecycle',
      effectiveAt: START, reviewExpiresAt: START + 400 * DAY, owner: 'synthetic', approvalReference: 'synthetic' })) });
  const storage = new FileAdaptiveStorage(join(root, 'accounts'));
  const factory = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(storage.directory)), {
    ...adaptiveOptionsFromManifest(manifest), now: () => now,
  });
  const adaptive = factory();
  for (const id of ids) await adaptive.confirm(id, { confirm: true, adultConfirmed: true });
  async function memory(id: number, space: 'work' | 'personal', text: string, eventId: string) {
    const before = await adaptive.read(id, space);
    return adaptive.createMemory(id, { space, text, eventId, expectedRevision: before.revision });
  }
  const shared = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared'))), adaptive, {
    member: async id => ({ active: ids.includes(id), agentIds: ['agent'] }),
    group: async () => null, agent: async () => ({ active: true }),
  }, () => now);
  return { root, ids, storage, factory, adaptive, shared, memory, now: () => now, setNow: (value: number) => { now = value; } };
}

describe('account rights and durable maintenance', () => {
  it('exports a selected own space, published authorized shared rows, and no receipts, fingerprints or third-party private canaries', async () => {
    const f = await fixture();
    await f.memory(101, 'work', 'OWN_WORK', 'work-memory-1');
    await f.memory(101, 'personal', 'OWN_PERSONAL', 'personal-memory-1');
    await f.memory(102, 'work', 'OTHER_PRIVATE', 'other-memory-1');
    await f.adaptive.present(101, { space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: 1, eventId: 'present-secret' });
    const preview = await f.shared.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await f.shared.create(101, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'AUTHORIZED_SHARED', expectedRevision: 0, eventId: 'create-shared' });
    await f.shared.repository.transaction(d => {
      const c = d.containers[0];
      const m = structuredClone(c.memories[0]); m.id = 'pending-memory'; m.status = 'pending'; m.text = 'UNPUBLISHED_SECRET';
      m.publication = { operationId: 'pending-operation', authorityKey: 'secret-authority', intentFingerprint: 'secret-fingerprint',
        contentDigest: 'secret-digest', audienceKey: 'secret-audience', stagedAt: START, validUntil: START + 30_000 };
      c.memories.push(m); d.revision++;
    });
    const lifecycle = new AdaptiveLifecycleService(f.adaptive, { shared: f.shared });
    const exported = await lifecycle.exportAccount(101, 'work');
    const encoded = JSON.stringify(exported);
    expect(encoded).toContain('OWN_WORK'); expect(encoded).toContain('AUTHORIZED_SHARED');
    for (const secret of ['OWN_PERSONAL', 'OTHER_PRIVATE', 'UNPUBLISHED_SECRET', 'secret-fingerprint', 'lastCommandFingerprint', 'receipts', 'sourceFence', preview.previewToken]) expect(encoded).not.toContain(secret);
    expect((await lifecycle.exportAccount(103, 'work')).sharedContributions).toEqual([]);
    await expect(lifecycle.exportAccount(101, 'invalid' as 'work')).rejects.toMatchObject({ code: 'invalid_space' });
    f.setNow(START + 12 * 3600_000);
    await expect(lifecycle.exportAccount(101, 'work')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  });

  it('drops a prepared export when fresh account authority changes during the shared projection', async () => {
    const f = await fixture();
    const list = f.shared.list.bind(f.shared);
    f.shared.list = async (...args) => {
      const result = await list(...args);
      await f.adaptive.confirm(101, { confirm: true, adultConfirmed: true });
      return result;
    };
    await expect(new AdaptiveLifecycleService(f.adaptive, { shared: f.shared }).exportAccount(101, 'work'))
      .rejects.toMatchObject({ code: 'export_authority_changed' });
  });

  it('drops a prepared export when external group authority changes without a shared repository write', async () => {
    const f = await fixture();
    let revision = 'initial';
    f.shared.authority.group = async () => ({ memberTelegramIds: [101, 102], hasGuests: false, revision });
    const preview = await f.shared.preview(101, { space: 'work', kind: 'group', recipientTelegramIds: [], groupId: 'group' });
    await f.shared.create(101, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'SHARED_EXPORT_CANARY', expectedRevision: 0, eventId: 'shared-export' });
    const list = f.shared.list.bind(f.shared);
    f.shared.list = async (...args) => {
      const prepared = await list(...args);
      const storedRevision = await f.shared.repository.transaction(d => d.revision);
      revision = 'membership-changed';
      expect(await f.shared.repository.transaction(d => d.revision)).toBe(storedRevision);
      return prepared;
    };
    await expect(new AdaptiveLifecycleService(f.adaptive, { shared: f.shared }).exportAccount(101, 'work'))
      .rejects.toMatchObject({ code: 'export_authority_changed' });
    expect((await list(101, 'work')).containers.flatMap(c => c.memories)).toEqual([]);
  });

  it('checks external group authority after the final awaited private account validation', async () => {
    const f = await fixture();
    let revision = 'initial';
    f.shared.authority.group = async () => ({ memberTelegramIds: [101, 102], hasGuests: false, revision });
    const preview = await f.shared.preview(101, { space: 'work', kind: 'group', recipientTelegramIds: [], groupId: 'group' });
    await f.shared.create(101, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'SHARED_EXPORT_CANARY', expectedRevision: 0, eventId: 'shared-export' });
    const validate = f.shared.revalidateExport.bind(f.shared);
    f.shared.revalidateExport = (...args) => validate(args[0], args[1], args[2], async () => {
      await args[3]();
      revision = 'membership-changed';
    });
    await expect(new AdaptiveLifecycleService(f.adaptive, { shared: f.shared }).exportAccount(101, 'work'))
      .rejects.toMatchObject({ code: 'audience_changed' });
  });

  it('drops shared payloads that expire during the final awaited account check', async () => {
    const f = await fixture();
    const preview = await f.shared.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await f.shared.create(101, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'EXPIRING_EXPORT_CANARY', expectedRevision: 0, eventId: 'expiring-export' });
    await f.shared.repository.transaction(d => { d.containers[0].memories[0].expiresAt = START + 1000; d.revision++; });
    const validate = f.shared.revalidateExport.bind(f.shared);
    f.shared.revalidateExport = (...args) => validate(args[0], args[1], args[2], async () => {
      await args[3](); f.setNow(START + 1001);
    });
    await expect(new AdaptiveLifecycleService(f.adaptive, { shared: f.shared }).exportAccount(101, 'work'))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(JSON.stringify(await f.shared.repository.transaction(d => d))).not.toContain('EXPIRING_EXPORT_CANARY');
  });

  it('erases expired payloads for inactive accounts after restart and keeps replay deletion tombstones', async () => {
    const f = await fixture();
    const saved = await f.memory(101, 'work', 'EXPIRING_PRIVATE_CANARY', 'original-memory');
    await f.adaptive.present(101, { space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: 1, eventId: 'expired-presentation' });
    const preview = await f.shared.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await f.shared.create(101, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'EXPIRING_SHARED_CANARY', expectedRevision: 0, eventId: 'shared-to-expire' });
    f.setNow(START + 91 * DAY);
    const restarted = new AdaptiveLifecycleService(f.factory(), { shared: f.shared });
    await restarted.sweepAccount(101); await restarted.sweepShared();
    const current = await f.adaptive.repository.transaction(accountIdFor(101), f.now(), d => d);
    expect(current.memories[0]).toMatchObject({ id: saved.memories[0].id, status: 'deleted' });
    expect(current.memories[0].text).toBeUndefined(); expect(current.receipts).toEqual([]);
    expect(current.events.some(e => e.eventId === 'original-memory')).toBe(true);
    expect(current.outbox.some(e => e.memoryId === saved.memories[0].id)).toBe(true);
    expect(JSON.stringify(await f.shared.repository.transaction(d => d))).not.toContain('EXPIRING_SHARED_CANARY');
    await f.factory().confirm(101, { confirm: true, adultConfirmed: true });
    const replayed = await f.factory().createMemory(101, { space: 'work', text: 'EXPIRING_PRIVATE_CANARY', eventId: 'original-memory', expectedRevision: saved.revision - 1 });
    expect(replayed.memories).toEqual([]);
    expect(JSON.stringify(await f.adaptive.repository.transaction(accountIdFor(101), f.now(), d => d))).not.toContain('EXPIRING_PRIVATE_CANARY');
  });

  it('reconciles a pre-deletion backup using current authority and refuses snapshot-only recovery', async () => {
    const f = await fixture();
    const saved = await f.memory(101, 'work', 'OLD_BACKUP_PAYLOAD', 'backup-memory');
    const shown = await f.adaptive.present(101, { space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: 1, eventId: 'backup-present' });
    const granted = await f.adaptive.changeConsent(101, { space: 'work', purpose: 'optional.personalization', state: 'granted',
      expectedRevision: shown.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: 'backup-grant', receipt: shown.receipt });
    const old = await f.adaptive.repository.transaction(accountIdFor(101), f.now(), d => d);
    await f.adaptive.deleteMemory(101, saved.memories[0].id, { space: 'work', expectedRevision: saved.memories[0].revision, eventId: 'delete-for-drill' });
    await f.adaptive.changeConsent(101, { space: 'work', purpose: 'optional.personalization', state: 'withdrawn',
      expectedRevision: granted.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: 'backup-withdraw' });
    const restarted = new AdaptiveLifecycleService(f.factory());
    const report = await restarted.reconcileSnapshot(101, old);
    expect(report).toMatchObject({ importedPayloads: 0, acceptedMemoryIds: [], suppressedMemoryIds: [saved.memories[0].id], providerDeletion: 'unverified', backupDeletion: 'unverified' });
    expect((await f.factory().read(101, 'work')).memories).toEqual([]);
    expect((await f.factory().read(101, 'work')).purposes.find(p => p.purpose === 'optional.personalization')!.state).toBe('withdrawn');
    await expect(restarted.reconcileSnapshot(102, old)).rejects.toMatchObject({ code: 'invalid_recovery_snapshot' });
    await expect(restarted.reconcileSnapshot(999, { ...old, accountId: accountIdFor(999) })).rejects.toMatchObject({ code: 'recovery_authority_unavailable' });
    expect((await f.storage.listAccounts({ limit: 100 })).accountIds).not.toContain(accountIdFor(999));
  });

  it('persists a bounded continuation across process objects and covers a synthetic load without activating providers', async () => {
    const f = await fixture(25), checkpoints = new FileAdaptiveStorage(join(f.root, 'maintenance'));
    const seen = new Set<number>();
    const runner = () => new AdaptiveMaintenanceRunner(new AdaptiveLifecycleService(f.factory()), new FileAdaptiveStorage(f.storage.directory),
      new FileAdaptiveStorage(checkpoints.directory), { now: f.now, afterAccount: async id => { seen.add(id); } });
    const first = await runner().runPage({ workerId: 'synthetic', limit: 4 });
    expect(first).toMatchObject({ state: 'continued', scanned: 4 });
    let result = first;
    for (let n = 0; result.state === 'continued' && n < 10; n++) result = await runner().runPage({ workerId: 'restarted', limit: 4 });
    expect(result.state).toBe('completed'); expect([...seen].sort()).toEqual([...f.ids].sort());
    const file = (await readdir(checkpoints.directory)).find(p => p.endsWith('.json'))!;
    const record = JSON.parse(await readFile(join(checkpoints.directory, file), 'utf8'));
    expect(record).toMatchObject({ accounts: 25, pages: 7, status: 'completed' });
    expect(record.lease).toBeUndefined();
  });

  it('retains the cursor on failure and excludes competing workers until lease recovery', async () => {
    const f = await fixture(), checkpoints = new FileAdaptiveStorage(join(f.root, 'maintenance'));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const lifecycle = new AdaptiveLifecycleService(f.adaptive);
    const a = new AdaptiveMaintenanceRunner(lifecycle, f.storage, checkpoints, { now: f.now,
      afterAccount: async () => { entered(); await blocked; throw new Error('PRIVATE_ERROR_CANARY'); } });
    const b = new AdaptiveMaintenanceRunner(lifecycle, new FileAdaptiveStorage(f.storage.directory), new FileAdaptiveStorage(checkpoints.directory), { now: f.now });
    const running = a.runPage({ workerId: 'first', limit: 1 }); await entering;
    expect((await b.runPage({ workerId: 'competitor', limit: 1 })).state).toBe('busy');
    // Simulate a crashed worker's expired lease. A new process retries its page.
    f.setNow(START + 61_000);
    expect(await b.runPage({ workerId: 'recovered', limit: 1 })).toMatchObject({ state: 'continued', scanned: 1 });
    release(); expect((await running).state).toBe('failed');
    const file = (await readdir(checkpoints.directory)).find(p => p.endsWith('.json'))!;
    const raw = await readFile(join(checkpoints.directory, file), 'utf8');
    expect(raw).not.toContain('PRIVATE_ERROR_CANARY');
    expect(JSON.parse(raw).status).toBe('continued'); // stale owner cannot replace newer checkpoint
  });

  it('records a retryable fixed failure and replays the same batch after restart', async () => {
    const f = await fixture(), checkpoint = new FileAdaptiveStorage(join(f.root, 'maintenance'));
    let calls = 0;
    const lifecycle = new AdaptiveLifecycleService(f.adaptive);
    const failed = await new AdaptiveMaintenanceRunner(lifecycle, f.storage, checkpoint, { now: f.now,
      afterAccount: async () => { calls++; throw new Error('private'); } }).runPage({ workerId: 'failing', limit: 2 });
    expect(failed).toEqual({ state: 'failed', scanned: 0, failure: 'sweep_failed' });
    const retried = await new AdaptiveMaintenanceRunner(lifecycle, f.storage, new FileAdaptiveStorage(checkpoint.directory), {
      now: f.now, afterAccount: async () => { calls++; },
    }).runPage({ workerId: 'retry', limit: 2 });
    expect(retried).toMatchObject({ state: 'continued', scanned: 2 }); expect(calls).toBe(3);
  });

  it('enumerates adapters with bounded stable cursors and serializes rollback-safe memory transactions', async () => {
    const storage = new MemoryAdaptiveStorage();
    for (const n of [104, 101, 102]) await storage.transact(accountIdFor(n), () => ({ document: { accountId: accountIdFor(n), n: 0 }, result: undefined }));
    const first = await storage.listAccounts({ limit: 1 });
    expect(first.accountIds).toHaveLength(1); expect(first.next).toMatch(/^[a-f0-9]{64}$/);
    const next = await storage.listAccounts({ limit: 100, after: first.next });
    expect(new Set([...first.accountIds, ...next.accountIds]).size).toBe(3);
    await expect(storage.listAccounts({ limit: 101 })).rejects.toThrow('Invalid adaptive enumeration');
    await expect(storage.transact(accountIdFor(101), raw => { (raw as { n: number }).n = 99; throw new Error('rollback'); })).rejects.toThrow('rollback');
    const increment = () => storage.transact(accountIdFor(101), raw => {
      const d = raw as { accountId: string; n: number }; d.n++; return { document: d, result: d.n };
    });
    expect(await Promise.all(Array.from({ length: 30 }, increment))).toEqual(Array.from({ length: 30 }, (_, n) => n + 1));
  });

  it('serializes concurrent file writers from independent process adapters and rolls back failed drafts', async () => {
    const f = await fixture();
    const file = new FileAdaptiveStorage(join(f.root, 'lock-drill'));
    await file.transact('synthetic-counter', () => ({ document: { n: 0 }, result: undefined }));
    await expect(file.transact('synthetic-counter', raw => { (raw as { n: number }).n = 100; throw new Error('rollback'); })).rejects.toThrow('rollback');
    await Promise.all(Array.from({ length: 20 }, () => new FileAdaptiveStorage(file.directory).transact('synthetic-counter', raw => {
      const d = raw as { n: number }; d.n++; return { document: d, result: undefined };
    })));
    const n = await new FileAdaptiveStorage(file.directory).transact('synthetic-counter', raw => ({ document: raw, result: (raw as { n: number }).n }));
    expect(n).toBe(20);
    expect((await readdir(file.directory)).filter(p => p.endsWith('.lock') || p.endsWith('.tmp'))).toEqual([]);
  });

  it('uses a bounded Firestore document-key cursor query and returns only validated account IDs', async () => {
    const rows = [101, 102, 103].map(n => {
      const accountId = accountIdFor(n);
      return { id: createHash('sha256').update(accountId).digest('hex'), get: () => JSON.stringify({ accountId, text: 'NOT_EXPORTED' }) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const calls: unknown[][] = [];
    const db = { collection: (collection: string) => {
      calls.push(['collection', collection]); let after = '', limit = 0;
      const query = { orderBy: (field: unknown) => { calls.push(['orderBy', field]); return query; },
        select: (...fields: string[]) => { calls.push(['select', ...fields]); return query; },
        limit: (count: number) => { limit = count; calls.push(['limit', count]); return query; },
        startAfter: (cursor: string) => { after = cursor; calls.push(['startAfter', cursor]); return query; },
        get: async () => ({ docs: rows.filter(row => row.id > after).slice(0, limit) }) };
      return query;
    } } as unknown as Firestore;
    const storage = new FirestoreAdaptiveStorage(db, 'syntheticAccounts');
    const first = await storage.listAccounts({ limit: 1 });
    expect(first.accountIds).toHaveLength(1); expect(first.next).toBe(rows[0].id);
    const second = await storage.listAccounts({ limit: 2, after: first.next });
    expect(second.accountIds).toHaveLength(2); expect(second.next).toBeUndefined();
    expect(calls).toContainEqual(['select', 'json']); expect(calls).toContainEqual(['limit', 2]);
    expect(calls).toContainEqual(['startAfter', rows[0].id]);
    expect(JSON.stringify([first, second])).not.toContain('NOT_EXPORTED');
  });

  it('captures validated Firestore pagination inputs before import and result awaits instead of following caller mutations',async()=>{
    const rows=[2101,2102,2103].map(owner=>({accountId:accountIdFor(owner),id:createHash('sha256').update(accountIdFor(owner)).digest('hex')})).sort((a,b)=>a.id.localeCompare(b.id));
    const calls:unknown[][]=[];let queryLimit=0,queryAfter='',enter!:()=>void,release!:()=>void;
    const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const query={orderBy:(field:unknown)=>{calls.push(['orderBy',field]);return query;},select:(field:string)=>{calls.push(['select',field]);return query;},
      limit:(n:number)=>{queryLimit=n;calls.push(['limit',n]);return query;},startAfter:(cursor:string)=>{queryAfter=cursor;calls.push(['startAfter',cursor]);return query;},
      get:async()=>{enter();await gate;return {docs:rows.filter(row=>row.id>queryAfter).slice(0,queryLimit).map(row=>({id:row.id,get:(field:string)=>{expect(field).toBe('json');return JSON.stringify({accountId:row.accountId});}}))};}};
    const db={collection:(name:string)=>{calls.push(['collection',name]);return query;}} as unknown as Firestore,storage=new FirestoreAdaptiveStorage(db,'syntheticInputSnapshot');
    const input={limit:1,after:'0'.repeat(64)},pending=storage.listAccounts(input);
    // The first mutation is before the newly lazy dependency resolves. The
    // second is during the actual asynchronous query/result boundary.
    input.limit=100;input.after='f'.repeat(64);await entered;input.limit=2;input.after='not-a-valid-cursor';release();
    expect(await pending).toEqual({accountIds:[rows[0].accountId],next:rows[0].id});
    expect(calls.filter(c=>c[0]==='limit')).toEqual([['limit',2]]);expect(calls.filter(c=>c[0]==='startAfter')).toEqual([['startAfter','0'.repeat(64)]]);
    const before=calls.length,invalid={limit:101,after:'0'.repeat(64)},refused=storage.listAccounts(invalid);invalid.limit=1;
    await expect(refused).rejects.toThrow('Invalid adaptive enumeration');expect(calls).toHaveLength(before);
    let coerced=0;const stringify=()=>{coerced++;return '0'.repeat(64);};
    for(const after of [{toString:stringify},Object.assign(['0'.repeat(64)],{toString:stringify})]){
      const malformed={limit:1,after} as unknown as Parameters<FirestoreAdaptiveStorage['listAccounts']>[0];
      await expect(storage.listAccounts(malformed)).rejects.toThrow('Invalid adaptive enumeration');
    }
    expect(coerced).toBe(0);expect(calls).toHaveLength(before);
  });
});
