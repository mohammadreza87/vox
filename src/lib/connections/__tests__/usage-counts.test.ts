import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { countLivePeople, emptyRecords, FileConnectionsStorage, FirestoreConnectionsStorage, InMemoryConnectionsStorage, type ConnectionsStorage } from '../storage';
import { partitionIdFor } from '../repository';
import type { ConnectionsRecords } from '../contracts';
import { protectUsage, USAGE_MIN_PEOPLE } from '../../studio/connector-usage';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

type Row = Record<string, unknown>;
/** A schema-valid synthetic connection row; ids and labels are synthetic and must never surface in counts. */
function connectionRow(o: { person: number; agentId?: string; providerId?: string; lifecycle?: string; space?: 'work' | 'personal'; legacy?: boolean; id?: string }): Row {
  const accountId = `telegram-account:${o.person}`, space = o.space ?? 'personal', providerId = o.providerId ?? 'gmail';
  return {
    schemaVersion: o.legacy ? 1 : 2, id: o.id ?? `conn-${o.person}-${providerId}-${space}-${o.agentId ?? 'x'}-${o.lifecycle ?? 'connected'}`,
    partitionId: partitionIdFor(accountId, space), revision: 1, createdAt: 1, updatedAt: 1, retentionUntil: 9_999_999_999_999,
    ownerAccountId: accountId, ownerPersonId: `person-${o.person}`,
    scope: { tenantId: `tenant-${o.person}`, spaceId: `space-${o.person}-${space}`, spaceKind: space, containerId: `container-${o.person}-${space}`, audiencePersonIds: [`person-${o.person}`], audienceRevision: `rev-${o.person}` },
    providerId, displayLabel: `SECRET_LABEL_${o.person}@example.org`, providerAccountId: null, adapterId: `${providerId}-typed`, adapterVersion: '1.0.0',
    catalogDigest: 'digest', endpointProfileId: 'profile', providerScopes: [], lifecycle: o.lifecycle ?? 'connected', revocationEpoch: 0, health: 'healthy', checkedAt: null,
    ...(o.legacy ? {} : { agentId: o.agentId ?? 'alpha' }),
    ...(providerId === 'remote_mcp' ? { mcp: { canonicalResourceUri: `https://private-host-${o.person}.fixture.net/mcp`, catalog: null } } : {}),
  };
}

async function seed(storage: ConnectionsStorage, rows: Row[]) {
  const byPartition = new Map<string, Row[]>();
  for (const row of rows) byPartition.set(row.partitionId as string, [...byPartition.get(row.partitionId as string) ?? [], row]);
  for (const [partitionId, connections] of byPartition) await storage.transact(partitionId, () => ({ records: { ...emptyRecords(), connections } as unknown as ConnectionsRecords, result: undefined }));
}

const world = (): Row[] => [
  connectionRow({ person: 1, providerId: 'gmail' }),
  connectionRow({ person: 1, providerId: 'gmail', space: 'work' }), // same person, other space: one person
  connectionRow({ person: 2, providerId: 'gmail' }),
  connectionRow({ person: 3, providerId: 'gmail' }),
  connectionRow({ person: 3, providerId: 'remote_mcp' }),
  connectionRow({ person: 4, providerId: 'github', lifecycle: 'pending' }),
  connectionRow({ person: 5, providerId: 'github', lifecycle: 'revoked' }),
  connectionRow({ person: 6, providerId: 'github', agentId: 'beta' }),
  connectionRow({ person: 7, providerId: 'github', legacy: true }),
];

const leaks = (value: unknown) => {
  const json = JSON.stringify(value);
  return ['telegram-account', 'person-', 'SECRET_LABEL', 'private-host', 'fixture.net', 'tenant-', 'conn-', 'createdAt', 'updatedAt'].filter(token => json.includes(token));
};

describe('manager counts: people per connected app', () => {
  it('counts distinct live people per provider; pending, revoked, other-agent and legacy rows never count', () => {
    expect(countLivePeople(world(), 'alpha')).toEqual({ gmail: 3, remote_mcp: 1 });
    expect(countLivePeople(world(), 'beta')).toEqual({ github: 1 });
    expect(countLivePeople([], 'alpha')).toEqual({});
    expect(countLivePeople([{ junk: true }, null, 'x'], 'alpha')).toEqual({});
  });

  it('never counts the excluded viewer (no subtraction of one\'s own connections)', async () => {
    expect(countLivePeople(world(), 'alpha', 'telegram-account:3')).toEqual({ gmail: 2 });
    const storage = new InMemoryConnectionsStorage();
    await seed(storage, world());
    expect(await storage.countLivePeopleByAgent('alpha', 'telegram-account:1')).toEqual({ gmail: 2, remote_mcp: 1 });
  });

  it('small-number protection: under 3 people, or everyone else, is never shown', () => {
    const rows = [{ people: 1 }, { people: 2 }, { people: 3 }, { people: 7 }, { people: 8 }];
    expect(protectUsage(rows, 8)).toEqual([{ people: 3 }, { people: 7 }]);
    expect(protectUsage(rows, null)).toEqual([{ people: 3 }, { people: 7 }, { people: 8 }]);
    expect(protectUsage([{ people: 1 }], 1)).toEqual([]);
    expect(protectUsage([{ people: 3 }], 3)).toEqual([]);
    // a hand-picked audience (a private agent's list) never shows a count, however large
    expect(protectUsage(rows, 'chosen')).toEqual([]);
    expect(USAGE_MIN_PEOPLE).toBe(3);
  });

  it('one person: the count is 1 and nothing about them is in the answer', () => {
    const one = countLivePeople([connectionRow({ person: 42, providerId: 'remote_mcp' })], 'alpha');
    expect(one).toEqual({ remote_mcp: 1 });
    expect(leaks(one)).toEqual([]);
    expect(Object.values(one).every(v => Number.isSafeInteger(v))).toBe(true);
  });

  const backends: Array<[string, () => Promise<ConnectionsStorage>]> = [
    ['in-memory', async () => new InMemoryConnectionsStorage()],
    ['file', async () => { const dir = await mkdtemp(join(tmpdir(), 'vox-usage-')); directories.push(dir); return new FileConnectionsStorage(join(dir, 'connections')); }],
  ];
  it.each(backends)('%s storage counts the same way and leaks nothing', async (_name, make) => {
    const storage = await make();
    expect(await storage.countLivePeopleByAgent!('alpha')).toEqual({});
    await seed(storage, world());
    const counts = await storage.countLivePeopleByAgent!('alpha');
    expect(counts).toEqual({ gmail: 3, remote_mcp: 1 });
    expect(leaks(counts)).toEqual([]);
  });

  it('file storage: a read-only peek of a partition that never existed creates nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-usage-')); directories.push(dir);
    const storage = new FileConnectionsStorage(join(dir, 'connections'));
    expect((await storage.peek(partitionIdFor('telegram-account:9', 'work'))).connections).toEqual([]);
    expect(await storage.countLivePeopleByAgent('alpha')).toEqual({});
    expect(await readdir(dir)).toEqual([]);
  });

  it('firestore storage uses one single-field agentId query and counts the same way', async () => {
    const rows = world();
    const queries: Array<{ collection: string; field: string; value: unknown; limit: number }> = [];
    const db = { collection: (collection: string) => ({ where: (field: string, _op: string, value: unknown) => ({ limit: (limit: number) => ({ get: async () => {
      queries.push({ collection, field, value, limit });
      return { docs: rows.filter(r => collection === 'connections_connections' && r[field] === value).map(r => ({ data: () => structuredClone(r) })) };
    } }) }) }) } as unknown as Firestore;
    const counts = await new FirestoreConnectionsStorage(db).countLivePeopleByAgent('alpha');
    expect(counts).toEqual({ gmail: 3, remote_mcp: 1 });
    expect(queries).toEqual([{ collection: 'connections_connections', field: 'agentId', value: 'alpha', limit: 5000 }]);
    expect(leaks(counts)).toEqual([]);
  });
});
