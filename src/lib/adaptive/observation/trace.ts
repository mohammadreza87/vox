import { AsyncLocalStorage } from 'node:async_hooks';
import { turnTelemetrySchema, usageReceiptSchema, type TurnStage, type TurnTelemetry, type UsageReceipt } from './telemetry';
const active = new AsyncLocalStorage<TurnTrace | undefined>();
const finiteToken = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;

/** Request-local, content-free, bounded and inert outside a consented observation.
 * No account IDs, content, errors, request objects or context escapes into state. */
export class TurnTrace {
  private data: TurnTelemetry = { version: 1, stages: [], usage: [], truncated: false };
  private closed = false;
  constructor(private readonly enabled: boolean) {}
  run<T>(fn: () => Promise<T>): Promise<T> { return active.run(this.enabled && !this.closed ? this : undefined, fn); }
  clear(): void { this.closed = true; this.data = { version: 1, stages: [], usage: [], truncated: false }; }
  stage(stage: TurnStage, outcome: TurnTelemetry['stages'][number]['outcome'], durationMs: number): void {
    if (!this.enabled || this.closed) return;
    if (this.data.stages.length >= 16) { this.data.truncated = true; return; }
    this.data.stages.push({ stage, outcome, durationMs: Math.max(0, Math.min(86_400_000, durationMs)) });
  }
  usage(value: UsageReceipt): void {
    if (!this.enabled || this.closed) return;
    const parsed = usageReceiptSchema.safeParse(value); if (!parsed.success) return;
    if (this.data.usage.length >= 16) { this.data.truncated = true; return; }
    this.data.usage.push(parsed.data);
  }
  snapshot(): TurnTelemetry | undefined { return this.enabled && !this.closed ? turnTelemetrySchema.parse(this.data) : undefined; }
}
export async function measureStage<T>(stage: TurnStage, fn: () => Promise<T>, outcome?: (result: T) => TurnTelemetry['stages'][number]['outcome']): Promise<T> {
  const trace = active.getStore(); if (!trace) return fn();
  const started = performance.now();
  try { const result = await fn(); trace.stage(stage, outcome ? outcome(result) : 'succeeded', performance.now() - started); return result; }
  catch (error) { let cancelled = false; try { cancelled = error instanceof Error && ['AbortError', 'LLMAuthorizationError'].includes(error.name); } catch {}
    trace.stage(stage, cancelled ? 'cancelled' : 'failed', performance.now() - started); throw error; }
}
export function observedUsage(provider: UsageReceipt['provider'], modelFamily: UsageReceipt['modelFamily'], value: {
  inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown;
}, partial = false): void {
  const trace = active.getStore(); if (!trace) return;
  const inputTokens = finiteToken(value.inputTokens), outputTokens = finiteToken(value.outputTokens);
  trace.usage({ provider, modelFamily, inputTokens, outputTokens, cacheReadTokens: finiteToken(value.cacheReadTokens),
    cacheWriteTokens: finiteToken(value.cacheWriteTokens), status: inputTokens === null && outputTokens === null ? 'unavailable' : partial || inputTokens === null || outputTokens === null ? 'partial' : 'complete' });
}
/** Both timing and usage remain unknown for external STT/TTS services that do not
 * return usage fields; duration/audio byte length is never converted into tokens. */
export function unavailableUsage(provider: UsageReceipt['provider'], modelFamily: UsageReceipt['modelFamily']): void { observedUsage(provider, modelFamily, {}); }

export function recordStage(stage: TurnStage, outcome: TurnTelemetry['stages'][number]['outcome'], durationMs: number): void { active.getStore()?.stage(stage, outcome, durationMs); }

export function captureUsage(provider: UsageReceipt['provider'], modelFamily: UsageReceipt['modelFamily'],
  read: () => Parameters<typeof observedUsage>[2], partial = false): void {
  if (!active.getStore()) return;
  try { observedUsage(provider, modelFamily, read(), partial); } catch { unavailableUsage(provider, modelFamily); }
}
