import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createConnectionsCatalog } from '../catalog';
import type { ConnectionContext } from '../contracts';
import { ConnectionsRepository } from '../repository';
import { ConnectionsService } from '../service';
import { InMemoryConnectionsStorage } from '../storage';
import { ConnectionsWorkflowService } from '../workflows/service';
import { verifyProviderEvent } from '../events/verification';

const NOW = Date.parse('2026-10-19T08:00:00Z');
const SECRET = new Uint8Array(32).fill(58);
async function fixture(providerDestination = true) {
  let time = NOW; const actor = { accountId: 'qa-workflow-account' };
  const context: ConnectionContext = { ...actor, personId: 'qa-person', bindingId: 'qa-binding', bindingRevision: 1, bindingExpiresAt: NOW + 7_200_000,
    currentAgentIds: ['qa-agent'], scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work', containerId: 'qa-private',
      audiencePersonIds: ['qa-person'], audienceRevision: 'qa-audience' } };
  const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'github.issue.get': ['github:repo:qa/fixture'], 'github.repository.get': ['github:repo:qa/fixture'] },
    destinationIds: ['vox:private', 'model:studio', 'provider:github'] });
  const core = new ConnectionsService(new ConnectionsRepository(new InMemoryConnectionsStorage()), { catalog, resolveContext: async () => context, now: () => time });
  const connection = (await core.enroll(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic workflow GitHub' })).connections[0];
  await core.completeEnrollment(actor, { space: 'work', connectionId: connection.id, expectedRevision: 1, issuer: 'https://github.com',
    providerSubject: 'qa-subject', providerTenantId: '999', providerScopes: ['issues:read'], displayLabel: 'Synthetic QA' });
  const grant = (await core.grant(actor, { space: 'work', connectionId: connection.id, expectedRevision: 2, agentId: 'qa-agent',
    toolIds: ['github.issue.get', 'github.repository.get'], resourceIds: ['github:repo:qa/fixture'], destinationIds: ['vox:private', 'model:studio', ...(providerDestination ? ['provider:github'] : [])],
    effects: ['read'], expiresAt: NOW + 7_200_000, maxCalls: 10, maxBytes: 64_000 })).grants[0];
  const outbound: unknown[] = [];
  const dispatcher = vi.fn(async (_actor, _space, operationId: string) => {
    const input = { space: 'work' as const, operationId, workerId: 'qa-workflow-worker', leaseMs: 1000 };
    const claimed = await core.operations.claim(actor, input); const lease = { ...input, fence: claimed.fence };
    await core.operations.markDispatched(actor, lease); outbound.push(structuredClone(claimed.arguments));
    const receipt = await core.operations.settle(actor, { ...lease, outcome: 'committed' });
    return { receipt, output: { body: 'WORKFLOW_RESULT_CANARY_MUST_NOT_PERSIST' } };
  });
  const readback = vi.fn(async () => ({ matches: true, revision: 'qa-native-revision' }));
  const service = new ConnectionsWorkflowService(core, { dispatcher, readback, now: () => time });
  const input = { space: 'work', name: 'QA periodic read', agentId: 'qa-agent', connectionId: connection.id, grantId: grant.id,
    skillId: 'engineering-triage', skillVersion: 1, steps: [{ toolId: 'github.issue.get', arguments: { owner: 'qa', repository: 'fixture', number: 1 } }],
    schedule: { kind: 'interval', minutes: 15 }, timezone: 'Europe/Tallinn', quietHours: null, expiresAt: NOW + 1_800_000, maxRuns: 2, maxCalls: 2 };
  const active = async (overrides: Record<string, unknown> = {}) => {
    const draft = await service.create(actor, { ...input, ...overrides });
    return service.review(actor, { space: 'work', workflowId: draft.id, expectedRevision: draft.revision, reviewDigest: draft.reviewDigest });
  };
  const subscription = (providerTenantId = '321') => service.registerSubscription(actor, { space: 'work', connectionId: connection.id, providerId: 'github',
    providerTenantId, nativeResourceId: '123', resourceId: 'github:repo:qa/fixture', eventTypes: ['issues'],
    secretRef: 'SYNTHETIC_OPAQUE_SECRET_REFERENCE', secretVersion: 1, expiresAt: NOW + 1_800_000 });
  const githubEvent = (subscriptionValue: Awaited<ReturnType<typeof subscription>>, overrides: Record<string, unknown> = {}, delivery = 'qa-delivery') => {
    const body = { repository: { id: 123, owner: { id: 321 } },
      issue: { updated_at: new Date(time).toISOString(), body: 'UNTRUSTED_EVENT_BODY_CANARY' }, ...overrides };
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const headers = { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(bytes).digest('hex'),
      'x-github-delivery': delivery, 'x-github-event': 'issues' };
    return { event: verifyProviderEvent(bytes, headers, subscriptionValue, SECRET, time), bytes, headers };
  };
  return { actor, context, core, service, grant, connection, dispatcher, readback, outbound, input, active, subscription, githubEvent,
    advance: (ms: number) => { time += ms; } };
}

describe('independent reviewed read-only workflows and signed event boundary', () => {
  it('does not activate a draft or run it without the exact review digest/revision', async () => {
    const f = await fixture(); const draft = await f.service.create(f.actor, f.input); f.advance(15 * 60_000);
    expect((await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 })).occurrences).toEqual([]);
    await expect(f.service.review(f.actor, { space: 'work', workflowId: draft.id, expectedRevision: draft.revision, reviewDigest: 'wrong-preview' }))
      .rejects.toMatchObject({ code: 'workflow_review_stale' });
    expect(f.outbound).toEqual([]);
  });

  it('reserves an interval occurrence once across concurrent drains and discards provider result bytes', async () => {
    const f = await fixture(); await f.active(); f.advance(15 * 60_000);
    await Promise.all([f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 }), f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 })]);
    expect(f.dispatcher).toHaveBeenCalledTimes(1); expect(f.outbound).toHaveLength(1);
    expect((await f.service.list(f.actor, 'work')).occurrences).toHaveLength(1);
    expect(JSON.stringify(await f.core.repository.transaction(f.context, rows => rows))).not.toContain('WORKFLOW_RESULT_CANARY_MUST_NOT_PERSIST');
  });

  it('cannot use a private-only destination grant to transmit scheduled arguments to a provider', async () => {
    const f = await fixture(false);
    await expect(f.active()).rejects.toThrow(); expect(f.dispatcher).not.toHaveBeenCalled();
  });

  it('rejects effectful workflows and arbitrary persisted content', async () => {
    const f = await fixture();
    await expect(f.active({ steps: [{ toolId: 'github.issue.create', arguments: { owner: 'qa', repository: 'fixture', title: 'Never send', body: 'Private' } }] }))
      .rejects.toMatchObject({ code: 'workflow_effect_unavailable' });
    await expect(f.active({ steps: [{ toolId: 'github.issue.get', arguments: { owner: 'qa', repository: 'fixture', number: 1, query: 'private data' } }] })).rejects.toThrow();
    expect(f.outbound).toEqual([]);
  });

  it('quiet hours and paused status suppress scheduled dispatch', async () => {
    const f = await fixture(); await f.active({ quietHours: { startHour: 11, endHour: 12 }, expiresAt: NOW + 90 * 60_000 }); f.advance(15 * 60_000);
    expect((await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 })).occurrences).toEqual([]);
    expect(f.outbound).toEqual([]);
  });

  it('revoked connection/agent authority cannot be resumed by a stored reviewed schedule', async () => {
    const f = await fixture(); await f.active(); f.advance(15 * 60_000); f.context.currentAgentIds = [];
    expect(await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 })).toEqual({ occurrences: [], quiet: true });
    expect((await f.service.list(f.actor, 'work')).workflows[0].status).toBe('paused');
    expect(f.outbound).toEqual([]);
  });

  it('signed provider events carry minimized metadata, deduplicate altered delivery IDs and grant no direct action', async () => {
    const f = await fixture(); const sub = await f.subscription(); const first = f.githubEvent(sub);
    expect(JSON.stringify(first.event)).not.toContain('UNTRUSTED_EVENT_BODY_CANARY');
    const accepted = await f.service.acceptVerifiedEvent(f.actor, 'work', first.event);
    const replay = f.githubEvent(sub, {}, 'qa-delivery-relabelled');
    expect(await f.service.acceptVerifiedEvent(f.actor, 'work', replay.event)).toMatchObject({ duplicate: true, eventId: accepted.eventId });
    expect(f.outbound).toEqual([]);
    expect(JSON.stringify(await f.service.list(f.actor, 'work'))).not.toContain('SYNTHETIC_OPAQUE_SECRET_REFERENCE');
  });

  it('valid signatures cannot substitute another native tenant/resource or use stale/tampered body bytes', async () => {
    const f = await fixture(); const sub = await f.subscription(); const good = f.githubEvent(sub);
    expect(() => f.githubEvent(sub, { repository: { id: 123, owner: { id: 888 } } })).toThrow('event_scope_or_replay_denied');
    expect(() => f.githubEvent(sub, { repository: { id: 456, owner: { id: 321 } } })).toThrow('event_scope_or_replay_denied');
    expect(() => verifyProviderEvent(new TextEncoder().encode('{}'), good.headers, sub, SECRET, NOW)).toThrow('event_signature_denied');
    expect(() => verifyProviderEvent(good.bytes, good.headers, sub, SECRET, NOW + 300_001)).toThrow('event_scope_or_replay_denied');
  });

  it('an App installation ID cannot be mistaken for a verified repository-owner audience contract', async () => {
    const f = await fixture(); const sub = await f.subscription();
    expect(() => f.githubEvent(sub, { installation: { id: 999 } })).toThrow('event_installation_qualification_required');
    expect(f.outbound).toEqual([]);
  });

  it('refuses a schedule whose first eligible read cannot occur before its authorization expires', async () => {
    const f = await fixture();
    await expect(f.active({ schedule: { kind: 'interval', minutes: 60 }, expiresAt: NOW + 30 * 60_000 }))
      .rejects.toMatchObject({ code: 'workflow_no_eligible_time' });
    await expect(f.active({ quietHours: { startHour: 0, endHour: 23 }, expiresAt: NOW + 30 * 60_000 }))
      .rejects.toMatchObject({ code: 'workflow_no_eligible_time' });
  });

  it('event-based work requires a fresh native readback before dispatch and cannot persist event source content', async () => {
    const f = await fixture(); const sub = await f.subscription();
    await f.active({ schedule: { kind: 'event', subscriptionId: sub.id }, steps: [{ toolId: 'github.repository.get', arguments: { owner: 'qa', repository: 'fixture' } }] });
    await f.service.acceptVerifiedEvent(f.actor, 'work', f.githubEvent(sub).event);
    f.readback.mockResolvedValueOnce({ matches: false, revision: 'qa-native-moved' });
    const drained = await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 });
    expect(drained.occurrences[0]).toMatchObject({ state: 'failed', safeReason: 'native_readback_mismatch' });
    expect(f.outbound).toEqual([]);
  });

  it('pause during native readback prevents later occurrence dispatch', async () => {
    const f = await fixture(); const sub = await f.subscription(); const workflow = await f.active({ schedule: { kind: 'event', subscriptionId: sub.id },
      steps: [{ toolId: 'github.repository.get', arguments: { owner: 'qa', repository: 'fixture' } }] });
    await f.service.acceptVerifiedEvent(f.actor, 'work', f.githubEvent(sub).event);
    f.readback.mockImplementationOnce(async () => {
      await f.service.pause(f.actor, { space: 'work', workflowId: workflow.id, expectedRevision: workflow.revision });
      return { matches: true, revision: 'qa-native-revision' };
    });
    const drained = await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 });
    expect(drained.occurrences[0].state).toBe('failed'); expect(f.outbound).toEqual([]);
  });

  it.each([true, false])('native fallback permits subsequent reviewed steps only after matching native proof: %s', async matches => {
    const f = await fixture(); const sub = await f.subscription('321');
    delete f.service.options.readback;
    await f.active({ schedule: { kind: 'event', subscriptionId: sub.id }, maxCalls: 2,
      steps: [{ toolId: 'github.repository.get', arguments: { owner: 'qa', repository: 'fixture' } },
        { toolId: 'github.issue.get', arguments: { owner: 'qa', repository: 'fixture', number: 1 } }] });
    await f.service.acceptVerifiedEvent(f.actor, 'work', f.githubEvent(sub, { installation: undefined }).event);
    const original = f.dispatcher.getMockImplementation()!; let step = 0;
    f.dispatcher.mockImplementation(async (...args) => {
      const result = await original(...args); step++;
      return step === 1 ? { ...result, output: { ...result.output, nativeEvidence: { providerId: 'github', providerTenantId: matches ? '321' : '999',
        nativeResourceId: '123', resourceIds: ['github:repo:qa/fixture'], revision: 'qa-native-current' } } } : result;
    });
    const drained = await f.service.drain(f.actor, { space: 'work', maxOccurrences: 2 });
    expect(drained.occurrences[0].state).toBe(matches ? 'complete' : 'failed');
    expect(f.dispatcher).toHaveBeenCalledTimes(matches ? 2 : 1);
    expect(JSON.stringify(await f.core.repository.transaction(f.context, rows => rows))).not.toContain('WORKFLOW_RESULT_CANARY_MUST_NOT_PERSIST');
  });
});
