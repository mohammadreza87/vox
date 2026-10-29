/** AM-03 R13: real Telegram retry loop through both production relationship adapters. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { am03Fixture, connectFailure, deferred, DUE, START, record, type Am03Fixture } from './am03-stop-fixture';

const open: Am03Fixture[] = [];
let noNetwork: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(START); noNetwork = vi.fn(() => { throw Error('AM03_UNEXPECTED_NETWORK'); }); vi.stubGlobal('fetch', noNetwork); });
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); for (const f of open.splice(0)) f.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function setup(legacy: boolean) { const f = await am03Fixture(legacy); open.push(f); return f; }

describe.sequential('AM03 current relationship transport authority', () => {
  it('R13 both adapters send when authorized, then deny retry after stop commits in connection delay', async () => {
    for (const legacy of [false, true]) {
      const adapter = legacy ? 'legacy-service' : 'scoped-drain';
      // Positive capability uses the real observeTurn-produced intention (not a fabricated authorizing job).
      const positive = await setup(legacy); positive.at(DUE);
      const report = await positive.h.studio.drainRelationships();
      expect(report.sent).toBe(1); expect(positive.proactive()).toHaveLength(1);
      expect((await positive.store.read(positive.key)).intentions[0].status).toBe('sent');
      await record('R13', `${adapter}-authorized-positive`, positive);

      const f = await setup(legacy), entered = deferred(); let attempts = 0;
      f.fetchHook(async () => { attempts++; entered.resolve(); throw connectFailure(); });
      f.at(DUE); const drain = f.h.studio.drainRelationships();
      await Promise.race([entered.promise, drain.then(() => { throw Error(`${adapter}: actual retry consumer did not enter transport`); })]);
      await vi.advanceTimersByTimeAsync(0); // settle rejection into the client's existing 250ms connection delay
      expect(attempts).toBe(1); f.trace.push({ event: 'known-pre-send-failure-and-retry-delay', at: f.h.clock.now.getTime() });
      await f.inbound('Please stop messaging me.');
      expect((await f.store.read(f.key)).disabled).toBe(true);
      expect(f.ledger().routines.every(r => r.status === 'stopped')).toBe(true);
      f.trace.push({ event: 'stop-commit-before-delay-release', at: f.h.clock.now.getTime() });
      await vi.advanceTimersByTimeAsync(250); await drain;
      expect(attempts).toBe(1); expect(f.proactive()).toHaveLength(1);
      f.reconstruct(); f.at(START + 86400_000 + 60_000); await f.h.studio.drainRelationships();
      expect(attempts).toBe(1); expect(f.proactive()).toHaveLength(1);
      if (!legacy) {
        const document = f.account();
        expect(document.relationships.ledger).toHaveLength(1);
        expect(document.relationships.ledger[0].state).toBe('unknown');
        expect(document.relationships.inbox.every((r: { text: string; status: string }) => !r.text || r.status === 'cancelled')).toBe(true);
      }
      await record('R13', `${adapter}-known-no-effect-stop-during-retry`, f);
    }
  });
});
