import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import { ConnectionsService } from '../service';
import { FileConnectionsStorage, InMemoryConnectionsStorage } from '../storage';
import { ConnectionsRepository, partitionIdFor } from '../repository';
import type { ConnectionContext, ConnectionsCatalog } from '../contracts';
const context: ConnectionContext = { accountId: 'synthetic-account', personId: 'synthetic-person', bindingId: 'binding', bindingRevision: 1,
  bindingExpiresAt: 1_000_000, currentAgentIds: [], scope: { tenantId: 'tenant', spaceId: 'work', spaceKind: 'work', containerId: 'private',
    audiencePersonIds: ['synthetic-person'], audienceRevision: '1' } };
const catalog: ConnectionsCatalog = { get: () => undefined, validateArguments: () => ({}), mapResources: () => [],
  provider: () => ({ adapterId: 'fixture', adapterVersion: '1', catalogDigest: 'catalog-1', endpointProfileId: 'fixture' }) };
const options = { now: () => 100, catalog, resolveContext: async () => context };
describe('normalized Connections storage', () => {
  it('reloads normalized files across service instances and cleans crash-orphan generations', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'vox-connections-fixture-'));
    try {
      const first = new ConnectionsService(new ConnectionsRepository(new FileConnectionsStorage(directory)), options);
      const enrolled = await first.enroll({ accountId: context.accountId }, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic' });
      const partition = partitionIdFor(context.accountId, 'work');
      const root = join(directory, createHash('sha256').update(partition).digest('hex'));
      const orphan = join(root, `generation-${randomUUID()}`);
      await fs.mkdir(orphan); await fs.writeFile(join(orphan, 'old-payload.json'), '{"synthetic":"crash fixture"}');
      const second = new ConnectionsService(new ConnectionsRepository(new FileConnectionsStorage(directory)), options);
      expect((await second.list({ accountId: context.accountId }, { space: 'work' })).connections).toEqual(enrolled.connections);
      await expect(fs.stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
      const pointer = JSON.parse(await fs.readFile(join(root, 'current.json'), 'utf8')) as { generation: string };
      expect((await fs.readdir(join(root, pointer.generation, 'connections'))).length).toBe(1);
      expect((await fs.stat(join(root, 'current.json'))).mode & 0o777).toBe(0o600);
      expect((await fs.readdir(root)).filter(name => name.startsWith('generation-'))).toHaveLength(1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('rolls back failed mutations and rejects corrupt identity on reload', async () => {
    const storage = new InMemoryConnectionsStorage();
    const repository = new ConnectionsRepository(storage);
    const service = new ConnectionsService(repository, options);
    await service.enroll({ accountId: context.accountId }, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic' });
    await expect(repository.transaction(context, records => { records.connections = []; throw new Error('fixture abort'); })).rejects.toThrow('fixture abort');
    expect((await service.list({ accountId: context.accountId }, { space: 'work' })).connections).toHaveLength(1);
    await expect(repository.transaction(context, records => { records.connections[0].ownerPersonId = 'substituted-person'; })).rejects.toMatchObject({ code: 'corrupt_partition' });
    expect((await service.list({ accountId: context.accountId }, { space: 'work' })).connections).toHaveLength(1);
  });
  it('fails closed on malformed current pointers rather than resetting records', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'vox-connections-fixture-'));
    try {
      const service = new ConnectionsService(new ConnectionsRepository(new FileConnectionsStorage(directory)), options);
      await service.enroll({ accountId: context.accountId }, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic' });
      const root = join(directory, createHash('sha256').update(partitionIdFor(context.accountId, 'work')).digest('hex'));
      await fs.writeFile(join(root, 'current.json'), '{"generation":"../../elsewhere"}');
      await expect(service.list({ accountId: context.accountId }, { space: 'work' })).rejects.toThrow('Invalid Connections generation');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
