import { afterEach, expect, it, vi } from 'vitest';
import { PreferenceLearningTasks, type OwnedLearningTask } from './tasks';
const input = (telegramId = 1, space: 'work' | 'personal' = 'work') => ({ telegramId, space, agentId: 'agent1', text: 'PRIVATE_EPHEMERAL_CANARY', turn: { sessionId: 'session1', turnId: 'turn1', revision: 0, contextKey: 'context1' } });
afterEach(() => vi.useRealTimers());
it('owns all pending promises, bounds global/account-space work, clears raw input and refuses new work after shutdown', async () => {
  vi.useFakeTimers(); const seen: OwnedLearningTask[] = [], releases: Array<() => void> = [];
  const owner = new PreferenceLearningTasks(async task => { seen.push(task); await new Promise<void>(r => { releases.push(r); }); });
  expect(owner.enqueue(input())).toBe(true); expect(owner.enqueue({ ...input(), agentId: 'another' })).toBe(false); expect(owner.enqueue(input(1, 'personal'))).toBe(true);
  for (let id = 2; id <= 15; id++) expect(owner.enqueue(input(id))).toBe(true);
  expect(owner.enqueue(input(16))).toBe(false); await Promise.resolve(); expect(owner.pending).toBe(16);
  owner.cancel(1, 'work', 'agent1'); expect(seen[0].signal.aborted).toBe(true); expect(seen[0].text).toBeUndefined(); expect(seen[1].signal.aborted).toBe(false);
  const closing = owner.close(); await vi.advanceTimersByTimeAsync(500); expect(await closing).toEqual({ pending: 16 });
  expect(seen.every(t => t.signal.aborted && t.text === undefined)).toBe(true); expect(owner.enqueue(input(20))).toBe(false);
  releases.forEach(r => r()); await owner.settle(); expect(owner.pending).toBe(0);
});
it('normal completion keeps the source alive; true abort and the total deadline erase it even if a worker ignores abort', async () => {
  vi.useFakeTimers(); let task!: OwnedLearningTask, release!: () => void;
  const owner = new PreferenceLearningTasks(async value => { task = value; await new Promise<void>(r => { release = r; }); });
  const request = new AbortController(); owner.enqueue(input(), request.signal); await Promise.resolve();
  expect(task.signal.aborted).toBe(false); expect(task.text).toBe('PRIVATE_EPHEMERAL_CANARY'); request.abort(); expect(task.text).toBeUndefined(); release(); await owner.settle();
  owner.enqueue(input()); await Promise.resolve(); await vi.advanceTimersByTimeAsync(500); expect(task.signal.aborted).toBe(true); expect(task.text).toBeUndefined(); expect(owner.pending).toBe(1);
  release(); await owner.settle(); await owner.close();
});
