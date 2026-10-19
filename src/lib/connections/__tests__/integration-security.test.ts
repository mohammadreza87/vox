import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ConnectionContext, ConnectionsCatalog, ReviewedTool, SourceLabel } from '../contracts';
import { ConnectionsRepository } from '../repository';
import { FileConnectionsStorage, InMemoryConnectionsStorage, type ConnectionsStorage } from '../storage';
import { baseRecord, ConnectionsService } from '../service';

/** Independent synthetic catalog: no production adapter, account, token or network. */
const NOW = 1_800_000_000_000;
const argumentSchema = z.object({ resourceId: z.enum(['selected', 'unselected']), text: z.string().max(1000) }).strict();
const read: ReviewedTool = { id: 'qa.read', version: '1', providerId: 'qa', adapterId: 'qa-adapter', adapterVersion: '1',
  catalogDigest: 'qa-catalog-v1', schemaDigest: 'qa-read-v1', effect: 'read', retryClass: 'safe_read',
  maxInputBytes: 4096, maxOutputBytes: 4096, timeoutMs: 1000,
  resourceIds: ['selected', 'unselected'], destinationIds: ['qa-private', 'qa-public'] };
const send: ReviewedTool = { ...read, id: 'qa.send', schemaDigest: 'qa-send-v1', effect: 'send', retryClass: 'reconcile_only' };
const catalog: ConnectionsCatalog = {
  get: id => [read, send].find(tool => tool.id === id),
  provider: id => id === 'qa' ? { adapterId: 'qa-adapter', adapterVersion: '1', catalogDigest: 'qa-catalog-v1', endpointProfileId: 'qa-no-network' } : undefined,
  validateArguments: (_id, value) => argumentSchema.parse(value),
  mapResources: (_id, args) => [String(args.resourceId)],
};

async function fixture(storage: ConnectionsStorage = new InMemoryConnectionsStorage()) {
  let time = NOW;
  const contexts = new Map<string, ConnectionContext>();
  const alice = { accountId: 'telegram-account:1001' };
  const context: ConnectionContext = { ...alice, personId: 'person:alice', bindingId: 'qa-binding', bindingRevision: 1,
    bindingExpiresAt: NOW + 86_400_000, currentAgentIds: ['agent-original', 'agent-successor'],
    scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work', containerId: 'qa-private-container',
      audiencePersonIds: ['person:alice'], audienceRevision: 'qa-audience-v1' } };
  contexts.set(`${alice.accountId}:work`, context);
  const repository = new ConnectionsRepository(storage);
  const options = { catalog, now: () => time,
    resolveContext: async (actor: { accountId: string }, space: 'work' | 'personal') => contexts.get(`${actor.accountId}:${space}`) };
  const service = new ConnectionsService(repository, options);
  const enrolled = await service.enroll(alice, { space: 'work', providerId: 'qa', displayLabel: 'Synthetic QA account' });
  const pending = enrolled.connections[0];
  await service.completeEnrollment(alice, { space: 'work', connectionId: pending.id, expectedRevision: pending.revision,
    issuer: 'https://qa.example.invalid', providerSubject: 'qa-external-subject', providerTenantId: 'qa-external-tenant',
    providerScopes: ['qa-scoped'], displayLabel: 'QA verified account' });
  const connected = (await service.list(alice, { space: 'work' })).connections[0];
  const grantInput = { space: 'work', connectionId: connected.id, expectedRevision: connected.revision,
    agentId: 'agent-original', toolIds: ['qa.read', 'qa.send'], resourceIds: ['selected'],
    destinationIds: ['qa-private', 'qa-public'], effects: ['read', 'send'], expiresAt: NOW + 60_000, maxCalls: 20, maxBytes: 4096 };
  const assign = async () => (await service.grant(alice, grantInput)).grants[0];
  const proposal = (grantId: string, overrides: Record<string, unknown> = {}) => ({ space: 'work', requestId: 'qa-request',
    idempotencyKey: 'qa-idempotency', connectionId: connected.id, grantId, agentId: 'agent-original', toolId: 'qa.read',
    arguments: { resourceId: 'selected', text: 'Synthetic request' }, destinationId: 'qa-private', expectedTargetRevision: null,
    sourceIds: [], retention: 'retained', deadlineAt: NOW + 30_000, ...overrides });
  const seedSource = async (grantId: string, overrides: Partial<SourceLabel> = {}) => {
    const source: SourceLabel = { ...baseRecord(context, time), connectionId: connected.id, connectionEpoch: connected.revocationEpoch,
      grantId, grantRevision: 1, resourceId: 'selected', resourceRevision: 'qa-source-v1', allowedAgentIds: ['agent-original'],
      allowedPersonIds: ['person:alice'], allowedDestinationIds: ['qa-private'], allowedPurposes: ['explicit.connection_task'],
      sensitivity: 'private', expiresAt: NOW + 60_000, persist: false, status: 'active', parentSourceIds: [], ...overrides };
    await repository.transaction(context, records => { records.sources.push(source); });
    return source;
  };
  return { alice, context, contexts, repository, storage, options, service, connected, grantInput, assign, proposal, seedSource,
    advance: (ms: number) => { time += ms; } };
}

describe('independent Connections security integration (synthetic accounts only)', () => {
  it('verified enrollment creates zero grants and safe views omit provider identity and payloads', async () => {
    const f = await fixture();
    const state = await f.service.list(f.alice, { space: 'work' });
    expect(state.connections[0].lifecycle).toBe('connected');
    expect(state.grants).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('qa-external-subject');
    expect(JSON.stringify(state)).not.toContain('qa-external-tenant');
    await expect(f.service.propose(f.alice, f.proposal('invented-grant'))).rejects.toMatchObject({ code: 'connection_unavailable' });
  });

  it('refuses request-controlled scope/identity fields instead of allowing a management-role shortcut', async () => {
    const f = await fixture();
    await expect(f.service.grant(f.alice, { ...f.grantInput, ownerPersonId: 'person:bob', role: 'owner' })).rejects.toThrow();
    const state = await f.service.list(f.alice, { space: 'work' });
    expect(state.grants).toHaveLength(0);
  });

  it('isolates another verified account even when it knows the connection and grant IDs', async () => {
    const f = await fixture(); const grant = await f.assign();
    const bob = { accountId: 'telegram-account:1002' };
    f.contexts.set(`${bob.accountId}:work`, { ...f.context, ...bob, personId: 'person:bob', bindingId: 'qa-bob-binding',
      scope: { ...f.context.scope, audiencePersonIds: ['person:bob'] } });
    expect((await f.service.list(bob, { space: 'work' })).connections).toEqual([]);
    await expect(f.service.propose(bob, f.proposal(grant.id))).rejects.toMatchObject({ code: 'connection_unavailable' });
    await expect(f.service.revoke(bob, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision }))
      .rejects.toMatchObject({ code: 'connection_unavailable' });
  });

  it.each(['tenantId', 'spaceId', 'containerId'] as const)('does not reuse records after trusted %s changes', async field => {
    const f = await fixture(); const grant = await f.assign();
    f.context.scope[field] = `another-${field}`;
    await expect(f.service.propose(f.alice, f.proposal(grant.id))).rejects.toMatchObject({ code: 'corrupt_partition' });
  });

  it('keeps Personal and Work partitioned even for the same verified person', async () => {
    const f = await fixture(); const grant = await f.assign();
    f.contexts.set(`${f.alice.accountId}:personal`, { ...f.context, scope: { ...f.context.scope,
      spaceId: 'qa-personal', spaceKind: 'personal', containerId: 'qa-personal-container' } });
    expect((await f.service.list(f.alice, { space: 'personal' })).connections).toEqual([]);
    await expect(f.service.propose(f.alice, { ...f.proposal(grant.id), space: 'personal' }))
      .rejects.toMatchObject({ code: 'connection_unavailable' });
  });

  it('does not inherit grants for a successor agent or after the original agent is fired', async () => {
    const f = await fixture(); const grant = await f.assign();
    await expect(f.service.propose(f.alice, f.proposal(grant.id, { agentId: 'agent-successor' })))
      .rejects.toMatchObject({ code: 'grant_denied' });
    f.context.currentAgentIds = ['agent-successor'];
    await expect(f.service.propose(f.alice, f.proposal(grant.id))).rejects.toMatchObject({ code: 'grant_denied' });
  });

  it('denies unknown/group audiences and old person bindings before operation creation', async () => {
    const f = await fixture(); const grant = await f.assign();
    f.context.scope.audiencePersonIds.push('person:unknown-listener');
    await expect(f.service.propose(f.alice, f.proposal(grant.id))).rejects.toMatchObject({ code: 'unsupported_audience' });
    f.context.scope.audiencePersonIds.pop(); f.context.bindingRevision++;
    await expect(f.service.propose(f.alice, f.proposal(grant.id))).rejects.toMatchObject({ code: 'grant_denied' });
  });

  it('maps exact resources in code and rejects unknown schema fields or unselected resources', async () => {
    const f = await fixture(); const grant = await f.assign();
    await expect(f.service.propose(f.alice, f.proposal(grant.id, { arguments: { resourceId: 'unselected', text: 'request' } })))
      .rejects.toMatchObject({ code: 'grant_denied' });
    await expect(f.service.propose(f.alice, f.proposal(grant.id, { arguments: { resourceId: 'selected', text: 'request', callbackUrl: 'https://exfil.example.invalid' } })))
      .rejects.toThrow();
    expect((await f.service.list(f.alice, { space: 'work' })).operations).toEqual([]);
  });

  it.each(['PRIVATE_QA_CANARY_449', 'A paraphrase and aggregate which contains no matching canary bytes'])
    ('blocks source-to-public read-query laundering by source policy: %s', async text => {
      const f = await fixture(); const grant = await f.assign(); const source = await f.seedSource(grant.id);
      await expect(f.service.propose(f.alice, f.proposal(grant.id, { destinationId: 'qa-public', retention: 'ephemeral',
        sourceIds: [source.id], arguments: { resourceId: 'selected', text } })))
        .rejects.toMatchObject({ code: 'source_disclosure_denied' });
      expect((await f.service.list(f.alice, { space: 'work' })).operations).toEqual([]);
    });

  it('does not persist a source labeled for ephemeral use', async () => {
    const f = await fixture(); const grant = await f.assign(); const source = await f.seedSource(grant.id);
    await expect(f.service.propose(f.alice, f.proposal(grant.id, { sourceIds: [source.id] })))
      .rejects.toMatchObject({ code: 'source_disclosure_denied' });
    expect((await f.repository.transaction(f.context, records => records.payloads))).toEqual([]);
  });

  it('requires an exact preview digest and revision for external sending; duplicate approval is rejected', async () => {
    const f = await fixture(); const grant = await f.assign();
    const operation = await f.service.propose(f.alice, f.proposal(grant.id, { toolId: 'qa.send', expectedTargetRevision: 'target-v1' }));
    expect(operation.state).toBe('needs_approval');
    const approval = { space: 'work', operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest };
    await expect(f.service.approve(f.alice, { ...approval, proposalDigest: 'changed-preview' })).rejects.toMatchObject({ code: 'approval_stale' });
    await expect(f.service.approve(f.alice, { ...approval, expectedRevision: operation.revision + 1 })).rejects.toMatchObject({ code: 'approval_stale' });
    expect((await f.service.approve(f.alice, approval)).state).toBe('queued');
    await expect(f.service.approve(f.alice, approval)).rejects.toMatchObject({ code: 'approval_stale' });
  });

  it('atomically deduplicates concurrent identical intents and denies changed payloads under the same key', async () => {
    const f = await fixture(); const grant = await f.assign();
    const input = f.proposal(grant.id);
    const receipts = await Promise.all(Array.from({ length: 8 }, () => f.service.propose(f.alice, input)));
    expect(new Set(receipts.map(r => r.operationId)).size).toBe(1);
    const records = await f.repository.transaction(f.context, rows => rows);
    expect(records.operations).toHaveLength(1); expect(records.payloads).toHaveLength(1); expect(records.outbox).toHaveLength(1);
    expect(records.grants[0].callsReserved).toBe(1);
    await expect(f.service.propose(f.alice, { ...input, arguments: { resourceId: 'selected', text: 'changed target content' } }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('rechecks expiry and current identity on approval instead of trusting the stored proposal', async () => {
    const f = await fixture(); const grant = await f.assign();
    const operation = await f.service.propose(f.alice, f.proposal(grant.id, { toolId: 'qa.send' }));
    f.advance(31_000);
    await expect(f.service.approve(f.alice, { space: 'work', operationId: operation.operationId,
      expectedRevision: operation.revision, proposalDigest: operation.proposalDigest })).rejects.toMatchObject({ code: 'operation_stale' });
  });

  it('revoke cancels queued work, deletes retained payloads, suppresses sources and leaves tombstones', async () => {
    const f = await fixture(); const grant = await f.assign(); const source = await f.seedSource(grant.id, { persist: true });
    const operation = await f.service.propose(f.alice, f.proposal(grant.id, { sourceIds: [source.id] }));
    const revoked = await f.service.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
    expect(revoked.connections[0].lifecycle).toBe('revoked'); expect(revoked.grants).toEqual([]);
    expect(revoked.operations.find(o => o.operationId === operation.operationId)?.state).toBe('cancelled');
    const records = await f.repository.transaction(f.context, rows => rows);
    expect(records.payloads).toEqual([]); expect(records.sources[0].status).toBe('suppressed');
    expect(records.tombstones).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'disconnect', providerRevocation: 'pending', purge: 'pending' })]));
    await expect(f.service.propose(f.alice, f.proposal(grant.id, { requestId: 'replay', idempotencyKey: 'replay' })))
      .rejects.toMatchObject({ code: 'grant_denied' });
  });

  it('reconstructed service retains policy and idempotency state without pretending to test process durability', async () => {
    const f = await fixture(); const grant = await f.assign(); const input = f.proposal(grant.id);
    const first = await f.service.propose(f.alice, input);
    const reconstructed = new ConnectionsService(new ConnectionsRepository(f.storage), f.options);
    expect((await reconstructed.propose(f.alice, input)).operationId).toBe(first.operationId);
    await reconstructed.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
    await expect(f.service.preview(f.alice, { space: 'work', operationId: first.operationId, expectedRevision: 2 }))
      .rejects.toThrow();
  });

  it('runs the synthetic broker sequence and permits only a currently authorized verified result', async () => {
    const f = await fixture(); const grant = await f.assign();
    const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const claim = await f.service.operations.claim(f.alice, { space: 'work', operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 });
    const lease = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', fence: claim.fence };
    const capturedOutbound: unknown[] = [];
    await f.service.operations.markDispatched(f.alice, lease);
    // This is the only fixture transmission seam; no production provider is contacted.
    capturedOutbound.push(structuredClone(claim.arguments));
    const settled = await f.service.operations.settle(f.alice, { ...lease, outcome: 'verified', providerReceiptRef: 'qa-provider-receipt' });
    expect(settled.state).toBe('verified'); expect(capturedOutbound).toEqual([{ resourceId: 'selected', text: 'Synthetic request' }]);
    await expect(f.service.operations.assertUsable(f.alice, 'work', operation.operationId)).resolves.toBeUndefined();
    await expect(f.service.operations.claim(f.alice, { ...lease, leaseMs: 1000 })).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
  });

  it('allows one worker to claim approved sending and consumes exact approval only at transmission', async () => {
    const f = await fixture(); const grant = await f.assign();
    const operation = await f.service.propose(f.alice, f.proposal(grant.id, { toolId: 'qa.send' }));
    const claimInput = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    await expect(f.service.operations.claim(f.alice, claimInput)).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
    await f.service.approve(f.alice, { space: 'work', operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest });
    const attempts = await Promise.allSettled([f.service.operations.claim(f.alice, claimInput),
      f.service.operations.claim(f.alice, { ...claimInput, workerId: 'qa-worker-2' })]);
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    const claimed = attempts[0]; expect(claimed.status).toBe('fulfilled');
    if (claimed.status !== 'fulfilled') throw new Error('First claim must own the serialized fixture lease');
    expect((await f.repository.transaction(f.context, rows => rows.approvals))[0].consumedAt).toBeNull();
    const lease = { ...claimInput, fence: claimed.value.fence };
    await f.service.operations.markDispatched(f.alice, lease);
    expect((await f.repository.transaction(f.context, rows => rows.approvals))[0].consumedAt).toBe(NOW);
    await expect(f.service.operations.markDispatched(f.alice, lease)).rejects.toMatchObject({ code: 'operation_already_dispatched' });
  });

  it('fences a stale worker after lease takeover before provider dispatch', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const input = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-old', leaseMs: 100 };
    const old = await f.service.operations.claim(f.alice, input); f.advance(101);
    const next = await f.service.operations.claim(f.alice, { ...input, workerId: 'qa-new' });
    expect(next.fence).toBeGreaterThan(old.fence);
    await expect(f.service.operations.markDispatched(f.alice, { ...input, fence: old.fence }))
      .rejects.toMatchObject({ code: 'stale_worker_fence' });
  });

  it('rechecks membership after claim and before transmission', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const input = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, input);
    f.context.currentAgentIds = [];
    const outbound: unknown[] = [];
    await expect((async () => { await f.service.operations.markDispatched(f.alice, { ...input, fence: claim.fence }); outbound.push(claim.arguments); })())
      .rejects.toMatchObject({ code: 'grant_denied' });
    expect(outbound).toEqual([]);
  });

  it('blocks a revoked claimed operation before the fixture transmission seam', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const input = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, input);
    await f.service.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
    const outbound: unknown[] = [];
    await expect((async () => { await f.service.operations.markDispatched(f.alice, { ...input, fence: claim.fence }); outbound.push(claim.arguments); })())
      .rejects.toMatchObject({ code: 'stale_worker_fence' });
    expect(outbound).toEqual([]);
  });

  it('revocation during sending preserves uncertainty and denies late settlement or result delivery', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const input = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, input); const lease = { ...input, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease);
    const revoked = await f.service.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
    expect(revoked.operations[0].state).toBe('outcome_unknown');
    await expect(f.service.operations.settle(f.alice, { ...lease, outcome: 'verified', providerReceiptRef: 'qa-late-receipt' }))
      .rejects.toMatchObject({ code: 'stale_worker_fence' });
    await expect(f.service.operations.assertUsable(f.alice, 'work', operation.operationId)).rejects.toMatchObject({ code: 'result_unavailable' });
  });

  it('unknown external outcomes remain unknown on duplicate request, reconstructed service and claim attempts', async () => {
    const f = await fixture(); const grant = await f.assign(); const input = f.proposal(grant.id, { toolId: 'qa.send' });
    const operation = await f.service.propose(f.alice, input);
    await f.service.approve(f.alice, { space: 'work', operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest });
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, worker); const lease = { ...worker, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease);
    await f.service.operations.settle(f.alice, { ...lease, outcome: 'outcome_unknown' });
    const reconstructed = new ConnectionsService(new ConnectionsRepository(f.storage), f.options);
    expect((await reconstructed.propose(f.alice, input)).state).toBe('outcome_unknown');
    await expect(reconstructed.operations.claim(f.alice, worker)).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
    await expect(reconstructed.operations.assertUsable(f.alice, 'work', operation.operationId)).rejects.toMatchObject({ code: 'result_unavailable' });
    expect((await f.repository.transaction(f.context, rows => rows.attempts.filter(a => a.phase === 'dispatched')))).toHaveLength(1);
  });

  it('recovers an expired sending lease as unknown without redispatch, even for a read', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 100 };
    const claim = await f.service.operations.claim(f.alice, worker);
    await f.service.operations.markDispatched(f.alice, { ...worker, fence: claim.fence }); f.advance(101);
    const recovered = await f.service.operations.recover(f.alice, 'work');
    expect(recovered).toEqual([expect.objectContaining({ state: 'outcome_unknown', safeReason: 'lease_lost_after_possible_dispatch' })]);
    await expect(f.service.operations.claim(f.alice, worker)).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
  });

  it('ephemeral argument bytes never enter durable fixture records and loss cannot reconstruct dispatch', async () => {
    const f = await fixture(); const grant = await f.assign(); const canary = 'EPHEMERAL_QA_CANARY_834';
    const operation = await f.service.propose(f.alice, f.proposal(grant.id, { retention: 'ephemeral', arguments: { resourceId: 'selected', text: canary } }));
    const records = await f.repository.transaction(f.context, rows => rows);
    expect(records.payloads).toEqual([]); expect(records.outbox).toEqual([]); expect(JSON.stringify(records)).not.toContain(canary);
    const reconstructed = new ConnectionsService(new ConnectionsRepository(f.storage), f.options);
    await expect(reconstructed.operations.claim(f.alice, { space: 'work', operationId: operation.operationId, workerId: 'qa-restarted', leaseMs: 1000 }))
      .rejects.toMatchObject({ code: 'ephemeral_payload_unavailable' });
    expect(await reconstructed.operations.recover(f.alice, 'work')).toEqual([expect.objectContaining({ state: 'expired', safeReason: 'ephemeral_payload_lost' })]);
  });

  it('a completed private read loses delivery authority immediately when its agent is fired', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, worker); const lease = { ...worker, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease);
    await f.service.operations.settle(f.alice, { ...lease, outcome: 'verified' });
    f.context.currentAgentIds = [];
    await expect(f.service.operations.assertUsable(f.alice, 'work', operation.operationId)).rejects.toMatchObject({ code: 'grant_denied' });
  });

  it('trusted generation context preserves source restrictions when the generated call omits them', async () => {
    const f = await fixture(); const grant = await f.assign(); const source = await f.seedSource(grant.id);
    const generated = f.proposal(grant.id, { sourceIds: [], destinationId: 'qa-public', retention: 'ephemeral',
      arguments: { resourceId: 'selected', text: 'Paraphrased hint with no source identifier or literal canary' } });
    await expect(f.service.proposeGenerated(f.alice, generated, { sourceIds: [source.id], isolated: true }))
      .rejects.toMatchObject({ code: 'source_disclosure_denied' });
    expect((await f.service.list(f.alice, { space: 'work' })).operations).toEqual([]);
  });

  it('result lineage intersects every parent restriction and deletion tombstones defeat restored-source replay', async () => {
    const f = await fixture(); const grant = await f.assign();
    const a = await f.seedSource(grant.id, { allowedDestinationIds: ['qa-private', 'qa-public'] });
    const b = await f.seedSource(grant.id, { allowedDestinationIds: ['qa-private'], sensitivity: 'restricted' });
    const operation = await f.service.proposeGenerated(f.alice, f.proposal(grant.id, { retention: 'ephemeral' }), { sourceIds: [a.id, b.id], isolated: true });
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, worker); const lease = { ...worker, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease); await f.service.operations.settle(f.alice, { ...lease, outcome: 'verified' });
    const child = await f.service.lineage.registerResult(f.alice, { space: 'work', operationId: operation.operationId, resourceId: 'selected', resourceRevision: 'qa-result-v1' });
    expect(child.allowedDestinationIds).toEqual(['qa-private']); expect(child.sensitivity).toBe('restricted');
    expect(child.parentSourceIds).toEqual([a.id, b.id]); expect(child.persist).toBe(false);
    await expect(f.service.lineage.assertUse(f.alice, { space: 'work', sourceIds: [child.id], agentId: 'agent-original',
      destinationId: 'qa-public', purpose: 'explicit.connection_task' })).rejects.toMatchObject({ code: 'source_disclosure_denied' });
    const deleted = await f.service.lineage.deleteSource(f.alice, { space: 'work', sourceId: a.id, expectedRevision: a.revision });
    expect(deleted.suppressedSourceIds).toEqual(expect.arrayContaining([a.id, child.id]));
    await f.repository.transaction(f.context, records => { // Simulate a stale restored source row; protected tombstone remains.
      const restored = records.sources.find(s => s.id === a.id)!; restored.status = 'active'; restored.revision = a.revision;
    });
    await expect(f.service.lineage.assertUse(f.alice, { space: 'work', sourceIds: [a.id], agentId: 'agent-original',
      destinationId: 'qa-private', purpose: 'explicit.connection_task' })).rejects.toMatchObject({ code: 'source_revoked' });
  });

  it('does not infer durable memory consent from a verified read', async () => {
    const f = await fixture(); const grant = await f.assign(); const operation = await f.service.propose(f.alice, f.proposal(grant.id));
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, worker); const lease = { ...worker, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease); await f.service.operations.settle(f.alice, { ...lease, outcome: 'verified' });
    await expect(f.service.lineage.registerResult(f.alice, { space: 'work', operationId: operation.operationId,
      resourceId: 'selected', resourceRevision: 'qa-result-v1', allowMemory: true })).rejects.toMatchObject({ code: 'memory_bridge_unavailable' });
  });

  it.each(['agent_fired', 'person_binding_changed'] as const)('cached source use denies changed current authority: %s', async change => {
    const f = await fixture(); const grant = await f.assign(); const source = await f.seedSource(grant.id);
    if (change === 'agent_fired') f.context.currentAgentIds = [];
    else f.context.bindingRevision++;
    await expect(f.service.lineage.assertUse(f.alice, { space: 'work', sourceIds: [source.id], agentId: 'agent-original',
      destinationId: 'qa-private', purpose: 'explicit.connection_task' })).rejects.toThrow();
  });

  it('a derived result on another connection cannot outlive its original revoked source', async () => {
    const f = await fixture(); const originalGrant = await f.assign(); const parent = await f.seedSource(originalGrant.id);
    const enrolled = await f.service.enroll(f.alice, { space: 'work', providerId: 'qa', displayLabel: 'Second synthetic connection' });
    const second = enrolled.connections.find(c => c.id !== f.connected.id)!;
    await f.service.completeEnrollment(f.alice, { space: 'work', connectionId: second.id, expectedRevision: second.revision,
      issuer: 'https://qa.example.invalid', providerSubject: 'second-subject', providerTenantId: 'second-tenant',
      providerScopes: ['qa-scoped'], displayLabel: 'Second verified account' });
    const secondGrant = (await f.service.grant(f.alice, { ...f.grantInput, connectionId: second.id, expectedRevision: 2 })).grants.find(g => g.connectionId === second.id)!;
    const operation = await f.service.proposeGenerated(f.alice, f.proposal(secondGrant.id, { connectionId: second.id, retention: 'ephemeral' }),
      { sourceIds: [parent.id], isolated: true });
    const worker = { space: 'work' as const, operationId: operation.operationId, workerId: 'qa-worker', leaseMs: 1000 };
    const claim = await f.service.operations.claim(f.alice, worker); const lease = { ...worker, fence: claim.fence };
    await f.service.operations.markDispatched(f.alice, lease); await f.service.operations.settle(f.alice, { ...lease, outcome: 'verified' });
    const child = await f.service.lineage.registerResult(f.alice, { space: 'work', operationId: operation.operationId,
      resourceId: 'selected', resourceRevision: 'second-result-v1' });
    await f.service.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
    await expect(f.service.lineage.assertUse(f.alice, { space: 'work', sourceIds: [child.id], agentId: 'agent-original',
      destinationId: 'qa-private', purpose: 'explicit.connection_task' })).rejects.toThrow();
  });

  it('survives actual file-store reconstruction and purges retained canaries from current and prior generations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-qa-'));
    try {
      const f = await fixture(new FileConnectionsStorage(directory)); const grant = await f.assign();
      const canary = 'FILE_RETAINED_QA_CANARY_985';
      const input = f.proposal(grant.id, { arguments: { resourceId: 'selected', text: canary } });
      const original = await f.service.propose(f.alice, input);
      const reconstructed = new ConnectionsService(new ConnectionsRepository(new FileConnectionsStorage(directory)), f.options);
      expect((await reconstructed.propose(f.alice, input)).operationId).toBe(original.operationId);
      await reconstructed.revoke(f.alice, { space: 'work', connectionId: f.connected.id, expectedRevision: f.connected.revision });
      const next = new ConnectionsService(new ConnectionsRepository(new FileConnectionsStorage(directory)), f.options);
      const state = await next.list(f.alice, { space: 'work' });
      expect(state.connections[0].lifecycle).toBe('revoked'); expect(state.operations[0].state).toBe('cancelled');
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json'));
      const contents = await Promise.all(jsonFiles.map(e => readFile(join(e.parentPath, e.name), 'utf8')));
      expect(contents.join('\n')).not.toContain(canary);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
