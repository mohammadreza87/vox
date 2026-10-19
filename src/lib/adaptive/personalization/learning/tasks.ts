import type { LogicalTurn } from './contracts';
export interface LearningTaskInput { telegramId: number; space: 'work' | 'personal'; agentId: string; turn: LogicalTurn; text: string }
export interface OwnedLearningTask extends Omit<LearningTaskInput, 'text'> { text?: string; signal: AbortSignal }
/** Bounded process owner. Raw current-turn text is released on every cancellation
 * or deadline, while the underlying promise remains owned until it settles. */
export class PreferenceLearningTasks {
  private readonly jobs = new Map<string, { task: OwnedLearningTask; stop(): void; promise: Promise<void> }>();
  private stopped = false;
  constructor(private readonly run: (task: OwnedLearningTask) => Promise<void>) {}
  enqueue(input: LearningTaskInput, requestSignal?: AbortSignal): boolean {
    const key = `${input.telegramId}:${input.space}`;
    if (this.stopped || this.jobs.size >= 16 || this.jobs.has(key) || requestSignal?.aborted) return false;
    const controller = new AbortController(), task: OwnedLearningTask = { ...input, signal: controller.signal };
    const stop = () => { task.text = undefined; controller.abort(); };
    requestSignal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 500);
    const job = { task, stop, promise: Promise.resolve() };
    // Defer work until after the caller has constructed its response. No provider
    // work is awaited on the reply path and every rejection has this owner.
    job.promise = Promise.resolve().then(() => this.run(task)).catch(() => undefined).finally(() => {
      clearTimeout(timer); requestSignal?.removeEventListener('abort', stop); task.text = undefined;
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    });
    this.jobs.set(key, job); return true;
  }
  cancel(telegramId: number, space?: 'work' | 'personal', agentId?: string): void {
    for (const job of this.jobs.values()) if (job.task.telegramId === telegramId && (!space || job.task.space === space) && (!agentId || job.task.agentId === agentId)) job.stop();
  }
  cancelAgent(agentId: string): void { for (const job of this.jobs.values()) if (job.task.agentId === agentId) job.stop(); }
  get pending(): number { return this.jobs.size; }
  async settle(): Promise<void> { await Promise.allSettled([...this.jobs.values()].map(j => j.promise)); }
  async close(): Promise<{ pending: number }> {
    this.stopped = true; for (const job of this.jobs.values()) job.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.settle(), new Promise<void>(resolve => { timer = setTimeout(resolve, 500); })]); }
    finally { if (timer) clearTimeout(timer); }
    return { pending: this.pending };
  }
}
