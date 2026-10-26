/**
 * Hardening H1 (F046, F085, F137, F173, F215): audit and notice writes on the
 * memory write path are bounded by AUDIT_WRITE_TIMEOUT_MS and a failure leaves
 * one fixed, content-free log line; a failed retention sweep is reported
 * through onError('sweep_failed'). The memory result never changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_WRITE_TIMEOUT_MS,
  auditMemoryStore,
  auditShareOfferStore,
  InMemoryAuditStore,
  InMemorySupersededNoticeStore,
  noticeErasingMemoryStore,
  startAuditRetentionSweep,
} from '../audit';
import { InMemoryMemoryStore, InMemoryShareOfferStore, type NewMemory } from '../memory/store';

const CONTENT = 'canary-content-Reza-prefers-mornings';
let seq = 0;
function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria', content: CONTENT, topic: 'canary-topic', type: 'fact',
    scope: { kind: 'people', personIds: ['milad', 'reza'] }, authorizedPersonIds: ['milad', 'reza'],
    sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-signal-${++seq}`] },
    ...overrides,
  };
}

const logger = () => ({ warn: vi.fn() });
const lines = (log: { warn: ReturnType<typeof vi.fn> }) => log.warn.mock.calls.map((call) => call.map(String).join(' '));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('audit write signals (H1)', () => {
  it('a rejecting audit.append logs exactly [vox] audit_append_failed and the memory add still resolves', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockRejectedValue(new Error(`permission-denied ${CONTENT}`));
    const log = logger();
    const inner = new InMemoryMemoryStore();
    const store = auditMemoryStore(inner, audit, undefined, { log });
    const record = await store.add(newMemory());
    expect(await inner.get(record.id)).toMatchObject({ id: record.id });
    expect(lines(log)).toEqual(['[vox] audit_append_failed']);
  });

  it('a never-settling append resolves the memory write after AUDIT_WRITE_TIMEOUT_MS and logs audit_append_timeout', async () => {
    vi.useFakeTimers();
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    expect(AUDIT_WRITE_TIMEOUT_MS).toBe(2000);
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockReturnValue(new Promise(() => undefined));
    const log = logger();
    const store = auditMemoryStore(new InMemoryMemoryStore(), audit, undefined, { log });
    let resolved = false;
    const write = store.add(newMemory()).then((record) => { resolved = true; return record; });
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const record = await write;
    expect(resolved).toBe(true);
    expect(record.content).toBe(CONTENT);
    expect(lines(log)).toEqual(['[vox] audit_append_timeout']);
  });

  it('a rejecting notices.deleteByMemoryIds on delete logs notice_erasure_failed and the delete result is unchanged', async () => {
    for (const auditLog of ['1', '']) {
      vi.stubEnv('TIREH_AUDIT_LOG', auditLog);
      const notices = new InMemorySupersededNoticeStore();
      vi.spyOn(notices, 'deleteByMemoryIds').mockRejectedValue(new Error('unavailable'));
      const log = logger();
      const inner = new InMemoryMemoryStore();
      const store = auditMemoryStore(inner, new InMemoryAuditStore(), notices, { log });
      const record = await inner.add(newMemory());
      expect(await store.delete(record.id)).toEqual([record.id]);
      expect(await inner.get(record.id)).toBeNull();
      expect(lines(log)).toEqual(['[vox] notice_erasure_failed']);
    }

    const notices = new InMemorySupersededNoticeStore();
    vi.spyOn(notices, 'deleteByMemoryIds').mockRejectedValue(new Error('unavailable'));
    const log = logger();
    const inner = new InMemoryMemoryStore();
    const erasing = noticeErasingMemoryStore(inner, notices, { log });
    const record = await inner.add(newMemory());
    expect(await erasing.delete(record.id)).toEqual([record.id]);
    expect(lines(log)).toEqual(['[vox] notice_erasure_failed']);
  });

  it('a rejecting notices.record on a supersede logs notice_record_failed and the add still resolves', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const notices = new InMemorySupersededNoticeStore();
    vi.spyOn(notices, 'record').mockRejectedValue(new Error('unavailable'));
    const log = logger();
    const inner = new InMemoryMemoryStore();
    const store = auditMemoryStore(inner, new InMemoryAuditStore(), notices, { log });
    const first = await inner.add(newMemory());
    const next = await store.add(newMemory({ supersedes: first.id }));
    expect(await inner.get(next.id)).toMatchObject({ id: next.id });
    expect(lines(log)).toEqual(['[vox] notice_record_failed']);
  });

  it('a rejecting share-offer audit append logs audit_append_failed and the offer is still created', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockRejectedValue(new Error('unavailable'));
    const log = logger();
    const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit, { log });
    const offer = await offers.create({ personaId: 'aria', memoryId: 'm-offer', ownerPersonId: 'reza', proposedAudiencePersonIds: ['milad'],
      proposedScope: { kind: 'people', personIds: ['milad', 'reza'] } });
    expect(offer.memoryId).toBe('m-offer');
    expect(lines(log)).toEqual(['[vox] audit_append_failed']);
  });

  it('no log line carries a memory id, a person id or content', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockRejectedValue(new Error(`row ${CONTENT}`));
    const notices = new InMemorySupersededNoticeStore();
    vi.spyOn(notices, 'record').mockRejectedValue(new Error('unavailable'));
    vi.spyOn(notices, 'deleteByMemoryIds').mockRejectedValue(new Error('unavailable'));
    const log = logger();
    const inner = new InMemoryMemoryStore();
    const store = auditMemoryStore(inner, audit, notices, { log });
    const first = await store.add(newMemory());
    const next = await store.add(newMemory({ supersedes: first.id }));
    await store.update(next.id, { confidence: 0.5 });
    await store.delete(next.id);
    const logged = lines(log);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).toMatch(/^\[vox\] (audit_append_failed|audit_append_timeout|notice_record_failed|notice_erasure_failed)$/);
      for (const forbidden of [first.id, next.id, 'reza', 'milad', 'aria', CONTENT, 'canary-topic']) expect(line).not.toContain(forbidden);
    }
  });

  it('a throwing logger never changes the memory result', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockRejectedValue(new Error('unavailable'));
    const store = auditMemoryStore(new InMemoryMemoryStore(), audit, undefined, { log: { warn: () => { throw new Error('logger down'); } } });
    await expect(store.add(newMemory())).resolves.toMatchObject({ content: CONTENT });
  });

  it('defaults to console.warn with the fixed code', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const audit = new InMemoryAuditStore();
    vi.spyOn(audit, 'append').mockRejectedValue(new Error('unavailable'));
    await auditMemoryStore(new InMemoryMemoryStore(), audit).add(newMemory());
    expect(warn).toHaveBeenCalledWith('[vox] audit_append_failed');
  });
});

describe('audit retention sweep signal (H1, F215)', () => {
  it("startAuditRetentionSweep reports a rejected sweep through onError('sweep_failed') and never throws", async () => {
    const store = { sweep: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const onError = vi.fn();
    const handle = startAuditRetentionSweep(store, { now: () => new Date('2026-10-25T00:00:00Z'), onError });
    await handle.flush();
    handle.stop();
    expect(store.sweep).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('sweep_failed');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a throwing onError is ignored', async () => {
    const store = { sweep: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const handle = startAuditRetentionSweep(store, { onError: () => { throw new Error('callback down'); } });
    await expect(handle.flush()).resolves.toBeUndefined();
    handle.stop();
  });

  it('a successful sweep reports nothing', async () => {
    const onError = vi.fn();
    const handle = startAuditRetentionSweep(new InMemoryAuditStore(), { onError });
    await handle.flush();
    handle.stop();
    expect(onError).not.toHaveBeenCalled();
  });
});
