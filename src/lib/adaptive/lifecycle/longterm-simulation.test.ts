import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor, digest, type OptionalPurpose, type SpaceKind } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { SharedMemoryRepository } from '../shared/repository';
import { SharedMemoryService, type SharedAuthority } from '../shared/service';
import type { SharedContainerView } from '../shared/contracts';
import { AdaptiveObserverService, type ObserverServiceOptions } from '../observation/service';
import { OBSERVER_LEASE_MS } from '../observation/contracts';
import { AdaptiveLifecycleService } from './service';
import { AdaptiveRelationshipService } from '../relationships/service';
import { FileRelationshipStore } from '../../relationships/file-store';
import { RelationshipLoop } from '../../relationships/loop';
import type { Assessment, RelationshipKey } from '../../relationships/types';

const START = Date.UTC(2026, 9, 19, 12), DAY = 86_400_000, HOUR = 3_600_000;
// Independent user intentions, fixed before API assertions. These are fictional adults.
const PEOPLE = {
  jonah: { id: 611, locale: 'en' as const, goal: 'Coordinate a launch; share reviewed decisions; allow Work analytics until withdrawing it.' },
  mina: { id: 612, locale: 'fa' as const, goal: 'Keep personal design notes private; use selected project notes; decline analytics everywhere.' },
  leila: { id: 613, locale: 'fa' as const, goal: 'Contract on the project temporarily; keep a personal bilingual journal; leave the group cleanly.' },
};
const J = PEOPLE.jonah.id, M = PEOPLE.mina.id, L = PEOPLE.leila.id;
const AGENT = 'tireh';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'vox-independent-90d-')); roots.push(root);
  let now = START, members = [J, M, L];
  const capabilities = ['core_text', 'personalization', 'product_analytics', 'auto_memory', 'proactive_suggestions'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'independent-90d-v1',
    enabledCapabilities: capabilities, accounts: Object.values(PEOPLE).map(p => ({ accountId: accountIdFor(p.id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `independent-${i}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'independent-90d-v1', effectiveAt: START,
      reviewExpiresAt: START + 365 * DAY, owner: 'synthetic-qa', approvalReference: 'local-fixture-only' })) }));
  const authority: SharedAuthority = {
    member: async id => ({ active: [J, M, L].includes(id), agentIds: [AGENT] }),
    group: async id => id === 'launch-room' ? { memberTelegramIds: [...members], hasGuests: false, revision: digest(members) } : null,
    agent: async id => ({ active: id === AGENT }),
  };
  const restart = (observerOptions?: ObserverServiceOptions) => {
    const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(root, 'accounts'))), { ...options, scopedRelationshipsEnabled: true, now: () => now });
    const shared = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared')), 'independent-90d'), adaptive, authority, () => now);
    return { adaptive, shared, observer: new AdaptiveObserverService(adaptive, observerOptions),
      lifecycle: new AdaptiveLifecycleService(adaptive, { shared }), relationships: new AdaptiveRelationshipService(adaptive) };
  };
  let services = restart();
  const confirm = async (...ids: number[]) => {
    for (const id of ids) await services.adaptive.confirm(id, { confirm: true, adultConfirmed: true });
  };
  const choose = async (id: number, space: SpaceKind, purpose: OptionalPurpose, state: 'granted' | 'declined' | 'withdrawn') => {
    let view = await services.adaptive.read(id, space);
    if (state !== 'withdrawn') {
      const shown = await services.adaptive.present(id, { space, purpose, locale: Object.values(PEOPLE).find(p => p.id === id)!.locale,
        expectedRevision: view.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), deliberateReopen: true });
      return services.adaptive.changeConsent(id, { space, purpose, state, eventId: randomUUID(), receipt: shown.receipt,
        expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision });
    }
    view = await services.adaptive.read(id, space);
    return services.adaptive.changeConsent(id, { space, purpose, state, eventId: randomUUID(), expectedRevision: view.purposes.find(p => p.purpose === purpose)!.revision });
  };
  const agent = async (id: number, space: SpaceKind) => {
    const view = await services.adaptive.read(id, space);
    return services.adaptive.setAgentAccess(id, AGENT, { space, allowed: true, expectedRevision: view.revision, eventId: randomUUID() });
  };
  const save = async (id: number, space: SpaceKind, text: string, eventId = randomUUID()) => services.adaptive.createMemory(id, {
    space, text, eventId, expectedRevision: (await services.adaptive.read(id, space)).revision,
  });
  const publish = async (space: SpaceKind, kind: 'selected' | 'group', recipients: number[], text: string) => {
    const preview = await services.shared.preview(J, { space, kind, recipientTelegramIds: recipients, ...(kind === 'group' ? { groupId: 'launch-room' } : {}) });
    const input = { space, text, eventId: randomUUID(), expectedRevision: 0, previewToken: preview.previewToken, agentIds: [AGENT] };
    const result = await services.shared.create(J, input);
    return { container: result.containers.at(-1)!, input };
  };
  const row = async (id: number, container: SharedContainerView) => (await services.shared.list(id, container.space)).containers.find(c => c.id === container.id)!;
  const response = async (id: number, space: SpaceKind, eventId: string, outcome: 'responded' | 'failed' = 'responded') => {
    const receipt = await services.observer.authorize(id, space, AGENT);
    const input = { eventId, turnId: eventId, space, agentId: AGENT, kind: 'response' as const, channel: 'voice' as const, outcome,
      durationMs: 120, policyReceipt: receipt ?? '0'.repeat(64) };
    return { input, result: await services.observer.recordServer(id, input) };
  };
  return { root, restart, confirm, choose, agent, save, publish, row, response,
    get services() { return services; },
    reboot: () => { services = restart(); }, now: () => now,
    advance: (day: number, offset = 0) => { now = START + (day - 1) * DAY + offset; },
    tick: (ms: number) => { now += ms; }, setMembers: (ids: number[]) => { members = [...ids]; } };
}

const command = (container: SharedContainerView) => ({ space: container.space, expectedRevision: container.revision, eventId: randomUUID() });
async function diskText(directory: string) {
  return (await Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(name => readFile(join(directory, name), 'utf8')))).join('\n');
}

describe('independent people using learning and memory over 90 simulated days', () => {
  it('preserves choices through restart, project departure, in-flight withdrawal and a scoped rights request', async () => {
    const h = await harness();
    await h.confirm(J, M, L);
    for (const id of [J, M, L]) { await h.choose(id, 'work', 'optional.personalization', 'granted'); await h.agent(id, 'work'); }
    await h.choose(J, 'work', 'optional.product_analytics', 'granted');
    for (const space of ['work', 'personal'] as const) await h.choose(M, space, 'optional.product_analytics', 'declined');
    await h.choose(L, 'personal', 'optional.product_analytics', 'granted'); await h.agent(L, 'personal');
    await h.save(J, 'work', 'PRIVATE_WORK_JONAH_CANARY');
    await h.save(J, 'personal', 'PRIVATE_PERSONAL_JONAH_CANARY');
    await h.save(M, 'personal', 'PRIVATE_MINA_CANARY طرح شخصی من');
    await h.save(L, 'work', 'PRIVATE_LEILA_CANARY');
    const selected = await h.publish('work', 'selected', [M], 'Reviewed launch decision: publish the blue version.');
    const group = await h.publish('work', 'group', [], 'جلسهٔ تیم: نسخه آبی، Friday release.');
    const groupContext = await h.services.shared.readContext(J, 'work', AGENT, { audienceTelegramIds: [J, M, L], groupId: 'launch-room' });
    expect(groupContext.memories.map(m => m.text)).toEqual(['جلسهٔ تیم: نسخه آبی، Friday release.']);
    expect(JSON.stringify(groupContext)).not.toMatch(/PRIVATE_/);
    expect((await h.services.shared.list(M, 'personal')).containers).toEqual([]);
    expect((await h.services.shared.list(L, 'work')).containers.some(c => c.id === selected.container.id)).toBe(false);
    const first = await h.response(J, 'work', 'day1-launch-reply'); expect(first.result.recorded).toBe(true);
    await h.services.observer.recordClient(J, { space: 'work', agentId: AGENT, turnId: 'day1-launch-reply', eventId: 'day1-stop-playback', outcome: 'interrupted' });
    expect((await h.response(M, 'work', 'mina-no-analytics')).result.recorded).toBe(false);
    expect((await h.response(M, 'personal', 'mina-private-no-analytics')).result.recorded).toBe(false);
    expect((await h.response(L, 'work', 'leila-work-not-granted')).result.recorded).toBe(false);
    expect((await h.response(J, 'personal', 'jonah-personal-not-granted')).result.recorded).toBe(false);
    expect((await h.response(L, 'personal', 'leila-personal-failure', 'failed')).result.recorded).toBe(true);
    h.reboot(); // New adapters read the accepted queue from actual temporary files.
    expect(await h.services.observer.process(J)).toEqual({ processed: 2, failed: 0 });
    expect(await h.services.observer.process(L)).toEqual({ processed: 1, failed: 0 });
    const finding = await h.services.observer.snapshot(J, 'work');
    expect(finding.findings).toMatchObject([{ rule: 'interruption', inferredCause: null, confidence: 'observation_only' }]);
    expect(finding.completeness).toMatchObject({ complete: false, verifiedTaskSuccess: null, providerUsage: null });
    expect(JSON.stringify(finding)).not.toMatch(/PRIVATE_|blue version|نسخه آبی/);
    expect((await h.services.observer.snapshot(L, 'work')).findings).toEqual([]);
    expect((await h.services.observer.snapshot(L, 'personal')).projection.failed).toBe(1);

    for (let day = 2; day <= 90; day++) {
      h.advance(day);
      // Inactive accounts also receive retention maintenance; no auto-confirmation.
      for (const id of [J, M, L]) await h.services.lifecycle.sweepAccount(id);
      await h.services.lifecycle.sweepShared();
      if (day === 2) {
        await h.confirm(J); await h.response(J, 'work', 'restart-lease', 'failed');
        const entered = barrier(), release = barrier();
        const stale = h.restart({ beforeConsume: async () => { entered.resolve(); await release.promise; } });
        const processing = stale.observer.process(J); await entered.promise;
        h.tick(OBSERVER_LEASE_MS + 1); h.reboot();
        const recovered = await h.services.observer.process(J);
        release.resolve();
        expect(recovered).toEqual({ processed: 1, failed: 0 });
        expect(await processing).toEqual({ processed: 0, failed: 0 });
        expect((await h.services.observer.snapshot(J, 'work')).projection.failed).toBe(1);
      }
      if (day === 3) {
        expect((await h.services.adaptive.read(J, 'work')).identity.confirmed).toBe(false);
        await expect(h.services.lifecycle.exportAccount(J, 'work')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
        expect(await h.services.observer.authorize(J, 'work', AGENT)).toBeNull();
        await h.confirm(J, M, L);
        expect((await h.services.observer.recordServer(J, first.input)).recorded).toBe(false);
        expect((await h.response(J, 'work', 'reconfirmed-reply')).result.recorded).toBe(true);
        await h.services.observer.process(J);
      }
      if (day === 14) {
        await h.confirm(J, M, L); h.setMembers([J, M]);
        // Leila leaves the project; old group history is frozen for every participant.
        for (const id of [J, M, L]) {
          const old = await h.row(id, group.container);
          expect(old.status).toBe('audience_changed'); expect(old.memories).toEqual([]);
        }
        await expect(h.services.shared.readContext(J, 'work', AGENT, { audienceTelegramIds: [J, M, L], groupId: 'launch-room' }))
          .rejects.toMatchObject({ code: 'audience_denied' });
        expect((await h.services.shared.readContext(M, 'work', AGENT, { audienceTelegramIds: [M] })).memories.map(m => m.text))
          .toEqual(['Reviewed launch decision: publish the blue version.']);
        h.setMembers([J, M, L]); // Rejoining must not resurrect the old audience grant.
        expect((await h.row(J, group.container)).memories).toEqual([]);
      }
      if (day === 21) {
        await h.confirm(J, M, L);
        const before = await h.row(M, selected.container);
        await h.services.shared.addMemory(M, before.id, { ...command(before), text: 'MINA_WITHDRAWN_CONTRIBUTION_CANARY' });
        const current = await h.row(J, selected.container);
        await h.services.shared.revokeParticipant(J, current.id, M, { ...command(current), revoked: true });
        expect((await h.services.shared.list(M, 'work')).containers.some(c => c.id === current.id)).toBe(false);
        await expect(h.services.shared.addMemory(M, before.id, { ...command(before), text: 'stale-author-retry' })).rejects.toMatchObject({ code: 'access_denied' });
        expect(await diskText(join(h.root, 'shared'))).not.toContain('MINA_WITHDRAWN_CONTRIBUTION_CANARY');
        const remaining = await h.row(J, selected.container);
        await h.services.shared.deleteMemory(J, remaining.id, remaining.memories[0].id, command(remaining));
        h.reboot();
        const replay = await h.services.shared.create(J, selected.input);
        expect(replay.containers.find(c => c.id === remaining.id)!.memories).toEqual([]);
      }
      if (day === 45) {
        await h.confirm(J, L); const delayed = await h.response(J, 'work', 'withdraw-while-consuming', 'failed');
        expect(delayed.result.recorded).toBe(true);
        const entered = barrier(), release = barrier();
        const worker = h.restart({ beforeConsume: async () => { entered.resolve(); await release.promise; } });
        const processing = worker.observer.process(J); await entered.promise;
        await h.choose(J, 'work', 'optional.product_analytics', 'withdrawn');
        release.resolve(); expect(await processing).toEqual({ processed: 0, failed: 0 });
        h.reboot();
        expect((await h.services.observer.snapshot(J, 'work')).completeness.acceptedEvents).toBe(0);
        expect((await h.services.observer.recordServer(J, delayed.input)).recorded).toBe(false);
        expect((await h.response(L, 'personal', 'leila-still-opted-in')).result.recorded).toBe(true);
        await h.services.observer.process(L);
        const rights = await h.services.lifecycle.exportAccount(J, 'work');
        expect(rights.observerEvents).toEqual([]);
        expect(rights.purposes.find(p => p.purpose === 'optional.product_analytics')!.state).toBe('withdrawn');
        expect(JSON.stringify(rights)).not.toMatch(/PRIVATE_PERSONAL_|PRIVATE_MINA_|PRIVATE_LEILA_|MINA_WITHDRAWN_/);
      }
      if (day === 60) { h.reboot(); await h.confirm(J); expect((await h.response(J, 'work', 'no-accidental-reenrolment')).result.recorded).toBe(false); }
      if (day === 90) {
        await h.confirm(J, M, L);
        await h.save(J, 'work', 'OWN_RECENT_WORK_EXPORT'); await h.save(J, 'personal', 'OWN_RECENT_PERSONAL_EXCLUDED');
        await h.save(M, 'work', 'OTHER_RECENT_WORK_EXCLUDED');
        const exported = await h.services.lifecycle.exportAccount(J, 'work');
        expect(exported.memories.map(m => m.text)).toContain('OWN_RECENT_WORK_EXPORT');
        expect(exported.sharedContributions).toEqual([]);
        expect(JSON.stringify(exported)).not.toMatch(/OWN_RECENT_PERSONAL_EXCLUDED|OTHER_RECENT_WORK_EXCLUDED|MINA_WITHDRAWN_/);
        expect(exported.coverage).toMatchObject({ shared: 'authorized_published_only', providers: 'unavailable', backups: 'unavailable' });
        expect((await h.services.adaptive.read(M, 'work')).purposes.find(p => p.purpose === 'optional.product_analytics')!.state).toBe('declined');
        expect((await h.services.observer.snapshot(L, 'personal')).projection.responseTurns).toBe(0);
      }
    }
    expect(h.now() - START).toBe(89 * DAY);
  }, 30_000);

  it('keeps uncertain mood factual, honors refusal and silence, and rechecks scoped relationship sources after 90 days', async () => {
    const h = await harness(); await h.confirm(M);
    for (const purpose of ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'] as const) await h.choose(M, 'personal', purpose, 'granted');
    await h.agent(M, 'personal');
    const records: Array<{ key: RelationshipKey; text: string; context: string }> = [];
    const assessments: Record<string, Assessment> = {
      'جلسه فردا سخت است. فقط گوش بده، شاید بعدا حرف بزنیم.': { timeZone: 'UTC',
        preferences: [{ key: 'support', value: 'Listen before giving advice' }],
        situations: [{ topic: 'meeting', summary: 'Mina says the meeting may be difficult; current mood is unknown.', status: 'open' }],
        followUp: { topic: 'meeting', purpose: 'Ask whether talking would be useful', dueAt: new Date(START + HOUR).toISOString(),
          timing: { kind: 'ongoing', evidenceQuote: 'فقط گوش بده' } } },
      'خوبم، اما درباره جلسه پیگیری نکن. Please leave that topic.': {
        situations: [{ topic: 'meeting', summary: 'Mina explicitly declined meeting follow-ups.', status: 'closed' }],
      },
      'I am quiet because I am building something; that does not mean I am upset.': {},
      'Please let me initiate every conversation from now on. دیگر خودت شروع نکن.': { control: { action: 'stop' } },
    };
    const factory = () => {
      const candidate = new RelationshipLoop({ store: new FileRelationshipStore(join(h.root, 'relationship.json')), mode: 'live', now: () => new Date(h.now()),
      assessor: { assess: async ({ key, text, context }) => { records.push({ key, text, context }); return structuredClone(assessments[text] ?? {}); } },
      decisions: { choose: async () => 'send' },
      authorize: async input => h.services.relationships.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint),
      applyScopedControl: async (key, action, until) => {
        await h.services.relationships.control(M, key.personaId, 'personal', action, until?.getTime());
        await candidate.control(key, action, { until });
      },
      });
      return candidate;
    };
    let loop = factory();
    const initial = (await h.services.relationships.resolve(M, AGENT, 'personal'))!;
    expect(initial).not.toBeNull();
    const turn = async (id: string, text: string) => {
      const permit = (await h.services.relationships.resolve(M, AGENT, 'personal'))!;
      expect(permit).not.toBeNull();
      const source = (await h.services.relationships.acceptSource(permit, { id, at: h.now(), channel: 'telegram' }))!;
      expect(source).not.toBeNull();
      return loop.observeTurn({ ...permit.key, speakerId: permit.key.audience.kind === 'private' ? permit.key.audience.personId : '', eventId: id,
        text, at: new Date(h.now()), source: 'telegram', authorizationFingerprint: permit.fingerprint, sourceReceipt: source });
    };
    await turn('mina-meeting', 'جلسه فردا سخت است. فقط گوش بده، شاید بعدا حرف بزنیم.');
    expect((await loop.status(initial.key)).intentions[0].status).toBe('pending');
    h.tick(30 * 60_000);
    await turn('mina-boundary', 'خوبم، اما درباره جلسه پیگیری نکن. Please leave that topic.');
    h.tick(HOUR); loop = factory(); // Restart before the unwanted follow-up could run.
    const sends: string[] = [];
    const drain = () => loop.drain({ authorize: async job => !!await h.services.relationships.authorize(job.key, job.sourceIds, 'inbox'),
      loadContext: async job => loop.context(job.key), compose: async () => 'Would you like to talk?', send: async (_job, text) => { sends.push(text); return 'synthetic-only'; } });
    expect((await drain()).sent).toBe(0);
    expect((await loop.status(initial.key)).situations[0].status).toBe('closed');
    expect(await loop.context(initial.key)).toContain('Listen before giving advice');
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE_|Jonah|Leila|depressed|angry/);
    const callsBeforeSilence = records.length;
    for (const day of [2, 7, 14]) { h.advance(day); await drain(); }
    expect(records).toHaveLength(callsBeforeSilence); expect(sends).toEqual([]);
    h.advance(15); await h.confirm(M);
    await turn('mina-returns', 'I am quiet because I am building something; that does not mean I am upset.');
    await turn('mina-global-boundary', 'Please let me initiate every conversation from now on. دیگر خودت شروع نکن.');
    expect((await loop.status(initial.key)).disabled).toBe(true);
    h.advance(31); await h.confirm(M); h.reboot(); loop = factory();
    expect(await h.services.relationships.authorize(initial.key, ['mina-meeting'], 'context')).toBeNull();
    expect((await h.services.adaptive.read(M, 'personal')).purposes.find(p => p.purpose === 'optional.auto_memory')!.state).toBe('reconsent_required');
    await h.choose(M, 'personal', 'optional.auto_memory', 'granted');
    const renewed = (await h.services.relationships.resolve(M, AGENT, 'personal'))!;
    expect(renewed.key.scope!.bindingId).not.toBe(initial.key.scope!.bindingId);
    expect(await h.services.relationships.acceptSource(renewed, { id: 'stopped-after-renewal', at: h.now(), channel: 'telegram' })).toBeNull();
    h.advance(90); await h.services.lifecycle.sweepAccount(M); await h.confirm(M);
    expect((await h.services.lifecycle.exportAccount(M, 'personal')).checkIns).toEqual([]);
    expect((await h.services.observer.snapshot(M, 'personal')).available).toBe(false);
    expect(sends).toEqual([]);
  });
});
