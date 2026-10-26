/** Independent AM-05/AM-12 acceptance. Synthetic FILE and mocked Telegram only.
 * Owned by the privacy/security evaluator; implementation authors do not edit. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hire, ID, makeStudio, seedOrg } from './__tests__/helpers';
import { StudioTelegramArchive } from './telegram-archive';
import { pollLoop } from './bots';
import { handleAgentUpdate } from './updates';
import { AdaptiveRepository, accountIdFor, digest } from '../adaptive/persistence/repository';
import { AdaptiveService } from '../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import { telegramArchiveEntrySchema } from '../adaptive/telegram-archive-state';
import { MAX_ARCHIVE_STATE_BYTES } from '../tireh/memory/telegram-archive/service';
import type { ArchiveTransport } from '../tireh/memory/telegram-archive/contracts';
import type { TelegramBotClient, TelegramMessage, TelegramUpdate } from '../tireh/telegram/client';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility } from '../../../scripts/studio-adaptive-compatibility.mjs';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
async function fixture() {
  const h = makeStudio(); dirs.push(h.dir);
  const users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const start = h.clock.now.getTime(), capabilities = ['core_text', 'auto_memory', 'personalization'];
  const policy = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'lineage-qa-only', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `lineage-qa-${i}`, revision: 1, createdAt: start, updatedAt: start,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'lineage-qa-only', effectiveAt: start, reviewExpiresAt: start + 86400_000,
      owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const data = join(h.dir, 'lineage-data'), directory = join(data, 'adaptive');
  const reopen = () => { const a = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), { ...policy, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime() });
    h.studio.deps.adaptive = a; h.studio.deps.relationshipAuthority = new AdaptiveRelationshipService(a); return a; };
  let adaptive = reopen();
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  for (const purpose of ['optional.auto_memory', 'optional.personalization'] as const) {
    const initial = await adaptive.read(ID.alice, 'work');
    const shown = await adaptive.present(ID.alice, { space: 'work', purpose, locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID() });
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, receipt: shown.receipt, eventId: randomUUID() });
  }
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: (await adaptive.read(ID.alice, 'work')).revision, eventId: randomUUID() });
  const files = new Map<string, Uint8Array>(); let sequence = 0, enabled = true;
  const transport: ArchiveTransport = { upload: vi.fn(async (_chat, _filename, content, authorizeNow) => {
    if (!authorizeNow()) throw Error('synthetic denied'); const fileId = `lineage-file-${++sequence}`; files.set(fileId, content.slice()); return { fileId, messageId: sequence };
  }), download: vi.fn(async id => { const file = files.get(id); if (!file) throw Error('synthetic missing'); return file.slice(); }) };
  const runtime = () => new StudioTelegramArchive(h.studio, () => enabled, () => transport);
  let archive = runtime(); h.studio.deps.telegramArchive = archive;
  const message = (id: number, text = 'QA_EDIT_REPLACEMENT', person = ID.alice): TelegramMessage => ({ message_id: id, date: Math.floor(h.clock.now.getTime() / 1000),
    from: { id: person, is_bot: false, first_name: 'Synthetic QA' }, chat: { id: person, type: 'private' }, text });
  const command = (text: string) => archive.command(agent.id, message(999, `/archive ${text}`));
  await command('enable'); h.clock.now = new Date(start + 2000);
  const scope = await archive.scope(ID.alice, agent.id);
  return { h, agent, data, directory, scope, transport, files, message, command,
    get adaptive() { return adaptive; }, get archive() { return archive; },
    capture: (id: number, text: string, update = id) => archive.capture(agent.id, message(id, text), update),
    edit: (id: number) => archive.invalidateEditedMessage(agent.id, message(id)),
    row: () => adaptive.withAccountView(ID.alice, d => structuredClone(d.telegramArchives![0])),
    off: () => { enabled = false; }, on: () => { enabled = true; },
    restart: () => { adaptive = reopen(); archive = runtime(); h.studio.deps.telegramArchive = archive; } };
}

describe('AM-05 / AM-12 independent source-lineage acceptance', () => {
  it('keeps a failed edit write unacknowledged, restarts, then retries suppression before processing the next reply', async () => {
    const f = await fixture(); await f.capture(10, 'QA_TRANSIENT_EDIT_SECRET'); await f.capture(11, 'QA_TRANSIENT_EDIT_KEEP');
    let failedWrite!: () => void, acknowledged!: (offset: number | undefined) => void;
    const failed = new Promise<void>(resolve => { failedWrite = resolve; });
    const settled = new Promise<number | undefined>(resolve => { acknowledged = resolve; });
    vi.spyOn(f.adaptive, 'withAccountDocument').mockImplementationOnce(async () => { failedWrite(); throw new Error('QA_TRANSIENT_CANONICAL_WRITE'); });
    const batch: TelegramUpdate[] = [{ update_id: 50, edited_message: f.message(10) }, { update_id: 51, message: f.message(12, 'Continue my prior project') }];
    const later = vi.fn();
    const getUpdates = vi.fn().mockResolvedValueOnce(batch).mockImplementationOnce(async (offset: number | undefined) => {
      expect(offset).toBeUndefined(); return batch;
    }).mockImplementation(async (offset: number | undefined) => { acknowledged(offset); return new Promise<TelegramUpdate[]>(() => {}); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const loop = pollLoop({ getUpdates, deleteWebhook: async () => true } as unknown as TelegramBotClient, ['message', 'edited_message'], async update => {
      await handleAgentUpdate(f.h.studio, f.agent.id, update); if (update.update_id === 51) later();
    }, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    try {
      await failed; await vi.advanceTimersByTimeAsync(0);
      expect(getUpdates).toHaveBeenCalledTimes(1); expect(later).not.toHaveBeenCalled();
      const before = await f.row(); expect(before.state!.receipts.find(r => r.logicalId === 'telegram:10')?.suppressed).toBeUndefined();
      f.restart(); await vi.advanceTimersByTimeAsync(3000);
      expect(await settled).toBe(52); expect(later).toHaveBeenCalledOnce();
      const after = await f.row(); expect(after.state!.receipts.find(r => r.logicalId === 'telegram:10')?.suppressed).toBe(true);
      expect(after.state!.pending.map(e => e.text)).not.toContain('QA_TRANSIENT_EDIT_SECRET'); expect(after.state!.pending.map(e => e.text)).toContain('QA_TRANSIENT_EDIT_KEEP');
      const prompt = JSON.stringify(f.h.chatLLM.replyRequests.at(-1)); expect(prompt).not.toContain('QA_TRANSIENT_EDIT_SECRET'); expect(prompt).toContain('QA_TRANSIENT_EDIT_KEEP');
      expect(f.transport.upload).not.toHaveBeenCalled();
    } finally { loop.stop(); vi.useRealTimers(); }
  });

  it.each(['QA_EN_PRIVATE_CANARY', 'QA_FA_PRIVATE_CANARY پروژه جمعه'])('suppresses %s across verified head, pending, restart, recovery and prompt use', async secret => {
    const f = await fixture(); await f.capture(10, secret); await f.capture(11, 'QA_KEEP_VERIFIED');
    await f.archive.archive(f.scope).checkpoint(f.scope, { force: true }); await f.capture(12, 'QA_KEEP_PENDING');
    const before = await f.row(), authority = await f.archive.context(ID.alice, f.agent.id, 'work', true);
    await f.edit(10); const after = await f.row();
    expect(after.state!.head).toEqual(before.state!.head); expect(after.clearedAt).toBe(before.clearedAt);
    expect(after.state!.receipts).toHaveLength(3); expect(after.state!.receipts.find(r => r.logicalId === 'telegram:10')?.suppressed).toBe(true);
    expect(after.sourceSuppressionVersion).toBe(1); expect(after.state!.pending.map(e => e.text)).toEqual(['QA_KEEP_PENDING']);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work', true)).revision).not.toBe(authority.revision);
    await f.edit(10); expect(await f.row()).toEqual(after);
    f.restart(); await f.command('recover');
    expect((await f.archive.archive(f.scope).recover(f.scope)).events.map(e => e.text)).toEqual(['QA_KEEP_VERIFIED', 'QA_KEEP_PENDING']);
    await expect(f.capture(10, secret, 10)).rejects.toThrow('admission unavailable');
    await expect(f.capture(10, secret, 400)).rejects.toThrow('admission unavailable');
    const { gateway } = await f.h.studio.gateway(); await gateway.converse(f.agent.id, `tg-${ID.alice}`, 'Continue the prior project');
    const prompt = JSON.stringify(f.h.chatLLM.replyRequests.at(-1));
    expect(prompt).not.toContain(secret); expect(prompt).not.toContain('QA_EDIT_REPLACEMENT'); expect(prompt).toContain('QA_KEEP_VERIFIED');
    await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
    expect((await f.archive.archive(f.scope).recover(f.scope)).events.map(e => e.text)).toEqual(['QA_KEEP_VERIFIED', 'QA_KEEP_PENDING']);
  });

  it.each(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown'] as const)('preserves external-effect uncertainty for operation stage %s', async stage => {
    const f = await fixture(); await f.capture(10, 'QA_REMOVE'); await f.capture(11, 'QA_KEEP');
    await f.adaptive.withAccountDocument(ID.alice, d => { const row = d.telegramArchives![0]; row.state!.operation = {
      id: 'qa-operation', sequence: 1, authorityRevision: digest([row.authorityStamp, row.generation, row.clearedAt, row.enabled]),
      eventIds: ['update:10', 'update:11'], stage, createdAt: f.h.clock.now.getTime(),
      ...(stage === 'bundle_verified' ? { bundle: { fileId: 'qa-verified-bundle', messageId: 1, digest: 'a'.repeat(64) } } : {}) }; d.revision++; });
    await f.edit(10); f.restart();
    expect((await f.row()).state!.pending.map(e => e.text)).toEqual(['QA_KEEP']);
    if (stage === 'prepared') { expect((await f.row()).state!.operation).toBeUndefined(); return; }
    expect((await f.row()).state!.operation?.stage).toBe('unknown');
    expect(await f.archive.archive(f.scope).checkpoint(f.scope, { force: true })).toEqual({ status: 'unknown' });
    await f.command('retry-unknown'); expect((await f.row()).state!.operation?.stage).toBe('unknown'); expect(f.transport.upload).not.toHaveBeenCalled();
    await f.command('retry-unknown confirm-duplicate-copies'); await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
    expect((await f.archive.archive(f.scope).recover(f.scope)).events.map(e => e.text)).toEqual(['QA_KEEP']);
  });

  it('fences a real in-process upload that finishes after an edit and never retries automatically', async () => {
    const f = await fixture(); await f.capture(10, 'QA_RACE_REMOVE'); await f.capture(11, 'QA_RACE_KEEP');
    const upload = vi.mocked(f.transport.upload).getMockImplementation()!;
    vi.mocked(f.transport.upload).mockImplementationOnce(async (...args) => { const result = await upload(...args); await f.edit(10); return result; });
    await expect(f.archive.archive(f.scope).checkpoint(f.scope, { force: true })).rejects.toMatchObject({ code: 'authority' });
    f.restart(); expect(await f.archive.archive(f.scope).checkpoint(f.scope, { force: true })).toEqual({ status: 'unknown' });
    expect(f.transport.upload).toHaveBeenCalledTimes(1); expect((await f.row()).state!.pending.map(e => e.text)).toEqual(['QA_RACE_KEEP']);
  });

  it('does not commit recovery assembled before a concurrent edit', async () => {
    const f = await fixture(); await f.capture(10, 'QA_LATE_RECOVERY'); await f.capture(11, 'QA_KEEP');
    await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
    const original = vi.mocked(f.transport.download).getMockImplementation()!;
    vi.mocked(f.transport.download).mockImplementationOnce(async (...args) => { const value = await original(...args); await f.edit(10); return value; });
    await expect(f.command('recover')).rejects.toMatchObject({ code: 'authority' });
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text.join()).not.toContain('QA_LATE_RECOVERY');
  });

  it('keeps agent/person/space partitions and suppresses existing state with capture disabled', async () => {
    const f = await fixture(); await f.capture(10, 'QA_SCOPED_REMOVE'); await f.capture(11, 'QA_SCOPED_KEEP');
    await f.adaptive.withAccountDocument(ID.alice, d => { const row = d.telegramArchives![0]; d.telegramArchives!.push(
      { agentId: 'qa-other-agent', space: 'work', enabled: false, generation: 0, clearedAt: 0, index: [] },
      { agentId: row.agentId, space: 'personal', enabled: false, generation: 0, clearedAt: 0, index: [] }); d.revision++; });
    const otherRows = await f.adaptive.withAccountView(ID.alice, d => structuredClone(d.telegramArchives!.slice(1)));
    await f.archive.invalidateEditedMessage(f.agent.id, f.message(10, 'QA_BOB_EDIT', ID.bob));
    expect((await f.row()).state!.receipts.some(r => r.suppressed)).toBe(false);
    f.off(); await f.edit(10); expect((await f.row()).state!.receipts[0].suppressed).toBe(true); f.on();
    expect((await f.archive.context(ID.alice, f.agent.id, 'personal')).text).toEqual([]);
    expect((await f.archive.context(ID.bob, f.agent.id, 'work')).text).toEqual([]);
    expect(await f.adaptive.withAccountView(ID.alice, d => d.telegramArchives!.slice(1))).toEqual(otherRows);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text.join()).toContain('QA_SCOPED_KEEP');
  });

  it.each(['withdrawal', 'expiry'] as const)('current %s still blocks suppressed and unrelated sources', async mode => {
    const f = await fixture(); await f.capture(10, 'QA_REMOVE'); await f.capture(11, 'QA_PERMISSION_KEEP'); await f.edit(10);
    if (mode === 'withdrawal') { const status = await f.adaptive.read(ID.alice, 'work');
      await f.adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.auto_memory', state: 'withdrawn',
        expectedRevision: status.purposes.find(p => p.purpose === 'optional.auto_memory')!.revision, eventId: randomUUID() });
    } else f.h.clock.now = new Date(f.h.clock.now.getTime() + 86400_001);
    f.restart(); expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
    await expect(f.archive.archive(f.scope).recover(f.scope)).rejects.toMatchObject({ code: 'authority' });
  });

  it.each(['unknown-edit', 'clear'] as const)('retains the full-scope barrier for %s and old-event replay', async mode => {
    const f = await fixture(); await f.capture(10, 'QA_BARRIER_OLD'); await f.capture(11, 'QA_BARRIER_OTHER');
    const old = f.message(10, 'QA_BARRIER_OLD'); await f.edit(10);
    if (mode === 'clear') await f.command('clear'); else await f.edit(9999);
    const row = await f.row(); expect(row.state).toBeUndefined(); expect(row.sourceSuppressionVersion).toBeUndefined(); expect(row.index).toEqual([]);
    f.restart(); await f.archive.capture(f.agent.id, old, 10);
    expect((await f.archive.archive(f.scope).recover(f.scope)).events).toEqual([]);
  });

  it.each(['missing-version', 'future-version', 'false-suppression'] as const)('rejects inconsistent canonical suppression metadata: %s', async variant => {
    const f = await fixture(); await f.capture(10, 'QA_MARKER_REMOVE'); await f.edit(10);
    const file = join(f.directory, `${createHash('sha256').update(accountIdFor(ID.alice)).digest('hex')}.json`), raw = JSON.parse(readFileSync(file, 'utf8'));
    const row = raw.telegramArchives[0];
    if (variant === 'missing-version') delete row.sourceSuppressionVersion;
    else if (variant === 'future-version') row.sourceSuppressionVersion = 2;
    else row.state.receipts[0].suppressed = false;
    expect(() => telegramArchiveEntrySchema.parse(row)).toThrow(); writeFileSync(file, JSON.stringify(raw));
    expect(() => assertReleaseAdaptiveCompatibility({ STUDIO_DATA_DIR: f.data, STUDIO_ADAPTIVE_FORMAT: 'file' }, ADAPTIVE_RELEASE_CAPABILITIES)).toThrow('incompatible');
    f.restart(); await expect(f.archive.context(ID.alice, f.agent.id, 'work')).rejects.toThrow();
  });

  it('rejects pre-suppression release capabilities even while capture is off', async () => {
    const f = await fixture(); await f.capture(10, 'QA_DOWNGRADE'); await f.edit(10); f.off();
    const { supportedTelegramArchiveSourceSuppressionVersions: supported, ...old } = ADAPTIVE_RELEASE_CAPABILITIES;
    expect(supported).toEqual([1]);
    const env = { STUDIO_DATA_DIR: f.data, STUDIO_ADAPTIVE_FORMAT: 'file' };
    expect(() => assertReleaseAdaptiveCompatibility(env, old)).toThrow('incompatible');
    expect(assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES)).toMatchObject({ telegramArchiveSourceSuppressionVersion: 1 });
  });

  it.each(['none', 'bundle_sending'] as const)('falls back to a bounded full reset at the legacy state limit with operation %s', async operation => {
    const f = await fixture(); await f.capture(10, 'QA_CAPACITY_REMOVE');
    await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
    if (operation !== 'none') await f.capture(11, 'QA_CAPACITY_PENDING');
    await f.adaptive.withAccountDocument(ID.alice, d => { const row = d.telegramArchives![0], state = row.state!; row.index = [];
      if (operation !== 'none') state.operation = { id: 'qa-capacity-operation', sequence: 2,
        authorityRevision: digest([row.authorityStamp, row.generation, row.clearedAt, row.enabled]), eventIds: ['update:11'], stage: operation, createdAt: f.h.clock.now.getTime() };
      while (state.receipts.length < 1024) { const n = state.receipts.length; state.receipts.push({ eventId: `qa-padding-${n}`, logicalId: `qa-source-${n}`, sourceRevision: 1, fingerprint: 'b'.repeat(64) }); }
      for (const receipt of state.receipts) { const extra = Math.min(200 - receipt.eventId.length, MAX_ARCHIVE_STATE_BYTES - 5 - bytes(state)); if (extra > 0) receipt.eventId += 'x'.repeat(extra); }
      expect(bytes(state)).toBe(MAX_ARCHIVE_STATE_BYTES - 5); telegramArchiveEntrySchema.parse(row); d.revision++;
    });
    const before = await f.row(); expect(bytes(before.state)).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
    await f.edit(10); const after = await f.row(); expect(after.index).toEqual([]);
    expect(after.state).toBeUndefined();
    if (operation === 'none') expect(after.retiredOperation).toBeUndefined();
    else {
      expect(after.retiredOperation).toEqual({ kind: 'checkpoint', id: 'qa-capacity-operation', stage: 'unknown',
        scope: f.scope, botId: before.state!.botId, createdAt: f.h.clock.now.getTime(), files: [] });
      expect(after.snapshotPublicationVersion).toBe(1);
      expect(JSON.stringify(after)).not.toContain('QA_CAPACITY_REMOVE');
      expect(JSON.stringify(after)).not.toContain('QA_CAPACITY_PENDING');
    }
    expect(after.clearedAt).toBeGreaterThan(before.clearedAt); expect(bytes([after])).toBeLessThanOrEqual(256 * 1024);
    f.restart(); expect((await f.archive.archive(f.scope).recover(f.scope)).events).toEqual([]);
    if (operation !== 'none') {
      expect((await f.archive.archive(f.scope).checkpoint(f.scope, { force: true })).status).not.toBe('recoverable');
      expect(f.transport.upload).toHaveBeenCalledTimes(2);
      expect((await f.row()).retiredOperation).toEqual(after.retiredOperation);
      await f.command('status');
      const token = f.h.studio.botToken(f.agent); expect(token).toBeTruthy();
      const notices = f.h.botFor(token!).sendMessage.mock.calls;
      expect(notices.some(([, text]) => text.includes('uncertain') || text.includes('may exist in Telegram'))).toBe(true);
    }
  });

  it.each(['archives', 'canonical'] as const)('commits a conservative deletion barrier at the aggregate %s capacity limit', async boundary => {
    const f = await fixture(); await f.capture(10, 'QA_AGGREGATE_REMOVE'); await f.archive.archive(f.scope).checkpoint(f.scope, { force: true });
    await f.adaptive.withAccountDocument(ID.alice, d => { const row = d.telegramArchives![0]; row.index = [];
      if (boundary === 'canonical') { d.consentEvents.push(''); const available = 700_000 - 5 - bytes(d); d.consentEvents[d.consentEvents.length - 1] = 'x'.repeat(available); expect(bytes(d)).toBe(699995); }
      else {
        const template = { eventId: 'qa-padding', logicalId: 'qa-padding', revision: 1, occurredAt: f.h.clock.now.getTime(), receivedAt: f.h.clock.now.getTime(), expiresAt: f.h.clock.now.getTime() + 86400_000, role: 'user' as const, text: 'x' };
        for (let n = 0; n < 3; n++) d.telegramArchives!.push({ agentId: `qa-aggregate-agent-${n}`, space: 'work', enabled: false, generation: 0, clearedAt: 0,
          index: Array.from({ length: 32 }, (_, i) => ({ ...template, eventId: `qa-event-${n}-${i}`, logicalId: `qa-source-${n}-${i}` })) });
        for (const filler of d.telegramArchives!.slice(1).flatMap(r => r.index)) { const available = Math.min(4096 - filler.text.length, 256 * 1024 - 5 - bytes(d.telegramArchives)); if (available > 0) filler.text += 'x'.repeat(available); }
        expect(bytes(d.telegramArchives)).toBe(256 * 1024 - 5);
      }
      d.revision++;
    });
    await f.edit(10); const row = await f.row(); expect(row.state).toBeUndefined(); expect(row.index).toEqual([]);
    const stored = await f.adaptive.withAccountView(ID.alice, d => d); expect(bytes(stored)).toBeLessThanOrEqual(700_000); expect(bytes(stored.telegramArchives)).toBeLessThanOrEqual(256 * 1024);
    f.restart(); expect((await f.archive.archive(f.scope).recover(f.scope)).events).toEqual([]);
  });

  it.each(['prepared', 'bundle_verified'] as const)('keeps a pre-upgrade %s operation usable before any suppression', async stage => {
    const f = await fixture(); await f.capture(10, 'QA_LEGACY_PENDING');
    let bundle: { fileId: string; messageId: number; digest: string } | undefined;
    if (stage === 'bundle_verified') {
      const event = (await f.row()).state!.pending[0], content = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind: 'events', scope: f.scope, botId: f.agent.bot!.id, sequence: 1, operationId: 'qa-legacy', events: [event] }));
      f.files.set('qa-legacy-bundle', content); const { archiveDigest } = await import('../tireh/memory/telegram-archive/contracts'); bundle = { fileId: 'qa-legacy-bundle', messageId: 1, digest: archiveDigest(content) };
    }
    await f.adaptive.withAccountDocument(ID.alice, d => { const row = d.telegramArchives![0]; row.state!.operation = { id: 'qa-legacy', sequence: 1,
      authorityRevision: digest([row.authorityStamp, row.generation, row.clearedAt, row.enabled]), eventIds: ['update:10'], stage, createdAt: f.h.clock.now.getTime(), ...(bundle ? { bundle } : {}) }; d.revision++; });
    f.restart(); expect(await f.archive.archive(f.scope).checkpoint(f.scope, { force: true })).toMatchObject({ status: 'recoverable', sequence: 1 });
    expect((await f.archive.archive(f.scope).recover(f.scope)).events.map(e => e.text)).toEqual(['QA_LEGACY_PENDING']);
  });
});
