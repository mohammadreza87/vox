import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { AdaptiveObserverService } from '../../adaptive/observation/service';
import type { StudioExperimentRuntime } from '../../adaptive/experiments/runtime';
import { handleConversationRequest } from '../conversation';
import { signInitData } from '../auth';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const TOKEN = '123:synthetic-manager';
async function fixture(consented = true) {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const now = Date.now(), capabilities = ['core_text', 'product_analytics'];
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()),
    adaptiveOptionsFromManifest(JSON.stringify({
      schemaVersion: 1, configurationVersion: 'synthetic-experiment-conversation', enabledCapabilities: capabilities,
      accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
      approvals: capabilities.map((capability, index) => ({
        schemaVersion: 1, id: `approval${index}`, revision: 1, createdAt: now, updatedAt: now,
        jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-experiment-conversation',
        effectiveAt: now, reviewExpiresAt: now + 86_400_000, owner: 'synthetic-owner', approvalReference: 'synthetic',
      })),
    })));
  h.studio.deps.adaptive = adaptive;
  h.studio.deps.observer = new AdaptiveObserverService(adaptive);
  const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: randomUUID() });
  if (consented) {
    const before = await adaptive.read(ID.alice, 'work');
    const shown = await adaptive.present(ID.alice, {
      space: 'work', purpose: 'optional.product_analytics', locale: 'en',
      expectedRevision: before.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID(),
    });
    await adaptive.changeConsent(ID.alice, {
      space: 'work', purpose: 'optional.product_analytics', state: 'granted',
      expectedRevision: shown.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision,
      eventId: randomUUID(), receipt: shown.receipt,
    });
  }
  const presentation = { density: 'compact' as const, receipt: 'a'.repeat(64) };
  const experiments = { prepare: vi.fn(async () => presentation), current: vi.fn(() => true), acknowledge: vi.fn() };
  h.studio.deps.experiments = experiments as unknown as StudioExperimentRuntime;
  const request = () => new Request('https://vox.example/api/studio/conversation', {
    method: 'POST', headers: { origin: 'https://vox.example', 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN) },
    body: JSON.stringify({ agentId: agent.id, space: 'work', text: 'A synthetic current request.' }),
  });
  return { h, agent, experiments, presentation, request };
}

describe('conversation experiment integration', () => {
  it('decorates the reply without recording exposure on server completion', async () => {
    const f = await fixture();
    const response = await handleConversationRequest(f.h.studio, f.request(), TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ reply: 'Sure.', responsePresentation: f.presentation });
    expect(f.experiments.prepare).toHaveBeenCalledWith(ID.alice, f.agent.id, 'work', body.turnId);
    expect(f.experiments.current).toHaveBeenCalledWith(ID.alice, f.agent.id, 'work', f.presentation);
    expect(f.experiments.acknowledge).not.toHaveBeenCalled();
  });
  it('does not prepare experiments without a consented server turn correlation', async () => {
    const f = await fixture(false);
    const response = await handleConversationRequest(f.h.studio, f.request(), TOKEN);
    expect(await response.json()).toEqual({ reply: 'Sure.' });
    expect(f.experiments.prepare).not.toHaveBeenCalled();
  });
  it.each(['prepare', 'current'] as const)('keeps the baseline reply when optional %s fails', async stage => {
    const f = await fixture();
    if (stage === 'prepare') f.experiments.prepare.mockRejectedValueOnce(new Error('synthetic unavailable'));
    else f.experiments.current.mockImplementationOnce(() => { throw new Error('synthetic unavailable'); });
    const response = await handleConversationRequest(f.h.studio, f.request(), TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reply).toBe('Sure.');
    expect(body.responsePresentation).toBeUndefined();
  });
  it('drops a disabled variant before publication', async () => {
    const f = await fixture();
    f.experiments.current.mockReturnValue(false);
    const response = await handleConversationRequest(f.h.studio, f.request(), TOKEN);
    expect(response.status).toBe(200);
    expect((await response.json()).responsePresentation).toBeUndefined();
  });
  it('rechecks conversation access even when optional preparation fails', async () => {
    const f = await fixture();
    f.experiments.prepare.mockImplementationOnce(async () => {
      await f.h.store.update(state => { state.agents.find(a => a.id === f.agent.id)!.blocked = [ID.alice]; });
      throw new Error('synthetic unavailable');
    });
    const response = await handleConversationRequest(f.h.studio, f.request(), TOKEN);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('Sure.');
  });
});
