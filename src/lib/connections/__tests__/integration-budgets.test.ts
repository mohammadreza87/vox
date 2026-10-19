import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { ConnectionsBudgetLedger } from '../budgets';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const base = { accountId: 'qa-budget-account', space: 'work' as const, providerId: 'github', kind: 'tool_calls' as const,
  requestId: 'qa-budget-request', units: 1, ceiling: 5 };
describe('independent durable budget reservations', () => {
  it('atomically admits exactly the configured number of concurrent calls', async () => {
    const ledger = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage(), () => NOW);
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => ledger.reserve({ ...base, requestId: `qa-${i}` })));
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(5);
    expect(attempts.filter(a => a.status === 'rejected').every(a => a.status === 'rejected' && a.reason.code === 'budget_exhausted')).toBe(true);
  });

  it('duplicate reservations cannot spend twice or reset a consumed reservation after failure', async () => {
    const ledger = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage(), () => NOW);
    const attempts = await Promise.allSettled([ledger.reserve(base), ledger.reserve(base), ledger.reserve(base)]);
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(a => a.status === 'rejected').every(a => a.status === 'rejected' && a.reason.code === 'budget_reservation_replayed')).toBe(true);
    await expect(ledger.reserve({ ...base, units: 2 })).rejects.toMatchObject({ code: 'budget_reservation_replayed' });
  });

  it.each([0, -1, NaN, Infinity, 1.5])('unconfigured or invalid ceiling %s fails before spend', async ceiling => {
    const ledger = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage(), () => NOW);
    await expect(ledger.reserve({ ...base, ceiling })).rejects.toMatchObject({ code: 'budget_not_configured' });
  });

  it('keeps account, provider, space, day and model/tool counters separate', async () => {
    let time = NOW; const ledger = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage(), () => time);
    await ledger.reserve({ ...base, ceiling: 1 });
    await ledger.reserve({ ...base, ceiling: 1, accountId: 'qa-other-account' });
    await ledger.reserve({ ...base, ceiling: 1, providerId: 'notion' });
    await ledger.reserve({ ...base, ceiling: 1, space: 'personal' });
    await ledger.reserve({ ...base, ceiling: 1, kind: 'model_tokens' });
    await expect(ledger.reserve({ ...base, ceiling: 1, requestId: 'second-same-partition' })).rejects.toMatchObject({ code: 'budget_exhausted' });
    time += 86_400_000; await expect(ledger.reserve({ ...base, ceiling: 1 })).resolves.toBeUndefined();
  });

  it('an exhausted reservation does not consume the remaining capacity or become a refundable reservation', async () => {
    const ledger = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage(), () => NOW);
    await ledger.reserve({ ...base, units: 4 });
    await expect(ledger.reserve({ ...base, requestId: 'too-large', units: 2 })).rejects.toMatchObject({ code: 'budget_exhausted' });
    await ledger.reserve({ ...base, requestId: 'last-unit' });
    await expect(ledger.reserve({ ...base, requestId: 'over-cap' })).rejects.toMatchObject({ code: 'budget_exhausted' });
  });

  it('fresh file-store and ledger instances retain reservations and enforce concurrency across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-independent-budgets-'));
    try {
      const first = new ConnectionsBudgetLedger(new FileAdaptiveStorage(directory), () => NOW);
      await first.reserve({ ...base, ceiling: 2 });
      const restarted = new ConnectionsBudgetLedger(new FileAdaptiveStorage(directory), () => NOW);
      await expect(restarted.reserve({ ...base, ceiling: 2 })).rejects.toMatchObject({ code: 'budget_reservation_replayed' });
      const attempts = await Promise.allSettled([
        first.reserve({ ...base, ceiling: 2, requestId: 'concurrent-first' }),
        restarted.reserve({ ...base, ceiling: 2, requestId: 'concurrent-restarted' }),
      ]);
      expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
      const afterRestart = new ConnectionsBudgetLedger(new FileAdaptiveStorage(directory), () => NOW);
      await expect(afterRestart.reserve({ ...base, ceiling: 2, requestId: 'third-process' })).rejects.toMatchObject({ code: 'budget_exhausted' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
