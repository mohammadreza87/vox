import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConnectionsService } from '../service';
import { ConnectionsRepository } from '../repository';
import { InMemoryConnectionsStorage } from '../storage';
import type { ConnectionContext, ConnectionsCatalog, ReviewedTool, ProposeInput } from '../contracts';
const actor = { accountId: 'test-account' };
const read: ReviewedTool = { id: 'fixture.read', version: '1', providerId: 'fixture', adapterId: 'fixture-api', adapterVersion: '1',
  catalogDigest: 'catalog-1', schemaDigest: 'read-1', effect: 'read', retryClass: 'safe_read', maxInputBytes: 1000,
  maxOutputBytes: 1000, timeoutMs: 1000, resourceIds: ['item-1'], destinationIds: ['fixture-private', 'public-search'] };
const write: ReviewedTool = { ...read, id: 'fixture.write', effect: 'write', schemaDigest: 'write-1', retryClass: 'reconcile_only' };
const argSchema = z.object({ itemId: z.literal('item-1'), text: z.string().max(100) }).strict();
export function fixture(storage = new InMemoryConnectionsStorage()) {
  let now = 1_000_000;
  let context: ConnectionContext = { accountId: actor.accountId, personId: 'person-1', bindingId: 'binding-1', bindingRevision: 1,
    bindingExpiresAt: now + 100_000_000, currentAgentIds: ['agent-1'], scope: { tenantId: 'tenant-1', spaceId: 'work-1', spaceKind: 'work',
      containerId: 'container-1', audiencePersonIds: ['person-1'], audienceRevision: 'audience-1' } };
  const tools = new Map([[read.id, read], [write.id, write]]);
  const catalog: ConnectionsCatalog = { get: id => tools.get(id), validateArguments: (_id, value) => argSchema.parse(value),
    provider: id => id === 'fixture' ? { adapterId: 'fixture-api', adapterVersion: '1', catalogDigest: 'catalog-1', endpointProfileId: 'fixture-local' } : undefined,
    mapResources: () => ['item-1'] };
  const repository = new ConnectionsRepository(storage);
  const service = new ConnectionsService(repository, { now: () => now, catalog,
    resolveContext: async (requested, space) => requested.accountId === actor.accountId && space === context.scope.spaceKind ? structuredClone(context) : undefined });
  return { actor, service, repository, catalog, getContext: () => context, setContext: (next: ConnectionContext) => { context = next; },
    advance: (ms: number) => { now += ms; }, now: () => now };
}
async function connected(f = fixture()) {
  const enrolled = await f.service.enroll(actor, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic fixture' });
  const connection = enrolled.connections[0];
  await f.service.completeEnrollment(actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
    issuer: 'https://fixture.invalid', providerSubject: 'fake-subject', providerTenantId: 'fake-tenant', providerScopes: ['fixture.read'], displayLabel: 'Synthetic account' });
  const ready = await f.service.list(actor, { space: 'work' });
  const granted = await f.service.grant(actor, { space: 'work', connectionId: connection.id, expectedRevision: ready.connections[0].revision,
    agentId: 'agent-1', toolIds: [read.id, write.id], resourceIds: ['item-1'], destinationIds: ['fixture-private', 'public-search'],
    effects: ['read', 'write'], expiresAt: f.now() + 60_000, maxCalls: 10, maxBytes: 1000 });
  const proposal: ProposeInput = { space: 'work', requestId: 'request-1', idempotencyKey: 'key-1', connectionId: connection.id,
    grantId: granted.grants[0].id, agentId: 'agent-1', toolId: read.id, arguments: { itemId: 'item-1', text: 'synthetic' },
    destinationId: 'fixture-private', expectedTargetRevision: 'resource-rev-1', sourceIds: [], retention: 'retained', deadlineAt: f.now() + 30_000 };
  return { ...f, proposal, ready, granted };
}
describe('Connections foundation control plane', () => {
  it('enrolls zero grants, rejects secrets/unknown wire fields, and hides subjects in list DTO', async () => {
    const f = fixture();
    const view = await f.service.enroll(actor, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic' });
    expect(view.connections[0].lifecycle).toBe('pending'); expect(view.grants).toEqual([]);
    await expect(f.service.enroll(actor, { space: 'work', providerId: 'fixture', displayLabel: 'Synthetic', token: 'not-a-secret' })).rejects.toThrow();
    expect(JSON.stringify(view)).not.toContain('providerSubject'); expect(JSON.stringify(view)).not.toContain('credential');
  });
  it('denies guessed IDs, private Personal context and successor agents', async () => {
    const f = await connected();
    await expect(f.service.propose(actor, { ...f.proposal, connectionId: 'guessed-id' })).rejects.toMatchObject({ code: 'connection_unavailable' });
    await expect(f.service.propose(actor, { ...f.proposal, space: 'personal' })).rejects.toMatchObject({ code: 'identity_unverified' });
    await expect(f.service.propose(actor, { ...f.proposal, agentId: 'successor-1' })).rejects.toMatchObject({ code: 'grant_denied' });
    f.setContext({ ...f.getContext(), bindingRevision: 2 });
    await expect(f.service.propose(actor, f.proposal)).rejects.toMatchObject({ code: 'grant_denied' });
  });
  it('converges concurrent duplicate proposals and conflicts on changed payload or target', async () => {
    const f = await connected();
    const receipts = await Promise.all([f.service.propose(actor, f.proposal), f.service.propose(actor, f.proposal)]);
    expect(receipts[0].operationId).toBe(receipts[1].operationId);
    await expect(f.service.propose(actor, { ...f.proposal, arguments: { itemId: 'item-1', text: 'changed' } })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(f.service.propose(actor, { ...f.proposal, expectedTargetRevision: 'revision-2' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  it('requires exact fresh approval and fences stale workers', async () => {
    const f = await connected();
    const proposed = await f.service.propose(actor, { ...f.proposal, toolId: write.id });
    expect(proposed.state).toBe('needs_approval');
    await expect(f.service.operations.claim(actor, { space: 'work', operationId: proposed.operationId, workerId: 'worker-1', leaseMs: 1000 })).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
    await expect(f.service.approve(actor, { space: 'work', operationId: proposed.operationId, expectedRevision: proposed.revision, proposalDigest: 'wrong' })).rejects.toMatchObject({ code: 'approval_stale' });
    const preview = await f.service.preview(actor, { space: 'work', operationId: proposed.operationId, expectedRevision: proposed.revision });
    expect(preview.arguments).toEqual(f.proposal.arguments);
    const approved = await f.service.approve(actor, { space: 'work', operationId: proposed.operationId, expectedRevision: proposed.revision, proposalDigest: proposed.proposalDigest });
    expect(approved.state).toBe('queued');
    const claim = await f.service.operations.claim(actor, { space: 'work', operationId: proposed.operationId, workerId: 'worker-1', leaseMs: 1000 });
    const lease = { space: 'work' as const, operationId: proposed.operationId, workerId: 'worker-1', fence: claim.fence };
    await expect(f.service.operations.markDispatched(actor, { ...lease, fence: claim.fence - 1 })).rejects.toMatchObject({ code: 'stale_worker_fence' });
    await f.service.operations.markDispatched(actor, lease);
    await expect(f.service.operations.markDispatched(actor, lease)).rejects.toMatchObject({ code: 'operation_already_dispatched' });
    await f.service.operations.settle(actor, { ...lease, outcome: 'verified', providerReceiptRef: 'receipt-1' });
    await expect(f.service.operations.assertUsable(actor, 'work', proposed.operationId)).resolves.toBeUndefined();
  });
  it('recovers possible transmission as unknown without redispatch and fences late success', async () => {
    const f = await connected();
    const operation = await f.service.propose(actor, f.proposal);
    const claim = await f.service.operations.claim(actor, { space: 'work', operationId: operation.operationId, workerId: 'worker-1', leaseMs: 1000 });
    const lease = { space: 'work' as const, operationId: operation.operationId, workerId: 'worker-1', fence: claim.fence };
    await f.service.operations.markDispatched(actor, lease); f.advance(1001);
    const recovered = await f.service.operations.recover(actor, 'work'); expect(recovered[0].state).toBe('outcome_unknown');
    await expect(f.service.operations.claim(actor, { space: 'work', operationId: operation.operationId, workerId: 'worker-2', leaseMs: 1000 })).rejects.toMatchObject({ code: 'operation_not_dispatchable' });
    await expect(f.service.operations.settle(actor, { ...lease, outcome: 'verified' })).rejects.toMatchObject({ code: 'stale_worker_fence' });
  });
  it('suppresses revoke between dispatch and result delivery, retaining truthful unknown receipt', async () => {
    const f = await connected();
    const operation = await f.service.propose(actor, f.proposal);
    const claim = await f.service.operations.claim(actor, { space: 'work', operationId: operation.operationId, workerId: 'worker-1', leaseMs: 1000 });
    const lease = { space: 'work' as const, operationId: operation.operationId, workerId: 'worker-1', fence: claim.fence };
    await f.service.operations.markDispatched(actor, lease);
    const revoked = await f.service.revoke(actor, { space: 'work', connectionId: f.proposal.connectionId, expectedRevision: f.ready.connections[0].revision });
    expect(revoked.operations[0].state).toBe('outcome_unknown');
    await expect(f.service.operations.settle(actor, { ...lease, outcome: 'verified' })).rejects.toMatchObject({ code: 'stale_worker_fence' });
    await expect(f.service.operations.assertUsable(actor, 'work', operation.operationId)).rejects.toThrow();
    const raw = await f.repository.transaction(f.getContext(), records => records);
    expect(raw.payloads).toEqual([]); expect(raw.tombstones[0].providerRevocation).toBe('pending');
  });
  it('expires lost ephemeral payload before dispatch and never stores its arguments', async () => {
    const storage = new InMemoryConnectionsStorage();
    const f = await connected(fixture(storage));
    const operation = await f.service.propose(actor, { ...f.proposal, retention: 'ephemeral' });
    expect(operation.state).toBe('authorized');
    const stored = await f.repository.transaction(f.getContext(), records => records);
    expect(stored.payloads).toEqual([]); expect(JSON.stringify(stored)).not.toContain('synthetic');
    const restarted = fixture(storage);
    expect((await restarted.service.operations.recover(actor, 'work'))[0].state).toBe('expired');
  });
});
export { connected };
