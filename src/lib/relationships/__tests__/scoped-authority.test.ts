import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRelationshipStore, RelationshipControlError, RelationshipLoop, relationshipId } from '..';
import type { Assessment, DrainDeps, RelationshipKey, RelationshipScope } from '..';
import type { RelationshipLoopDeps } from '../loop';

const scope: RelationshipScope = { schemaVersion: 1, accountId: 'account', personId: 'person', bindingId: 'binding', tenantId: 'tenant', space: 'personal', spaceId: 'personal-space', containerId: 'private-container' };
const key: RelationshipKey = { personaId: 'agent', chatKey: 'chat', audience: { kind: 'private', personId: 'person' }, scope };
function harness(withAuthority = true) {
  let now = new Date('2026-10-19T12:00:00Z');
  let fingerprint: string | null = 'policy-1';
  const authorize = vi.fn(async (input: Parameters<NonNullable<RelationshipLoopDeps['authorize']>>[0]) => { void input; return fingerprint ? { fingerprint } : null; });
  const store = new InMemoryRelationshipStore();
  const assess = vi.fn(async ({ text }: { text: string }): Promise<Assessment> => ({ timeZone: 'UTC', preferences: [{ key: 'style', value: 'PERSONAL_CANARY' }], situations: [{ topic: 'topic', summary: 'An unresolved matter', status: 'open' }], followUp: { topic: 'topic', purpose: 'Ask how things are', timing: { kind: 'ongoing', evidenceQuote: text }, dueAt: new Date(now.getTime() + 3600_000).toISOString() } }));
  const choose = vi.fn(async () => 'send' as const);
  const classify = vi.fn(async () => ({ outcome: 'helpful' as const, scope: 'message' as const }));
  const deps: RelationshipLoopDeps = { store, mode: 'live', assessor: { assess }, decisions: { choose }, feedback: { classify }, now: () => now, ...(withAuthority ? { authorize } : {}) };
  const loop = new RelationshipLoop(deps);
  const delivery: DrainDeps = { authorize: vi.fn(async () => true), loadContext: vi.fn(async () => 'Authorized recent history'), compose: vi.fn(async () => 'How did it go?'), send: vi.fn(async () => 'message') };
  const turn = async (eventId = 'source', text = 'This is ongoing', target = key) => {
    if (!(await store.read(target)).timeZone) await loop.configure(target, { timeZone: 'UTC' });
    return loop.observeTurn({ ...target, eventId, text, source: 'telegram', speakerId: 'person', authorizationFingerprint: fingerprint ?? undefined });
  };
  return { loop, store, assess, choose, classify, authorize, deps, delivery, turn, revoke: () => { fingerprint = null; }, changePolicy: () => { fingerprint = 'policy-2'; }, advance: () => { now = new Date(now.getTime() + 3600_000); } };
}

describe('scoped relationship authority', () => {
  it('retains explicit scoped timezone and quiet hours when assessment proposes replacements', async () => {
    const h = harness();
    await h.loop.configure(key, { timeZone: 'Europe/Tallinn', quietHours: { start: 23, end: 7 } });
    h.assess.mockResolvedValueOnce({ timeZone: 'America/New_York', quietHours: { start: 0, end: 0 },
      situations: [{ topic: 'meeting', summary: 'A meeting tomorrow', status: 'open' }] });
    await h.turn('meeting', 'My meeting is tomorrow.');
    const state = await h.store.read(key);
    expect(state.timeZone).toBe('Europe/Tallinn'); expect(state.quietHours).toEqual({ start: 23, end: 7 });
    expect(h.assess).toHaveBeenCalledWith(expect.objectContaining({ timeZone: 'Europe/Tallinn' }));
  });
  it.each(['stop', 'pause'] as const)('persists an assessed %s outside the core transaction and never writes control-turn derivatives', async action => {
    const h = harness();
    h.deps.applyScopedControl = vi.fn(async (target, requested, until) => {
      // A callback that mutates the same core store would deadlock if invoked
      // from inside its transaction rather than after authority/revision fences.
      await h.loop.control(target, requested, { until });
    });
    h.assess.mockResolvedValueOnce({ control: { action }, preferences: [{ key: 'forbidden', value: 'CONTROL_TURN_CANARY' }] });
    expect(await h.turn('boundary', 'I would rather be the one to start conversations.')).toEqual({ duplicate: false, context: '' });
    expect(h.deps.applyScopedControl).toHaveBeenCalledWith(key, action, action === 'pause' ? new Date('2026-10-26T12:00:00Z') : undefined);
    const state = await h.store.read(key);
    expect(state.disabled).toBe(action === 'stop'); expect(state.preferences).toEqual([]); expect(state.feedback ?? []).toEqual([]); expect(state.intentions).toEqual([]);
  });
  it('requires durable scoped controls and propagates unconfirmed application so callers cannot falsely acknowledge it', async () => {
    const h = harness(); h.assess.mockResolvedValue({ control: { action: 'stop' }, preferences: [{ key: 'forbidden', value: 'CONTROL_TURN_CANARY' }] });
    await expect(h.turn('missing')).rejects.toBeInstanceOf(RelationshipControlError);
    expect((await h.store.read(key)).disabled).toBe(true);
    h.deps.applyScopedControl = vi.fn(async () => { throw new Error('synthetic unavailable authority'); });
    await expect(h.turn('failed')).rejects.toMatchObject({ code: 'relationship_control_unconfirmed' });
    expect((await h.store.read(key)).preferences).toEqual([]);
  });
  it('cancels previous binding work locally when durable assessment control fails', async () => {
    const h = harness(); await h.turn('source');
    h.assess.mockResolvedValueOnce({ control: { action: 'stop' } });
    h.deps.applyScopedControl = vi.fn(async () => { throw new Error('synthetic unavailable authority'); });
    await expect(h.turn('boundary')).rejects.toBeInstanceOf(RelationshipControlError);
    const state = await h.store.read(key);
    expect(state.disabled).toBe(true); expect(state.intentions[0].status).toBe('cancelled');
    h.advance(); await h.loop.drain(h.delivery); expect(h.delivery.send).not.toHaveBeenCalled();
  });
  it('does not apply an assessment control that outlived its accepted revision', async () => {
    const h = harness(); h.deps.applyScopedControl = vi.fn(async () => undefined);
    h.assess.mockImplementationOnce(async () => { await h.loop.control(key, 'resume'); return { control: { action: 'stop' } }; });
    await h.turn(); expect(h.deps.applyScopedControl).not.toHaveBeenCalled();
  });
  it('keeps an assessed stop authoritative after a new binding creates a fresh core key', async () => {
    const h = harness(); let stopped = false;
    h.authorize.mockImplementation(async () => stopped ? null : { fingerprint: 'policy-1' });
    h.deps.applyScopedControl = vi.fn(async (target, action) => { stopped = action === 'stop'; await h.loop.control(target, action); });
    h.assess.mockResolvedValueOnce({ control: { action: 'stop' } });
    await h.turn('boundary');
    const rebound: RelationshipKey = { ...key, scope: { ...scope, bindingId: 'new-thirty-day-link' } };
    await h.turn('after-rebinding', 'This is ongoing', rebound);
    expect(h.assess).toHaveBeenCalledTimes(1); expect((await h.store.read(rebound)).preferences).toEqual([]); expect((await h.store.read(rebound)).intentions).toEqual([]);
  });
  it.each([undefined, ['source']])('erases in-flight private evidence before forget acknowledges (%s)', async sourceIds => {
    const h = harness(); await h.turn('source', 'ERASE_TIMING_CANARY is ongoing');
    await h.store.update(key, state => { const job = state.intentions[0]; job.status = 'sending'; job.leaseOwner = 'worker'; job.leaseUntil = '2026-10-19T13:00:00Z'; });
    await h.loop.invalidate(key, { sourceIds, reason: 'source_deleted' });
    const state = await h.store.read(key);
    expect(state.intentions[0]).toMatchObject({ status: 'delivery_unknown', purpose: '', topic: '', sourceIds: [] });
    expect(state.intentions[0].timing).toBeUndefined(); expect(state.intentions[0].leaseOwner).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('ERASE_TIMING_CANARY');
    h.advance(); await h.loop.drain(h.delivery); expect(h.delivery.send).not.toHaveBeenCalled();
  });

  it('hashes every canonical scope field while preserving the legacy identity', () => {
    const { scope: _scope, ...legacy } = key; void _scope;
    expect(relationshipId(legacy)).toBe(createHash('sha256').update(JSON.stringify(['agent', 'chat', 'private', 'person'])).digest('hex'));
    for (const field of ['accountId', 'bindingId', 'tenantId', 'spaceId', 'containerId'] as const) expect(relationshipId({ ...key, scope: { ...scope, [field]: 'other' } })).not.toBe(relationshipId(key));
    const reverse = Object.fromEntries(Object.entries(scope).reverse()) as unknown as RelationshipScope;
    expect(relationshipId({ ...key, scope: reverse })).toBe(relationshipId(key));
    expect(relationshipId(key)).not.toBe(relationshipId(legacy));
  });
  it('rejects incomplete or widened scope and a mismatched private audience', () => {
    expect(() => relationshipId({ ...key, scope: { ...scope, containerId: '' } })).toThrow();
    expect(() => relationshipId({ ...key, scope: { ...scope, extra: true } as RelationshipScope })).toThrow();
    expect(() => relationshipId({ ...key, audience: { kind: 'private', personId: 'other' } })).toThrow();
  });
  it('separates Work and Personal state, controls and queued purposes for the same person', async () => {
    const h = harness();
    const work: RelationshipKey = { ...key, scope: { ...scope, space: 'work', spaceId: 'work-space' } };
    await h.turn();
    expect(await h.loop.context(work)).toBe('');
    await h.loop.control(work, 'stop');
    expect((await h.loop.status(key)).disabled).toBe(false);
    expect((await h.loop.status(work)).disabled).toBe(true);
    expect((await h.loop.status(key)).intentions[0].key.scope).toEqual(scope);
    expect((await h.loop.status(work)).intentions).toEqual([]);
  });
  it.each(['live', 'shadow'] as const)('fails quiet before any provider without an authority hook in %s', async (mode) => {
    const h = harness(false); h.deps.mode = mode;
    await h.turn(); h.advance(); await h.loop.drain(h.delivery);
    expect(h.assess).not.toHaveBeenCalled(); expect(h.choose).not.toHaveBeenCalled(); expect(h.classify).not.toHaveBeenCalled(); expect(h.delivery.send).not.toHaveBeenCalled();
    expect(await h.loop.context(key)).toBe('');
  });
  it('purges stale derivatives after revocation during assessment while retaining controls and replay fences', async () => {
    const h = harness();
    await h.loop.configure(key, { timeZone: 'Europe/Tallinn', quietHours: { start: 23, end: 7 } });
    h.assess.mockImplementationOnce(async () => { h.revoke(); return { preferences: [{ key: 'style', value: 'REVOKED_CANARY' }] }; });
    expect((await h.turn()).context).toBe('');
    const state = await h.loop.status(key);
    expect(state.preferences).toEqual([]); expect(state.situations).toEqual([]); expect(state.intentions).toEqual([]);
    expect(state.timeZone).toBe('Europe/Tallinn'); expect(state.quietHours).toEqual({ start: 23, end: 7 }); expect(state.eventIds).toContain('source');
  });
  it('treats a changed fingerprint as revoked even when the hook returns a permit', async () => {
    const h = harness();
    h.assess.mockImplementationOnce(async () => { h.changePolicy(); return { preferences: [{ key: 'style', value: 'STALE_CANARY' }] }; });
    expect((await h.turn()).context).toBe(''); expect((await h.loop.status(key)).preferences).toEqual([]);
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ expectedFingerprint: 'policy-1' }));
  });
  it('does not export an accepted snapshot when local forget races with authorization', async () => {
    const h = harness();
    h.authorize.mockImplementationOnce(async () => { await h.loop.control(key, 'forget'); return { fingerprint: 'policy-1' }; });
    expect((await h.turn()).context).toBe(''); expect(h.assess).not.toHaveBeenCalled(); expect(h.classify).not.toHaveBeenCalled();
  });
  it('redacts a status snapshot changed during authorization while preserving current stop controls', async () => {
    const h = harness(); await h.turn();
    h.authorize.mockImplementationOnce(async () => { await h.loop.control(key, 'stop'); return { fingerprint: 'policy-1' }; });
    const state = await h.loop.status(key);
    expect(state.disabled).toBe(true); expect(state.timeZone).toBe('UTC'); expect(state.preferences).toEqual([]); expect(state.situations).toEqual([]);
  });
  it('keeps stop, pause, forget and resume operable without turning resume into authority', async () => {
    const h = harness(); await h.turn(); h.revoke();
    await h.turn('stop', 'stop following up');
    expect((await h.loop.status(key)).disabled).toBe(true);
    await h.loop.control(key, 'pause'); expect((await h.loop.status(key)).pausedUntil).toBeDefined();
    await h.loop.control(key, 'forget'); await h.loop.control(key, 'resume');
    await h.turn('new'); h.advance(); await h.loop.drain(h.delivery);
    expect(h.assess).toHaveBeenCalledTimes(1); expect(h.delivery.send).not.toHaveBeenCalled(); expect(await h.loop.context(key)).toBe('');
    expect((await h.loop.status(key)).forgottenSourceIds).toContain('source');
  });
  it('checks every loaded lineage including preferences, situations, jobs, outreach and feedback', async () => {
    const h = harness(); await h.turn();
    await h.store.update(key, (s) => {
      s.preferences.push({ key: 'extra', value: 'preference', sourceId: 'preference', sourceIds: ['preference-ancestor'], updatedAt: '2026-10-19T12:00:00Z' });
      s.situations[0].sourceIds.push('situation'); s.intentions[0].sourceIds.push('job');
      s.lastOutreach = { intentionId: 'old', topic: 'topic', sourceIds: ['outreach'], sentAt: '2026-10-19T12:00:00Z' };
      s.feedback = [{ id: 'feedback', sourceId: 'feedback-turn', sourceIds: ['feedback-ancestor'], intentionId: 'old', at: '2026-10-19T12:00:00Z', outcome: 'correction', scope: 'message' }];
    });
    h.authorize.mockClear(); await h.loop.context(key);
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: expect.arrayContaining(['source', 'preference', 'preference-ancestor', 'situation', 'job', 'outreach', 'feedback-turn', 'feedback-ancestor']) }));
    h.authorize.mockClear(); await h.turn('next');
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ phase: 'observe', sourceIds: expect.arrayContaining(['next', 'source', 'preference-ancestor', 'situation', 'job', 'outreach', 'feedback-ancestor']) }));
    expect((await h.store.read(key)).preferences.find((p) => p.key === 'style')?.sourceIds).toContain('feedback-ancestor');
  });
  it.each(['compose', 'review'] as const)('blocks a revocation during %s before later provider export or sending', async (phase) => {
    const h = harness(); await h.turn(); h.advance();
    if (phase === 'compose') h.delivery.compose = vi.fn(async () => { h.revoke(); return 'Revoked detailed draft'; });
    else h.choose.mockImplementationOnce(async () => { h.revoke(); return 'send'; });
    await h.loop.drain(h.delivery);
    if (phase === 'compose') expect(h.choose).not.toHaveBeenCalled();
    expect(h.delivery.send).not.toHaveBeenCalled(); expect(await h.loop.context(key)).toBe('');
    const state = await h.loop.status(key); expect(state.preferences).toEqual([]); expect(state.situations).toEqual([]); expect(state.forgottenSourceIds).toContain('source');
  });
  it('rechecks authority after external context awaits and before composition', async () => {
    const h = harness(); await h.turn(); h.advance();
    h.delivery.loadContext = vi.fn(async () => { h.revoke(); return 'Stale external private history'; });
    await h.loop.drain(h.delivery);
    expect(h.delivery.compose).not.toHaveBeenCalled(); expect(h.choose).not.toHaveBeenCalled(); expect(h.delivery.send).not.toHaveBeenCalled();
  });
});

it('suspended use cancels old tasks but retains primary context and normal source lineage for fresh resume', async () => {
  const h = harness(); await h.turn('retained-source'); const before = await h.store.read(key);
  h.deps.synchronize = async () => 'suspended_use'; h.revoke();
  expect(await h.loop.context(key)).toBe(''); const paused = await h.store.read(key);
  expect(paused.preferences).toEqual(before.preferences); expect(paused.situations).toEqual(before.situations); expect(paused.forgottenSourceIds).toEqual(before.forgottenSourceIds);
  expect(paused.intentions[0]).toMatchObject({status:'cancelled',purpose:'',topic:'',sourceIds:[]});
  h.changePolicy(); expect(await h.loop.context(key)).toContain('PERSONAL_CANARY');
  h.advance(); await h.loop.drain(h.delivery); expect(h.delivery.send).not.toHaveBeenCalled();
});
