/** Independent AM-QA-01 FILE integration and offline rollback acceptance.
 * QA-owned; no real provider, private content, or Telegram sends. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hire, ID, makeStudio, seedOrg, T0 } from './__tests__/helpers';
import { StudioTelegramArchive } from './telegram-archive';
import { handleAgentUpdate } from './updates';
import { pollLoop } from './bots';
import { AdaptiveService } from '../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor, digest } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage } from '../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../adaptive/relationships/service';
import { rollbackFileTelegramArchive, stripTelegramArchiveForRollback } from '../adaptive/telegram-archive-rollback';
import { resetTelegramArchives } from '../adaptive/telegram-archive-state';
import type { ArchiveTransport } from '../tireh/memory/telegram-archive/contracts';
import type { TelegramBotClient, TelegramMessage } from '../tireh/telegram/client';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility } from '../../../scripts/studio-adaptive-compatibility.mjs';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const privateMessage = (id: number, text: string, at: number, person = ID.alice): TelegramMessage => ({ message_id: id, date: Math.floor(at / 1000),
  from: { id: person, first_name: 'Synthetic QA', is_bot: false }, chat: { id: person, type: 'private' }, text });

async function integration() {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice); dirs.push(h.dir);
  vi.spyOn(h.studio, 'botToken').mockReturnValue('7001:qa-synthetic-token');
  const capabilities = ['core_text', 'personalization', 'auto_memory'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'qa-only', enabledCapabilities: capabilities,
    accounts: [ID.alice, ID.bob].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `qa-approval-${i}`, revision: 1, createdAt: T0.getTime(), updatedAt: T0.getTime(),
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'qa-only', effectiveAt: T0.getTime(), reviewExpiresAt: T0.getTime() + 86_400_000,
      owner: 'synthetic-only', approvalReference: 'synthetic-only' })) }));
  const reload = () => {
    const a = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(h.dir, 'adaptive'))), { ...options, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime() });
    h.studio.deps.adaptive = a; h.studio.deps.relationshipAuthority = new AdaptiveRelationshipService(a); return a;
  };
  const adaptive = reload();
  for (const person of [ID.alice, ID.bob]) {
    await adaptive.confirm(person, { confirm: true, adultConfirmed: true });
    for (const purpose of ['optional.personalization', 'optional.auto_memory'] as const) {
      const before = await adaptive.read(person, 'work');
      const shown = await adaptive.present(person, { space: 'work', purpose, locale: 'en', expectedRevision: before.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID() });
      await adaptive.changeConsent(person, { space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt });
    }
    const consented = await adaptive.read(person, 'work');
    await adaptive.setAgentAccess(person, agent.id, { space: 'work', allowed: true, expectedRevision: consented.revision, eventId: randomUUID() });
  }
  const files = new Map<string, Uint8Array>(), uploads: string[] = [];
  const transport: ArchiveTransport = {
    async upload(chatId, filename, bytes, authorizeNow) {
      if (!authorizeNow()) throw new Error('qa-export-denied');
      expect(chatId).toBe(ID.alice); const fileId = `qa-telegram-file-${uploads.length + 1}`;
      files.set(fileId, bytes.slice()); uploads.push(filename); return { fileId, messageId: uploads.length };
    },
    async download(fileId, maxBytes) { const bytes = files.get(fileId); if (!bytes || bytes.length > maxBytes) throw new Error('qa-unavailable'); return bytes.slice(); },
  };
  let enabled = true;
  const makeArchive = () => new StudioTelegramArchive(h.studio, () => enabled, () => transport);
  const archive = makeArchive(); h.studio.deps.telegramArchive = archive;
  const command = (text: string) => archive.command(agent.id, privateMessage(1, text, h.clock.now.getTime()));
  await command('/archive enable'); h.clock.now = new Date(T0.getTime() + 2000);
  const scope = await archive.scope(ID.alice, agent.id);
  return { h, agent, archive, scope, command, reload, makeArchive, uploads,
    disableGlobal: () => { enabled = false; },
    capture: (id: number, text: string, updateId = id) => archive.capture(agent.id, privateMessage(id, text, h.clock.now.getTime()), updateId),
    get adaptive() { return h.studio.deps.adaptive!; },
  };
}

describe('AM-QA-01 existing FILE archive integration', () => {
  it('persists accepted pending text through a fresh FILE repository and reconstructs provenance', async () => {
    const f = await integration(); await f.capture(10, 'QA_FILE_CANARY presentation on Friday.');
    f.reload(); const restarted = f.makeArchive();
    const recovered = await restarted.archive(f.scope).recover(f.scope);
    expect(recovered.status).toBe('captured'); expect(recovered.pending).toBe(1);
    expect(recovered.events).toMatchObject([{ text: 'QA_FILE_CANARY presentation on Friday.', sourceMessageId: 10 }]);
    expect((await restarted.context(ID.alice, f.agent.id, 'work')).text.join(' ')).toContain('QA_FILE_CANARY');
    expect(f.uploads).toHaveLength(0);
  });

  it('denies another person and Personal space the Work private archive', async () => {
    const f = await integration(); await f.capture(10, 'QA_PRIVATE_WORK_CANARY');
    expect((await f.archive.context(ID.bob, f.agent.id, 'work')).text).toEqual([]);
    expect((await f.archive.context(ID.alice, f.agent.id, 'personal')).text).toEqual([]);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text.join(' ')).toContain('QA_PRIVATE_WORK_CANARY');
  });

  it('whole-archive clear reports its scope and prevents old verified head or pending recovery after restart', async () => {
    const f = await integration(); await f.capture(10, 'QA_FORGET_OLD_HEAD');
    await f.archive.archive(f.scope).checkpoint(f.scope, { force: true }); await f.capture(11, 'QA_FORGET_PENDING');
    await f.command('/archive clear');
    const sent = f.h.botFor('7001:qa-synthetic-token');
    expect(JSON.stringify(sent.sendMessage.mock.calls)).toContain('complete automatic archive');
    expect(JSON.stringify(sent.sendMessage.mock.calls)).toContain('External Telegram copies may remain');
    f.reload(); const restarted = f.makeArchive();
    // A reset may require a new explicit enable; either state must be content-free.
    await f.command('/archive enable');
    expect((await restarted.archive(f.scope).recover(f.scope)).events).toEqual([]);
    expect((await restarted.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
  });

  it('clear permits new eligible source text without reviving the old archive', async () => {
    const f = await integration(); await f.capture(10, 'QA_BEFORE_CLEAR');
    f.h.clock.now = new Date(f.h.clock.now.getTime() + 2000); await f.command('/archive clear');
    f.h.clock.now = new Date(f.h.clock.now.getTime() + 2000); await f.capture(11, 'QA_AFTER_CLEAR');
    const context = (await f.archive.context(ID.alice, f.agent.id, 'work')).text.join(' ');
    expect(context).toContain('QA_AFTER_CLEAR'); expect(context).not.toContain('QA_BEFORE_CLEAR');
  });

  it('recovery cannot overwrite a new source committed after reconstruction', async () => {
    const f = await integration(); await f.capture(10, 'QA_OLD_RECOVERED_SOURCE');
    const actual = f.archive.archive.bind(f.archive);
    vi.spyOn(f.archive, 'archive').mockImplementation(s => {
      const archive = actual(s), recover = archive.recover.bind(archive);
      vi.spyOn(archive, 'recover').mockImplementation(async key => {
        const result = await recover(key); await f.capture(10, 'QA_NEW_COMMITTED_SOURCE', 1000); return result;
      });
      return archive;
    });
    await expect(f.command('/archive recover')).rejects.toMatchObject({ code: 'authority' });
    const context = (await f.archive.context(ID.alice, f.agent.id, 'work')).text.join(' ');
    expect(context).toContain('QA_NEW_COMMITTED_SOURCE'); expect(context).not.toContain('QA_OLD_RECOVERED_SOURCE');
  });

  it('an edit with capture globally off and no archive row leaves canonical bytes unchanged', async () => {
    const f = await integration();
    await f.adaptive.withAccountDocument(ID.alice, d => { delete d.telegramArchives; d.revision++; });
    f.disableGlobal(); const directory = join(f.h.dir, 'adaptive');
    const file = join(directory, createHash('sha256').update(accountIdFor(ID.alice)).digest('hex') + '.json');
    const before = readFileSync(file, 'utf8');
    await handleAgentUpdate(f.h.studio, f.agent.id, { update_id: 700, edited_message: privateMessage(10, 'QA_EDIT_WHILE_OFF', f.h.clock.now.getTime()) });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it.each(['EN', 'FA'])('supplies authorized %s source to the actual gateway and removes it before the next prompt after clear', async language => {
    const f = await integration(), text = language === 'EN' ? 'QA_EN_PRESENTATION Friday' : 'QA_FA_PRESENTATION ارائه روز جمعه';
    await f.capture(10, text); const { gateway } = await f.h.studio.gateway();
    await gateway.converse(f.agent.id, `tg-${ID.alice}`, language === 'EN' ? 'Continue that discussion' : 'بحث قبلی را ادامه بده');
    expect(JSON.stringify(f.h.chatLLM.replyRequests.at(-1)?.messages)).toContain(text);
    await f.command('/archive clear');
    await gateway.converse(f.agent.id, `tg-${ID.alice}`, language === 'EN' ? 'Which presentation?' : 'کدام ارائه؟');
    expect(JSON.stringify(f.h.chatLLM.replyRequests.at(-1)?.messages)).not.toContain(text);
  });

  it('an ordinary gateway forget request suppresses archive context, not merely a promised reply', async () => {
    const f = await integration(); await f.capture(10, 'QA_GATEWAY_FORGET_CANARY');
    const { gateway } = await f.h.studio.gateway();
    const reply = await gateway.converse(f.agent.id, `tg-${ID.alice}`, 'forget everything I told you');
    expect(reply).toContain('cleared');
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
    f.reload(); expect((await f.makeArchive().archive(f.scope).recover(f.scope)).events).toEqual([]);
  });

  it.each(["Don't remember this QA_NO_SAVE", 'ذخیره نکن QA_NO_SAVE_FA'])('keeps explicit no-save input out of pending events and context: %s', async text => {
    const f = await integration(); await f.capture(10, text);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
    expect((await f.archive.archive(f.scope).recover(f.scope)).events).toEqual([]);
  });

  it('terminal capacity refusal leaves clear and another person reachable in the same polling batch', async () => {
    const f = await integration(); await f.capture(10, 'QA_ACCEPTED_BEFORE_CAPACITY');
    await f.adaptive.withAccountDocument(ID.alice, d => {
      d.telegramArchives![0].state!.head = { fileId: 'qa-capacity-head', messageId: 1, digest: 'a'.repeat(64), sequence: 128 }; d.revision++;
    });
    const at = f.h.clock.now.getTime(), updates = [
      { update_id: 701, message: privateMessage(11, 'QA_REFUSED_NOT_SAVED', at) },
      { update_id: 702, message: privateMessage(12, '/archive clear', at) },
      { update_id: 703, message: privateMessage(13, '/archive status', at, ID.bob) },
    ];
    let polled = 0, observedOffset: number | undefined;
    let finished!: () => void; const done = new Promise<void>(resolve => { finished = resolve; });
    const bot = { deleteWebhook: async () => true, getUpdates: async (offset?: number) => {
      if (!polled++) return updates;
      observedOffset = offset; loop.stop(); finished(); return [];
    } } as unknown as TelegramBotClient;
    const loop = pollLoop(bot, ['message'], update => handleAgentUpdate(f.h.studio, f.agent.id, update), { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    try { await done; } finally { loop.stop(); }
    expect(observedOffset).toBe(704);
    const calls = f.h.botFor('7001:qa-synthetic-token').sendMessage.mock.calls;
    expect(calls.some(([recipient, text]) => recipient === ID.alice && text.includes('not saved or processed'))).toBe(true);
    expect(calls.some(([recipient, text]) => recipient === ID.alice && text.includes('complete automatic archive'))).toBe(true);
    expect(calls.some(([recipient, text]) => recipient === ID.bob && text.includes('disabled'))).toBe(true);
    const current = await f.adaptive.withAccountView(ID.alice, d => d);
    expect(JSON.stringify(current)).not.toContain('QA_REFUSED_NOT_SAVED');
    expect(f.h.chatLLM.replyRequests).toEqual([]);
  });

  it('a confirmation send with unknown outcome is not retried with a false no-processing claim', async () => {
    const f = await integration(); await f.capture(10, 'QA_COMMAND_COMMITTED');
    const bot = f.h.botFor('7001:qa-synthetic-token');
    bot.sendMessage.mockClear(); bot.sendMessage.mockRejectedValueOnce(new Error('qa-send-response-lost'));
    await handleAgentUpdate(f.h.studio, f.agent.id, { update_id: 801, message: privateMessage(20, '/archive clear', f.h.clock.now.getTime()) });
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(bot.sendMessage.mock.calls)).not.toContain('not saved or processed');
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
  });

  it('background checkpoint failure cannot relabel a durable accepted source as refused', async () => {
    const f = await integration(), actual = f.archive.archive.bind(f.archive);
    vi.spyOn(f.archive, 'archive').mockImplementation(s => {
      const archive = actual(s); vi.spyOn(archive, 'checkpoint').mockRejectedValue(new Error('qa-background-checkpoint-failure')); return archive;
    });
    await expect(f.capture(10, 'QA_CAPTURE_ALREADY_DURABLE')).resolves.toBeUndefined();
    expect((await actual(f.scope).recover(f.scope)).events.map(e => e.text)).toEqual(['QA_CAPTURE_ALREADY_DURABLE']);
  });

  it('keeps clear/disable controls usable after auto-memory withdrawal and global kill', async () => {
    const f = await integration(); await f.capture(10, 'QA_WITHDRAW_CANARY');
    const before = await f.adaptive.read(ID.alice, 'work');
    await f.adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.auto_memory', state: 'withdrawn',
      expectedRevision: before.purposes.find(p => p.purpose === 'optional.auto_memory')!.revision, eventId: randomUUID() });
    f.disableGlobal(); expect(await f.command('/archive clear')).toBe(true); expect(await f.command('/archive disable')).toBe(true);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
    await f.capture(11, 'QA_AFTER_KILL');
    const stored = await f.adaptive.withAccountView(ID.alice, d => d.telegramArchives);
    expect(JSON.stringify(stored)).not.toContain('QA_WITHDRAW_CANARY'); expect(JSON.stringify(stored)).not.toContain('QA_AFTER_KILL');
  });

  it('newer source revision expiry does not expose an older longer-lived revision in the index', async () => {
    const f = await integration(); await f.capture(10, 'QA_OLD_DATE');
    await f.adaptive.withAccountDocument(ID.alice, d => {
      const row = d.telegramArchives![0], old = row.index[0];
      row.index.push({ ...old, eventId: 'qa-revision-2', revision: old.revision + 1, text: 'QA_NEW_DATE', expiresAt: f.h.clock.now.getTime() + 1000 }); d.revision++;
    });
    f.h.clock.now = new Date(f.h.clock.now.getTime() + 1000);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
  });

  it('source deletion reset advances monotonic generation and preserves unrelated current authority', async () => {
    const f = await integration(); await f.capture(10, 'QA_RESET_CANARY');
    const before = await f.adaptive.withAccountView(ID.alice, d => d);
    await f.adaptive.withAccountDocument(ID.alice, (d, now) => { resetTelegramArchives(d, now, 'work', f.agent.id); d.revision++; });
    const after = await f.adaptive.withAccountView(ID.alice, d => d);
    expect(after.telegramArchives![0].generation).toBeGreaterThan(before.telegramArchives![0].generation);
    expect(after.telegramArchives![0].state).toBeUndefined(); expect(after.telegramArchives![0].index).toEqual([]);
    expect(after.permissions).toEqual(before.permissions); expect(after.agentGrants).toEqual(before.agentGrants);
    expect((await f.archive.context(ID.alice, f.agent.id, 'work')).text).toEqual([]);
  });
});

describe('AM-QA-01 offline downgrade and admission', () => {
  const emptyRow = () => ({ agentId: 'qa-agent', space: 'work', enabled: false, generation: 4, clearedAt: 200, authorityStamp: 'a'.repeat(64), index: [] });
  const doc = () => ({ schemaVersion: 1, accountId: 'telegram-account:101', personId: `account-profile:${digest('telegram-account:101').slice(0, 32)}`,
    revision: 99, createdAt: 100, updatedAt: 200, permissions: [{ state: 'withdrawn', revision: 8 }], agentGrants: [{ allowed: false, revision: 9 }],
    tombstones: [{ eventId: 'qa-deleted', revocationEpoch: 12 }], telegramArchives: [emptyRow()] });

  it('drops only archive state and keeps the newest grants, tombstones and source object immutable', () => {
    const before = doc(), stripped = stripTelegramArchiveForRollback(before, before.accountId);
    const expected = structuredClone(before); Reflect.deleteProperty(expected, 'telegramArchives');
    expect(stripped.document).toEqual(expected); expect(before.telegramArchives).toHaveLength(1);
    expect(() => stripTelegramArchiveForRollback(before, 'telegram-account:999')).toThrow('scope_mismatch');
  });

  it('refuses uncertain operations even when there are zero pending source events', () => {
    const before = doc(); const state = { schemaVersion: 1, scope: { ...scopeForRollback }, botId: 7001, revision: 2, pending: [], receipts: [],
      operation: { id: 'qa-unknown-operation', sequence: 1, authorityRevision: 'qa-authority', eventIds: ['qa-event'], stage: 'unknown', createdAt: 100 } };
    expect(() => stripTelegramArchiveForRollback({ ...before, telegramArchives: [{ ...emptyRow(), state }] }, before.accountId)).toThrow('pending_work');
  });

  it('uses dry run and digest CAS while preserving current canonical authority on apply', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-qa-rollback-')); dirs.push(directory);
    const before = doc(), file = join(directory, createHash('sha256').update(before.accountId).digest('hex') + '.json');
    writeFileSync(file, JSON.stringify(before)); const originalBytes = readFileSync(file, 'utf8');
    const first = await rollbackFileTelegramArchive({ directory, accountId: before.accountId });
    expect(first.mode).toBe('dry-run'); expect(readFileSync(file, 'utf8')).toBe(originalBytes);
    await expect(rollbackFileTelegramArchive({ directory, accountId: before.accountId, apply: true, expectedContentSha256: first.contentSha256 })).rejects.toThrow('stop_producers');
    before.revision++; before.tombstones[0].revocationEpoch++; writeFileSync(file, JSON.stringify(before));
    await expect(rollbackFileTelegramArchive({ directory, accountId: before.accountId, apply: true, producersStopped: true, expectedContentSha256: first.contentSha256 })).rejects.toThrow('document_changed');
    const fresh = await rollbackFileTelegramArchive({ directory, accountId: before.accountId });
    await rollbackFileTelegramArchive({ directory, accountId: before.accountId, apply: true, producersStopped: true, expectedContentSha256: fresh.contentSha256 });
    const expected = structuredClone(before); Reflect.deleteProperty(expected, 'telegramArchives');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected);
  });

  it.each([{ rows: [] }, { rows: [emptyRow()] }, { rows: [{ ...emptyRow(), enabled: true }] }])('requires archive-aware release admission for extension $rows', ({ rows }) => {
    const root = mkdtempSync(join(tmpdir(), 'vox-qa-admission-')); dirs.push(root);
    const directory = join(root, 'adaptive'), storage = new FileAdaptiveStorage(directory), before = doc();
    // Admission scanner intentionally reads only structural source metadata.
    const { permissions: _permissions, agentGrants: _grants, tombstones: _tombstones, ...canonical } = before;
    void _permissions; void _grants; void _tombstones;
    return storage.transact(before.accountId, () => ({ document: { ...canonical, telegramArchives: rows }, result: undefined })).then(() => {
      const { supportedTelegramArchiveSchemas: _supported, ...old } = ADAPTIVE_RELEASE_CAPABILITIES; void _supported;
      const env = { STUDIO_DATA_DIR: root, STUDIO_ADAPTIVE_FORMAT: 'file' };
      expect(() => assertReleaseAdaptiveCompatibility(env, old)).toThrow('incompatible');
      expect(assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES)).toMatchObject({ telegramArchiveSchema: 1 });
    });
  });
});

const scopeForRollback = { accountId: 'telegram-account:101', personId: 'qa-person', agentId: 'qa-agent', space: 'work', containerId: 'qa-container' };
