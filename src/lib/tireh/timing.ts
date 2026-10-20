/**
 * Content-free per-stage turn timers, emitted through the fixed diagnostics
 * catalogue (telegram/diagnostics.ts) so a latency baseline can be collected
 * before the Step 1 boundary work. Off unless a runtime opts in
 * (STUDIO_STAGE_TIMINGS=1); see scripts/stage-timings.ts for p50/p95.
 *
 * A timer holds only stage names and millisecond sums: never text, ids or
 * errors. Stages are wall-clock spans and may nest, so they do not add up:
 *   ingress     update received (or call/turn request) until the first
 *               privacy boundary starts; includes dedupe, access checks and,
 *               for voice, download and speech-to-text
 *   stt         speech-to-text (also inside ingress)
 *   boundary    sum of every privacy boundary computed during the turn,
 *               including the rechecks inside triage, before sending, per
 *               streamed chunk and during extraction
 *   triage      the pre-reply decision call (includes its boundary recheck)
 *   retrieval   memory listing and selection, history and saved context
 *   prompt      system prompt and message assembly
 *   llm_ttft    request to first streamed token (streaming routes only)
 *   llm_done    request to complete reply
 *   tts         speech synthesis
 *   send        Telegram send calls
 *   extraction  memory extraction after the reply (only when memory is on)
 *   total       turn start until the reply was delivered (or fully streamed)
 * A turn is emitted only once `total` is marked, so refusals, duplicates and
 * short-circuit replies do not skew the distribution.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { logStageTiming, TIMING_STAGES, type TimingRoute, type TimingStage } from './telegram/diagnostics';

type Log = Pick<Console, 'info' | 'warn' | 'error'>;
const active = new AsyncLocalStorage<StageTimer>();

export class StageTimer {
  private readonly started = performance.now();
  private readonly totals = new Map<TimingStage, number>();
  private emitted = false;
  constructor(readonly route: TimingRoute) {}

  run<T>(fn: () => Promise<T>): Promise<T> { return active.run(this, fn); }
  add(stage: TimingStage, durationMs: number): void {
    if (this.emitted || !Number.isFinite(durationMs)) return;
    this.totals.set(stage, (this.totals.get(stage) ?? 0) + Math.max(0, durationMs));
  }
  /** Records time since the turn started, once per stage. */
  markOnce(stage: TimingStage): void {
    if (!this.totals.has(stage)) this.add(stage, performance.now() - this.started);
  }
  get measured(): boolean { return this.totals.has('total'); }
  /** One line per recorded stage, in a fixed order; only for completed turns. */
  emit(log: Log): void {
    if (this.emitted || !this.measured) return;
    this.emitted = true;
    for (const stage of TIMING_STAGES) {
      const durationMs = this.totals.get(stage);
      if (durationMs !== undefined) logStageTiming(log, this.route, stage, durationMs);
    }
  }
}

export function currentStageTimer(): StageTimer | undefined { return active.getStore(); }

/** Adds the duration of `fn` to `stage` of the current turn, if one is timed. */
export async function timed<T>(stage: TimingStage, fn: () => Promise<T>): Promise<T> {
  const timer = active.getStore();
  if (!timer) return fn();
  const started = performance.now();
  try { return await fn(); }
  finally { timer.add(stage, performance.now() - started); }
}

/** Sequential laps for straight-line code: each lap charges the time since the
 * previous one to a stage, or to nothing when `stage` is null. */
export function stageLaps(timer = active.getStore()): (stage: TimingStage | null) => void {
  let last = performance.now();
  return (stage) => {
    const now = performance.now();
    if (timer && stage) timer.add(stage, now - last);
    last = now;
  };
}
