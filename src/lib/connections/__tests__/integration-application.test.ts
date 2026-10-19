import { describe, expect, it, vi } from 'vitest';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { InMemoryConnectionsStorage } from '../storage';
import { connectionsConfigurationSchema } from '../config';
import { createStudioConnectionsApplication } from '../studio-application';
import { ConnectionsBudgetLedger } from '../budgets';
import { randomUUID } from 'crypto';

async function fixture({ budgetCeiling, modelQualification = 'qualified' }: { budgetCeiling?: number;
  modelQualification?: 'qualified' | 'absent' | 'wrong_model' | 'unqualified' | 'no_identity' } = {}) {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
  await adaptive.confirm(1001, { confirm: true }); await adaptive.confirm(1002, { confirm: true });
  const state = { members: [{ telegramId: 1001, role: 'member', firstName: 'QA' }, { telegramId: 1002, role: 'owner', firstName: 'Owner' }],
    agents: [{ id: 'qa-agent', status: 'active', createdBy: 1001, visibility: 'private', access: [], persona: { name: 'QA Agent' } }], groups: [], audit: [] } as unknown as StudioState;
  const llm = { identity: modelQualification === 'no_identity' ? undefined : { provider: 'anthropic', model: 'qa-scripted-model' },
    complete: vi.fn(async () => JSON.stringify({ kind: 'answer', text: 'Synthetic answer' })) };
  const studio = { deps: { store: { read: async () => structuredClone(state) }, adaptive, chatLLM: llm } } as unknown as Studio;
  const configuration = connectionsConfigurationSchema.parse({ schemaVersion: 1, enabled: true,
    ...(modelQualification === 'absent' ? {} : { modelPolicy: { provider: 'anthropic', model: modelQualification === 'wrong_model' ? 'another-scripted-model' : 'qa-scripted-model',
      qualified: modelQualification !== 'unqualified', evidenceReference: 'synthetic-processor-fixture-only' } }), profiles: [
    { accountId: 'telegram-account:1001', space: 'work', providerId: 'github', providerSubject: 'qa-owner-subject', providerTenantId: 'qa-owner-tenant',
      endpointProfileId: 'github-api', setup: 'operator', qualified: true, evidenceReference: 'synthetic-only-not-live',
      dailyToolCallCeiling: budgetCeiling ?? 0,
      dailyModelTokenCeiling: budgetCeiling === undefined ? 0 : 100_000,
      resources: [{ id: 'github:repo:qa/owned', label: 'Owned QA repository', toolIds: ['github.issue.get', 'github.issue.create'] }] },
    { accountId: 'telegram-account:1002', space: 'work', providerId: 'github', providerSubject: 'qa-other-subject', providerTenantId: 'qa-other-tenant',
      endpointProfileId: 'github-api', setup: 'operator', qualified: true, evidenceReference: 'synthetic-only-not-live',
      resources: [{ id: 'github:repo:qa/other_private_canary', label: 'OTHER_PRIVATE_LABEL_CANARY', toolIds: ['github.issue.get'] }] },
  ] });
  const broker = { begin: vi.fn(async () => ({ flowId: 'qa-flow', status: 'pending' as const, expiresAt: Date.now() + 60_000 })),
    claim: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn(async () => undefined) };
  const actor = { accountId: 'telegram-account:1001' };
  const app = await createStudioConnectionsApplication(studio, actor, 'work', { storage: new InMemoryConnectionsStorage(),
    configuration: async () => structuredClone(configuration), broker,
    ...(budgetCeiling === undefined ? {} : { budgets: new ConnectionsBudgetLedger(new MemoryAdaptiveStorage()) }) });
  const enroll = () => app.enroll!(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic GitHub' });
  const complete = async (subject = 'qa-owner-subject') => {
    const pending = (await enroll()).connections[0];
    await app.service.completeEnrollment(actor, { space: 'work', connectionId: pending.id, expectedRevision: pending.revision,
      issuer: 'https://github.com', providerSubject: subject, providerTenantId: 'qa-owner-tenant', providerScopes: ['issues:read'], displayLabel: 'Synthetic GitHub' });
    return (await app.service.list(actor, { space: 'work' })).connections[0];
  };
  return { adaptive, state, configuration, actor, app, broker, enroll, complete, llm };
}

describe('independent account-bound application/configuration integration', () => {
  it('excludes other accounts inventory from its real code-owned catalog and resource picker', async () => {
    const f = await fixture(); const connection = await f.complete();
    expect(f.app.service.options.catalog.get('github.issue.get')?.resourceIds).toEqual(['github:repo:qa/owned']);
    const resources = await f.app.resources(f.actor, 'work', connection.id);
    expect(resources.map(r => r.id)).toEqual(['github:repo:qa/owned']);
    expect(JSON.stringify(resources)).not.toContain('OTHER_PRIVATE');
    expect(JSON.stringify(await f.app.dashboard(f.actor, 'work'))).not.toContain('OTHER_PRIVATE');
  });

  it('binds the application instance to its authenticated account and space', async () => {
    const f = await fixture();
    await expect(f.app.dashboard({ accountId: 'telegram-account:1002' }, 'work')).rejects.toMatchObject({ code: 'partition_denied' });
    await expect(f.app.dashboard(f.actor, 'personal')).rejects.toMatchObject({ code: 'partition_denied' });
  });

  it('checks the verified external subject before listing private inventory', async () => {
    const f = await fixture(); const connection = await f.complete('qa-impostor-subject');
    await expect(f.app.resources(f.actor, 'work', connection.id)).rejects.toMatchObject({ code: 'provider_identity_mismatch' });
  });

  it('does not grant an unregistered repository even when the descriptor schema can map its name', async () => {
    const f = await fixture(); const connection = await f.complete();
    await expect(f.app.grant!(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
      agentId: 'qa-agent', toolIds: ['github.issue.get'], resourceIds: ['github:repo:qa/unregistered'],
      destinationIds: ['provider:github', 'model:studio', 'vox:private'], effects: ['read'], expiresAt: Date.now() + 60_000, maxCalls: 4, maxBytes: 4096 }))
      .rejects.toMatchObject({ code: 'resource_not_registered' });
  });

  it('live disabling blocks provider setup while preserving local revocation and honest pending cleanup', async () => {
    const f = await fixture(); const connection = await f.complete(); f.configuration.enabled = false;
    await expect(f.app.resources(f.actor, 'work', connection.id)).rejects.toMatchObject({ code: 'provider_setup_required' });
    await expect(f.app.assertTaskCurrent!('github')).rejects.toMatchObject({ code: 'provider_setup_required' });
    const state = await f.app.revoke!(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision });
    expect(state.connections[0].lifecycle).toBe('revoked'); expect(f.broker.revoke).toHaveBeenCalledTimes(1);
  });

  it('changed configuration cannot silently widen an existing catalog', async () => {
    const f = await fixture(); const connection = await f.complete();
    f.configuration.profiles[0].resources.push({ id: 'github:repo:qa/new', label: 'New repo', toolIds: ['github.issue.get'] });
    await expect(f.app.resources(f.actor, 'work', connection.id)).rejects.toMatchObject({ code: 'configuration_changed' });
  });

  it('concurrent enrollment admits at most one active account/provider connection', async () => {
    const f = await fixture(); const attempts = await Promise.allSettled([f.enroll(), f.enroll()]);
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    expect((await f.app.service.list(f.actor, { space: 'work' })).connections).toHaveLength(1);
  });

  it('omitted spend ceilings default to zero and never authorize a paid task budget', async () => {
    const f = await fixture();
    expect(f.configuration.profiles[0].dailyModelTokenCeiling).toBe(0); expect(f.configuration.profiles[0].dailyToolCallCeiling).toBe(0);
    await expect(f.app.reserveTaskBudget!('github', 'qa-unconfigured-budget', 'model_tokens', 10)).rejects.toMatchObject({ code: 'budget_not_configured' });
    expect(f.broker.execute).not.toHaveBeenCalled();
  });

  it('a qualified read inventory cannot enable external writes in discovery, grants or retained operation execution', async () => {
    const f = await fixture(); const connection = await f.complete();
    const resources = await f.app.resources(f.actor, 'work', connection.id);
    expect(resources[0].toolIds).toEqual(['github.issue.get']);
    expect((await f.app.dashboard(f.actor, 'work')).providers.flatMap(p => p.tools).every(t => t.effect === 'read')).toBe(true);
    const grant = { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
      agentId: 'qa-agent', toolIds: ['github.issue.create'], resourceIds: ['github:repo:qa/owned'],
      destinationIds: ['provider:github', 'model:studio', 'vox:private'], effects: ['write'], expiresAt: Date.now() + 60_000, maxCalls: 4, maxBytes: 4096 };
    await expect(f.app.grant!(f.actor, grant)).rejects.toMatchObject({ code: 'external_effects_not_qualified' });
    const readGrant = (await f.app.grant!(f.actor, { ...grant, toolIds: ['github.issue.get'], effects: ['read'] })).grants[0];
    const requestId = 'qa-retained-effect';
    const operation = await f.app.service.propose(f.actor, { space: 'work', requestId, idempotencyKey: requestId,
      connectionId: connection.id, grantId: readGrant.id, agentId: 'qa-agent', toolId: 'github.issue.get',
      arguments: { owner: 'qa', repository: 'owned', number: 1 }, destinationId: 'provider:github', expectedTargetRevision: null,
      sourceIds: [], retention: 'retained', deadlineAt: Date.now() + 30_000 });
    const context = await f.app.service.context(f.actor, 'work');
    await f.app.service.repository.transaction(context, records => { // Simulate a receipt retained from an older effect-capable deployment.
      const old = records.operations.find(o => o.id === operation.operationId)!; old.toolId = 'github.issue.create'; old.effect = 'write';
    });
    await expect(f.app.execute(f.actor, 'work', operation.operationId)).rejects.toMatchObject({ code: 'external_effects_not_qualified' });
    expect(f.broker.execute).not.toHaveBeenCalled();
  });

  it.each([0, 1])('production application enforces daily tool ceiling %s immediately before the broker', async ceiling => {
    const f = await fixture({ budgetCeiling: ceiling }); const connection = await f.complete();
    const grant = (await f.app.grant!(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
      agentId: 'qa-agent', toolIds: ['github.issue.get'], resourceIds: ['github:repo:qa/owned'],
      destinationIds: ['provider:github', 'model:studio', 'vox:private'], effects: ['read'], expiresAt: Date.now() + 60_000, maxCalls: 4, maxBytes: 4096 })).grants[0];
    const propose = (requestId: string) => f.app.service.propose(f.actor, { space: 'work', requestId, idempotencyKey: requestId,
      connectionId: connection.id, grantId: grant.id, agentId: 'qa-agent', toolId: 'github.issue.get',
      arguments: { owner: 'qa', repository: 'owned', number: 1 }, destinationId: 'provider:github', expectedTargetRevision: null,
      sourceIds: [], retention: 'retained', deadlineAt: Date.now() + 30_000 });
    const first = await propose('qa-budgeted-operation-1');
    if (ceiling === 0) {
      await expect(f.app.execute(f.actor, 'work', first.operationId)).rejects.toMatchObject({ code: 'budget_not_configured' });
      expect(f.broker.execute).not.toHaveBeenCalled();
    } else {
      await f.app.execute(f.actor, 'work', first.operationId); expect(f.broker.execute).toHaveBeenCalledTimes(1);
      await expect(f.app.execute(f.actor, 'work', first.operationId)).rejects.toMatchObject({ code: 'budget_reservation_replayed' });
      const second = await propose('qa-budgeted-operation-2');
      await expect(f.app.execute(f.actor, 'work', second.operationId)).rejects.toMatchObject({ code: 'budget_exhausted' });
      expect(f.broker.execute).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['absent', 'wrong_model', 'unqualified', 'no_identity'] as const)('production model policy %s blocks a paid task without inference', async modelQualification => {
    const f = await fixture({ budgetCeiling: 1, modelQualification });
    expect((await f.app.dashboard(f.actor, 'work')).canRunTasks).toBe(false);
    await expect(f.app.task!(f.actor, {})).rejects.toMatchObject({ code: 'model_processor_not_qualified' });
    await expect(f.app.reserveTaskBudget!('github', 'qa-model-denial', 'model_tokens', 10)).rejects.toMatchObject({ code: 'model_processor_not_qualified' });
    expect(f.llm.complete).not.toHaveBeenCalled(); expect(f.broker.execute).not.toHaveBeenCalled();
  });

  it.each(['during_budget', 'during_inference'] as const)('model policy change %s is observed at the actual application task boundary', async change => {
    const f = await fixture({ budgetCeiling: 1 }); const connection = await f.complete();
    await f.app.grant!(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
      agentId: 'qa-agent', toolIds: ['github.issue.get'], resourceIds: ['github:repo:qa/owned'],
      destinationIds: ['provider:github', 'model:studio', 'vox:private'], effects: ['read'], expiresAt: Date.now() + 60_000, maxCalls: 4, maxBytes: 4096 });
    expect((await f.app.dashboard(f.actor, 'work')).canRunTasks).toBe(true);
    if (change === 'during_budget') {
      const reserve = f.app.reserveTaskBudget!;
      f.app.reserveTaskBudget = async (...args) => { await reserve(...args); if (args[2] === 'model_tokens') f.configuration.modelPolicy!.qualified = false; };
    } else {
      f.llm.complete.mockImplementationOnce(async () => { f.configuration.modelPolicy!.model = 'different-processor-model'; return JSON.stringify({ kind: 'answer', text: 'MUST_NOT_DELIVER' }); });
    }
    await expect(f.app.task!(f.actor, { space: 'work', agentId: 'qa-agent', connectionId: connection.id, message: 'Synthetic model policy check', requestId: randomUUID() }))
      .rejects.toMatchObject({ code: 'model_processor_not_qualified' });
    expect(f.llm.complete).toHaveBeenCalledTimes(change === 'during_budget' ? 0 : 1);
    expect(f.broker.execute).not.toHaveBeenCalled();
  });
});
