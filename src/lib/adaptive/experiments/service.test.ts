import { describe, expect, it } from 'vitest';
import { ControlledExperimentService, experimentUnit } from './service';
import { MemoryExperimentStorage } from './storage';
import { authority, config, NOW, privateScope, sharedScope, source } from './test-fixtures';
const fence = () => undefined;
function setup(c = config(), phase: 'off' | 'offline' | 'shadow' | 'pilot' = 'pilot') {
  const storage = new MemoryExperimentStorage(), service = new ControlledExperimentService(storage);
  service.install(c, NOW);
  const phases = ['offline', 'shadow', 'pilot'] as const;
  if (phase !== 'off') for (const [i, p] of phases.entries()) { service.transition(c.id, i + 1, p, NOW); if (p === phase) break; }
  return { service, storage };
}
describe('controlled experiments and derived-state rollback', () => {
  it('is default off; only sequential reviewed offline/shadow/pilot transitions enable presentation', () => {
    const storage = new MemoryExperimentStorage(), service = new ControlledExperimentService(storage);
    expect(service.prepare(authority(), source(), NOW, fence)).toBeUndefined(); expect(storage.read().derived).toHaveLength(0);
    service.install(config(), NOW);
    expect(() => service.transition(config().id, 1, 'pilot', NOW)).toThrow('transition');
    service.transition(config().id, 1, 'offline', NOW);
    expect(service.prepare(authority(), source(), NOW, fence)).toBeUndefined();
    service.transition(config().id, 2, 'shadow', NOW);
    expect(service.prepare(authority(), source(), NOW, fence)).toBeUndefined(); expect(storage.read().derived).toHaveLength(1); expect(storage.read().exposures).toHaveLength(0);
    service.transition(config().id, 3, 'pilot', NOW);
    expect(service.prepare(authority(), source(), NOW, fence)).toBeDefined();
  });
  it('rejects missing/unknown policy fields, self-review, unreviewed artifacts and stale revisions', () => {
    const { service } = setup(config(), 'off');
    expect(() => service.install({ ...config({ id: 'other' }), permissions: 'broader' }, NOW)).toThrow();
    expect(() => service.install(config({ id: 'other', review: { ...config().review, reviewer: config().review.owner } }), NOW)).toThrow();
    expect(() => service.install(config({ id: 'other', retention: undefined as never }), NOW)).toThrow();
    expect(() => service.transition(config().id, 2, 'offline', NOW)).toThrow('revision');
  });
  it('preserves person assignment across turns/agents and isolates work/personal and other people', () => {
    const { service, storage } = setup();
    const first = service.prepare(authority(), source('dm-one'), NOW, fence)!;
    const second = service.prepare(authority(), source('dm-two'), NOW + 1, fence)!;
    expect(second.density).toBe(first.density); expect(second.receipt).not.toBe(first.receipt); expect(storage.read().assignments).toHaveLength(1);
    service.prepare(authority(privateScope('bob')), source(), NOW, fence);
    service.prepare(authority({ ...privateScope(), space: 'personal' }), source(), NOW, fence);
    expect(storage.read().assignments).toHaveLength(3);
  });
  it('uses the exact selected container across DMs, with recipient order irrelevant and changed membership isolated', () => {
    const { service, storage } = setup(config({ assignmentKind: 'shared_container' }));
    const one = service.prepare(authority(sharedScope()), source('dm-one'), NOW, fence)!;
    const two = service.prepare(authority(sharedScope(['bob', 'alice'])), source('dm-two'), NOW, fence)!;
    expect(two.density).toBe(one.density); expect(storage.read().assignments).toHaveLength(1);
    service.prepare(authority(sharedScope(['alice', 'carol'])), source('dm-three'), NOW, fence);
    expect(storage.read().assignments).toHaveLength(2);
    expect(service.current(authority(sharedScope(['alice', 'carol'])), one, NOW)).toBe(false);
    expect(() => experimentUnit(sharedScope(['alice', 'alice']))).toThrow();
  });
  it('records actual exposure explicitly, idempotently, and denies mismatched unit, policy, receipt and expired acknowledgements', () => {
    const { service, storage } = setup(); const p = service.prepare(authority(), source(), NOW, fence)!;
    expect(storage.read().exposures).toHaveLength(0);
    expect(service.expose(authority(privateScope('bob')), p.receipt, NOW, fence).recorded).toBe(false);
    expect(service.expose(authority(undefined, 'd'.repeat(64)), p.receipt, NOW, fence).recorded).toBe(false);
    expect(service.expose(authority(), 'e'.repeat(64), NOW, fence).recorded).toBe(false);
    expect(service.expose(authority(), p.receipt, NOW, fence)).toEqual({ recorded: true, duplicate: false });
    expect(service.expose(authority(), p.receipt, NOW + 1, fence)).toEqual({ recorded: false, duplicate: true });
    expect(storage.read().exposures[0]).toMatchObject({ surface: 'text_rendered', trust: 'client_unverified', configRevision: 4 });
    expect(service.current(authority(), p, NOW + 10_000)).toBe(false);
  });
  it('keeps candidate/control derived state separate and kill quarantines it without touching canonical source/tombstones', () => {
    const { service, storage } = setup();
    const canonical = { memories: [{ id: 'canonical', text: 'SYNTHETIC_CANARY', status: 'deleted' }], deletionTombstones: ['canonical'] };
    const before = structuredClone(canonical);
    for (let i = 0; i < 30; i++) service.prepare(authority(privateScope(`person-${i}`)), source(), NOW, fence);
    const d = storage.read(); expect(new Set(d.derived.map(r => r.variant)).size).toBe(2);
    const p = service.prepare(authority(), source('latest'), NOW, fence)!;
    expect(service.current(authority(), p, NOW)).toBe(true);
    service.kill(config().id, 4, 'quarantine', NOW + 1);
    expect(storage.read().derived.every(r => r.state === 'quarantined')).toBe(true);
    expect(service.current(authority(), p, NOW + 1)).toBe(false);
    expect(service.prepare(authority(), source('queued'), NOW + 1, fence)).toBeUndefined();
    expect(service.expose(authority(), p.receipt, NOW + 1, fence).recorded).toBe(false);
    expect(canonical).toEqual(before); expect(JSON.stringify(storage.read())).not.toContain('SYNTHETIC_CANARY');
    service.kill(config().id, 5, 'purge', NOW + 1); expect(storage.read().derived).toEqual([]);
    expect(storage.read().tombstones).toHaveLength(1);
    expect(() => service.transition(config().id, 5, 'pilot', NOW)).toThrow();
    expect(() => service.install(config(), NOW)).toThrow('already exists');
  });
  it('deletion tombstones reject all source revisions after purge, rollback, and later experiment installation', () => {
    const { service, storage } = setup(); const p = service.prepare(authority(), source(), NOW, fence)!;
    service.expose(authority(), p.receipt, NOW, fence);
    service.deleteSource(privateScope(), source().id, NOW);
    expect(storage.read().derived).toEqual([]); expect(storage.read().exposures).toEqual([]);
    expect(service.prepare(authority(), { ...source(), revision: 2 }, NOW, fence)).toBeUndefined();
    service.kill(config().id, 4, 'purge', NOW);
    const next = config({ id: 'new-experiment', assignmentVersion: 2 }); service.install(next, NOW);
    for (const [i, phase] of ['offline', 'shadow', 'pilot'].entries()) service.transition(next.id, i + 1, phase as 'offline' | 'shadow' | 'pilot', NOW);
    expect(service.prepare(authority(), source(), NOW, fence)).toBeUndefined(); expect(storage.read().tombstones).toHaveLength(2);
  });
  it('fails closed on a policy fence change without recording assignment, derived state or exposure', () => {
    const { service, storage } = setup(); const before = storage.read();
    expect(() => service.prepare(authority(), source(), NOW, () => { throw new Error('revoked'); })).toThrow('revoked');
    expect(storage.read()).toEqual(before);
    const p = service.prepare(authority(), source(), NOW, fence)!;
    expect(() => service.expose(authority(), p.receipt, NOW, () => { throw new Error('paused'); })).toThrow('paused');
    expect(storage.read().exposures).toHaveLength(0);
  });
  it('predeclared assignment, exposure and failure stopping rules kill rather than expand a pilot', () => {
    const a = setup(config({ stoppingRules: { ...config().stoppingRules, maxAssignments: 1 } }));
    a.service.prepare(authority(), source(), NOW, fence); expect(a.service.prepare(authority(privateScope('bob')), source(), NOW, fence)).toBeUndefined();
    expect(a.storage.read().definitions[0]).toMatchObject({ phase: 'killed', stopReason: 'assignment_limit' });
    const e = setup(config({ stoppingRules: { ...config().stoppingRules, maxExposures: 1 } }));
    const p = e.service.prepare(authority(), source(), NOW, fence)!;
    expect(e.service.expose(authority(), p.receipt, NOW, fence).recorded).toBe(true);
    expect(e.storage.read().definitions[0]).toMatchObject({ phase: 'killed', stopReason: 'exposure_limit' });
    const f = setup(); f.service.failure(config().id, 4, NOW); f.service.failure(config().id, 5, NOW);
    expect(f.storage.read().definitions[0]).toMatchObject({ phase: 'killed', stopReason: 'failure_guardrail' });
  });
  it('expires effects at deadline and sweeps data at reviewed retention while preserving tombstones', () => {
    const { service, storage } = setup(); const p = service.prepare(authority(), source(), NOW, fence)!;
    service.expose(authority(), p.receipt, NOW, fence);
    service.sweep(NOW + 10_000); expect(storage.read().definitions[0].phase).toBe('killed'); expect(storage.read().derived).toEqual([]);
    expect(storage.read().exposures).toHaveLength(1);
    service.sweep(NOW + 20_000); expect(storage.read().assignments).toEqual([]); expect(storage.read().exposures).toEqual([]); expect(storage.read().tombstones).toHaveLength(1);
  });
});
