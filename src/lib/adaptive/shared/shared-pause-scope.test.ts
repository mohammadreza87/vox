import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { FileAdaptiveStorage } from '../persistence/storage';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage } from '../persistence/indexed/managed-storage';
import { ProductPauseService } from '../product-pause/service';
import { SharedMemoryRepository } from './repository';
import { SharedMemoryService, type SharedAuthority } from './service';
const NOW = 1_800_000_000_000, U = 710001, V = 710002, W = 710003, AGENT = 'aria';
const roots: string[] = [], stores: Array<{ close(): void }> = [];
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(kind: 'sqlite' | 'file-v2') {
  const root = await mkdtemp(join(tmpdir(), 'vox-shared-pause-scope-')); roots.push(root);
  const options = { now: () => NOW, newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 as const } };
  const storage = kind === 'sqlite' ? new SqliteAdaptiveStorage(join(root, 'private.sqlite'), options) : new ManagedFileV2Storage(join(root, 'private'), options); stores.push(storage);
  const caps = ['core_text', 'personalization'], version = 'shared-pause-scope';
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: version, enabledCapabilities: caps,
    accounts: [U, V, W].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: caps.map((capability, i) => ({ schemaVersion: 1, id: `scope-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: version, effectiveAt: NOW, reviewExpiresAt: NOW + 600_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) });
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...adaptiveOptionsFromManifest(manifest), now: () => NOW });
  for (const id of [U, V, W]) {
    await adaptive.confirm(id, { confirm: true, adultConfirmed: true });
    const initial = await adaptive.read(id, 'work'), purpose = 'optional.personalization' as const;
    const p = await adaptive.present(id, { space: 'work', purpose, locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === purpose)!.revision, eventId: `present-${id}` });
    await adaptive.changeConsent(id, { space: 'work', purpose, state: 'granted', receipt: p.receipt, expectedRevision: p.purposes.find(p => p.purpose === purpose)!.revision, eventId: `grant-${id}` });
  }
  const member = () => ({ active: true, agentIds: [AGENT], revision: '1' }), agent = () => ({ active: true, revision: '1' });
  const group = (id: string) => id === 'current-group' ? { memberTelegramIds: [U, W], hasGuests: false, revision: '1' } : null;
  const authority: SharedAuthority = { member: async () => member(), memberNow: member, agent: async () => agent(), agentNow: agent,
    group: async id => group(id), groupNow: group, readSnapshotNow: ({ telegramIds, groupIds }) => ({ members: telegramIds.map(telegramId => ({ telegramId, ...member() })), agent: agent(), groups: groupIds.map(groupId => ({ groupId, value: group(groupId) })) }) };
  const repository = new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared')), 'scope');
  const service = new SharedMemoryService(repository, adaptive, authority, () => NOW), pause = new ProductPauseService(adaptive);
  for (const [recipient, text] of [[V, 'SHARED_U_V'], [W, 'SHARED_U_W']] as const) {
    const preview = await service.preview(U, { space: 'work', kind: 'selected', recipientTelegramIds: [recipient] });
    await service.create(U, { space: 'work', expectedRevision: 0, eventId: `create-${recipient}`, previewToken: preview.previewToken, agentIds: [AGENT], text });
  }
  let event = 0;
  const change = async (id: number, action: 'pause' | 'resume') => { const s = await pause.read(id, 'work'); await pause.command(id, { version: 1, space: 'work', action, eventId: `synthetic-pause-event-${String(++event).padStart(4, '0')}`, expectedCommandSeq: s.commandSeq! }); };
  const audience = { audienceTelegramIds: [U] };
  async function context(expected: string[], selectedAudience = audience) {
    const result = await service.readContext(U, 'work', AGENT, selectedAudience);
    expect(result.memories.map(m => m.text).sort()).toEqual([...expected].sort());
    expect(await service.readContextAuthority(U, 'work', AGENT, selectedAudience)).toEqual({ revision: result.revision });
    expect(service.readContextAuthorityNow(U, 'work', AGENT, selectedAudience).revision).toBe(result.revision);
    return result;
  }
  return { service, repository, change, context, audience };
}
for (const kind of ['sqlite', 'file-v2'] as const) {
  it(`${kind}: unrelated paused participant in an agent-denied container leaves fresh allowed shared context usable`, async () => {
    const f = await fixture(kind), listed = await f.service.list(U, 'work');
    const uv = listed.containers.find(c => c.recipients.some(r => r.telegramId === V))!;
    await f.service.setAgentAccess(U, uv.id, AGENT, { space: 'work', expectedRevision: uv.revision, eventId: 'disable-uv-agent', allowed: false });
    const before = await f.context(['SHARED_U_W']);
    await f.change(V, 'pause'); const paused = await f.context(['SHARED_U_W']);
    // Existing broad invalidation remains: a fresh read works, an old prepared receipt does not.
    expect(paused.revision).not.toBe(before.revision);
    await f.change(V, 'resume'); const resumed = await f.context(['SHARED_U_W']);
    expect(resumed.revision).not.toBe(paused.revision); expect(resumed.revision).not.toBe(before.revision);
    expect((await f.service.list(U, 'work')).containers.flatMap(c => c.memories).map(m => m.text).sort()).toEqual(['SHARED_U_V', 'SHARED_U_W']);
  });
  it(`${kind}: pause suppresses only the eligible container that requires the stopped member; resume needs fresh receipts`, async () => {
    const f = await fixture(kind), before = await f.context(['SHARED_U_V', 'SHARED_U_W']);
    await f.change(V, 'pause'); const stoppedV = await f.context(['SHARED_U_W']);
    await f.change(W, 'pause'); await f.context([]);
    await f.change(V, 'resume'); const freshV = await f.context(['SHARED_U_V']);
    expect(freshV.revision).not.toBe(before.revision); expect(freshV.revision).not.toBe(stoppedV.revision);
    await f.change(W, 'resume'); const freshBoth = await f.context(['SHARED_U_V', 'SHARED_U_W']);
    expect(freshBoth.revision).not.toBe(before.revision);
    await f.change(U, 'pause'); await f.context([]);
    expect((await f.service.list(U, 'work')).containers.flatMap(c => c.memories).map(m => m.text).sort()).toEqual(['SHARED_U_V', 'SHARED_U_W']);
  });
  it(`${kind}: an active container member absent from a resource's recipients cannot suppress that resource`, async () => {
    const f = await fixture(kind);
    const preview = await f.service.preview(U, { space: 'work', kind: 'selected', recipientTelegramIds: [V, W] });
    const created = await f.service.create(U, { space: 'work', expectedRevision: 0, eventId: 'three-member-container', previewToken: preview.previewToken, agentIds: [AGENT], text: 'RESOURCE_U_V_W' });
    const c = created.containers.find(c => c.memories.some(m => m.text === 'RESOURCE_U_V_W'))!;
    await f.service.addMemory(U, c.id, { space: 'work', expectedRevision: c.revision, eventId: 'subset-resource', text: 'RESOURCE_U_W' });
    // Valid canonical historical recipient partition: the active container may
    // contain more people than an individual retained resource authorizes.
    await f.repository.transaction(d => {
      const container = d.containers.find(row => row.id === c.id)!, v = container.members.find(m => m.telegramId === V)!;
      const memory = container.memories.find(m => m.text === 'RESOURCE_U_W')!;
      memory.recipientPersonIds = memory.recipientPersonIds.filter(id => id !== v.personId); memory.revision++; container.revision++; d.revision++;
    });
    const before = await f.context(['SHARED_U_V', 'SHARED_U_W', 'RESOURCE_U_V_W', 'RESOURCE_U_W']);
    await f.change(V, 'pause'); const after = await f.context(['SHARED_U_W', 'RESOURCE_U_W']);
    expect(after.revision).not.toBe(before.revision);
    await f.change(V, 'resume'); const resumed = await f.context(['SHARED_U_V', 'SHARED_U_W', 'RESOURCE_U_V_W', 'RESOURCE_U_W']);
    expect(resumed.revision).not.toBe(before.revision); expect(resumed.revision).not.toBe(after.revision);
  });
  it(`${kind}: a resource with an unmapped retained recipient identity stays suppressed`, async () => {
    const f = await fixture(kind);
    await f.repository.transaction(d => {
      const c = d.containers.find(c => c.members.some(m => m.telegramId === V))!, recipient = c.members.find(m => m.telegramId === V)!;
      const previousPerson = recipient.personId; recipient.personId = 'stale-unmapped-person';
      for (const m of c.memories) m.recipientPersonIds = m.recipientPersonIds.map(id => id === previousPerson ? recipient.personId : id);
      c.revision++; d.revision++;
    });
    await f.context(['SHARED_U_W']);
    await f.change(V, 'pause'); await f.context(['SHARED_U_W']);
    await f.change(V, 'resume'); await f.context(['SHARED_U_W']);
  });
  it(`${kind}: participant of a resource outside the current exact audience does not suppress an eligible independent contribution`, async () => {
    const f = await fixture(kind), audience = { audienceTelegramIds: [U, W], groupId: 'current-group' };
    const before = await f.context(['SHARED_U_W'], audience);
    await f.change(V, 'pause'); const after = await f.context(['SHARED_U_W'], audience);
    expect(after.revision).not.toBe(before.revision);
    await f.change(W, 'pause'); await f.context([], audience);
  });
}
