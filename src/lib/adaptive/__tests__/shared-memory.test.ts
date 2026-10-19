import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AdaptiveRepository, accountIdFor, digest } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage, type AdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { SharedMemoryRepository, type SharedDocument } from '../shared/repository';
import { SharedMemoryService, type SharedAuthority } from '../shared/service';
import type { SharedContainerView } from '../shared/contracts';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
const roots: string[] = [];
const sqliteStores: SqliteAdaptiveStorage[] = [];
afterEach(async () => { for (const storage of sqliteStores.splice(0)) storage.close(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const START = 1_800_000_000_000;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(indexed = false) {
  const root = await mkdtemp(join(tmpdir(), 'vox-shared-')); roots.push(root);
  let now = START;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'shared-synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [101, 102, 103].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, index) => ({ schemaVersion: 1, id: `shared-approval-${index}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'shared-synthetic', effectiveAt: START, reviewExpiresAt: START + 400 * 86400_000,
      owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const privateDirectory = join(root, 'private'), sharedDirectory = join(root, 'shared');
  const storage = indexed ? new SqliteAdaptiveStorage(join(privateDirectory, 'synthetic.sqlite'), { now: () => now }) : new FileAdaptiveStorage(privateDirectory);
  if (storage instanceof SqliteAdaptiveStorage) sqliteStores.push(storage);
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
  for (const id of [101, 102, 103]) await adaptive.confirm(id, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const active = new Map([[101, true], [102, true], [103, true]]);
  let members = [101, 102], guests = false;
  const authority: SharedAuthority = {
    member: async id => ({ active: active.get(id) === true, agentIds: ['aria', 'other-agent'] }),
    group: async id => id === 'chat--100' ? { memberTelegramIds: members, hasGuests: guests, revision: digest([members, guests]) } : null,
    agent: async id => ({ active: ['aria', 'other-agent'].includes(id) }),
    memberNow: id => ({ active: active.get(id) === true, agentIds: ['aria', 'other-agent'] }),
    groupNow: id => id === 'chat--100' ? { memberTelegramIds: members, hasGuests: guests, revision: digest([members, guests]) } : null,
    agentNow: id => ({ active: ['aria', 'other-agent'].includes(id) }),
  };
  const factory = () => new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(sharedDirectory), 'synthetic'), adaptive, authority, () => now);
  const service = factory();
  async function create(options: { space?: 'work' | 'personal'; group?: boolean; agents?: string[]; text?: string; eventId?: string } = {}) {
    const space = options.space ?? 'work';
    const preview = await service.preview(101, { space, kind: options.group ? 'group' : 'selected', recipientTelegramIds: [102], ...(options.group ? { groupId: 'chat--100' } : {}) });
    const input = { space, eventId: options.eventId ?? 'create-001', expectedRevision: 0, previewToken: preview.previewToken, agentIds: options.agents ?? [], text: options.text ?? 'SHARED_CANARY' };
    const snapshot = await service.create(101, input);
    return { container: snapshot.containers.at(-1)!, input, preview };
  }
  async function personalize(id: number, space: 'work' | 'personal' = 'work') {
    const snapshot = await adaptive.read(id, space);
    const purpose = 'optional.personalization' as const;
    const current = snapshot.purposes.find(p => p.purpose === purpose)!;
    const presented = await adaptive.present(id, { space, purpose, locale: 'en', expectedRevision: current.revision, eventId: `present-${space}-${id}` });
    return adaptive.changeConsent(id, { space, purpose, state: 'granted', expectedRevision: presented.purposes.find(p => p.purpose === purpose)!.revision,
      receipt: presented.receipt, eventId: `grant-${space}-${id}` });
  }
  const command = (container: SharedContainerView, eventId: string) => ({ space: container.space, expectedRevision: container.revision, eventId });
  return { service, adaptive, storage, authority, factory, create, personalize, command, active, sharedDirectory, setNow: (value: number) => { now = value; }, setGroup: (ids: number[], hasGuests = false) => { members = ids; guests = hasGuests; } };
}

describe('durable explicit shared memory boundaries', () => {
  it('rechecks indexed participants without private aggregates and returns matching body-free shared authority', async () => {
    const ctx = await setup(true), storage = ctx.storage as SqliteAdaptiveStorage;
    await ctx.personalize(101); await ctx.personalize(102);
    const { container } = await ctx.create({ group: true, agents: ['aria'] });
    for (const id of [101, 102]) await ctx.adaptive.withAccountDocument(id, (d, now) => {
      d.memories = Array.from({ length: 300 }, (_, i) => ({ id: `private-${i}`, revision: 1, space: 'work', text: `PRIVATE_ACCOUNT_${id}_${i}`,
        status: 'active', createdAt: now, updatedAt: now, expiresAt: now + 50_000, revocationEpoch: 0 })); d.revision++;
    });
    const audience = { audienceTelegramIds: [101, 102], groupId: 'chat--100' };
    for (const k of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[k] = 0;
    const before = await ctx.service.readContext(101, 'work', 'aria', audience);
    expect(before.memories.map(m => m.text)).toEqual(['SHARED_CANARY']);
    expect(await ctx.service.readContextAuthority(101, 'work', 'aria', audience)).toEqual({ revision: before.revision });
    expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0);
    await ctx.service.deleteMemory(101, container.id, container.memories[0].id, ctx.command(container, 'delete-shared'));
    const deleted = await ctx.service.readContextAuthority(101, 'work', 'aria', audience);
    expect(deleted.revision).not.toBe(before.revision);
    expect((await ctx.service.readContext(101, 'work', 'aria', audience)).memories).toEqual([]);
    ctx.setGroup([101, 102, 103]);
    await expect(ctx.service.readContextAuthority(101, 'work', 'aria', audience)).rejects.toMatchObject({ code: 'audience_denied' });
  });
  it('stores exact recipients separately and gives unrelated accounts no implicit access', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    expect(container.recipients.map(r => r.telegramId)).toEqual([101, 102]);
    expect((await ctx.service.list(102, 'work')).containers[0].memories[0].text).toBe('SHARED_CANARY');
    expect((await ctx.service.list(103, 'work')).containers).toEqual([]);
    expect((await ctx.service.list(101, 'personal')).containers).toEqual([]);
    await expect(ctx.service.addMemory(103, container.id, { ...ctx.command(container, 'intrude'), text: 'forged' })).rejects.toMatchObject({ code: 'access_denied' });
    expect((await ctx.factory().list(102, 'work')).containers[0].id).toBe(container.id);
  });

  it('requires every chosen profile confirmed, eligible and currently approved', async () => {
    const ctx = await setup(); ctx.active.set(102, false);
    await expect(ctx.service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] })).rejects.toMatchObject({ code: 'recipient_unavailable' });
    ctx.active.set(102, true); ctx.setNow(START + 13 * 3600_000);
    await ctx.adaptive.confirm(101, { confirm: true, adultConfirmed: true });
    await expect(ctx.service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  });

  it('requires independent personalization and explicit per-container agent grants', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    await ctx.personalize(101);
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] })).memories).toEqual([]);
    const granted = await ctx.service.setAgentAccess(101, container.id, 'aria', { ...ctx.command(container, 'agent-grant'), allowed: true });
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] })).memories[0].text).toBe('SHARED_CANARY');
    expect((await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] })).memories).toEqual([]);
    expect((await ctx.adaptive.read(102, 'work')).purposes.find(p => p.purpose === 'optional.personalization')!.state).toBe('not_asked');
    const c = granted.containers[0];
    await expect(ctx.service.setAgentAccess(102, c.id, 'other-agent', { ...ctx.command(c, 'recipient-grant'), allowed: true })).rejects.toMatchObject({ code: 'access_denied' });
    await ctx.personalize(102);
    const before = await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] });
    await ctx.service.setAgentAccess(101, c.id, 'aria', { ...ctx.command(c, 'agent-revoke'), allowed: false });
    const after = await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] });
    expect(after.memories).toEqual([]); expect(after.revision).not.toBe(before.revision);
  });

  it('supports Personal sharing without mixing Work containers or grants', async () => {
    const ctx = await setup(); await ctx.personalize(101, 'personal');
    await ctx.create({ space: 'personal', agents: ['aria'], text: 'PERSONAL_SHARED_CANARY' });
    expect((await ctx.service.list(102, 'work')).containers).toEqual([]);
    expect((await ctx.service.readContext(101, 'personal', 'aria', { audienceTelegramIds: [101] })).memories[0].text).toBe('PERSONAL_SHARED_CANARY');
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] })).memories).toEqual([]);
  });

  it('does not expand group history when membership changes, and rejects stale previews', async () => {
    const ctx = await setup(); const { container } = await ctx.create({ group: true, agents: ['aria'] });
    await ctx.personalize(101); ctx.setGroup([101, 102, 103]);
    const list = await ctx.service.list(101, 'work');
    expect(list.containers[0].status).toBe('audience_changed'); expect(list.containers[0].memories).toEqual([]);
    expect((await ctx.service.list(103, 'work')).containers).toEqual([]);
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] })).memories).toEqual([]);
    await expect(ctx.service.addMemory(101, container.id, { ...ctx.command(container, 'new-after-join'), text: 'new' })).rejects.toMatchObject({ code: 'audience_changed' });
    const preview = await ctx.service.preview(101, { space: 'work', kind: 'group', groupId: 'chat--100', recipientTelegramIds: [102, 103] });
    ctx.setGroup([101, 102]);
    await expect(ctx.service.create(101, { space: 'work', eventId: 'stale-preview', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'NO_COMMIT' })).rejects.toMatchObject({ code: 'audience_changed' });
  });

  it('requires the exact live group audience and every recipient consent before group context', async () => {
    const ctx = await setup(); await ctx.create({ group: true, agents: ['aria'] }); await ctx.personalize(101);
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).memories).toEqual([]);
    await ctx.personalize(102);
    expect((await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).memories).toHaveLength(1);
    await expect(ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101, 103], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
    ctx.setGroup([101, 102], true);
    await expect(ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101, 102], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
  });

  it('revokes participants immediately, erases their authored content, and prevents stale writes', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    const contributed = await ctx.service.addMemory(102, container.id, { ...ctx.command(container, 'member-source'), text: 'REVOKED_AUTHOR_CANARY' });
    const c = contributed.containers[0];
    await ctx.service.revokeParticipant(101, c.id, 102, { ...ctx.command(c, 'revoke-member'), revoked: true });
    expect((await ctx.service.list(102, 'work')).containers).toEqual([]);
    const owner = (await ctx.service.list(101, 'work')).containers[0];
    expect(owner.memories.map(m => m.text)).toEqual(['SHARED_CANARY']);
    await expect(ctx.service.addMemory(102, c.id, { ...ctx.command(c, 'stale-add'), text: 'REPLAY' })).rejects.toMatchObject({ code: 'access_denied' });
    const stored = await Promise.all((await readdir(ctx.sharedDirectory)).filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')));
    expect(stored.join('')).not.toContain('REVOKED_AUTHOR_CANARY');
  });

  it('lets a recipient leave but denies revoking another recipient or acquiring management rights', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    await expect(ctx.service.revokeParticipant(102, container.id, 101, { ...ctx.command(container, 'bad-revoke'), revoked: true })).rejects.toMatchObject({ code: 'access_denied' });
    await ctx.service.revokeParticipant(102, container.id, 102, { ...ctx.command(container, 'leave'), revoked: true });
    expect((await ctx.service.list(102, 'work')).containers).toEqual([]);
  });

  it('erases deleted text across restart, and historical create retries never recreate it', async () => {
    const ctx = await setup(); const { container, input } = await ctx.create();
    await ctx.service.deleteMemory(101, container.id, container.memories[0].id, ctx.command(container, 'delete-source'));
    ctx.setNow(START + 6 * 60_000);
    const retried = await ctx.factory().create(101, input);
    expect(retried.containers[0].memories).toEqual([]);
    expect(retried.containers).toHaveLength(1);
    const files = await readdir(ctx.sharedDirectory);
    const text = (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('');
    expect(text).not.toContain('SHARED_CANARY'); expect(text).toContain('delete-source');
    await expect(ctx.service.create(101, { ...input, text: 'altered-retry' })).rejects.toMatchObject({ code: 'event_conflict' });
  });

  it('serializes concurrent CAS writers so one succeeds and the other must reload', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    const result = await Promise.allSettled([
      ctx.service.addMemory(101, container.id, { ...ctx.command(container, 'race-one'), text: 'one' }),
      ctx.factory().addMemory(102, container.id, { ...ctx.command(container, 'race-two'), text: 'two' }),
    ]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await ctx.service.list(101, 'work')).containers[0].memories).toHaveLength(2);
  });

  it('cancels a captured context if revocation commits before the final revision check', async () => {
    const ctx = await setup(); const { container } = await ctx.create({ agents: ['aria'] }); await ctx.personalize(102);
    const original = ctx.authority.member;
    let calls = 0, entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(done => { entered = done; }); const gate = new Promise<void>(done => { release = done; });
    ctx.authority.member = async id => { if (id === 102 && ++calls === 2) { entered(); await gate; } return original(id); };
    const read = ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] });
    await waiting;
    await ctx.service.revokeParticipant(101, container.id, 102, { ...ctx.command(container, 'racing-revoke'), revoked: true });
    release(); await expect(read).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('owner departure purges the container and all source text for every participant', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    await ctx.service.revokeParticipant(101, container.id, 101, { ...ctx.command(container, 'owner-leaves'), revoked: true });
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('SHARED_CANARY');
  });
  it('resolves group preview from server membership and never restores invalidated historical containers', async () => {
    const ctx = await setup();
    const preview = await ctx.service.preview(101, { space: 'work', kind: 'group', recipientTelegramIds: [], groupId: 'chat--100' });
    expect(preview.recipients.map(r => r.telegramId)).toEqual([101, 102]);
    const created = await ctx.service.create(101, { space: 'work', eventId: 'group-empty-selection', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'HISTORY_STAYS_INVALID' });
    ctx.setGroup([101, 102, 103]);
    expect((await ctx.service.list(101, 'work')).containers[0].memories).toEqual([]);
    ctx.setGroup([101, 102]);
    const restored = await ctx.factory().list(101, 'work');
    expect(restored.containers[0].status).toBe('audience_changed');
    expect(restored.containers[0].memories).toEqual([]);
    const c = restored.containers[0];
    await ctx.service.deleteMemory(101, c.id, created.containers[0].memories[0].id, ctx.command(c, 'delete-after-drift'));
  });

  it('rejects spoofed fields, duplicate audiences and previews whose binding changed', async () => {
    const ctx = await setup();
    await expect(ctx.service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102, 102] })).rejects.toMatchObject({ code: 'invalid_request' });
    const preview = await ctx.service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await ctx.adaptive.confirm(102, { confirm: true, adultConfirmed: true });
    await expect(ctx.service.create(101, { space: 'work', eventId: 'stale-identity', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'DENIED' })).rejects.toMatchObject({ code: 'preview_stale' });
    const input = { space: 'work', kind: 'selected', recipientTelegramIds: [102], personId: 'victim' };
    await expect(ctx.service.preview(101, input as never)).rejects.toBeTruthy();
    expect((await ctx.service.list(101, 'work')).containers).toEqual([]);
  });

  it('uses metadata-only identity projection and ignores unrelated aggregate revisions', async () => {
    const ctx = await setup(); const { container } = await ctx.create({ agents: ['aria'] }); await ctx.personalize(101);
    const before = await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] });
    const originalRead = ctx.adaptive.read;
    ctx.adaptive.read = async () => { throw new Error('Shared authority must not request private memory snapshots'); };
    const preview = await ctx.service.preview(101, { space: 'personal', kind: 'selected', recipientTelegramIds: [102] });
    expect(preview.recipients.map(r => r.telegramId)).toEqual([101, 102]);
    ctx.adaptive.read = originalRead;
    await ctx.adaptive.repository.transaction(accountIdFor(101), START, d => { d.revision++; });
    const latest = await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] });
    // Preview writes legitimately change shared registry revision. Compare once
    // stable, then mutate only the account's unrelated telemetry revision.
    await ctx.adaptive.repository.transaction(accountIdFor(101), START, d => { d.revision++; });
    const after = await ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101] });
    expect(after.revision).toBe(latest.revision);
    expect(after.memories[0].containerId).toBe(container.id);
    expect(before.memories[0].text).toBe(after.memories[0].text);
  });

  it('keeps a pending create invisible, then erases it if initiating authority fails revalidation', async () => {
    const ctx = await setup();
    const reached = deferred(), release = deferred(); let paused = false;
    const backing = ctx.service.repository.storage;
    const storage: AdaptiveStorage = { transact: async (key, mutate) => {
      let pendingStage = false;
      const result = await backing.transact(key, current => {
        const output = mutate(current);
        pendingStage = (output.document as SharedDocument).containers.some(c => c.status === 'pending');
        return output;
      });
      if (pendingStage && !paused) { paused = true; reached.resolve(); await release.promise; }
      return result;
    } };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => START);
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    const input = { space: 'work' as const, eventId: 'pending-create-failure', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'PENDING_CREATE_CANARY' };
    const creating = service.create(101, input);
    await reached.promise;
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    ctx.active.set(101, false); release.resolve();
    await expect(creating).rejects.toMatchObject({ code: 'recipient_unavailable' });
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('PENDING_CREATE_CANARY');
    ctx.active.set(101, true);
    await expect(ctx.factory().create(101, input)).rejects.toMatchObject({ code: 'operation_aborted' });
  });

  it('keeps staged additions invisible and purges failed text without erasing prior authorized memory', async () => {
    const ctx = await setup(); const { container } = await ctx.create();
    const reached = deferred(), release = deferred(); let paused = false;
    const backing = ctx.service.repository.storage;
    const storage: AdaptiveStorage = { transact: async (key, mutate) => {
      let pendingStage = false;
      const result = await backing.transact(key, current => {
        const output = mutate(current);
        pendingStage = (output.document as SharedDocument).containers.some(c => c.memories.some(m => m.status === 'pending'));
        return output;
      });
      if (pendingStage && !paused) { paused = true; reached.resolve(); await release.promise; }
      return result;
    } };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => START);
    const adding = service.addMemory(101, container.id, { ...ctx.command(container, 'pending-add-failure'), text: 'PENDING_ADD_CANARY' });
    await reached.promise;
    const during = await ctx.factory().list(102, 'work');
    expect(during.containers[0].memories.map(m => m.text)).toEqual(['SHARED_CANARY']);
    ctx.active.set(101, false); release.resolve();
    await expect(adding).rejects.toMatchObject({ code: 'recipient_unavailable' });
    expect((await ctx.factory().list(102, 'work')).containers[0].memories.map(m => m.text)).toEqual(['SHARED_CANARY']);
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('PENDING_ADD_CANARY');
  });

  it('checks real binding expiry again inside the delayed final publication transaction', async () => {
    const ctx = await setup(); let now = START + 12 * 3600_000 - 2;
    ctx.setNow(START + 6 * 3600_000); await ctx.adaptive.confirm(102, { confirm: true, adultConfirmed: true });
    ctx.setNow(now);
    const backing = ctx.service.repository.storage; let pendingSeen = false;
    const storage: AdaptiveStorage = { transact: (key, mutate) => backing.transact(key, current => {
      const hasPending = (current as SharedDocument | null)?.containers.some(c => c.memories.some(m => m.status === 'pending'));
      if (hasPending && pendingSeen) { now += 3; ctx.setNow(now); pendingSeen = false; }
      const result = mutate(current);
      if ((result.document as SharedDocument).containers.some(c => c.memories.some(m => m.status === 'pending'))) pendingSeen = true;
      return result;
    }) };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => now);
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await expect(service.create(101, { space: 'work', eventId: 'expire-at-publish', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'EXPIRED_PUBLISH_CANARY' })).rejects.toBeDefined();
    expect(JSON.stringify(await ctx.factory().list(102, 'work'))).not.toContain('EXPIRED_PUBLISH_CANARY');
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('EXPIRED_PUBLISH_CANARY');
  });

  it('erases staging after an uncertain adapter error and never replays the failed operation', async () => {
    const ctx = await setup(); const backing = ctx.service.repository.storage; let injected = false;
    const storage: AdaptiveStorage = { transact: async (key, mutate) => {
      let staged = false;
      const result = await backing.transact(key, current => {
        const output = mutate(current); staged = (output.document as SharedDocument).containers.some(c => c.status === 'pending'); return output;
      });
      if (staged && !injected) { injected = true; throw new Error('Synthetic unknown outcome after staging commit'); }
      return result;
    } };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => START);
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    const input = { space: 'work' as const, eventId: 'uncertain-stage', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'UNCERTAIN_STAGE_CANARY' };
    await expect(service.create(101, input)).rejects.toThrow('Synthetic unknown outcome');
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    await expect(ctx.factory().create(101, input)).rejects.toMatchObject({ code: 'operation_aborted' });
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('UNCERTAIN_STAGE_CANARY');
  });

  it('expires unpublished staging across restart and never resumes its timed-out operation', async () => {
    const ctx = await setup(); let now = START;
    const reached = deferred(), release = deferred(); let paused = false;
    const backing = ctx.service.repository.storage;
    const storage: AdaptiveStorage = { transact: async (key, mutate) => {
      let pendingStage = false;
      const result = await backing.transact(key, current => { const output = mutate(current); pendingStage = (output.document as SharedDocument).containers.some(c => c.status === 'pending'); return output; });
      if (pendingStage && !paused) { paused = true; reached.resolve(); await release.promise; }
      return result;
    } };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => now);
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    const input = { space: 'work' as const, eventId: 'timed-out-stage', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'TIMED_OUT_STAGE_CANARY' };
    const creating = service.create(101, input); await reached.promise;
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    now += 31_000; ctx.setNow(now);
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    release.resolve(); await expect(creating).rejects.toBeDefined();
    await expect(ctx.factory().create(101, input)).rejects.toMatchObject({ code: 'operation_aborted' });
    const files = await readdir(ctx.sharedDirectory);
    expect((await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('')).not.toContain('TIMED_OUT_STAGE_CANARY');
  });

  it('binds pending publication to its exact authored content and recipient intent', async () => {
    const ctx = await setup(); const backing = ctx.service.repository.storage; let tampered = false;
    const storage: AdaptiveStorage = { transact: (key, mutate) => backing.transact(key, current => {
      const d = current as SharedDocument | null;
      const c = d?.containers.find(c => c.status === 'pending');
      if (c && !tampered) {
        tampered = true;
        c.memories[0].text = 'TAMPERED_INTENT_CANARY';
        c.memories[0].recipientPersonIds.reverse();
      }
      return mutate(current);
    }) };
    const service = new SharedMemoryService(new SharedMemoryRepository(storage, 'synthetic'), ctx.adaptive, ctx.authority, () => START);
    const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    await expect(service.create(101, { space: 'work', eventId: 'sealed-intent', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'ORIGINAL_INTENT_CANARY' })).rejects.toMatchObject({ code: 'publication_stale' });
    expect((await ctx.factory().list(102, 'work')).containers).toEqual([]);
    const files = await readdir(ctx.sharedDirectory);
    const raw = (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => readFile(join(ctx.sharedDirectory, f), 'utf8')))).join('');
    expect(raw).not.toContain('ORIGINAL_INTENT_CANARY'); expect(raw).not.toContain('TAMPERED_INTENT_CANARY');
  });

});


describe('shared committed transport authority', () => {
  it('matches the async revision without private body reads and detects recipient/group changes', async () => {
    const f = await setup(true); await f.personalize(101); await f.personalize(102); await f.create({ group: true, agents: ['aria'] });
    const audience = { audienceTelegramIds: [101, 102], groupId: 'chat--100' };
    const before = await f.service.readContext(101, 'work', 'aria', audience);
    const storage = f.storage as SqliteAdaptiveStorage;
    storage.io.canonicalImageReads = 0; storage.io.bodyRowsRead = 0;
    expect(f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toMatchObject({ revision: before.revision });
    expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0);
    f.active.set(102, false); expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toThrow('recipient_unavailable');
    f.active.set(102, true); f.setGroup([101, 102, 103]);
    expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toThrow('audience_denied');
  });
  it('fails closed during a shared writer or unsupported Studio adapter', async () => {
    const f = await setup(true), audience = { audienceTelegramIds: [101] };
    await f.service.repository.transaction(() => {
      expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toThrow('Shared authority unavailable');
    });
    delete f.authority.memberNow;
    expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toThrow('authority_unavailable');
  });
  it('rejects expiry reached during shared parsing and exposes the earliest deadline', async () => {
    const f = await setup(true); await f.personalize(101); const { container } = await f.create({ agents: ['aria'] });
    await f.service.repository.transaction(d => { d.containers[0].memories[0].expiresAt = START + 10; });
    const audience = { audienceTelegramIds: [101] };
    await f.service.readContext(101, 'work', 'aria', audience);
    expect(f.service.readContextAuthorityNow(101, 'work', 'aria', audience).validUntil).toBe(START + 10);
    const read = f.service.repository.readCommittedForEffect.bind(f.service.repository);
    const spy = vi.spyOn(f.service.repository, 'readCommittedForEffect').mockImplementation(() => { const d = read(); f.setNow(START + 11); return d; });
    expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', audience)).toThrow('retention_changed');
    spy.mockRestore();
    expect((await f.service.list(101, 'work')).containers.find(c => c.id === container.id)?.memories).toEqual([]);
  });
});


it.each(['shared_read', 'private_commit'] as const)('rechecks Studio membership after final %s I/O', async seam => {
  const f = await setup(true); await f.personalize(101); await f.create({ agents: ['aria'] });
  let calls = 0;
  const storage = f.storage as SqliteAdaptiveStorage;
  const read = f.service.repository.readCommittedForEffect.bind(f.service.repository), exec = storage.database.exec.bind(storage.database);
  const spy = seam === 'shared_read' ? vi.spyOn(f.service.repository, 'readCommittedForEffect').mockImplementation((() => {
    return () => { const result = read(); if (++calls === 2) f.active.set(101, false); return result; };
  })()) : vi.spyOn(storage.database, 'exec').mockImplementation((() => {
    return sql => { const result = exec(sql); if (sql === 'COMMIT' && ++calls === 3) f.active.set(101, false); return result; };
  })());
  try { expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', { audienceTelegramIds: [101] })).toThrow(); }
  finally { spy.mockRestore(); }
});
it('persists a shared expiry first observed after the last shared read', async () => {
  const f = await setup(true); await f.personalize(101); await f.create({ agents: ['aria'] });
  await f.service.repository.transaction(d => { d.containers[0].memories[0].expiresAt = START + 10; });
  const read = f.service.repository.readCommittedForEffect.bind(f.service.repository); let calls = 0;
  const spy = vi.spyOn(f.service.repository, 'readCommittedForEffect').mockImplementation(() => { const result = read(); if (++calls === 2) f.setNow(START + 11); return result; });
  try { expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', { audienceTelegramIds: [101] })).toThrow('retention_changed'); }
  finally { spy.mockRestore(); }
  expect((f.storage as SqliteAdaptiveStorage).readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(START + 11);
  f.setNow(START + 5);
  expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', { audienceTelegramIds: [101] })).toThrow();
});
