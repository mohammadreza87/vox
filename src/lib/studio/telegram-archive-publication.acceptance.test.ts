/** QA-owned actual FILE publication integration with synthetic identities,
 * permissions and transport only. No real Telegram/provider calls. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { hire, ID, makeStudio, seedOrg, T0 } from './__tests__/helpers';
import { StudioTelegramArchive } from './telegram-archive';
import { handleAgentUpdate } from './updates';
import { AdaptiveService } from '../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor, type AdaptiveDocument } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage } from '../adaptive/persistence/storage';
import { ManagedFileV2Storage } from '../adaptive/persistence/indexed/managed-storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import { RightsUseHoldService } from '../adaptive/rights-use-holds/service';
import type { ArchiveTransport } from '../tireh/memory/telegram-archive/contracts';
import type { TelegramMessage } from '../tireh/telegram/client';

const directories: string[] = [];
const shutdowns: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of shutdowns.splice(0)) close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const message = (id: number, text: string, at: number, person = ID.alice): TelegramMessage => ({
  message_id: id, date: Math.floor(at / 1000), text,
  from: { id: person, first_name: 'Synthetic publication QA', is_bot: false }, chat: { id: person, type: 'private' },
});

async function fixture(managed = false) {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice); directories.push(h.dir);
  vi.spyOn(h.studio, 'botToken').mockReturnValue('7011:qa-synthetic-token');
  const capabilities = ['core_text', 'personalization', 'auto_memory'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'qa-publication', enabledCapabilities: capabilities,
    accounts: [ID.alice, ID.bob].map(person => ({ accountId: accountIdFor(person), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `qa-publication-approval-${index}`, revision: 1,
      createdAt: T0.getTime(), updatedAt: T0.getTime(), jurisdiction: 'SYNTHETIC', capability, state: 'approved',
      configurationVersion: 'qa-publication', effectiveAt: T0.getTime(), reviewExpiresAt: T0.getTime() + 86_400_000,
      owner: 'synthetic-only', approvalReference: 'synthetic-only' })) }));
  let managedStorage: ManagedFileV2Storage | undefined;
  shutdowns.push(() => managedStorage?.close());
  const reopen = () => {
    if (managed) {
      managedStorage?.close();
      managedStorage = new ManagedFileV2Storage(join(h.dir, 'adaptive'), { now: () => h.clock.now.getTime(),
        newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 3 } });
    }
    const storage = managedStorage ?? new FileAdaptiveStorage(join(h.dir, 'adaptive'));
    const service = new AdaptiveService(new AdaptiveRepository(storage), {
      ...options, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime(),
    });
    h.studio.deps.adaptive = service; h.studio.deps.relationshipAuthority = new AdaptiveRelationshipService(service); return service;
  };
  let adaptive = reopen();
  for (const person of [ID.alice, ID.bob]) {
    await adaptive.confirm(person, { confirm: true, adultConfirmed: true });
    for (const purpose of ['optional.personalization', 'optional.auto_memory'] as const) {
      const current = await adaptive.read(person, 'work');
      const shown = await adaptive.present(person, { space: 'work', purpose, locale: 'en',
        expectedRevision: current.purposes.find(row => row.purpose === purpose)!.revision, eventId: randomUUID() });
      await adaptive.changeConsent(person, { space: 'work', purpose, state: 'granted',
        expectedRevision: shown.purposes.find(row => row.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt });
    }
    const consent = await adaptive.read(person, 'work');
    await adaptive.setAgentAccess(person, agent.id, { space: 'work', allowed: true, expectedRevision: consent.revision, eventId: randomUUID() });
  }
  const files = new Map<string, Uint8Array>(), uploads: Array<{ fileId: string; data: Uint8Array }> = [];
  let beforeUpload: ((authorizeNow: () => boolean) => Promise<void>) | undefined;
  let afterUpload: (() => Promise<void>) | undefined, captureEnabled = true, publicationEnabled = false;
  const transport: ArchiveTransport = {
    async upload(chatId, _name, data, authorizeNow) {
      await beforeUpload?.(authorizeNow);
      expect(chatId).toBe(ID.alice); if (!authorizeNow()) throw new Error('QA_PUBLICATION_DENIED');
      const fileId = `qa-file-publication-${uploads.length + 1}`;
      files.set(fileId, new Uint8Array(data)); uploads.push({ fileId, data: new Uint8Array(data) });
      await afterUpload?.(); return { fileId, messageId: uploads.length };
    },
    async download(fileId, maxBytes) {
      const data = files.get(fileId); if (!data || data.byteLength > maxBytes) throw new Error('QA_FILE_UNAVAILABLE');
      return new Uint8Array(data);
    },
  };
  const create = () => new StudioTelegramArchive(h.studio, () => captureEnabled, () => transport, () => publicationEnabled);
  let archive = create(); h.studio.deps.telegramArchive = archive;
  const command = (action: string, person = ID.alice) => archive.command(agent.id, message(1, `/archive ${action}`, h.clock.now.getTime(), person));
  await command('enable'); h.clock.now = new Date(T0.getTime() + 2000);
  const scope = await archive.scope(ID.alice, agent.id);
  return { h, agent, files, uploads, scope, command,
    get archive() { return archive; }, get adaptive() { return adaptive; },
    set publicationEnabled(value: boolean) { publicationEnabled = value; }, set captureEnabled(value: boolean) { captureEnabled = value; },
    afterUpload: (fn?: typeof afterUpload) => { afterUpload = fn; },
    beforeUpload: (fn?: typeof beforeUpload) => { beforeUpload = fn; },
    row: () => adaptive.withAccountView(ID.alice, doc => structuredClone(doc.telegramArchives![0])),
    capture: (id: number, text: string, update = id) => archive.capture(agent.id, message(id, text, h.clock.now.getTime()), update),
    edit: (id: number) => archive.invalidateEditedMessage(agent.id, message(id, 'QA_EDIT_NOT_AUTOMATICALLY_SAVED', h.clock.now.getTime())),
    restart: () => { adaptive = reopen(); archive = create(); h.studio.deps.telegramArchive = archive; },
    withdraw: async () => {
      const current = await adaptive.read(ID.alice, 'work');
      await adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.auto_memory', state: 'withdrawn',
        expectedRevision: current.purposes.find(row => row.purpose === 'optional.auto_memory')!.revision, eventId: randomUUID() });
    },
  };
}

async function checkpoint(f: Awaited<ReturnType<typeof fixture>>, id = 10, text = 'QA_PUBLICATION_PRIVATE_SOURCE') {
  await f.capture(id, text); await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
}

describe('AM-05/12 independent FILE snapshot publication integration', () => {
  it('requires separate publication availability and never starts from capture or maintenance', async () => {
    const f = await fixture(); await checkpoint(f);
    const existing = f.uploads.length;
    await f.command('compact'); expect(f.uploads).toHaveLength(existing);
    expect((await f.row()).state!.publication).toBeUndefined(); expect((await f.row()).state!.snapshot).toBeUndefined();
    f.publicationEnabled = true;
    await f.archive.drain(); expect(f.uploads).toHaveLength(existing);
    expect((await f.row()).state!.snapshot).toBeUndefined();
    await f.command('compact'); expect((await f.row()).state!.snapshot).toBeDefined();
    const published = f.uploads.length; await f.command('compact'); expect(f.uploads).toHaveLength(published);
  });

  it('persists a trusted snapshot and later checkpoint suffix through fresh FILE/service instances', async () => {
    const f = await fixture(); f.publicationEnabled = true;
    await checkpoint(f, 10, 'QA_ORIGINAL Monday'); await f.command('compact');
    const row = await f.row(); expect(row.snapshotPublicationVersion).toBe(1);
    const base = row.state!.snapshot!.baseHead; f.publicationEnabled = false; f.restart();
    await checkpoint(f, 11, 'QA_LATER Friday'); f.restart();
    const restored = await f.archive.archive(f.scope).recover(f.scope);
    expect(restored.events.map(event => event.text)).toEqual(['QA_ORIGINAL Monday', 'QA_LATER Friday']);
    expect((await f.row()).state!.head!.sequence).toBe(base.sequence + 1);
    expect((await f.row()).snapshotPublicationVersion).toBe(1);
    const sent = f.uploads.length; await f.command('compact'); expect(f.uploads).toHaveLength(sent);
    await f.command('recover');
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text.join()).toContain('QA_LATER Friday');
    expect((await f.archive.context(ID.bob, f.agent.id, 'work')).text).toEqual([]);
    expect((await f.archive.context(ID.alice, f.agent.id, 'personal')).text).toEqual([]);
  });

  it('reports an incoming message refused during publication before returning from update handling', async () => {
    const f = await fixture(); f.publicationEnabled = true; await checkpoint(f);
    let entered!: () => void, release!: () => void, first = true;
    const entry = new Promise<void>(done => { entered = done; }), hold = new Promise<void>(done => { release = done; });
    f.afterUpload(async () => { if (first) { first = false; entered(); await hold; } });
    const active = f.command('compact');
    await Promise.race([entry, active.then(() => { throw new Error('Publication ended before its upload barrier'); })]);
    try {
      await handleAgentUpdate(f.h.studio, f.agent.id, { update_id: 500,
        message: message(500, 'QA_REFUSED_DURING_PUBLICATION', f.h.clock.now.getTime()) });
      const notices = f.h.botFor('7011:qa-synthetic-token').sendMessage.mock.calls;
      expect(notices.some(([recipient, text]) => recipient === ID.alice && text.includes('not saved or processed'))).toBe(true);
      expect(JSON.stringify(await f.adaptive.withAccountView(ID.alice, doc => doc))).not.toContain('QA_REFUSED_DURING_PUBLICATION');
      expect(f.h.chatLLM.replyRequests).toEqual([]);
    } finally { release(); await active.catch(() => undefined); }
  });

  it('denies the effect callback while actual canonical FILE is busy even with an available service draft', async () => {
    const f = await fixture(); f.publicationEnabled = true; await checkpoint(f); const sent = f.uploads.length;
    let checked = false;
    f.beforeUpload(async authorizeNow => {
      expect(authorizeNow()).toBe(true);
      const current = await f.adaptive.withAccountView(ID.alice, doc => structuredClone(doc));
      // This deliberately presents the exact draft source used by a synchronous
      // mutation. It must never substitute for the committed provider-effect
      // claim while an actual canonical writer owns the FILE lease.
      const bridge = f.archive as unknown as { draft?: AdaptiveDocument };
      await f.adaptive.withAccountDocument(ID.alice, () => {
        const prior = bridge.draft; bridge.draft = current;
        try { expect(authorizeNow()).toBe(false); checked = true; }
        finally { bridge.draft = prior; }
      });
      throw new Error('QA_STOP_AFTER_BUSY_GATE_PROOF');
    });
    await f.command('compact').catch(() => undefined); f.beforeUpload();
    expect(checked).toBe(true); expect(f.uploads).toHaveLength(sent); expect((await f.row()).state?.snapshot).toBeUndefined();
  });

  it('honors a real current rights-use hold during publication in separately qualified synthetic Managed FILE3 state', async () => {
    const f = await fixture(true); f.publicationEnabled = true; await checkpoint(f);
    const backend = new RightsUseHoldService(f.adaptive), holdScope = { space: 'work' as const, purpose: 'optional.personalization' as const };
    let applied = false;
    f.afterUpload(async () => {
      if (applied) return;
      const current = backend.inspectNow(ID.alice, holdScope, () => {});
      expect(current.status).toBe('ready'); if (current.status !== 'ready') throw new Error('QA_HOLD_UNAVAILABLE');
      const now = f.h.clock.now.getTime();
      const receipt = await backend.apply(ID.alice, { version: 1, scope: holdScope, effectId: randomUUID(), requestId: randomUUID(),
        expectedCanonicalRevision: current.value.accountRevision, expectedUseEpoch: current.value.useEpoch,
        policy: { id: 'qa-only-policy', revision: 1, digest: 'a'.repeat(64), approvalReference: 'synthetic-only', decisionReference: 'synthetic-only' },
        notice: { version: 'qa-only-notice', digest: 'b'.repeat(64) }, reviewAt: now + 60_000,
        metadataRetainUntil: now + 86_400_000, replayRetainUntil: now + 86_400_000, applyIntentDigest: 'c'.repeat(64),
      }, () => {});
      expect(receipt.effectiveBlocked).toBe(true); applied = true;
    });
    const sentBefore = f.uploads.length;
    await f.command('compact').catch(() => undefined); expect(applied).toBe(true); f.afterUpload();
    expect(f.uploads).toHaveLength(sentBefore + 1); expect((await f.row()).state?.snapshot).toBeUndefined();
    await expect(f.archive.archive(f.scope).recover(f.scope)).rejects.toMatchObject({ code: 'authority' });
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
    await f.command('compact').catch(() => undefined); expect(f.uploads).toHaveLength(sentBefore + 1);
  });

  it.each(['clear', 'disable', 'withdrawal', 'expiry'] as const)('keeps uncertainty content-free across %s, repeated reset and a late upload response', async reason => {
    const f = await fixture(); f.publicationEnabled = true; await checkpoint(f);
    const oldHead = (await f.row()).state!.head;
    let held = false;
    f.afterUpload(async () => {
      if (held) return; held = true;
      if (reason === 'clear' || reason === 'disable') await f.command(reason);
      else if (reason === 'withdrawal') await f.withdraw();
      else {
        f.h.clock.now = new Date(T0.getTime() + 86_400_001);
        // Actual expiry pruning runs as part of the canonical account read.
        await f.adaptive.read(ID.alice, 'work');
        await f.command('clear');
      }
    });
    await f.command('compact').catch(() => undefined); expect(held).toBe(true);
    f.afterUpload(); f.restart();
    const row = await f.row(); expect(row.state?.snapshot).toBeUndefined();
    expect(row.retiredOperation).toMatchObject({ kind: 'snapshot', stage: 'unknown', scope: f.scope });
    const retired = row.retiredOperation;
    expect(JSON.stringify(retired)).not.toContain('QA_PUBLICATION_PRIVATE_SOURCE');
    expect(JSON.stringify(retired)).not.toContain('planJson'); expect(JSON.stringify(retired)).not.toContain('reservation');
    expect(row.index).toEqual([]); expect(row.state?.head).not.toEqual(oldHead);
    await f.command('clear'); f.restart(); expect((await f.row()).retiredOperation).toEqual(retired);
    const sent = f.uploads.length; await f.archive.drain(); expect(f.uploads).toHaveLength(sent);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
  });

  it('allows owner-only control acknowledgement after disable, withdrawal and publication availability off without resending', async () => {
    const f = await fixture(); f.publicationEnabled = true; await checkpoint(f);
    f.afterUpload(async () => { await f.command('disable'); });
    await f.command('compact').catch(() => undefined); f.afterUpload();
    expect((await f.row()).retiredOperation).toBeDefined();
    await f.withdraw(); f.publicationEnabled = false; f.captureEnabled = false; f.restart();
    const before = await f.row(), sent = f.uploads.length;
    await f.command('retry-unknown'); expect((await f.row()).retiredOperation).toEqual(before.retiredOperation);
    await f.command('retry-unknown confirm-duplicate-copies', ID.bob).catch(() => undefined);
    expect((await f.row()).retiredOperation).toEqual(before.retiredOperation);
    await f.command('retry-unknown confirm-duplicate-copies');
    expect((await f.row()).retiredOperation).toBeUndefined(); expect(f.uploads).toHaveLength(sent);
    expect((await f.row()).enabled).toBe(false); expect((await f.row()).state).toBeUndefined();
    const acknowledged = await f.row(); await f.command('retry-unknown confirm-duplicate-copies');
    expect(await f.row()).toEqual(acknowledged); expect(f.uploads).toHaveLength(sent);
  });

  it('suppresses a published old source after an edit without clearing unrelated snapshot evidence', async () => {
    const f = await fixture(); f.publicationEnabled = true;
    await checkpoint(f, 10, 'QA_PUBLISHED_REMOVE'); await checkpoint(f, 11, 'QA_PUBLISHED_KEEP');
    await f.command('compact'); await f.edit(10); f.restart();
    await f.command('recover');
    const restored = await f.archive.archive(f.scope).recover(f.scope);
    expect(restored.events.map(event => event.text)).toEqual(['QA_PUBLISHED_KEEP']);
    const context = (await f.archive.context(ID.alice, f.agent.id, 'work')).text.join();
    expect(context).toContain('QA_PUBLISHED_KEEP'); expect(context).not.toContain('QA_PUBLISHED_REMOVE');
    expect(context).not.toContain('QA_EDIT_NOT_AUTOMATICALLY_SAVED');
    await expect(f.capture(10, 'QA_PUBLISHED_REMOVE', 400)).rejects.toBeDefined();
  });

  it('rejects a retired snapshot record transplanted into a different canonical account/person', async () => {
    const f = await fixture(); f.publicationEnabled = true; await checkpoint(f);
    f.afterUpload(async () => { await f.command('clear'); });
    await f.command('compact').catch(() => undefined); f.afterUpload();
    const foreign = await f.row(); expect(foreign.retiredOperation).toBeDefined();
    await expect(f.adaptive.withAccountDocument(ID.bob, doc => {
      doc.telegramArchives = [structuredClone(foreign)]; doc.revision++;
    })).rejects.toBeDefined();
    expect(await f.adaptive.withAccountView(ID.bob, doc => doc.telegramArchives?.some(row => !!row.retiredOperation) ?? false)).toBe(false);
  });

  it.each(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown'] as const)(
    'preserves legacy checkpoint %s effects across a full source reset', async stage => {
      const f = await fixture(); await f.capture(10, 'QA_PENDING_CHECKPOINT_SOURCE');
      await f.adaptive.withAccountDocument(ID.alice, doc => {
        const state = doc.telegramArchives![0].state!;
        state.operation = { id: 'qa-legacy-checkpoint', stage, sequence: 1, authorityRevision: 'qa-historical-authority',
          eventIds: [state.pending[0].eventId], createdAt: f.h.clock.now.getTime(),
          ...(stage === 'bundle_verified' ? { bundle: { fileId: 'qa-known-old-bundle', messageId: 17, digest: 'a'.repeat(64) } } : {}) };
        doc.revision++;
      });
      await f.command('clear'); f.restart(); const after = await f.row();
      expect(after.state).toBeUndefined(); expect(after.index).toEqual([]);
      if (stage === 'prepared') expect(after.retiredOperation).toBeUndefined();
      else {
        expect(after.retiredOperation).toMatchObject({ kind: 'checkpoint', id: 'qa-legacy-checkpoint', stage: 'unknown', scope: f.scope });
        expect(JSON.stringify(after.retiredOperation)).not.toContain('QA_PENDING_CHECKPOINT_SOURCE');
        if (stage === 'bundle_verified') expect(after.retiredOperation!.files).toEqual([{ fileId: 'qa-known-old-bundle', messageId: 17, digest: 'a'.repeat(64) }]);
        await f.command('clear'); expect((await f.row()).retiredOperation).toEqual(after.retiredOperation);
      }
    });
});
