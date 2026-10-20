/**
 * p50/p95 per route and stage from server logs written with
 * STUDIO_STAGE_TIMINGS=1. Reads both Pino JSON lines and Node console output
 * (which may wrap one object over several lines). Only the fixed timing
 * events are read; any other log content is ignored.
 */
import { TIMING_ROUTES, TIMING_STAGES, type TimingRoute, type TimingStage } from './telegram/diagnostics';

export interface StageTiming { route: TimingRoute; stage: TimingStage; durationMs: number }
export interface StageSummary { route: TimingRoute; stage: TimingStage; count: number; p50: number; p95: number }

const OBJECT = /\{[^{}]*\}/g;
function field(block: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|[\\s{,])["']?${key}["']?\\s*:\\s*(?:["']([A-Za-z_]+)["']|(\\d+(?:\\.\\d+)?))`).exec(block);
  return match?.[1] ?? match?.[2];
}

export function parseStageTimings(text: string): StageTiming[] {
  const timings: StageTiming[] = [];
  for (const [block] of text.matchAll(OBJECT)) {
    if (field(block, 'type') !== 'telegram_ingress' || field(block, 'reason') !== 'timing') continue;
    const route = field(block, 'route'), stage = field(block, 'stage'), durationMs = Number(field(block, 'durationMs'));
    if (!(TIMING_ROUTES as readonly (string | undefined)[]).includes(route) || !(TIMING_STAGES as readonly (string | undefined)[]).includes(stage) || !Number.isFinite(durationMs)) continue;
    timings.push({ route: route as TimingRoute, stage: stage as TimingStage, durationMs });
  }
  return timings;
}

/** Nearest-rank percentile of ascending values. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1];
}

export function summarizeStageTimings(timings: readonly StageTiming[]): StageSummary[] {
  const rows: StageSummary[] = [];
  for (const route of TIMING_ROUTES) for (const stage of TIMING_STAGES) {
    const values = timings.filter((t) => t.route === route && t.stage === stage).map((t) => t.durationMs).sort((a, b) => a - b);
    if (values.length) rows.push({ route, stage, count: values.length, p50: percentile(values, 50), p95: percentile(values, 95) });
  }
  return rows;
}

export function formatStageSummary(rows: readonly StageSummary[]): string {
  if (!rows.length) return 'No stage timings found. Run the server with STUDIO_STAGE_TIMINGS=1.';
  const header = ['route', 'stage', 'n', 'p50 ms', 'p95 ms'];
  const body = rows.map((r) => [r.route, r.stage, String(r.count), String(Math.round(r.p50)), String(Math.round(r.p95))]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(header), ...body.map(line)].join('\n');
}
