/** AM-03 QA-owned synthetic fixture. Production ingress/FILE consumers; no network or model provider. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../../adaptive/relationships/service';
import { FileRelationshipStore, RelationshipLoop, type RelationshipKey } from '../../relationships';
import { TelegramBotClient, type TelegramMessage, type TelegramUpdate } from '../../tireh/telegram/client';
import { Studio } from '../service';
import { StudioStore } from '../store';
import { createStudioRequestedRoutines } from '../requested-routines';
import type { RoutineBinding, RoutineLedger } from '../routines';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg } from './helpers';

export const START = Date.parse('2026-10-29T10:00:00Z');
export const DUE = START + 60_000;
export const STOP = START + 30_000;
const DAY = 86400_000;
const fixturePath = process.env.AM03_FIXTURE_MANIFEST;
export const fixtureNames: { name: string; topic: string; idOffset: number } = fixturePath
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : { name: 'Mira', topic: 'garden vocabulary', idOffset: 41000 };
if (!fixtureNames.name || !fixtureNames.topic || !Number.isSafeInteger(fixtureNames.idOffset)) throw Error('Invalid AM03 neutral fixture manifest');
export function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
export function connectFailure() { return new TypeError('synthetic known pre-send connection failure', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); }
export type Effect = { method: string; text: string; at: number; proactive: boolean };
export type Trace = { event: string; at: number; state?: unknown };
export const records: Array<{ id: string; probe: string; trace: Trace[]; state: unknown }> = [];

export async function am03Fixture(legacy = false) {
  const h = makeStudio({ adaptive: false }); h.clock.now = new Date(START);
  const org = await seedOrg(h), hired = await hire(h, org.superadmin, { name: fixtureNames.name });
  vi.spyOn(h.studio, 'nudgeBotProfile').mockImplementation(() => undefined);
  const routinePath = join(h.dir, 'am03-routines.json'), relationshipPath = join(h.dir, 'am03-relationships.json');
  const trace: Trace[] = [], effects: Effect[] = [];
  let nextId = fixtureNames.idOffset, outbound = 51000;
  let fetchHook: ((effect: Effect) => Promise<Response>) | undefined;
  let snapshotHook: (() => void) | undefined;
  let ackHook: ((text: string) => void) | undefined;
  let modelHook: ((kind: 'ordinary' | 'daily' | 'relationship') => Promise<string>) | undefined;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const method = String(url).split('/').at(-1)!;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const text = String(body.text ?? '');
    const proactive = text.includes('AM03_GENERATED') || text === 'You have an update in Vox.';
    const effect = { method, text, proactive, at: h.clock.now.getTime() };
    effects.push(effect); trace.push({ event: proactive ? 'proactive-POST-entry' : 'reply-POST-entry', at: effect.at });
    if (!proactive && method === 'sendMessage') { snapshotHook?.(); ackHook?.(text); }
    if (fetchHook && proactive) return fetchHook(effect);
    trace.push({ event: 'fake-provider-accepted', at: h.clock.now.getTime() });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: outbound++, chat: { id: ID.superadmin, type: 'private' }, date: 0, text } : true });
  });
  const clients = new Map<string, TelegramBotClient>();
  h.studio.deps.botFor = credential => {
    let client = clients.get(credential); if (!client) { client = new TelegramBotClient(credential, fetcher); clients.set(credential, client); }
    return client;
  };
  const llm = vi.spyOn(h.chatLLM, 'complete').mockImplementation(async request => {
    const system = String(request.system);
    if (system.startsWith('Extract only an explicit first-person request')) return JSON.stringify({ intent: 'create', instruction: fixtureNames.topic, localTime: null, timeZone: null });
    if (system.startsWith('You extract long-term memories')) return '{"memories":[]}';
    const kind = request.messages.some(m => String(m.content).includes('recentOwnLessons')) ? 'daily'
      : system.startsWith('Write one brief natural check-in') ? 'relationship' : 'ordinary';
    trace.push({ event: `${kind}-generation-entry`, at: h.clock.now.getTime() });
    if (modelHook) return modelHook(kind);
    return kind === 'ordinary' ? 'AM03_ORDINARY_REPLY' : 'AM03_GENERATED_PRIVATE_CANARY';
  });
  const capabilities = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions', 'relationship_outreach'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'am03-synthetic', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.superadmin), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, n) => ({ schemaVersion: 1, id: `am03-${n}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'am03-synthetic', effectiveAt: START,
      reviewExpiresAt: START + 30 * DAY, owner: 'synthetic', approvalReference: 'synthetic-only' })) }));
  let adaptive: AdaptiveService | undefined, authority: AdaptiveRelationshipService | undefined;
  const buildAdaptive = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(h.dir, 'adaptive'))), { ...options, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime() });
  if (!legacy) {
    adaptive = buildAdaptive(); authority = new AdaptiveRelationshipService(adaptive);
    await adaptive.confirm(ID.superadmin, { confirm: true, adultConfirmed: true });
    for (const space of ['work', 'personal'] as const) {
      for (const purpose of ['optional.personalization', 'optional.auto_memory', 'optional.proactive_suggestions', 'optional.relationship_outreach'] as OptionalPurpose[]) {
        const view = await adaptive.read(ID.superadmin, space);
        const shown = await adaptive.present(ID.superadmin, { space, purpose, locale: 'en', expectedRevision: view.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), deliberateReopen: true });
        await adaptive.changeConsent(ID.superadmin, { space, purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, receipt: shown.receipt, eventId: randomUUID() });
      }
      await adaptive.setAgentAccess(ID.superadmin, hired.agent.id, { space, allowed: true, expectedRevision: (await adaptive.read(ID.superadmin, space)).revision, eventId: randomUUID() });
      await authority.configureExternal(ID.superadmin, space, true);
    }
    await adaptive.withAccountDocument(ID.superadmin, d => {
      d.experience.settings.timezone = 'Europe/Tallinn'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0;
      d.experience.settings.work = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false };
      d.experience.settings.personal = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false };
    });
  }
  const binding: RoutineBinding = { memberId: accountIdFor(ID.superadmin), agentId: hired.agent.id, telegramUserId: String(ID.superadmin), telegramChatId: String(ID.superadmin), telegramBotId: String(hired.botId), tokenFingerprint: createHash('sha256').update(hired.token).digest('hex') };
  let key: RelationshipKey = { personaId: hired.agent.id, chatKey: `private-tg-${ID.superadmin}`, audience: { kind: 'private', personId: `tg-${ID.superadmin}` } };
  if (authority) key = (await authority.resolve(ID.superadmin, hired.agent.id, 'work'))!.key;
  let store = new FileRelationshipStore(relationshipPath);
  const newLoop = () => new RelationshipLoop({ store, mode: 'live', now: () => h.clock.now, policy: { minimumDelayMs: 0 }, assessor: { assess: async ({ text }) => text === 'My synthetic discussion is ongoing.' ? { situations: [{ topic: fixtureNames.topic, summary: 'An ongoing synthetic discussion.', status: 'open' as const }], followUp: { topic: fixtureNames.topic, purpose: 'Ask how the discussion is going', dueAt: new Date(DUE).toISOString(), timing: { kind: 'ongoing' as const, evidenceQuote: text } } } : {} }, decisions: { choose: async () => 'send' },
    ...(authority ? { authorize: (input: Parameters<NonNullable<ConstructorParameters<typeof RelationshipLoop>[0]['authorize']>>[0]) => authority!.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint),
      applyScopedControl: (k: RelationshipKey, action: 'stop' | 'pause', until?: Date) => authority!.control(ID.superadmin, hired.agent.id, k.scope!.space, action, until?.getTime()) } : {}) });
  let loop = newLoop();
  const wire = () => {
    Object.assign(h.studio.deps, { adaptive, relationshipAuthority: authority, relationships: loop, relationshipStore: store,
      relationshipConfig: { mode: 'live', agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] }, requestedRoutinesEnabled: () => true });
    h.studio.deps.requestedRoutines = createStudioRequestedRoutines(h.studio, { filePath: routinePath, enabled: () => true, fetcher, now: () => h.clock.now });
  };
  wire();
  const message = (text: string, id = nextId++, extra: Partial<TelegramMessage> = {}): TelegramMessage => ({ message_id: id, date: Math.floor(h.clock.now.getTime() / 1000), text, from: { id: ID.superadmin, first_name: 'Synthetic', is_bot: false }, chat: { id: ID.superadmin, type: 'private' }, ...extra });
  const inbound = async (text: string, id = nextId++, extra: Partial<TelegramMessage> = {}, endpoint: string | null = h.studio.relationshipEndpointId(hired.token), agent = hired.agent.id) => {
    trace.push({ event: 'inbound-intent', at: h.clock.now.getTime() });
    const update: TelegramUpdate = { update_id: id, message: message(text, id, extra) };
    await handleAgentUpdate(h.studio, agent, update, endpoint ?? undefined);
  };
  // Pending timezone request precedes the two fixed tasks, so inference cannot fill it from an existing timezone.
  await inbound('Please teach me vocabulary every day');
  const engine = () => h.studio.deps.requestedRoutines!;
  for (const suffix of ['alpha', 'beta']) await engine().manage(binding, { type: 'create', inboundMessageId: `am03-${fixtureNames.idOffset}-${suffix}`, instruction: `${fixtureNames.topic} ${suffix}`, localTime: '12:01', timeZone: 'Europe/Tallinn' });
  const seedSource = async () => {
    const permit = authority ? (await authority.resolve(ID.superadmin, hired.agent.id, 'work'))! : undefined;
    const source = permit ? await authority!.acceptSource(permit, { id: 'telegram:am03-source', at: START, channel: 'telegram', endpointId: h.studio.relationshipEndpointId(hired.token) }) : undefined;
    await loop.configure(key, { timeZone: 'Europe/Tallinn', quietHours: { start: 0, end: 0 } });
    await loop.observeTurn({ ...key, eventId: source?.id ?? 'telegram:am03-source', text: 'My synthetic discussion is ongoing.', source: 'telegram', speakerId: key.audience.kind === 'private' ? key.audience.personId : '',
      ...(permit ? { authorizationFingerprint: permit.fingerprint, sourceReceipt: source! } : {}) });
    expect((await store.read(key)).intentions).toHaveLength(1);
  };
  await seedSource(); effects.length = 0; trace.length = 0; llm.mockClear();
  const ledger = (): RoutineLedger => JSON.parse(readFileSync(routinePath, 'utf8'));
  const account = () => adaptive ? JSON.parse(readFileSync(join(h.dir, 'adaptive', `${createHash('sha256').update(accountIdFor(ID.superadmin)).digest('hex')}.json`), 'utf8')) : undefined;
  const state = async () => ({ daily: ledger().routines.map(r => ({ id: r.id, status: r.status, instruction: r.instruction, nextRunAt: r.nextRunAt, recentLessons: r.recentLessons })), occurrences: ledger().occurrences.map(o => ({ id: o.id, status: o.status })), relationship: await store.read(key), control: account()?.relationships.controls });
  const beforeState = await state();
  snapshotHook = () => {
    const committed = { daily: ledger().routines.map(r => ({ id: r.id, status: r.status })), control: account()?.relationships.controls };
    trace.push({ event: 'committed-state-at-reply-entry', at: h.clock.now.getTime(), state: committed });
  };
  trace.push({ event: 'seeded-committed-state', at: h.clock.now.getTime(), state: { sha256: createHash('sha256').update(JSON.stringify(beforeState)).digest('hex') } });
  const reconstruct = () => {
    engine().close(); store = new FileRelationshipStore(relationshipPath);
    if (adaptive) { adaptive = buildAdaptive(); authority = new AdaptiveRelationshipService(adaptive); }
    loop = newLoop(); h.store = new StudioStore(h.dir); h.studio = new Studio({ ...h.studio.deps, store: h.store }); wire();
    vi.spyOn(h.studio, 'nudgeBotProfile').mockImplementation(() => undefined);
    trace.push({ event: 'service-reconstructed', at: h.clock.now.getTime() });
  };
  return { h, org, hired, binding, key, routinePath, relationshipPath, effects, trace, fetcher, llm, engine, ledger, account, state, inbound, message,
    beforeState, get store() { return store; }, get loop() { return loop; }, get adaptive() { return adaptive; }, get authority() { return authority; },
    at: (time: number) => { h.clock.now = new Date(time); }, reconstruct,
    fetchHook: (hook: typeof fetchHook) => { fetchHook = hook; }, ackHook: (hook: typeof ackHook) => { ackHook = hook; }, modelHook: (hook: typeof modelHook) => { modelHook = hook; },
    close: () => { engine().close(); rmSync(h.dir, { recursive: true, force: true }); },
    proactive: () => effects.filter(e => e.proactive),
  };
}
export type Am03Fixture = Awaited<ReturnType<typeof am03Fixture>>;
export function assertScopedAck(text: string, daily: boolean, checkins: boolean) {
  // Semantic components are checked independently: scope nouns + committed outcome; EN and FA supported.
  expect(text).toMatch(/daily|روزانه/i); expect(text).toMatch(/check.?ins?|پیگیری|احوال/i);
  const parts = text.split(/[.!;\n]+/u).map(s => s.trim()).filter(Boolean);
  const dailyParts = parts.filter(s => /daily|روزانه/i.test(s));
  const checkinParts = parts.filter(s => /check.?ins?|پیگیری|احوال/i.test(s));
  const positive = /stopp?ed|cancelled|متوقف|لغو/i, uncertain = /couldn.t|cannot|unavailable|not confirmed|نتوانست|تأیید نشده/i;
  expect(dailyParts.some(s => positive.test(s) && !uncertain.test(s))).toBe(daily);
  expect(checkinParts.some(s => positive.test(s) && !uncertain.test(s))).toBe(checkins);
  if (!daily) expect(dailyParts.some(s => uncertain.test(s))).toBe(true);
  if (!checkins) expect(checkinParts.some(s => uncertain.test(s))).toBe(true);
  // Broad claims exceed the two receipts even if both commit.
  expect(text).not.toMatch(/(?:all|every)\s+(?:messages?|proactive|notifications?)|everything|همه\s+(?:پیام|چیز)/i);
}
export async function record(id: string, probe: string, f: Am03Fixture) {
  const state = await f.state(); records.push({ id, probe, trace: [...f.trace], state });
  console.info('AM03_PROBE', JSON.stringify({ id, probe, beforeDigest: createHash('sha256').update(JSON.stringify(f.beforeState)).digest('hex'), afterDigest: createHash('sha256').update(JSON.stringify(state)).digest('hex'), trace: f.trace, state }));
}
export function routineFileExists(f: Am03Fixture) { return existsSync(f.routinePath); }
