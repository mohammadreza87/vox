import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditMemoryStore, auditShareOfferStore, InMemoryAuditStore, InMemorySupersededNoticeStore, type AuditStore } from '../audit';
import { ownerRevokePatch, ownerSharePatch, resnapshotPatch } from '../memory/sharing';
import { InMemoryMemoryStore, InMemoryShareOfferStore, StaleMemoryWriteError, type MemoryStore, type NewMemory } from '../memory/store';
import type { MemoryRecord } from '../types';
import { testOrg } from './fixtures';

const CANARY = 'AUDIT_CANARY_7f3';

function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria', content: `Reza likes ${CANARY}`, topic: CANARY, type: 'fact', scope: { kind: 'private', personId: 'reza' },
    authorizedPersonIds: ['reza'], sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-${Math.random()}`] },
    ...overrides,
  };
}

class TombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(personaId: string): Promise<string[]> { return [...(this.tombstones.get(personaId) ?? [])].sort(); }
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    const set = this.tombstones.get(personaId) ?? new Set<string>();
    for (const id of eventIds) set.add(id);
    this.tombstones.set(personaId, set);
  }
  async findNearest(): Promise<MemoryRecord[]> { return []; }
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('flags off: pure pass-through', () => {
  beforeEach(() => { vi.stubEnv('TIREH_AUDIT_LOG', ''); vi.stubEnv('TIREH_SHARING_V2', ''); });

  it('returns identical results with no extra reads and no rows', async () => {
    const inner = new InMemoryMemoryStore();
    const audit = new InMemoryAuditStore();
    const store = auditMemoryStore(inner, audit, new InMemorySupersededNoticeStore());
    const get = vi.spyOn(inner, 'get');
    const record = await store.add(newMemory());
    expect(inner.records.get(record.id)).toBe(record);
    const shared = await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']));
    expect(shared).toBe(true);
    expect(await store.updateIfShareVersion(record.id, 0, { authorizedPersonIds: [] })).toBe(false);
    await expect(store.update(record.id, { confidence: 0.5 })).resolves.toBeUndefined();
    const correction = await store.add(newMemory({ supersedes: record.id, scope: { kind: 'people', personIds: ['parastoo', 'reza'] } }));
    await store.delete(correction.id);
    expect(get).not.toHaveBeenCalled();
    expect(audit.rows).toEqual([]);
  });
});

describe('proxy forwarding', () => {
  it('forwards reads, optional subclass methods and keeps instanceof', async () => {
    const inner = new TombstoneStore();
    const store = auditMemoryStore(inner, new InMemoryAuditStore()) as MemoryStore & TombstoneStore;
    const record = await store.add(newMemory());
    expect(await store.get(record.id)).toEqual(record);
    expect(await store.listActive('aria')).toHaveLength(1);
    expect(await store.safetyRevision('aria')).toBe(0);
    expect(store).toBeInstanceOf(InMemoryMemoryStore);
    expect(typeof store.tombstonesOf).toBe('function');
    expect(typeof store.addTombstones).toBe('function');
    expect(typeof store.findNearest).toBe('function');
    await store.addTombstones('aria', ['e1']);
    expect(await store.tombstonesOf('aria')).toEqual(['e1']);
    expect(await store.findNearest()).toEqual([]);
    expect(store.records).toBe(inner.records);
  });
});

describe('TIREH_AUDIT_LOG=1 classification', () => {
  let inner: InMemoryMemoryStore;
  let audit: InMemoryAuditStore;
  let store: MemoryStore;
  beforeEach(() => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    vi.stubEnv('TIREH_SHARING_V2', '');
    inner = new InMemoryMemoryStore();
    audit = new InMemoryAuditStore();
    store = auditMemoryStore(inner, audit);
  });

  it('write, supersede, share_approve, revoke, denied, resnapshot (no row) and delete', async () => {
    const record = await store.add(newMemory());
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', memoryIds: [record.id], audiencePersonIds: ['reza'], actorPersonId: 'reza', outcome: 'applied', policyKey: 'tireh.visibility.v1:private:normal' });
    expect(audit.rows.at(-1)!.chatKeyHash).toMatch(/^[0-9a-f]{32}$/);

    expect(await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']))).toBe(true);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_approve', memoryIds: [record.id], audiencePersonIds: ['parastoo', 'reza'], actorPersonId: 'reza', outcome: 'applied' });

    const shared = (await store.get(record.id))!;
    expect(await store.updateIfShareVersion(record.id, 0, ownerRevokePatch(shared, 'reza'))).toBe(false);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'revoke', outcome: 'denied' });
    expect(await store.updateIfShareVersion(record.id, 1, ownerRevokePatch(shared, 'reza'))).toBe(true);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'revoke', outcome: 'applied', audiencePersonIds: ['reza'] });

    const group = await store.add(newMemory({ scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['reza'], source: { personId: 'reza', chatKind: 'group', groupId: 'leads', at: new Date() } }));
    const count = audit.rows.length;
    expect(await store.updateIfShareVersion(group.id, 0, resnapshotPatch(group, 'leads', 'parastoo')!)).toBe(true);
    expect(audit.rows).toHaveLength(count);

    const correction = await store.add(newMemory({ supersedes: record.id }));
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'supersede', memoryIds: [correction.id, record.id].sort(), outcome: 'applied' });

    await store.update(correction.id, { confidence: 0.4 });
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', memoryIds: [correction.id] });
    await store.update(group.id, { supersededBy: 'x-1' });
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'supersede', memoryIds: [group.id, 'x-1'].sort() });

    await store.delete(correction.id);
    const deleted = audit.rows.at(-1)!;
    expect(deleted).toMatchObject({ kind: 'delete', memoryIds: [correction.id], outcome: 'applied' });
    expect(deleted.actorPersonId).toBeUndefined();
  });

  it('an add rejected by tombstones is denied and rethrows the original error', async () => {
    const memory = newMemory();
    const record = await store.add(memory);
    await store.delete(record.id);
    let thrown: unknown;
    try { await store.add({ ...memory }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(StaleMemoryWriteError);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', outcome: 'denied', memoryIds: [] });
  });

  it('other add failures are recorded as failed', async () => {
    const failing = auditMemoryStore({ ...inner, add: async () => { throw new Error('disk full'); } } as unknown as MemoryStore, audit);
    await expect(failing.add(newMemory())).rejects.toThrow('disk full');
    expect(audit.rows.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('share offers: create applied, declined denied, approved no row', async () => {
    const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
    const offer = await offers.create({ personaId: 'aria', memoryId: 'm-1', ownerPersonId: 'reza', proposedScope: { kind: 'people', personIds: ['parastoo', 'reza'] }, proposedAudiencePersonIds: ['parastoo', 'reza'] });
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_offer', outcome: 'applied', memoryIds: ['m-1'], audiencePersonIds: ['parastoo', 'reza'] });
    expect(audit.rows.at(-1)!.actorPersonId).toBeUndefined();
    await offers.setStatus(offer.id, 'declined');
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_offer', outcome: 'denied' });
    expect((await offers.get(offer.id))!.status).toBe('declined');
    const count = audit.rows.length;
    await offers.setStatus(offer.id, 'approved');
    expect(audit.rows).toHaveLength(count);
  });

  it('a failing audit store never changes a memory result or error', async () => {
    const broken: AuditStore = { append: async () => { throw new Error('audit down'); }, list: async () => [], sweep: async () => 0 };
    const guarded = auditMemoryStore(inner, broken);
    const record = await guarded.add(newMemory());
    expect(await guarded.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']))).toBe(true);
    await guarded.update(record.id, { confidence: 0.3 });
    await guarded.delete(record.id);
    await expect(guarded.add({ ...newMemory(), source: record.source })).rejects.toBeInstanceOf(StaleMemoryWriteError);
  });

  it('is content-free on every path', async () => {
    const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
    const record = await store.add(newMemory());
    await offers.create({ personaId: 'aria', memoryId: record.id, ownerPersonId: 'reza', proposedScope: { kind: 'org' } });
    await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']));
    const correction = await store.add(newMemory({ supersedes: record.id }));
    await store.update(correction.id, { content: `${CANARY} again`, topic: CANARY });
    await store.delete(correction.id);
    expect(audit.rows.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(audit.rows)).not.toContain(CANARY);
    expect(JSON.stringify(audit.rows)).not.toContain('Reza likes');
  });
});

describe('supersede notices (TIREH_SHARING_V2=1)', () => {
  const owner = { personId: 'reza', chatKind: 'private' as const, at: new Date('2026-10-19T10:00:00Z') };
  let inner: InMemoryMemoryStore;
  let notices: InMemorySupersededNoticeStore;
  let store: MemoryStore;
  beforeEach(() => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    vi.stubEnv('TIREH_AUDIT_LOG', '');
    inner = new InMemoryMemoryStore();
    notices = new InMemorySupersededNoticeStore();
    store = auditMemoryStore(inner, new InMemoryAuditStore(), notices);
  });

  it('people-scope supersede notifies recipients minus the owner', async () => {
    const shared = await store.add(newMemory({ scope: { kind: 'people', personIds: ['milad', 'parastoo', 'reza'] }, authorizedPersonIds: ['milad', 'parastoo', 'reza'], source: { ...owner, eventIds: ['e-p'] } }));
    const next = await store.add(newMemory({ supersedes: shared.id, source: { ...owner, eventIds: ['e-p2'] } }));
    expect(notices.notices).toHaveLength(1);
    expect(notices.notices[0]).toMatchObject({ personaId: 'aria', oldMemoryId: shared.id, newMemoryId: next.id, ownerPersonId: 'reza', recipientPersonIds: ['milad', 'parastoo'] });
    expect(JSON.stringify(notices.notices)).not.toContain(CANARY);
  });

  it('project-scope supersede records too', async () => {
    const project = await store.add(newMemory({ scope: { kind: 'project', projectId: 'gameend' }, authorizedPersonIds: ['milad', 'parastoo', 'reza'], source: { ...owner, eventIds: ['e-j'] } }));
    await store.add(newMemory({ supersedes: project.id, scope: project.scope, source: { ...owner, eventIds: ['e-j2'] } }));
    expect(notices.notices.map((n) => n.recipientPersonIds)).toEqual([['milad', 'parastoo']]);
  });

  it('private, group and sensitive predecessors record nothing', async () => {
    const priv = await store.add(newMemory({ source: { ...owner, eventIds: ['a1'] } }));
    await store.add(newMemory({ supersedes: priv.id, source: { ...owner, eventIds: ['a2'] } }));
    const group = await store.add(newMemory({ scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['parastoo', 'reza'], source: { ...owner, eventIds: ['b1'] } }));
    await store.add(newMemory({ supersedes: group.id, scope: group.scope, source: { ...owner, eventIds: ['b2'] } }));
    const sensitive = await store.add(newMemory({ sensitivity: 'personal', scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, authorizedPersonIds: ['parastoo', 'reza'], source: { ...owner, eventIds: ['c1'] } }));
    await store.add(newMemory({ supersedes: sensitive.id, source: { ...owner, eventIds: ['c2'] } }));
    expect(notices.notices).toEqual([]);
  });

  it('with the flag off nothing is recorded and there is no extra get', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const get = vi.spyOn(inner, 'get');
    const shared = await store.add(newMemory({ scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, authorizedPersonIds: ['parastoo', 'reza'], source: { ...owner, eventIds: ['d1'] } }));
    await store.add(newMemory({ supersedes: shared.id, source: { ...owner, eventIds: ['d2'] } }));
    expect(notices.notices).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
