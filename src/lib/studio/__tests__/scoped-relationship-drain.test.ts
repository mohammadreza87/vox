import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../../adaptive/relationships/service';
import { InMemoryRelationshipStore, RelationshipLoop, type DecisionProvider } from '../../relationships';
import { drainScopedRelationships } from '../scoped-relationship-drain';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(options: { external?: boolean; channel?: 'telegram' | 'call'; endpoint?: 'missing' | 'rotated' } = {}) {
  const h = makeStudio(); dirs.push(h.dir);
  const users = await seedOrg(h), hired = await hire(h, users.alice);
  await h.store.update(state => { state.members.find(m => m.telegramId === ID.alice)!.role = 'superadmin'; });
  const start = h.clock.now.getTime();
  const capabilities = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions', 'relationship_outreach'];
  const manifest = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-only', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `approval-${index}`, revision: 1, createdAt: start, updatedAt: start,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-only', effectiveAt: start,
      reviewExpiresAt: start + 100 * 86400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(`${h.dir}/adaptive`)), { ...manifest, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime() });
  const authority = new AdaptiveRelationshipService(adaptive);
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  const grant = async (purpose: OptionalPurpose) => {
    const initial = await adaptive.read(ID.alice, 'personal');
    const shown = await adaptive.present(ID.alice, { space: 'personal', purpose, locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), deliberateReopen: true });
    await adaptive.changeConsent(ID.alice, { space: 'personal', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, receipt: shown.receipt, eventId: randomUUID() });
  };
  for (const purpose of ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'] as const) await grant(purpose);
  await adaptive.setAgentAccess(ID.alice, hired.agent.id, { space: 'personal', allowed: true, expectedRevision: (await adaptive.read(ID.alice, 'personal')).revision, eventId: randomUUID() });
  await adaptive.withAccountDocument(ID.alice, document => {
    document.experience.settings.timezone = 'UTC'; document.experience.settings.quietStartHour = 0; document.experience.settings.quietEndHour = 0;
    document.experience.settings.personal = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false };
  });
  if (options.external) { await grant('optional.relationship_outreach'); await authority.configureExternal(ID.alice, 'personal', true); }
  const permit = (await authority.resolve(ID.alice, hired.agent.id, 'personal'))!;
  expect(permit).not.toBeNull();
  const endpointId = options.endpoint === 'missing' ? undefined : h.studio.relationshipEndpointId(options.endpoint === 'rotated' ? 'previous-bot-token' : h.studio.botToken(hired.agent)!);
  const source = (await authority.acceptSource(permit, { id: 'accepted-source', at: start, channel: options.channel ?? 'telegram',
    ...(options.channel !== 'call' && endpointId ? { endpointId } : {}) }))!;
  const store = new InMemoryRelationshipStore();
  const review = vi.fn<DecisionProvider['choose']>(async () => 'send');
  const loop = new RelationshipLoop({ store, mode: 'live', now: () => h.clock.now, decisions: { choose: review },
    authorize: input => authority.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint),
    assessor: { assess: async ({ text }) => ({ timeZone: 'UTC', quietHours: { start: 0, end: 0 }, preferences: [{ key: 'style', value: 'SCOPED_STYLE_CANARY' }],
      situations: [{ topic: 'discussion', summary: 'SCOPED_SITUATION_CANARY', status: 'open' }],
      followUp: { topic: 'discussion', purpose: 'Check on the discussion', dueAt: new Date(start + 86400_000).toISOString(), timing: { kind: 'ongoing', evidenceQuote: text } } }) } });
  Object.assign(h.studio.deps, { adaptive, relationshipAuthority: authority, relationships: loop, relationshipStore: store,
    relationshipConfig: { mode: 'live', agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] } });
  await loop.configure(permit.key, { timeZone: 'UTC', quietHours: { start: 0, end: 0 } });
  await loop.observeTurn({ ...permit.key, eventId: source.id, text: 'My discussion is ongoing.', source: options.channel ?? 'telegram', speakerId: permit.key.audience.kind === 'private' ? permit.key.audience.personId : '', authorizationFingerprint: permit.fingerprint });
  h.advanceDays(1);
  hired.bot().sendMessage.mockClear();
  const compose = vi.spyOn(h.chatLLM, 'complete').mockResolvedValue('How has the discussion been going?');
  const publish = vi.spyOn(authority, 'publish');
  const history = vi.spyOn(h.memory.history, 'recent');
  const document = () => adaptive.withAccountDocument(ID.alice, d => structuredClone(d));
  return { h, hired, adaptive, authority, store, loop, review, compose, publish, history, permit, source, document };
}

describe('scoped Studio relationship delivery', () => {
  it('publishes the exact reviewed next-day draft to the private inbox with scoped context and no legacy history', async () => {
    const x = await setup();
    expect((await x.adaptive.read(ID.alice, 'personal')).identity.confirmed).toBe(false);
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1, failed: 0 });
    expect(x.review).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'How has the discussion been going?', context: expect.stringContaining('SCOPED_SITUATION_CANARY') }));
    expect(x.review.mock.calls[0][0].context).toContain('Nova');
    expect(x.compose.mock.calls[0][0].system).toContain('Nova');
    expect(JSON.stringify(x.compose.mock.calls)).toContain('SCOPED_STYLE_CANARY');
    expect(x.publish).toHaveBeenCalledWith(x.permit.key, expect.any(String), 'How has the discussion been going?', [x.source.id], expect.any(String));
    const document = await x.document();
    expect(document.relationships.inbox[0].text).toBe('How has the discussion been going?');
    expect(x.history).not.toHaveBeenCalled(); expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    expect(await x.h.memory.history.recent(x.hired.agent.id, x.permit.key.chatKey, 20)).toEqual([]);
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 0 });
  });
  it('sends only the generic separately consented Telegram alert and records acceptance', async () => {
    const x = await setup({ external: true });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1 });
    expect(x.hired.bot().sendMessage).toHaveBeenCalledOnce();
    expect(x.hired.bot().sendMessage).toHaveBeenCalledWith(ID.alice, 'You have an update in Vox.', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect((await x.document()).relationships.ledger[0]).toMatchObject({ state: 'accepted', messageId: expect.any(String) });
  });
  it.each(['missing', 'rotated'] as const)('keeps an inbox-only delivery with %s Telegram endpoint proof', async endpoint => {
    const x = await setup({ external: true, endpoint });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    expect((await x.document()).relationships.ledger[0].state).toBe('published');
  });
  it('never exports flattened private/shared context without persisted relationship source lineage', async () => {
    const x = await setup();
    vi.spyOn(x.h.studio, 'adaptiveContext').mockResolvedValue({ revision: 'private:shared:preferences-stable', memoryEnabled: false, historyEnabled: false,
      context: ['UNTRACKED_PRIVATE_CANARY', 'UNTRACKED_SHARED_CANARY'] });
    x.compose.mockImplementationOnce(async request => JSON.stringify(request).includes('UNTRACKED_') ? 'UNTRACKED_PRIVATE_CANARY UNTRACKED_SHARED_CANARY' : 'How has the discussion been going?');
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1 });
    expect(JSON.stringify(x.compose.mock.calls)).not.toContain('UNTRACKED_');
    expect(JSON.stringify(x.review.mock.calls)).not.toContain('UNTRACKED_');
    expect(JSON.stringify((await x.document()).relationships.inbox)).not.toContain('UNTRACKED_');
    expect(x.publish).toHaveBeenCalledWith(x.permit.key, expect.any(String), 'How has the discussion been going?', [x.source.id], expect.any(String));
  });
  it('supports a call-only source in the inbox without inventing a Telegram DM route', async () => {
    const x = await setup({ external: true, channel: 'call' });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    expect((await x.document()).relationships.ledger[0].state).toBe('published');
  });
  it('can publish to the inbox without a configured Telegram bot', async () => {
    const x = await setup({ external: true });
    await x.h.store.update(state => {
      const agent = state.agents.find(a => a.id === x.hired.agent.id)!;
      delete agent.bot; delete agent.tokenEnc;
    });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1 });
    expect((await x.document()).relationships.inbox).toHaveLength(1);
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });
  it.each(['compose', 'review'] as const)('suppresses publication after a full adaptive context revision change during %s', async phase => {
    const x = await setup();
    let revision = 'private:shared:preferences-v1';
    vi.spyOn(x.h.studio, 'adaptiveContext').mockImplementation(async () => ({ revision, memoryEnabled: false, historyEnabled: false, context: ['PRIVATE_CONTEXT_CANARY'] }));
    if (phase === 'compose') x.compose.mockImplementationOnce(async () => { revision = 'private:shared:preferences-v2'; return 'Stale draft'; });
    else x.review.mockImplementationOnce(async () => { revision = 'private:shared:preferences-v2'; return 'send'; });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 0 });
    if (phase === 'compose') expect(x.review).not.toHaveBeenCalled();
    expect(x.publish).not.toHaveBeenCalled(); expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });
  it('rejects a fresh role demotion and a revoked source before publication', async () => {
    const x = await setup();
    x.compose.mockImplementationOnce(async () => { await x.h.store.update(d => { d.members.find(m => m.telegramId === ID.alice)!.role = 'member'; }); return 'Stale draft'; });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 0 });
    expect(x.review).not.toHaveBeenCalled(); expect(x.publish).not.toHaveBeenCalled();
    const y = await setup();
    y.review.mockImplementationOnce(async () => { await y.authority.invalidate(ID.alice, 'personal', { agentId: y.hired.agent.id, sourceIds: [y.source.id], reason: 'deleted' }); return 'send'; });
    expect(await drainScopedRelationships(y.h.studio, 5)).toMatchObject({ sent: 0 });
    expect(y.publish).not.toHaveBeenCalled(); expect((await y.document()).relationships.inbox).toEqual([]);
  });
  it('rechecks private/shared/preferences revisions after the final asynchronous loop fence', async () => {
    const x = await setup();
    let revision = 'private:shared:preferences-v1', checks = 0;
    vi.spyOn(x.h.studio, 'adaptiveContext').mockImplementation(async () => ({ revision, memoryEnabled: false, historyEnabled: false, context: ['PRIVATE_CONTEXT_CANARY'] }));
    const mayDeliver = x.loop.mayDeliver.bind(x.loop);
    vi.spyOn(x.loop, 'mayDeliver').mockImplementation(async job => {
      const allowed = await mayDeliver(job);
      if (++checks === 2) revision = 'private:shared:preferences-v2';
      return allowed;
    });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 0 });
    expect(x.publish).not.toHaveBeenCalled(); expect((await x.document()).relationships.inbox).toEqual([]);
  });
  it('keeps a successfully published draft terminal when Telegram delivery is ambiguous', async () => {
    const x = await setup({ external: true });
    x.hired.bot().sendMessage.mockRejectedValue(new Error('synthetic timeout after possible delivery'));
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1, failed: 0 });
    expect((await x.document()).relationships.ledger[0].state).toBe('unknown');
    x.h.advanceDays(2); expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 0 });
    expect(x.hired.bot().sendMessage).toHaveBeenCalledOnce(); expect(x.publish).toHaveBeenCalledOnce();
  });
  it('cancels the reserved alert when access changes after publication and never retries the detailed inbox item', async () => {
    const x = await setup({ external: true });
    const reserve = x.authority.reserveExternal.bind(x.authority);
    vi.spyOn(x.authority, 'reserveExternal').mockImplementation(async (...args) => {
      const result = await reserve(...args);
      await x.h.store.update(d => { d.agents.find(a => a.id === x.hired.agent.id)!.blocked = [ID.alice]; });
      return result;
    });
    expect(await drainScopedRelationships(x.h.studio, 5)).toMatchObject({ sent: 1, failed: 0 });
    expect((await x.document()).relationships.ledger[0].state).toBe('cancelled');
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    expect((await x.document()).relationships.inbox).toHaveLength(1);
  });
});
