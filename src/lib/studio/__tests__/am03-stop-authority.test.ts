/** Supplemental fixed AM-03 conjunction packet; separate from R01–R13 chronology. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { MEMORY_ACCOUNT_MARKER, MEMORY_ACCOUNT_MARKER_BYTES, MEMORY_ACCOUNT_TIME } from '../../adaptive/memory-account-lifecycle';
import { StudioMemoryAccount } from '../memory-account';
import { encryptSecret } from '../crypto';
import { ID, SECRET } from './helpers';
import { am03Fixture, connectFailure, deferred, DUE, START, record, type Am03Fixture } from './am03-stop-fixture';

const open: Am03Fixture[] = [];
let noNetwork: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(START); noNetwork = vi.fn(() => { throw Error('AM03_UNEXPECTED_NETWORK'); }); vi.stubGlobal('fetch', noNetwork); });
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); for (const f of open.splice(0)) f.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function setup(legacy: boolean) { const f = await am03Fixture(legacy); open.push(f); return f; }
async function afterKnownFailure(f: Am03Fixture, mutation: () => void | Promise<void>) {
  const entered = deferred(); let attempts = 0;
  f.fetchHook(async () => { attempts++; entered.resolve(); throw connectFailure(); });
  f.at(DUE); const drain = f.h.studio.drainRelationships();
  await Promise.race([entered.promise, drain.then(() => { throw Error('Supplemental positive precondition: real consumer did not enter transport'); })]);
  await vi.advanceTimersByTimeAsync(0); expect(attempts).toBe(1);
  await mutation(); f.trace.push({ event: 'conjunction-revoked-before-retry', at: f.h.clock.now.getTime() });
  await vi.advanceTimersByTimeAsync(250); await drain;
  expect(attempts).toBe(1); expect(f.proactive()).toHaveLength(1);
}
const common = ['missing-reader', 'busy-reader', 'unsupported-reader', 'marked', 'job-revision', 'job-status', 'lease-expiry', 'contact-stop', 'studio-token', 'cohort-disable', 'agent-inactive', 'prior-contact-source'] as const;
type Common = typeof common[number];
async function deny(f: Am03Fixture, kind: Common) {
  if (kind === 'missing-reader') Object.defineProperty(f.store, 'readCommittedForEffect', { value: undefined });
  else if (kind === 'busy-reader') vi.spyOn(f.store, 'readCommittedForEffect').mockImplementation(() => { throw Error('SYNTHETIC_COMMITTED_READER_BUSY'); });
  else if (kind === 'unsupported-reader') Object.defineProperty(f.store, 'readCommittedForEffect', { value: () => undefined });
  else if (kind === 'marked') {
    const directory = join(f.h.dir, 'adaptive');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!f.h.studio.deps.adaptive) f.h.studio.deps.adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)));
    writeFileSync(join(directory, MEMORY_ACCOUNT_MARKER), MEMORY_ACCOUNT_MARKER_BYTES, { flag: 'wx' });
    writeFileSync(join(directory, MEMORY_ACCOUNT_TIME), JSON.stringify({ version: 1, highWaterMs: DUE }) + '\n', { flag: 'wx' });
    f.h.studio.deps.memoryAccount = new StudioMemoryAccount(f.h.studio, { clock: () => f.h.clock.now.getTime() });
  } else if (kind === 'job-revision') await f.store.update(f.key, s => { s.revision++; s.intentions[0].revision++; });
  else if (kind === 'job-status') await f.store.update(f.key, s => { s.intentions[0].status = 'cancelled'; });
  else if (kind === 'lease-expiry') await f.store.update(f.key, s => { s.intentions[0].leaseUntil = new Date(DUE).toISOString(); });
  else if (kind === 'contact-stop') await f.loop.control(f.key, 'stop');
  else if (kind === 'studio-token') await f.h.store.update(s => { s.agents[0].tokenEnc = encryptSecret('am03-supplemental-rotation', SECRET); });
  else if (kind === 'cohort-disable') f.h.studio.deps.relationshipConfig!.agentIds = ['different-synthetic-agent'];
  else if (kind === 'agent-inactive') await f.h.store.update(s => { s.agents[0].status = 'fired'; });
  else if (!f.authority) await f.store.update(f.key, s => { s.eventIds = []; });
  else await f.adaptive!.withAccountDocument(ID.superadmin, d => { d.relationships.sources[0].status = 'deleted'; });
}

describe.sequential('AM03 supplemental final fetch conjunctions', () => {
  for (const legacy of [false, true]) {
    const adapter = legacy ? 'legacy' : 'scoped';
    it.each(common)(`${adapter}: %s denies the next actual fetch after connection delay`, async kind => {
      const f = await setup(legacy); await afterKnownFailure(f, () => deny(f, kind)); await record('S01', `${adapter}-${kind}`, f);
    });
  }
  it.each(['fingerprint', 'reservation', 'inbox-deadline', 'source-deadline', 'endpoint'] as const)('scoped: %s authority change denies next actual fetch', async kind => {
    const f = await setup(false);
    await afterKnownFailure(f, () => f.adaptive!.withAccountDocument(ID.superadmin, d => {
      if (kind === 'fingerprint') d.experience.settings.revision++;
      else if (kind === 'reservation') d.relationships.ledger[0].reservationId = 'different-synthetic-reservation';
      else if (kind === 'inbox-deadline') d.relationships.inbox[0].expiresAt = DUE;
      else if (kind === 'source-deadline') d.relationships.sources[0].expiresAt = DUE;
      else d.relationships.sources[0].endpointId = 'different-synthetic-endpoint';
    })); await record('S02', `scoped-${kind}`, f);
  });
  it('legacy: unavailable synchronous history epoch probe denies initial fetch', async () => {
    const f = await setup(true), original = f.h.memory.history.epochProbe!.bind(f.h.memory.history);
    vi.spyOn(f.h.memory.history, 'epochProbe').mockImplementation(async persona => { const probe = await original(persona); return { key: probe.key, value: probe.value }; });
    f.at(DUE); await f.h.studio.drainRelationships(); expect(f.proactive()).toEqual([]); await record('S03', 'legacy-missing-history-local-probe', f);
  });
});
