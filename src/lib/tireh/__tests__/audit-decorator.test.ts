/**
 * S08 audit decorators: pure pass-through with the flags unset, Proxy
 * forwarding, row classification under TIREH_AUDIT_LOG=1, failure isolation,
 * content-free canaries and supersede notices under TIREH_SHARING_V2=1.
 */
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDITED_MEMORY_METHODS, AUDITED_OFFER_METHODS, auditMemoryStore, auditShareOfferStore, createFileAuditStore, InMemoryAuditStore,
  InMemorySupersededNoticeStore, type AuditStore,
} from '../audit';
import { ownerRevokePatch, ownerSharePatch, resnapshotPatch } from '../memory/sharing';
import { InMemoryMemoryStore, InMemoryShareOfferStore, StaleMemoryWriteError, type MemoryStore, type NewMemory, type ShareOfferStore } from '../memory/store';
import type { MemoryRecord } from '../types';
import { testOrg } from './fixtures';

const CANARY = 'AUDIT_CANARY_7f3c';
const TOPIC = 'TOPIC_CANARY';
let seq = 0;

function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria', content: `Reza likes ${CANARY}`, topic: TOPIC, type: 'fact', scope: { kind: 'private', personId: 'reza' },
    authorizedPersonIds: ['reza'], sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-${++seq}`] },
    ...overrides,
  };
}

const peopleShared = (overrides: Partial<NewMemory> = {}) => newMemory({
  scope: { kind: 'people', personIds: ['milad', 'parastoo', 'reza'] }, authorizedPersonIds: ['milad', 'parastoo', 'reza'], ...overrides,
});

/** S06-shaped optional methods on a subclass; they read `this`, so a wrong binding would fail. */
class TombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(personaId: string): Promise<string[]> { return [...(this.tombstones.get(personaId) ?? [])].sort(); }
  async addTombstones(personaId: string, eventIds: readonly string[]): Promise<void> {
    const set = this.tombstones.get(personaId) ?? new Set<string>();
    for (const id of eventIds) set.add(id);
    this.tombstones.set(personaId, set);
  }
  async findNearest(): Promise<MemoryRecord[]> { return [...this.records.values()].slice(0, 1); }
}

afterEach(() => { vi.unstubAllEnvs(); });

const sorted = (ids: string[]) => [...ids].sort();

it('pins the intercepted method lists', () => {
  expect([...AUDITED_MEMORY_METHODS]).toEqual(['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete']);
  expect([...AUDITED_OFFER_METHODS]).toEqual(['create', 'setStatus']);
});

describe('flags unset: pure pass-through', () => {
  beforeEach(() => { vi.stubEnv('TIREH_AUDIT_LOG', ''); vi.stubEnv('TIREH_SHARING_V2', ''); });

  it('every result is the undecorated store result, with no extra reads, rows or notices', async () => {
    const inner = new InMemoryMemoryStore();
    const audit = new InMemoryAuditStore();
    const notices = new InMemorySupersededNoticeStore();
    const store = auditMemoryStore(inner, audit, notices);
    const spies = Object.fromEntries((['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete', 'get'] as const).map((m) => [m, vi.spyOn(inner, m)]));
    const lastResult = (name: string) => spies[name].mock.results.at(-1)!.value as Promise<unknown>;

    const record = await store.add(newMemory());
    await expect(lastResult('add')).resolves.toBe(record);
    const viaEpoch = await store.addIfEpoch(newMemory(), 0);
    await expect(lastResult('addIfEpoch')).resolves.toBe(viaEpoch);
    expect(await store.addIfEpoch(newMemory(), 7)).toBeNull();
    expect(await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']))).toBe(true);
    expect(await store.updateIfShareVersion(record.id, 0, { authorizedPersonIds: [] })).toBe(false);
    await expect(store.update(record.id, { confidence: 0.5 })).resolves.toBeUndefined();
    const correction = await store.add(peopleShared({ supersedes: record.id }));
    await expect(lastResult('add')).resolves.toBe(correction);
    await store.delete(correction.id);
    expect(spies.get).not.toHaveBeenCalled();
    for (const name of ['add', 'addIfEpoch', 'update', 'updateIfShareVersion', 'delete']) expect(spies[name]).toHaveBeenCalled();
    expect(audit.rows).toEqual([]);
    expect(notices.notices).toEqual([]);

    const innerOffers = new InMemoryShareOfferStore();
    const offers = auditShareOfferStore(innerOffers, audit);
    const create = vi.spyOn(innerOffers, 'create');
    const offer = await offers.create({ personaId: 'aria', memoryId: record.id, ownerPersonId: 'reza', proposedScope: { kind: 'org' } });
    await expect(create.mock.results[0].value).resolves.toBe(offer);
    await offers.setStatus(offer.id, 'declined');
    expect(await offers.get(offer.id)).toBe(innerOffers.offers.get(offer.id));
    expect(audit.rows).toEqual([]);
  });

  it('forwards reads, fields, instanceof and subclass methods with the right this', async () => {
    const inner = new TombstoneStore();
    const store = auditMemoryStore(inner, new InMemoryAuditStore()) as MemoryStore & TombstoneStore;
    const record = await store.add(newMemory());
    expect(store).toBeInstanceOf(InMemoryMemoryStore);
    expect(store).toBeInstanceOf(TombstoneStore);
    expect(store.records).toBe(inner.records);
    expect(await store.get(record.id)).toBe(record);
    expect(await store.listActive('aria')).toEqual([record]);
    expect(await store.safetyRevision('aria')).toBe(0);
    await store.invalidate('aria');
    expect(await store.safetyRevision('aria')).toBe(1);
    await store.addTombstones('aria', ['e1', 'e2']);
    expect(await store.tombstonesOf('aria')).toEqual(['e1', 'e2']);
    expect(inner.tombstones.get('aria')).toEqual(new Set(['e1', 'e2']));
    expect(await store.findNearest()).toEqual([record]);
  });
});

describe('TIREH_AUDIT_LOG=1 rows', () => {
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

  it('write and supersede', async () => {
    const record = await store.add(newMemory());
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ kind: 'write', personaId: 'aria', memoryIds: [record.id], audiencePersonIds: ['reza'], actorPersonId: 'reza', outcome: 'applied' });
    expect(audit.rows[0].policyKey).toMatch(/^private:[0-9a-f]{16}:s0:normal$/);
    expect(audit.rows[0].chatKeyHash).toBeUndefined();
    const correction = await store.add(newMemory({ supersedes: record.id }));
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'supersede', memoryIds: sorted([correction.id, record.id]), actorPersonId: 'reza', outcome: 'applied' });
  });

  it('share_approve, revoke, a stale share version is denied, and a re-snapshot patch writes no row', async () => {
    const record = await store.add(newMemory());
    expect(await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']))).toBe(true);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_approve', memoryIds: [record.id], audiencePersonIds: ['parastoo', 'reza'], actorPersonId: 'reza', outcome: 'applied' });
    expect(audit.rows.at(-1)!.policyKey).toMatch(/^people:[0-9a-f]{16}:s1:normal$/);

    const shared = (await store.get(record.id))!;
    expect(await store.updateIfShareVersion(record.id, 0, ownerRevokePatch(shared, 'reza'))).toBe(false);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'revoke', outcome: 'denied', memoryIds: [record.id] });
    expect(await store.updateIfShareVersion(record.id, 1, ownerRevokePatch(shared, 'reza'))).toBe(true);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'revoke', outcome: 'applied', audiencePersonIds: ['reza'], actorPersonId: 'reza' });

    const group = await store.add(newMemory({ scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['reza'], source: { personId: 'reza', chatKind: 'group', groupId: 'leads', at: new Date(), eventIds: ['g-1'] } }));
    const count = audit.rows.length;
    expect(await store.updateIfShareVersion(group.id, 0, resnapshotPatch(group, 'leads', 'parastoo')!)).toBe(true);
    expect(audit.rows).toHaveLength(count);
    expect(await store.updateIfShareVersion(group.id, 1, { confidence: 0.2 })).toBe(true);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', memoryIds: [group.id], outcome: 'applied' });
  });

  it('addIfEpoch writes exactly one row, and a null result is denied', async () => {
    const record = await store.addIfEpoch(newMemory(), 0);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ kind: 'write', memoryIds: [record!.id], outcome: 'applied' });
    expect(await store.addIfEpoch(newMemory(), 5)).toBeNull();
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1]).toMatchObject({ kind: 'write', memoryIds: [], outcome: 'denied' });
  });

  it('an add throwing StaleMemoryWriteError is denied and the same error is rethrown', async () => {
    const memory = newMemory();
    const record = await store.add(memory);
    await store.delete(record.id);
    let thrown: unknown;
    try { await store.add({ ...memory }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(StaleMemoryWriteError);
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', outcome: 'denied', memoryIds: [] });

    const original = new StaleMemoryWriteError();
    const rejecting = auditMemoryStore(Object.assign(Object.create(inner) as MemoryStore, { add: async () => { throw original; } }), audit);
    await expect(rejecting.add(newMemory())).rejects.toBe(original);
    const failing = auditMemoryStore(Object.assign(Object.create(inner) as MemoryStore, { add: async () => { throw new Error('disk full'); } }), audit);
    await expect(failing.add(newMemory())).rejects.toThrow('disk full');
    expect(audit.rows.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('update and delete', async () => {
    const record = await store.add(newMemory());
    await store.update(record.id, { confidence: 0.4 });
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'write', memoryIds: [record.id], outcome: 'applied', actorPersonId: 'reza' });
    await store.delete(record.id);
    const deleted = audit.rows.at(-1)!;
    expect(deleted).toMatchObject({ kind: 'delete', memoryIds: [record.id], audiencePersonIds: ['reza'], outcome: 'applied' });
    expect(deleted.actorPersonId).toBeUndefined();
    expect(await store.get(record.id)).toBeNull();
  });

  it('share offers: create applied, declined denied, approved no row', async () => {
    const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
    const offer = await offers.create({ personaId: 'aria', memoryId: 'm-1', ownerPersonId: 'reza', proposedScope: { kind: 'people', personIds: ['parastoo', 'reza'] }, proposedAudiencePersonIds: ['reza', 'parastoo'] });
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_offer', outcome: 'applied', memoryIds: ['m-1'], audiencePersonIds: ['parastoo', 'reza'], actorPersonId: 'reza' });
    await offers.setStatus(offer.id, 'declined');
    expect(audit.rows.at(-1)).toMatchObject({ kind: 'share_offer', outcome: 'denied', memoryIds: ['m-1'], actorPersonId: 'reza' });
    expect((await offers.get(offer.id))!.status).toBe('declined');
    const count = audit.rows.length;
    await offers.setStatus(offer.id, 'approved');
    expect(audit.rows).toHaveLength(count);
  });
});

describe('failure isolation', () => {
  beforeEach(() => { vi.stubEnv('TIREH_AUDIT_LOG', '1'); vi.stubEnv('TIREH_SHARING_V2', '1'); });

  const scenario = async (memories: MemoryStore, offers: ShareOfferStore) => {
    const record = await memories.add(newMemory());
    const shared = await memories.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo']));
    await memories.update(record.id, { confidence: 0.3 });
    const correction = await memories.add(peopleShared({ supersedes: record.id }));
    const epoch = await memories.addIfEpoch(newMemory(), 0);
    await memories.delete(correction.id);
    const offer = await offers.create({ personaId: 'aria', memoryId: record.id, ownerPersonId: 'reza', proposedScope: { kind: 'org' } });
    await offers.setStatus(offer.id, 'declined');
    let stale: unknown;
    try { await memories.add({ ...newMemory(), source: record.source }); } catch (error) { stale = error; }
    return { shared, epoch: !!epoch, list: (await memories.listActive('aria')).length, stale: stale instanceof StaleMemoryWriteError, offer: (await offers.get(offer.id))!.status };
  };

  it('a rejecting audit store, a rejecting notice store or an invalid row never changes a memory result', async () => {
    const expected = await scenario(new InMemoryMemoryStore(), new InMemoryShareOfferStore());
    const broken: AuditStore = { append: async () => { throw new Error('audit down'); }, list: async () => [], sweep: async () => 0 };
    const brokenNotices = { record: async () => { throw new Error('notices down'); }, listFor: async () => [],
      deleteByMemoryIds: async () => { throw new Error('notices down'); }, deleteForPerson: async () => { throw new Error('notices down'); },
      hasAny: async () => { throw new Error('notices down'); } };
    expect(await scenario(auditMemoryStore(new InMemoryMemoryStore(), broken, brokenNotices), auditShareOfferStore(new InMemoryShareOfferStore(), broken))).toEqual(expected);

    // Ids with whitespace make every row invalid; the strict schema rejects them inside append.
    const audit = new InMemoryAuditStore();
    const inner = new InMemoryMemoryStore();
    const store = auditMemoryStore(inner, audit, new InMemorySupersededNoticeStore());
    const odd = await store.add(newMemory({ personaId: 'persona with spaces' }));
    expect(await inner.get(odd.id)).toBe(odd);
    expect(audit.rows).toEqual([]);
  });
});

describe('content-free canary', () => {
  beforeEach(() => { vi.stubEnv('TIREH_AUDIT_LOG', '1'); vi.stubEnv('TIREH_SHARING_V2', '1'); });

  const everyPath = async (audit: AuditStore) => {
    const notices = new InMemorySupersededNoticeStore();
    const store = auditMemoryStore(new InMemoryMemoryStore(), audit, notices);
    const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
    const record = await store.add(newMemory());
    await offers.create({ personaId: 'aria', memoryId: record.id, ownerPersonId: 'reza', proposedScope: { kind: 'org' } });
    await store.updateIfShareVersion(record.id, 0, ownerSharePatch(testOrg(), record, 'reza', ['parastoo', 'milad']));
    const correction = await store.add(newMemory({ supersedes: record.id }));
    await store.update(correction.id, { content: `${CANARY} again`, topic: TOPIC });
    await store.addIfEpoch(newMemory(), 0);
    // The notice as recorded; deleting the correction then erases it (fixer r1).
    const recorded = JSON.stringify(notices.notices);
    expect(notices.notices).toHaveLength(1);
    await store.delete(correction.id);
    expect(notices.notices).toHaveLength(0);
    return recorded;
  };

  it('never puts content or topics in rows, notices or the JSONL file', async () => {
    const audit = new InMemoryAuditStore();
    const notices = await everyPath(audit);
    expect(audit.rows.length).toBeGreaterThanOrEqual(7);
    for (const text of [JSON.stringify(audit.rows), notices]) {
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain(TOPIC);
      expect(text).not.toContain('Reza likes');
    }
    const path = join(mkdtempSync(join(tmpdir(), 'vox-audit-canary-')), 'vox-audit.jsonl');
    await everyPath(createFileAuditStore(path));
    const bytes = readFileSync(path, 'utf8');
    expect(bytes.trim().split('\n').length).toBeGreaterThanOrEqual(7);
    expect(bytes).not.toContain(CANARY);
    expect(bytes).not.toContain(TOPIC);
  });
});

describe('TIREH_SHARING_V2=1 supersede notices', () => {
  let notices: InMemorySupersededNoticeStore;
  let store: MemoryStore;
  beforeEach(() => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    vi.stubEnv('TIREH_AUDIT_LOG', '');
    notices = new InMemorySupersededNoticeStore();
    store = auditMemoryStore(new InMemoryMemoryStore(), new InMemoryAuditStore(), notices);
  });

  it('deleting either memory of a notice erases the notice; an unrelated delete leaves it', async () => {
    const shared = await store.add(peopleShared());
    const next = await store.add(newMemory({ supersedes: shared.id }));
    const other = await store.add(newMemory());
    await store.delete(other.id);
    expect(notices.notices).toHaveLength(1);
    await store.delete(next.id);
    expect(notices.notices).toEqual([]);
  });

  it('a failed delete keeps the notice', async () => {
    const inner = new InMemoryMemoryStore();
    const failing = auditMemoryStore(inner, new InMemoryAuditStore(), notices);
    const shared = await failing.add(peopleShared());
    const next = await failing.add(newMemory({ supersedes: shared.id }));
    vi.spyOn(inner, 'delete').mockRejectedValueOnce(new Error('store down'));
    await expect(failing.delete(next.id)).rejects.toThrow('store down');
    expect(notices.notices).toHaveLength(1);
  });

  it('a people-scoped correction by the owner notifies the other recipients', async () => {
    const shared = await store.add(peopleShared());
    const next = await store.add(newMemory({ supersedes: shared.id }));
    expect(notices.notices).toHaveLength(1);
    expect(notices.notices[0]).toMatchObject({ personaId: 'aria', oldMemoryId: shared.id, newMemoryId: next.id, ownerPersonId: 'reza', recipientPersonIds: ['milad', 'parastoo'] });
  });

  it('a project-scoped correction records one too', async () => {
    const project = await store.add(newMemory({ scope: { kind: 'project', projectId: 'gameend' }, authorizedPersonIds: ['milad', 'parastoo', 'reza'] }));
    await store.add(newMemory({ supersedes: project.id, scope: project.scope }));
    expect(notices.notices.map((n) => n.recipientPersonIds)).toEqual([['milad', 'parastoo']]);
  });

  it('private, group and sensitive predecessors record none', async () => {
    const priv = await store.add(newMemory());
    await store.add(newMemory({ supersedes: priv.id }));
    const group = await store.add(newMemory({ scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: ['parastoo', 'reza'] }));
    await store.add(newMemory({ supersedes: group.id, scope: group.scope }));
    const sensitive = await store.add(peopleShared({ sensitivity: 'personal' }));
    await store.add(newMemory({ supersedes: sensitive.id }));
    expect(notices.notices).toEqual([]);
  });

  it('with the flag unset none is recorded and there is no extra read', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const inner = new InMemoryMemoryStore();
    const local = auditMemoryStore(inner, new InMemoryAuditStore(), notices);
    const get = vi.spyOn(inner, 'get');
    const shared = await local.add(peopleShared());
    await local.add(newMemory({ supersedes: shared.id }));
    expect(notices.notices).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
