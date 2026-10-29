/** Independent AM-03 frozen R01–R12 chronology. Never access live accounts/providers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encryptSecret } from '../crypto';
import { RoutineFileStore } from '../routines/store';
import type { RoutineLedger } from '../routines';
import { StudioMemoryAccount } from '../memory-account';
import { MEMORY_ACCOUNT_MARKER, MEMORY_ACCOUNT_MARKER_BYTES, MEMORY_ACCOUNT_TIME } from '../../adaptive/memory-account-lifecycle';
import { ID, SECRET } from './helpers';
import { setFileRuntimeIoHooks, resetFileRuntimeIoHooks } from '../../../test/fro1-io-fixture';
vi.mock('../file-runtime-owner', async importOriginal => {
  const actual = await importOriginal<typeof import('../file-runtime-owner')>();
  const { instrumentFileRuntime } = await import('../../../test/fro1-io-fixture');
  return instrumentFileRuntime(actual);
});
import { am03Fixture, assertScopedAck, deferred, DUE, STOP, START, record, type Am03Fixture } from './am03-stop-fixture';

const open: Am03Fixture[] = [];
let noNetwork: ReturnType<typeof vi.fn>;
const setup = async (legacy = false) => { const f = await am03Fixture(legacy); open.push(f); return f; };
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(START); noNetwork = vi.fn(() => { throw Error('AM03_UNEXPECTED_NETWORK'); }); vi.stubGlobal('fetch', noNetwork); });
afterEach(() => { resetFileRuntimeIoHooks(); expect(noNetwork).not.toHaveBeenCalled(); for (const f of open.splice(0)) f.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const stopped = (f: Am03Fixture) => f.ledger().routines.every(r => r.status === 'stopped' && !r.instruction && r.nextRunAt === null && r.recentLessons.length === 0);
const contactStopped = (f: Am03Fixture) => f.account().relationships.controls.some((c: { agentId: string; space: string; disabled: boolean }) => c.agentId === f.hired.agent.id && c.space === 'work' && c.disabled);
const ack = (f: Am03Fixture) => f.effects.filter(e => e.method === 'sendMessage' && !e.proactive).at(-1)?.text ?? '';
async function due(f: Am03Fixture) { await f.engine().tick(); await f.h.studio.drainRelationships(); }
async function broad(id: string, text: string) {
  const f = await setup(), original = await f.state();
  f.at(STOP);
  f.ackHook(text => {
    expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(true);
    expect(f.store.readCommittedForEffect(f.key).disabled).toBe(true);
    f.trace.push({ event: 'commits-observed-before-ack', at: f.h.clock.now.getTime() }); assertScopedAck(text, true, true);
  });
  await f.inbound(text, 60001); f.ackHook(undefined);
  expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(true);
  await record(id, 'committed-scope', f);
  f.at(DUE); await due(f); f.reconstruct(); f.at(START + 86400_000 + 60_000); await due(f);
  await f.inbound(text, 60001); // one fixed inbound replay after reconstruction
  expect(stopped(f)).toBe(true); expect(f.ledger().routines).toHaveLength(2); expect(f.proactive()).toEqual([]);
  const beforeAnswer = f.ledger().routines.length; await f.inbound('Europe/Tallinn', 60002);
  expect(f.ledger().routines).toHaveLength(beforeAnswer);
  const beforeReply = f.effects.length; await f.inbound('What does a seed need to grow?', 60003);
  expect(f.effects.length).toBeGreaterThan(beforeReply); expect(f.effects.at(-1)?.text).toBe('AM03_ORDINARY_REPLY');
  expect(original.daily).toHaveLength(2); await record(id, 'due-reconstruct-replay-pending-and-ordinary-reply', f);
}

describe.sequential('AM03 protected stop ingress chronology', () => {
  it('R01 EN broad stop commits both components before scoped acknowledgment', () => broad('R01', 'Please stop messaging me.'));
  it('R02 FA broad stop commits both components before scoped acknowledgment', () => broad('R02', 'دیگه بهم پیام نده.'));
  it('R03 explicit daily ID stops only alpha; beta and check-in retain delivery', async () => {
    const f = await setup(), [alpha, beta] = f.ledger().routines;
    f.at(STOP); await f.inbound(`/daily stop ${alpha.id}`);
    expect(f.ledger().routines.map(r => [r.id, r.status])).toEqual([[alpha.id, 'stopped'], [beta.id, 'active']]);
    expect(contactStopped(f)).toBe(false); expect(ack(f)).toContain(alpha.id); expect(ack(f)).not.toMatch(/check.?ins?.*(?:stopped|cancelled)/i);
    f.at(DUE); await due(f); expect(f.ledger().occurrences.filter(o => o.status === 'accepted')).toHaveLength(1);
    expect((await f.store.read(f.key)).intentions.some(j => j.status === 'sent')).toBe(true); await record('R03', 'targeted-daily-positive-other-lanes', f);
  });
  it('R04 named check-in control preserves both daily tasks', async () => {
    const f = await setup(); f.at(STOP); await f.inbound('Stop checking in.');
    expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(true);
    expect(ack(f)).toMatch(/check.?ins?.*stopped/i); expect(ack(f)).not.toMatch(/daily.*stopped/i);
    f.at(DUE); await due(f); expect(f.ledger().occurrences.filter(o => o.status === 'accepted')).toHaveLength(2);
    expect((await f.store.read(f.key)).intentions.every(j => j.status === 'cancelled')).toBe(true); await record('R04', 'targeted-checkins-positive-daily', f);
  });
  it('R05 bare stop retains relationship-only scope', async () => {
    const f = await setup(); f.at(STOP); await f.inbound('stop');
    expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(true);
    expect(ack(f)).toMatch(/check.?ins?.*stopped/i); expect(ack(f)).not.toMatch(/daily.*stopped/i); await record('R05', 'bare-stop', f);
  });
  it('R06 slash stop retains relationship-only scope', async () => {
    const f = await setup(); f.at(STOP); await f.inbound('/stop');
    expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(true);
    expect(ack(f)).toMatch(/check.?ins?.*stopped/i); expect(ack(f)).not.toMatch(/daily.*stopped/i); await record('R06', 'slash-stop', f);
  });
  it('R07 quoted, negative, question, reported and forwarded probes never mutate controls', async () => {
    const f = await setup(); f.at(STOP);
    const probes = [
      ['quotation', '> stop messaging me', {}], ['negation', 'Do not stop messaging me.', {}],
      ['question', 'What does stop messaging me mean?', {}], ['reported-speech', 'She said leave me alone.', {}],
      ['forwarding', 'stop messaging me', { forward_origin: { type: 'user' } }],
    ] as const;
    for (const [name, text, extra] of probes) {
      await f.inbound(text, undefined, extra);
      expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(false);
      expect(ack(f)).not.toMatch(/(?:daily lessons|check.?ins?)\s+are stopped/i);
      await record('R07', name, f);
    }
  });
  it('R08 all named scope/identity profiles retain guards and credential rotation semantics', async () => {
    for (const profile of ['marked', 'personal', 'group', 'voice', 'wrong-actor', 'wrong-agent', 'wrong-endpoint', 'stale-token', 'current-rotated-token'] as const) {
      const f = await setup(); f.at(STOP); const before = f.ledger();
      const manage = vi.spyOn(f.engine(), 'manage');
      if (profile === 'marked') {
        const directory = join(f.h.dir, 'adaptive');
        writeFileSync(join(directory, MEMORY_ACCOUNT_MARKER), MEMORY_ACCOUNT_MARKER_BYTES, { flag: 'wx' });
        writeFileSync(join(directory, MEMORY_ACCOUNT_TIME), JSON.stringify({ version: 1, highWaterMs: STOP }) + '\n', { flag: 'wx' });
        f.h.studio.deps.memoryAccount = new StudioMemoryAccount(f.h.studio, { clock: () => f.h.clock.now.getTime() });
        await f.inbound('Please stop messaging me.'); expect(manage).not.toHaveBeenCalled();
        expect(JSON.stringify(f.llm.mock.calls)).not.toContain(before.routines[0].instruction);
      } else if (profile === 'personal') {
        const { gateway } = await f.h.studio.gateway();
        for await (const value of gateway.liveTurn(f.hired.agent.id, `tg-${ID.superadmin}`, [{ role: 'user', content: 'Please stop messaging me.' }], { space: 'personal' })) void value;
        expect(manage).not.toHaveBeenCalled();
      } else if (profile === 'voice') {
        f.h.openai.transcribe.mockResolvedValue('Please stop messaging me.');
        // Existing voice control changes its pinned context revision and refuses stale output.
        await expect(f.h.studio.callTurn(f.org.superadmin, f.hired.agent.id, new ArrayBuffer(8), 'audio/webm')).rejects.toMatchObject({ status: 409, message: 'The conversation settings changed. Please try again.' });
        expect(manage).not.toHaveBeenCalled(); expect(contactStopped(f)).toBe(true);
        expect((await f.store.read(f.key)).disabled).toBe(true);
        expect(f.effects).toEqual([]); expect(f.h.eleven.speak).not.toHaveBeenCalled();
      } else if (profile === 'group') {
        await f.inbound('Please stop messaging me.', undefined, { chat: { type: 'group', id: -9900 } }); expect(manage).not.toHaveBeenCalled();
      } else if (profile === 'wrong-actor') {
        await f.inbound('Please stop messaging me.', undefined, { from: { id: ID.alice, is_bot: false, first_name: 'Synthetic Other' }, chat: { type: 'private', id: ID.alice } });
      } else if (profile === 'wrong-agent') await f.inbound('Please stop messaging me.', undefined, {}, undefined, 'unrelated-synthetic-agent');
      else if (profile === 'wrong-endpoint') await f.inbound('Please stop messaging me.', undefined, {}, 'unrelated-endpoint');
      else {
        const rotated = 'am03-synthetic-rotated-credential';
        await f.h.store.update(s => { s.agents.find(a => a.id === f.hired.agent.id)!.tokenEnc = encryptSecret(rotated, SECRET); });
        await f.inbound('Please stop messaging me.', undefined, {}, profile === 'stale-token' ? f.h.studio.relationshipEndpointId(f.hired.token) : f.h.studio.relationshipEndpointId(rotated));
      }
      if (profile === 'current-rotated-token') { expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(true); assertScopedAck(ack(f), true, true); }
      else {
        expect(f.ledger().routines).toEqual(before.routines);
        expect(ack(f)).not.toMatch(/daily lessons are stopped/i);
      }
      expect(Object.keys(f.binding)).not.toContain('space'); await record('R08', profile, f);
    }
    for (const profile of ['narrow-absent-endpoint', 'narrow-supplied-mismatch', 'broad-absent-endpoint'] as const) {
      const f = await setup(); f.at(STOP);
      await f.inbound(profile === 'broad-absent-endpoint' ? 'Please stop messaging me.' : '/stop', undefined, {}, profile === 'narrow-supplied-mismatch' ? 'supplied-wrong-endpoint' : null);
      expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true);
      if (profile === 'narrow-absent-endpoint') {
        expect(contactStopped(f)).toBe(true); expect((await f.store.read(f.key)).disabled).toBe(true);
        expect(ack(f)).toMatch(/stop initiating check.ins/i); expect(ack(f)).not.toMatch(/daily.*stopped/i);
      } else {
        expect(contactStopped(f)).toBe(false); expect((await f.store.read(f.key)).disabled).toBe(false);
        expect(f.effects.filter(e => e.method === 'sendMessage')).toEqual([]);
      }
      await record('R08', profile, f);
    }
    // Control callbacks keep their real FILE mutations; only scheduling is delayed.
    for (const legacy of [false, true]) {
      const f = await setup(legacy), entered = deferred(), release = deferred(); f.at(STOP);
      let pending: Promise<void>, blocker: Promise<unknown> | undefined;
      if (legacy) {
        const backend = f.store as unknown as { commit(states: unknown): Promise<void> };
        const originalCommit = backend.commit.bind(backend);
        vi.spyOn(backend, 'commit').mockImplementationOnce(async states => { entered.resolve(); await release.promise; await originalCommit(states); });
        blocker = f.store.update(f.key, state => { state.revision++; }); await entered.promise;
        const queued = deferred(), originalControl = f.loop.control.bind(f.loop);
        vi.spyOn(f.loop, 'control').mockImplementation((...args) => { queued.resolve(); return originalControl(...args); });
        pending = f.inbound('stop'); await queued.promise;
      } else {
        const storage = f.adaptive!.repository.storage, originalTransact = storage.transact.bind(storage);
        let controlEntered = false;
        const originalControl = f.authority!.control.bind(f.authority!);
        vi.spyOn(f.authority!, 'control').mockImplementation((...args) => { controlEntered = true; return originalControl(...args); });
        vi.spyOn(storage, 'transact').mockImplementation(async (...args) => {
          if (controlEntered) { controlEntered = false; entered.resolve(); await release.promise; }
          return originalTransact(...args);
        });
        pending = f.inbound('stop'); await entered.promise;
      }
      await f.h.store.update(state => { state.agents.find(a => a.id === f.hired.agent.id)!.tokenEnc = encryptSecret('am03-queued-rotation', SECRET); });
      release.resolve(); await blocker; await pending;
      expect((await f.store.read(f.key)).disabled).toBe(false);
      if (!legacy) expect(contactStopped(f)).toBe(false);
      expect(f.effects.filter(e => e.method === 'sendMessage')).toEqual([]);
      expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true);
      await record('R08', legacy ? 'legacy-real-queue-token-rotation' : 'scoped-storage-scheduling-token-rotation', f);
    }
    {
      const f = await setup(), entered = deferred(), release = deferred(); f.at(STOP);
      let controlling = false, held = false;
      const before = JSON.stringify(f.account().relationships), original = f.authority!.control.bind(f.authority!);
      vi.spyOn(f.authority!, 'control').mockImplementation((...args) => { controlling = true; return original(...args); });
      setFileRuntimeIoHooks({ afterTemporarySync: async path => {
        if (!controlling || held || !path.startsWith(join(f.h.dir, 'adaptive') + '/') || !path.endsWith('.tmp')) return;
        held = true; entered.resolve(); await release.promise;
      } });
      const pending = f.inbound('stop'); await entered.promise;
      await f.h.store.update(state => { state.agents.find(a => a.id === f.hired.agent.id)!.tokenEnc = encryptSecret('am03-publication-cut-rotation', SECRET); });
      release.resolve(); await pending; resetFileRuntimeIoHooks();
      expect(JSON.stringify(f.account().relationships)).toBe(before);
      expect((await f.store.read(f.key)).disabled).toBe(false); expect(f.effects.filter(e => e.method === 'sendMessage')).toEqual([]);
      await record('R08', 'scoped-real-temporary-sync-to-rename-token-rotation', f);
    }
  });
  it('R09 daily FILE transaction fails atomically and check-in success remains honest', async () => {
    const f = await setup(); f.at(STOP);
    const original = RoutineFileStore.prototype.transaction;
    const injected = vi.spyOn(RoutineFileStore.prototype, 'transaction').mockImplementation(function <T>(this: RoutineFileStore, callback: (ledger: RoutineLedger) => T): Promise<T> {
      return original.call(this, ledger => { const result = callback(ledger); if (ledger.routines.some(r => r.status === 'stopped')) throw Error('AM03_DAILY_COMMIT_FAILED'); return result; }) as Promise<T>;
    });
    await f.inbound('Please stop messaging me.'); injected.mockRestore();
    expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(true); assertScopedAck(ack(f), false, true);
    f.reconstruct(); expect(f.ledger().routines.every(r => r.status === 'active')).toBe(true); expect(contactStopped(f)).toBe(true); await record('R09', 'failed-atomic-daily-commit', f);
  });
  it('R10 relationship commit failure preserves daily success without full acknowledgment', async () => {
    const f = await setup(); f.at(STOP);
    const injected = vi.spyOn(f.authority!, 'control').mockRejectedValue(new Error('AM03_RELATIONSHIP_COMMIT_FAILED'));
    await f.inbound('Please stop messaging me.'); injected.mockRestore();
    expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(false); assertScopedAck(ack(f), true, false);
    f.reconstruct(); expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(false); await record('R10', 'failed-relationship-commit', f);
  });
  it('R11 stop during both actual consumer generations suppresses late canary export', async () => {
    const f = await setup(), dailyEntered = deferred(), relationshipEntered = deferred(), release = deferred();
    f.modelHook(async kind => { if (kind === 'daily') dailyEntered.resolve(); else if (kind === 'relationship') relationshipEntered.resolve(); else return 'AM03_ORDINARY_REPLY'; await release.promise; return 'AM03_GENERATED_CANCELLED_CANARY'; });
    f.at(DUE); const tick = f.engine().tick(), drain = f.h.studio.drainRelationships();
    await Promise.all([dailyEntered.promise, relationshipEntered.promise]);
    await f.inbound('Please stop messaging me.'); release.resolve(); await Promise.all([tick, drain]);
    expect(stopped(f)).toBe(true); expect(contactStopped(f)).toBe(true); expect(f.proactive()).toEqual([]);
    expect(JSON.stringify(await f.state())).not.toContain('AM03_GENERATED_CANCELLED_CANARY');
    f.reconstruct(); f.at(START + 86400_000 + 60_000); await due(f); expect(f.proactive()).toEqual([]); await record('R11', 'generation-stop-release-reconstruction', f);
  });
  it('R12 an already-entered POST remains unknown and is never resent after stop', async () => {
    const f = await setup(), entered = deferred(), release = deferred();
    f.fetchHook(async () => { entered.resolve(); await release.promise; throw new Error('AM03_AMBIGUOUS_AFTER_POST'); });
    f.at(DUE); const pending = f.engine().tick(); await entered.promise;
    await f.inbound('Please stop messaging me.'); release.resolve(); await pending;
    expect(f.proactive()).toHaveLength(1); expect(f.ledger().occurrences.some(o => o.status === 'unknown')).toBe(true);
    expect(ack(f)).not.toMatch(/unsent|recalled|never sent|پس گرفته/i);
    f.reconstruct(); f.at(START + 86400_000 + 60_000); await due(f);
    expect(f.proactive()).toHaveLength(1); expect(f.ledger().occurrences.some(o => o.status === 'unknown')).toBe(true); await record('R12', 'unknown-no-replay', f);
  });
});
