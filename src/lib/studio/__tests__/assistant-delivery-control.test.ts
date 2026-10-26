/** Independent QA-owned ARC1 actual FILE fixtures. All inputs and identities are
 * synthetic. This file contains no real provider destination, token or request. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor, type AdaptiveDocument } from '../../adaptive/persistence/repository';
import { FileAdaptiveStorage, MemoryAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveLifecycleService } from '../../adaptive/lifecycle/service';
import { assistantCapacityProjection, ASSISTANT_CONTROL_IDLE_MS, ASSISTANT_CONTROL_TTL_MS } from '../../adaptive/assistant-delivery-control';
import { AssistantDeliveryControlAdapter, type AssistantDeliveryBinding, type AssistantDeliveryIngress } from '../assistant-delivery-control';
import type { DeliveryState, PreparedAssistantText, ResponseProjection, TransportEvidence } from '../../tireh/delivery/assistant-text-protocol';

const OWNER = 70300, OTHER = 70400, BOT = 77001, NOW = Date.parse('2026-10-26T12:00:00Z');
const PRIVATE_GENERATED = 'QA_ARC1_GENERATED_PRIVATE_رمز', PRIVATE_WIRE = 'QA_ARC1_SUBMITTED_PRIVATE_秘密';
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uuid = () => randomUUID();
const accountPath = (directory: string, owner = OWNER) => join(directory, `${createHash('sha256').update(accountIdFor(owner)).digest('hex')}.json`);
const read = (directory: string, owner = OWNER): AdaptiveDocument => JSON.parse(readFileSync(accountPath(directory, owner), 'utf8')) as AdaptiveDocument;
const markerName = 'assistant-delivery-control-v1.json', markerBytes = '{"version":1,"kind":"assistant-delivery-control"}\n';

async function fixture(initialize = true) {
  const directory = mkdtempSync(join(tmpdir(), 'vox-arc1-file-qa-')); dirs.push(directory);
  const clock = { now: NOW }, keyring = new Map([['qa-key-v1', new Uint8Array(32).fill(193)], ['qa-key-v2', new Uint8Array(32).fill(194)]]);
  let currentKey = 'qa-key-v1', bindingUnavailable = false;
  const bindings = new Map<number, AssistantDeliveryBinding>();
  for (let n = 0; n < 5; n++) bindings.set(BOT + n, { scope: { agentId: 'qa-agent', space: n === 1 ? 'personal' : 'work' },
    binding: { botId: BOT + n, destinationChatId: OWNER, endpointBindingId: 'qa-endpoint', credentialBindingId: 'qa-credential', bindingRevision: 'qa-binding-v1' }, stamp: 'qa-committed-studio-v1' });
  const capabilities = ['core_text', 'personalization', 'auto_memory'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'qa-arc1', enabledCapabilities: capabilities,
    accounts: [OWNER, OTHER].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `qa-arc1-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'qa-arc1', effectiveAt: NOW,
      reviewExpiresAt: NOW + 500 * 86400_000, owner: 'synthetic-only', approvalReference: 'synthetic-only' })) }));
  const makeService = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), { ...options, scopedRelationshipsEnabled: true, now: () => clock.now });
  let adaptive = makeService();
  for (const owner of [OWNER, OTHER]) {
    await adaptive.confirm(owner, { confirm: true, adultConfirmed: true });
    for (const space of ['work', 'personal'] as const) {
      for (const purpose of ['optional.personalization', 'optional.auto_memory'] as const) {
        const view = await adaptive.read(owner, space), shown = await adaptive.present(owner, { space, purpose, locale: 'en',
          expectedRevision: view.purposes.find(p => p.purpose === purpose)!.revision, eventId: uuid() });
        await adaptive.changeConsent(owner, { space, purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision,
          eventId: uuid(), receipt: shown.receipt });
      }
      for (const agentId of ['qa-agent', 'qa-other-agent']) {
        const view = await adaptive.read(owner, space);
        await adaptive.setAgentAccess(owner, agentId, { space, allowed: true, expectedRevision: view.revision, eventId: uuid() });
      }
    }
    // Explicit synthetic long-lived identity permits TTL/idle tests without
    // re-confirmation becoming a competing cause of the tested refusal.
    await adaptive.withAccountDocument(owner, d => { d.binding!.expiresAt = NOW + 400 * 86400_000; d.revision++; });
  }
  const adapterOptions = { now: () => clock.now,
    bindingFor: (botId: number, owner: number) => owner === OWNER && !bindingUnavailable ? copy(bindings.get(botId) ?? null) : null,
    keys: { current: () => ({ keyId: currentKey, key: keyring.get(currentKey)! }), resolve: (keyId: string) => keyring.get(keyId) } };
  const create = () => new AssistantDeliveryControlAdapter(adaptive, adapterOptions);
  let adapter = create(); if (initialize) await adapter.initialize(OWNER); clock.now += 2000;
  const ingress = (messageId = 1, botId = BOT, dateSeconds = Math.floor((clock.now - 1000) / 1000)): AssistantDeliveryIngress => ({ botId, chatId: OWNER, fromId: OWNER,
    isBot: false, chatType: 'private', kind: 'initial-text', messageId, updateId: messageId, dateSeconds });
  const prepare = (input = ingress()) => adapter.prepare({ ownerId: OWNER, ingress: input, generatedText: PRIVATE_GENERATED, decoratedText: PRIVATE_WIRE,
    generationId: uuid(), attemptId: uuid() });
  const claim = async (input = ingress()) => { const prepared = prepare(input), result = await adapter.claim(prepared, input);
    if (result.status !== 'claimed') throw Error('QA expected initial claim'); return { prepared, state: copy(result.state), ingress: input }; };
  const row = (effectKey?: string) => { const rows = read(directory).assistantDeliveryControl!.effects;
    const found = effectKey ? rows.find(r => r.state.effectKey === effectKey) : rows[0]; if (!found) throw Error('QA expected retained effect'); return copy(found.state); };
  const response = (s: DeliveryState, prepared: PreparedAssistantText, messageId = 9001): ResponseProjection => ({ httpStatus: 200, body: { ok: true,
    result: { message_id: messageId, date: Math.floor(clock.now / 1000), chat: { id: s.binding.destinationChatId, type: 'private' },
      from: { id: s.binding.botId, is_bot: true }, text: prepared.submittedText } } });
  const transport = (s: DeliveryState): TransportEvidence => ({ method: 'sendMessage', botId: s.binding.botId,
    credentialBindingId: s.binding.credentialBindingId, endpointBindingId: s.binding.endpointBindingId, attemptId: s.attemptId,
    effectKey: s.effectKey, dispatchedBodyHmac: s.evidence.bodyHmac, observedAt: clock.now });
  return { directory, clock, bindings, keyring, ingress, prepare, claim, row, response, transport,
    get adaptive() { return adaptive; }, get adapter() { return adapter; },
    get storage() { return adaptive.repository.storage as FileAdaptiveStorage; },
    freshAdapter: create, currentKey: (id: string) => { currentKey = id; }, denyBinding: (deny = true) => { bindingUnavailable = deny; },
    restart: () => { adaptive = makeService(); adapter = create(); },
    withdraw: async (space: 'work' | 'personal' = 'work') => { const view = await adaptive.read(OWNER, space);
      await adaptive.changeConsent(OWNER, { space, purpose: 'optional.auto_memory', state: 'withdrawn',
        expectedRevision: view.purposes.find(p => p.purpose === 'optional.auto_memory')!.revision, eventId: uuid() }); },
  };
}

describe('ARC1 independent actual FILE lifecycle and current-authority qualification', () => {
  it('ordinary confirmed/consented accounts have no marker or controls until explicit initialization', async () => {
    const f = await fixture(false); expect(read(f.directory).assistantDeliveryControl).toBeUndefined();
    expect(existsSync(join(f.directory, markerName))).toBe(false);
    expect(() => f.prepare()).toThrow(); await f.adapter.initialize(OWNER);
    const before = read(f.directory); await f.adapter.initialize(OWNER);
    expect(read(f.directory)).toEqual(before); expect(readFileSync(join(f.directory, markerName), 'utf8')).toBe(markerBytes);
    expect(lstatSync(join(f.directory, markerName)).mode & 0o777).toBe(0o600);
  });

  it('invalid or missing initialization owner cannot create the permanent format marker', async () => {
    const f = await fixture(false), marker = join(f.directory, markerName);
    for (const owner of [0, -1, Number.MAX_SAFE_INTEGER + 1, 799999]) {
      await expect(f.adapter.initialize(owner)).rejects.toThrow(); expect(existsSync(marker)).toBe(false);
    }
    await f.adaptive.withAccountDocument(OTHER, d => { delete d.binding; d.revision++; });
    await expect(f.adapter.initialize(OTHER)).rejects.toThrow(); expect(existsSync(marker)).toBe(false);
  });

  it('a failure after durable marker creation leaves a safe marker-only format and no partial account extension', async () => {
    const f = await fixture(false), before = readFileSync(accountPath(f.directory));
    vi.spyOn(f.adaptive.repository, 'assistantDeliveryTransaction').mockRejectedValueOnce(Error('QA_AFTER_MARKER_BEFORE_ACCOUNT'));
    await expect(f.adapter.initialize(OWNER)).rejects.toThrow('QA_AFTER_MARKER_BEFORE_ACCOUNT');
    expect(readFileSync(join(f.directory, markerName), 'utf8')).toBe(markerBytes);
    expect(readFileSync(accountPath(f.directory))).toEqual(before); expect(read(f.directory).assistantDeliveryControl).toBeUndefined();
  });

  it('concurrent initialization converges or refuses a racing marker read without resetting the winning barrier', async () => {
    const f = await fixture(false), second = f.freshAdapter();
    const results = await Promise.allSettled([f.adapter.initialize(OWNER), second.initialize(OWNER)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(readFileSync(join(f.directory, markerName), 'utf8')).toBe(markerBytes);
    const c = read(f.directory).assistantDeliveryControl!; expect(c.noReplayBefore).toBe(f.clock.now);
    expect(c.effects).toEqual([]); expect(c.streams).toEqual([]);
  });

  it('refuses fake/memory storage rather than treating similar methods as FILE qualification', () => {
    const service = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
    expect(() => new AssistantDeliveryControlAdapter(service, { now: () => NOW, bindingFor: () => null,
      keys: { current: () => ({ keyId: 'qa', key: new Uint8Array(32) }), resolve: () => undefined } })).toThrow();
  });

  it('reserves one durable claim through two competing actual FILE adapter instances and restart', async () => {
    const f = await fixture(), ingress = f.ingress(), prepared = f.prepare(ingress), competitor = f.freshAdapter();
    const results = await Promise.all([f.adapter.claim(prepared, ingress), competitor.claim(prepared, ingress)]);
    expect(results.filter(r => r.status === 'claimed')).toHaveLength(1); expect(results.filter(r => r.status === 'already_claimed')).toHaveLength(1);
    expect(read(f.directory).assistantDeliveryControl!.effects).toHaveLength(1); f.restart();
    await expect(f.adapter.claim(prepared, ingress)).resolves.toEqual({ status: 'already_claimed', phase: 'generated' });
    const replacement = f.prepare(ingress); await expect(f.adapter.claim(replacement, ingress)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('persists generated→sending→actual bound sent metadata while every text/key stays transient and no fetch occurs', async () => {
    const fetch = vi.fn(() => { throw Error('QA_NETWORK_FORBIDDEN'); }); vi.stubGlobal('fetch', fetch);
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(true);
    const sent = await f.adapter.recordResponse(sending, c.prepared, f.transport(sending), f.response(sending, c.prepared));
    expect(sent.phase).toBe('sent'); expect(sent.outcome).toMatchObject({ reason: 'provider_accepted', receipt: { messageId: 9001, textEvidence: 'matches-submitted' } });
    expect(sent.outcome).not.toMatchObject({ receipt: { messageId: c.state.source.messageId } }); f.restart(); expect(f.row().phase).toBe('sent');
    const all = readdirSync(f.directory).filter(n => n.endsWith('.json')).map(n => readFileSync(join(f.directory, n), 'utf8')).join();
    for (const forbidden of [PRIVATE_GENERATED, PRIVATE_WIRE, c.prepared.bodyJson, Buffer.from(f.keyring.get('qa-key-v1')!).toString('hex')]) expect(all).not.toContain(forbidden);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('wrong provider chat becomes unknown and conflicting accepted receipts cannot replace known truth', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared), response = f.response(sending, c.prepared);
    (response.body as { result: { chat: { id: number } } }).result.chat.id = OTHER;
    const unknown = await f.adapter.recordResponse(sending, c.prepared, f.transport(sending), response); expect(unknown.phase).toBe('unknown');
    await expect(f.adapter.beginDispatch(unknown, c.prepared)).rejects.toThrow();
    const sent = await f.adapter.recordResponse(unknown, c.prepared, f.transport(unknown), f.response(unknown, c.prepared));
    await expect(f.adapter.recordResponse(sent, c.prepared, f.transport(sent), f.response(sent, c.prepared, 9999))).rejects.toThrow();
    expect(f.row().outcome).toEqual(sent.outcome);
  });

  it('interrupted sending becomes durable unknown after actual FILE reopen and cannot resume dispatch', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared); f.restart();
    await f.adapter.recover(OWNER); const unknown = f.row(); expect(unknown.phase).toBe('unknown');
    expect(unknown.outcome?.reason).toBe('dispatch_interrupted'); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
    await expect(f.adapter.beginDispatch(unknown, c.prepared)).rejects.toThrow();
    const sent = await f.adapter.recordResponse(unknown, c.prepared, f.transport(unknown), f.response(unknown, c.prepared)); expect(sent.phase).toBe('sent');
  });

  it('lost result commit preserves sending and keyless recovery never invents a failed/no-effect result', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    vi.spyOn(f.storage, 'transact').mockRejectedValueOnce(Error('QA_RESULT_COMMIT_UNAVAILABLE'));
    await expect(f.adapter.recordResponse(sending, c.prepared, f.transport(sending), f.response(sending, c.prepared))).rejects.toThrow('QA_RESULT_COMMIT_UNAVAILABLE');
    expect(f.row().phase).toBe('sending'); f.keyring.delete('qa-key-v1'); f.restart(); await f.adapter.recover(OWNER);
    expect(f.row().phase).toBe('unknown'); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
  });

  it('real FILE writer busy state denies a callback even when the exact committed snapshot is available to that writer', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    await f.adaptive.withAccountDocument(OWNER, d => { expect(d.assistantDeliveryControl!.effects[0].state).toEqual(sending);
      expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false); });
    expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(true);
  });

  it('current committed binding and canonical grant changes deny stale callbacks', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    f.denyBinding(); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false); f.denyBinding(false);
    f.bindings.get(BOT)!.stamp = 'qa-new-studio-revision'; expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
    f.bindings.get(BOT)!.stamp = 'qa-committed-studio-v1'; const view = await f.adaptive.read(OWNER, 'work');
    await f.adaptive.setAgentAccess(OWNER, 'qa-agent', { space: 'work', allowed: false, expectedRevision: view.revision, eventId: uuid() });
    expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false); expect(f.row().contentEligible).toBe(false);
  });

  it('source edit with no archive rows fences all lower source IDs and preserves late acceptance without content eligibility', async () => {
    const f = await fixture(), c = await f.claim(f.ingress(20)), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    expect(read(f.directory).telegramArchives).toBeUndefined(); await f.adapter.invalidateSource(OWNER, BOT, OWNER, 20);
    const invalidated = f.row(); expect(invalidated.contentEligible).toBe(false); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
    const sent = await f.adapter.recordResponse(invalidated, c.prepared, f.transport(invalidated), f.response(invalidated, c.prepared));
    expect(sent.phase).toBe('sent'); expect(sent.contentEligible).toBe(false);
    expect(() => f.prepare(f.ingress(19))).toThrow(); expect(() => f.prepare(f.ingress(20))).toThrow();
    const snapshot = readFileSync(accountPath(f.directory)); await f.adapter.invalidateSource(OWNER, BOT, OWNER, 20);
    expect(readFileSync(accountPath(f.directory))).toEqual(snapshot);
  });

  it('unknown-stream edit advances account time floor without allocating a fifth route or archive entry', async () => {
    const f = await fixture(), c = await f.claim(); f.clock.now += 1000;
    await f.adapter.invalidateSource(OWNER, BOT + 99, OWNER, 999); const d = read(f.directory), control = d.assistantDeliveryControl!;
    expect(control.noReplayBefore).toBe(f.clock.now); expect(control.streams).toHaveLength(1); expect(d.telegramArchives).toBeUndefined();
    expect(f.adapter.isDispatchCurrent(c.state, c.prepared)).toBe(false); expect(() => f.prepare(f.ingress(999))).toThrow();
  });

  it('withdrawal invalidates existing controls through the ordinary canonical consent writer and late sent truth remains control-only', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared); await f.withdraw();
    const invalid = f.row(); expect(invalid.contentEligible).toBe(false); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
    const sent = await f.adapter.recordResponse(invalid, c.prepared, f.transport(invalid), f.response(invalid, c.prepared));
    expect(sent.phase).toBe('sent'); expect(sent.contentEligible).toBe(false); expect(() => f.prepare(f.ingress(2))).toThrow();
  });

  it('erasure immediately removes detailed proof, keeps replay cutoff and makes late callback metadata_expired', async () => {
    const f = await fixture(), c = await f.claim(f.ingress(12)), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    await f.adapter.eraseScope(OWNER, 'work'); const d = read(f.directory), control = d.assistantDeliveryControl!;
    expect(control.effects).toEqual([]); expect(control.streams[0].messageFloor).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(control)).not.toContain(c.state.evidence.bodyHmac); expect(() => f.prepare(f.ingress(12))).toThrow();
    await expect(f.adapter.recordResponse(sending, c.prepared, f.transport(sending), f.response(sending, c.prepared))).rejects.toMatchObject({ code: 'metadata_expired' });
    expect(readFileSync(join(f.directory, markerName), 'utf8')).toBe(markerBytes);
  });

  it('seven-day unknown expiry atomically advances message cutoff and does not refresh from late observations', async () => {
    const f = await fixture(), c = await f.claim(f.ingress(40)), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    const unknown = await f.adapter.recordUncertainty(sending); const retainUntil = read(f.directory).assistantDeliveryControl!.effects[0].retainUntil;
    expect(retainUntil).toBe(c.state.createdAt + ASSISTANT_CONTROL_TTL_MS); f.clock.now = retainUntil - 1; await f.adapter.prune(OWNER);
    expect(f.row().phase).toBe('unknown'); f.clock.now++; await f.adapter.prune(OWNER); f.restart();
    expect(read(f.directory).assistantDeliveryControl!.effects).toEqual([]); expect(read(f.directory).assistantDeliveryControl!.streams[0].messageFloor).toBe(40);
    await expect(f.adapter.recordUncertainty(unknown)).rejects.toMatchObject({ code: 'metadata_expired' }); expect(() => f.prepare(f.ingress(40))).toThrow();
  });

  it('90-day stream retirement leaves a fresh account floor and refuses the retired source under another route', async () => {
    const f = await fixture(), c = await f.claim(f.ingress(8)); f.clock.now = c.state.createdAt + ASSISTANT_CONTROL_IDLE_MS;
    await f.adapter.prune(OWNER); const d = read(f.directory), control = d.assistantDeliveryControl!;
    expect(control.streams).toEqual([]); expect(control.effects).toEqual([]); expect(control.noReplayBefore).toBe(f.clock.now);
    f.bindings.get(BOT)!.scope = { agentId: 'qa-other-agent', space: 'personal' };
    expect(() => f.prepare({ ...c.ingress, updateId: 99999 })).toThrow();
  });

  it('out-of-order unseen messages above floors are accepted, while a week-idle random update ID cannot replay an old effect', async () => {
    const f = await fixture(), first = await f.claim(f.ingress(50)); await f.claim(f.ingress(40));
    expect(read(f.directory).assistantDeliveryControl!.streams[0].highMessageId).toBe(50);
    const changedUpdate = { ...first.ingress, updateId: 2 }, prepared = f.prepare(changedUpdate);
    await expect(f.adapter.claim(prepared, changedUpdate)).rejects.toMatchObject({ code: 'conflict' });
    f.clock.now += 8 * 86400_000; await f.adapter.prune(OWNER);
    const randomAfterIdle = f.ingress(51); randomAfterIdle.updateId = 1;
    await f.claim(randomAfterIdle); expect(read(f.directory).assistantDeliveryControl!.streams[0].messageFloor).toBe(50);
    expect(() => f.prepare({ ...first.ingress, updateId: 0 })).toThrow();
  });

  it('same source cannot move between spaces or agents, or acquire another effect through key or endpoint rotation', async () => {
    const f = await fixture(), c = await f.claim(); f.currentKey('qa-key-v2');
    await expect(f.adapter.claim(f.prepare(c.ingress), c.ingress)).rejects.toMatchObject({ code: 'conflict' });
    f.bindings.get(BOT)!.binding.endpointBindingId = 'qa-next-endpoint';
    await expect(f.adapter.claim(f.prepare(c.ingress), c.ingress)).rejects.toMatchObject({ code: 'conflict' });
    f.bindings.get(BOT)!.scope.space = 'personal'; expect(() => f.prepare(c.ingress)).toThrow();
    expect(read(f.directory).assistantDeliveryControl!.effects).toHaveLength(1);
  });

  it('whole-account erasure requires a fresh trusted bootstrap before any recreated account can accept original sources', async () => {
    const f = await fixture(), c = await f.claim(), marker = join(f.directory, markerName); rmSync(accountPath(f.directory)); f.clock.now += 5000;
    await expect(f.adapter.initialize(OWNER)).rejects.toThrow(); expect(readFileSync(marker, 'utf8')).toBe(markerBytes);
    await f.adaptive.confirm(OWNER, { confirm: true, adultConfirmed: true });
    for (const purpose of ['optional.personalization', 'optional.auto_memory'] as const) {
      const view = await f.adaptive.read(OWNER, 'work'), shown = await f.adaptive.present(OWNER, { space: 'work', purpose, locale: 'en',
        expectedRevision: view.purposes.find(p => p.purpose === purpose)!.revision, eventId: uuid() });
      await f.adaptive.changeConsent(OWNER, { space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision,
        eventId: uuid(), receipt: shown.receipt });
    }
    const view = await f.adaptive.read(OWNER, 'work'); await f.adaptive.setAgentAccess(OWNER, 'qa-agent', { space: 'work', allowed: true, expectedRevision: view.revision, eventId: uuid() });
    await f.adapter.initialize(OWNER); expect(read(f.directory).assistantDeliveryControl!.noReplayBefore).toBe(f.clock.now);
    expect(() => f.prepare(c.ingress)).toThrow(); f.clock.now += 2000; await f.claim(f.ingress(2));
    expect(read(f.directory).assistantDeliveryControl!.effects).toHaveLength(1);
  });

  it('32 detailed effects and four active streams are hard limits with no early unknown eviction', async () => {
    const f = await fixture(); for (let n = 1; n <= 32; n++) await f.claim(f.ingress(n, BOT + (n % 4)));
    const before = readFileSync(accountPath(f.directory)); const overflow = f.ingress(33), prepared = f.prepare(overflow);
    await expect(f.adapter.claim(prepared, overflow)).rejects.toMatchObject({ code: 'capacity' }); expect(readFileSync(accountPath(f.directory))).toEqual(before);
    expect(read(f.directory).assistantDeliveryControl!.effects).toHaveLength(32); expect(read(f.directory).assistantDeliveryControl!.streams).toHaveLength(4);
  });

  it('fifth active stream fails before any partial stream/effect write', async () => {
    const f = await fixture(); for (let n = 0; n < 4; n++) await f.claim(f.ingress(n + 1, BOT + n));
    const before = readFileSync(accountPath(f.directory)), ingress = f.ingress(99, BOT + 4), prepared = f.prepare(ingress);
    await expect(f.adapter.claim(prepared, ingress)).rejects.toMatchObject({ code: 'capacity' }); expect(readFileSync(accountPath(f.directory))).toEqual(before);
  });

  it('preparation expiry, future source dates, initial/edit distinction, negative zero and mismatched private owner all refuse', async () => {
    const f = await fixture(), c = await f.claim(); f.clock.now = c.state.expiresAt;
    expect(f.adapter.isDispatchCurrent(c.state, c.prepared)).toBe(false); await expect(f.adapter.beginDispatch(c.state, c.prepared)).rejects.toThrow();
    for (const patch of [{ dateSeconds: Math.floor(f.clock.now / 1000) + 1 }, { kind: 'edit' }, { fromId: OTHER }, { chatId: OTHER },
      { isBot: true }, { chatType: 'group' }, { updateId: -0 }, { messageId: 0 }, { dateSeconds: Number.MAX_SAFE_INTEGER }]) {
      expect(() => f.prepare({ ...f.ingress(2), ...patch } as AssistantDeliveryIngress)).toThrow();
    }
  });

  it('missing old key denies acceptance/dispatch while metadata-only uncertainty and replay barriers survive key rotation', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    f.keyring.delete('qa-key-v1'); f.currentKey('qa-key-v2'); expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false);
    await expect(Promise.resolve().then(() => f.adapter.recordResponse(sending, c.prepared, f.transport(sending), f.response(sending, c.prepared)))).rejects.toMatchObject({ code: 'key_unavailable' });
    const unknown = await f.adapter.recordUncertainty(sending); expect(unknown.phase).toBe('unknown');
    await expect(f.adapter.claim(f.prepare(c.ingress), c.ingress)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('owner-selected existing lifecycle export includes current metadata and a bounded final fence without leaking another space', async () => {
    const f = await fixture(), work = await f.claim(f.ingress(1)), personal = await f.claim(f.ingress(2, BOT + 1));
    const lifecycle = new AdaptiveLifecycleService(f.adaptive), exported = await lifecycle.prepareAccountExport(OWNER, 'work');
    const data = exported.data as typeof exported.data & { assistantDeliveryControl?: { effects: Array<{ state: DeliveryState }>; streams: Array<{ space: string }>; barriers: string } };
    expect(data.assistantDeliveryControl).toBeDefined(); expect(data.assistantDeliveryControl!.barriers).toBe('account-wide');
    expect(data.assistantDeliveryControl!.effects.map(r => r.state.effectKey)).toEqual([work.state.effectKey]);
    expect(JSON.stringify(data.assistantDeliveryControl)).not.toContain(personal.state.effectKey); exported.revalidate();
    f.clock.now = work.state.createdAt + ASSISTANT_CONTROL_TTL_MS; expect(() => exported.revalidate()).toThrow();
    await expect(f.adapter.exportOwner(OTHER, 'work')).rejects.toThrow();
  });

  it('ordinary lifecycle sweep prunes expired ARC1 even with no feature producer wired', async () => {
    const f = await fixture(), c = await f.claim(); f.clock.now = c.state.createdAt + ASSISTANT_CONTROL_TTL_MS;
    await new AdaptiveLifecycleService(f.adaptive).sweepAccount(OWNER);
    expect(read(f.directory).assistantDeliveryControl!.effects).toEqual([]); expect(read(f.directory).assistantDeliveryControl!.streams[0].messageFloor).toBe(1);
  });

  it('canonical generic writer cannot strip/reset controls or fabricate a delivery receipt', async () => {
    const f = await fixture(), c = await f.claim(), before = readFileSync(accountPath(f.directory));
    await expect(f.adaptive.withAccountDocument(OWNER, d => { delete d.assistantDeliveryControl; d.revision++; })).rejects.toThrow();
    await expect(f.adaptive.withAccountDocument(OWNER, d => { const control = d.assistantDeliveryControl!; control.revision++; d.revision++;
      const state = control.effects[0].state; state.phase = 'sent'; state.revision++; state.outcome = { reason: 'provider_accepted', observedAt: f.clock.now,
        receipt: { messageId: 12345, botId: BOT, destinationChatId: OWNER, providerDateSeconds: Math.floor(f.clock.now / 1000), textEvidence: 'matches-submitted' } }; })).rejects.toThrow();
    expect(readFileSync(accountPath(f.directory))).toEqual(before); expect(f.row().effectKey).toBe(c.state.effectKey);
  });

  it('hostile typed-array byteLength/species accessors are never invoked while snapshotting prepared bytes', async () => {
    const f = await fixture(), ingress = f.ingress(), prepared = f.prepare(ingress); let accessed = 0;
    for (const property of ['byteLength', 'constructor']) Object.defineProperty(prepared.bodyBytes, property,
      { get() { accessed++; throw Error('QA_TYPED_ARRAY_ACCESSOR'); }, configurable: true });
    await f.adapter.claim(prepared, ingress); expect(accessed).toBe(0); expect(f.row().phase).toBe('generated');
  });

  it('full canonical reservation keeps outer counter growth available for a terminal receipt and rejects one extra byte', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared);
    await f.adaptive.withAccountDocument(OWNER, d => {
      d.revision = 99;
      const before = Buffer.byteLength(JSON.stringify(assistantCapacityProjection(d)));
      // Appending one JSON string consumes its two quotes and the array comma.
      d.consentEvents.push('x'.repeat(700000 - before - 3) as never);
      expect(Buffer.byteLength(JSON.stringify(assistantCapacityProjection(d)))).toBe(700000);
    });
    const sent = await f.adapter.recordResponse(sending, c.prepared, f.transport(sending), f.response(sending, c.prepared));
    expect(sent.phase).toBe('sent'); expect(read(f.directory).revision).toBe(100);
    const before = readFileSync(accountPath(f.directory));
    await expect(f.adaptive.withAccountDocument(OWNER, d => { const index = d.consentEvents.length - 1;
      d.consentEvents[index] = String(d.consentEvents[index]) + 'x' as never; d.revision++; })).rejects.toThrow();
    expect(readFileSync(accountPath(f.directory))).toEqual(before);
  });

  it('caller mutation of prepared and ingress while waiting for FILE lock cannot replace the claim or forge sent truth', async () => {
    const f = await fixture(), ingress = f.ingress(), prepared = f.prepare(ingress), original = copy(prepared.initialState);
    const lock = `${accountPath(f.directory)}.lock`; mkdirSync(lock); const pending = f.adapter.claim(prepared, ingress).then(value => ({ value }), error => ({ error }));
    prepared.initialState.scope.agentId = 'qa-other-agent'; prepared.initialState.phase = 'sent'; ingress.messageId = 999;
    rmSync(lock, { recursive: true }); await pending;
    const rows = read(f.directory).assistantDeliveryControl!.effects;
    expect(rows.length).toBeLessThanOrEqual(1); if (rows.length) expect(rows[0].state).toEqual(original);
  });

  it('caller mutation of expected claim and provider response during FILE lock cannot commit forged receipt data', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared), expected = copy(sending);
    const response = f.response(sending, c.prepared), transport = f.transport(sending), lock = `${accountPath(f.directory)}.lock`;
    mkdirSync(lock); const pending = f.adapter.recordResponse(expected, c.prepared, transport, response).then(value => ({ value }), error => ({ error }));
    expected.attemptId = uuid(); (response.body as { result: { message_id: number } }).result.message_id = 66666; transport.attemptId = uuid();
    rmSync(lock, { recursive: true }); await pending; const actual = f.row();
    expect(actual.attemptId).toBe(sending.attemptId); if (actual.phase === 'sent') expect(actual.outcome).toMatchObject({ receipt: { messageId: 9001 } });
  });

  it('exhausted retained control counters deny prior equal stamps and never reset or authorize another claim', async () => {
    const f = await fixture(), c = await f.claim(), sending = await f.adapter.beginDispatch(c.state, c.prepared), path = accountPath(f.directory);
    const document = read(f.directory); document.assistantDeliveryControl!.revision = Number.MAX_SAFE_INTEGER;
    writeFileSync(path, JSON.stringify(document), { mode: 0o600 }); const before = readFileSync(path);
    expect(f.adapter.isDispatchCurrent(sending, c.prepared)).toBe(false); expect(() => f.prepare(f.ingress(2))).toThrow();
    await expect(f.adapter.beginDispatch(sending, c.prepared)).rejects.toThrow(); expect(readFileSync(path)).toEqual(before);
  });

  it('strict marker loss, malformed bytes, symlink or hardlink never becomes an empty active ledger', async () => {
    const f = await fixture(), c = await f.claim(), marker = join(f.directory, markerName), target = join(f.directory, 'qa-marker-target');
    rmSync(marker); expect(() => f.storage.readCommittedForEffect(accountIdFor(OWNER))).toThrow(); expect(() => f.prepare(f.ingress(2))).toThrow(); expect(f.adapter.isDispatchCurrent(c.state, c.prepared)).toBe(false);
    writeFileSync(marker, '{}', { mode: 0o600 }); await expect(f.adapter.initialize(OWNER)).rejects.toThrow(); expect(readFileSync(marker, 'utf8')).toBe('{}');
    rmSync(marker); writeFileSync(target, markerBytes, { mode: 0o600 }); symlinkSync(target, marker);
    await expect(f.adapter.initialize(OWNER)).rejects.toThrow(); rmSync(marker); linkSync(target, marker);
    await expect(f.adapter.initialize(OWNER)).rejects.toThrow();
  });
});
