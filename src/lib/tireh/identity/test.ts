/**
 * Windowed sequential log-likelihood-ratio test of session consistency (S10L).
 * Not a test file: vitest only collects *.test.ts / *.spec.ts.
 *
 * Each message is scored against the person's own profile and an explicit
 * unknown class; no single message can decide, nothing is decided before
 * MIN_SEQUENTIAL_MESSAGES, and a downgrade sticks for the session. Thresholds
 * are per person and target fewer than one false prompt a week; members for
 * whom the signal is systematically wrong are disabled (budget or Gini rule).
 *
 * Pure: no randomness, no clock, no I/O.
 */
import { WEEK_MS, type GaussianModel, type StyleProfile } from './profile';
import type { SessionConsistency } from './types';

export const MIN_SEQUENTIAL_MESSAGES = 5; export const SEQUENTIAL_WINDOW = 12;
export const MAX_DIM_LLR = 2; export const MAX_MESSAGE_LLR = 4;
export const DEFAULT_LOWER_THRESHOLD = -10; export const LOWER_THRESHOLD_MIN = -40; export const LOWER_THRESHOLD_MAX = -4;
export const THRESHOLD_MARGIN = 1; export const MIN_SELF_SCORES = 20;
export const TARGET_FALSE_PROMPTS_PER_WEEK = 0.5; export const FALSE_PROMPT_BUDGET_PER_WEEK = 1;
export const SESSION_IDLE_MS = 30 * 60_000; export const MAX_SESSIONS = 10_000;
export const GINI_DISABLE_THRESHOLD = 0.5; export const MIN_FAIRNESS_MEMBERS = 5; export const MIN_FAIRNESS_WEEKS = 2;

/** A dim the person has seen fewer than this (decayed) number of times is unlearned and skipped. */
const MIN_DIM_WEIGHT = 5;

export interface PersonThreshold { readonly lower: number }
export interface SequentialState { readonly messages: number; readonly window: readonly number[]; readonly minScore: number | null; readonly flagged: SessionConsistency | null }
export const INITIAL_SEQUENTIAL_STATE: SequentialState = Object.freeze({ messages: 0, window: Object.freeze([]) as readonly number[], minScore: null, flagged: null });

const SEVERITY: Readonly<Record<SessionConsistency, number>> = { consistent: 0, uncertain: 1, inconsistent: 2 };

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function logNormal(x: number, mean: number, variance: number): number {
  return -0.5 * Math.log(2 * Math.PI * variance) - ((x - mean) ** 2) / (2 * variance);
}

/** Per-message LLR of "the person" against "an unknown sender"; each dim clamped to ±2, the sum to ±4. */
export function messageLlr(person: GaussianModel, unknown: GaussianModel, x: readonly (number | null)[]): number {
  let sum = 0;
  for (let d = 0; d < x.length; d++) {
    const value = x[d];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const w = person.weight[d], mp = person.mean[d], vp = person.variance[d], mu = unknown.mean[d], vu = unknown.variance[d];
    if (!(w >= MIN_DIM_WEIGHT) || !Number.isFinite(mp) || !Number.isFinite(mu) || !(vp > 0) || !(vu > 0)) continue;
    const llr = logNormal(value, mp, vp) - logNormal(value, mu, vu);
    if (Number.isFinite(llr)) sum += clamp(llr, -MAX_DIM_LLR, MAX_DIM_LLR);
  }
  return clamp(sum, -MAX_MESSAGE_LLR, MAX_MESSAGE_LLR);
}

function worse(a: SessionConsistency | null, b: SessionConsistency | null): SessionConsistency | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/** One message of the windowed test. Decisions start at MIN_SEQUENTIAL_MESSAGES; downgrades are sticky. */
export function stepSequential(state: SequentialState, llr: number, threshold: PersonThreshold): { state: SequentialState; decision: SessionConsistency | null } {
  const value = Number.isFinite(llr) ? clamp(llr, -MAX_MESSAGE_LLR, MAX_MESSAGE_LLR) : -MAX_MESSAGE_LLR;
  const window = [...state.window, value].slice(-SEQUENTIAL_WINDOW);
  const messages = state.messages + 1;
  if (messages < MIN_SEQUENTIAL_MESSAGES) {
    return { state: { messages, window, minScore: state.minScore, flagged: state.flagged }, decision: null };
  }
  const score = window.reduce((total, x) => total + x, 0);
  const lower = threshold.lower;
  const current: SessionConsistency = score <= 2 * lower ? 'inconsistent' : score <= lower ? 'uncertain' : 'consistent';
  const flagged = worse(state.flagged, current === 'consistent' ? null : current);
  const minScore = state.minScore === null ? score : Math.min(state.minScore, score);
  return { state: { messages, window, minScore, flagged }, decision: worse(flagged, current) ?? current };
}

/** Deterministic lower quantile: sorted copy, index floor(p * (n - 1)). */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(clamp(Number.isFinite(p) ? p : 0, 0, 1) * (sorted.length - 1));
  return sorted[index];
}

/**
 * Per-person lower threshold. With too few calibrated sessions it is the
 * default; otherwise the quantile of the person's own session minimum scores
 * that yields TARGET_FALSE_PROMPTS_PER_WEEK at their session rate, minus a margin.
 */
export function personThreshold(profile: StyleProfile, at: number): PersonThreshold {
  if (profile.selfScores.length < MIN_SELF_SCORES) return { lower: DEFAULT_LOWER_THRESHOLD };
  const weeks = Math.max(1, (at - profile.createdAt) / WEEK_MS);
  const sessionsPerWeek = Math.max(1, profile.sessions / weeks);
  const p = clamp(TARGET_FALSE_PROMPTS_PER_WEEK / sessionsPerWeek, 0.002, 0.1);
  const lower = clamp(quantile(profile.selfScores, p) - THRESHOLD_MARGIN, LOWER_THRESHOLD_MIN, LOWER_THRESHOLD_MAX);
  return { lower: Number.isFinite(lower) ? lower : DEFAULT_LOWER_THRESHOLD };
}

/** Gini coefficient: sum_i sum_j |x_i - x_j| / (2 n^2 mean); 0 for empty input or zero mean. */
export function gini(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((total, x) => total + x, 0) / n;
  if (!(mean > 0)) return 0;
  let sum = 0;
  for (const a of values) for (const b of values) sum += Math.abs(a - b);
  return sum / (2 * n * n * mean);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface FairnessStat { readonly key: string; readonly falsePrompts: number; readonly weeksObserved: number }
export interface FairnessVerdict { readonly key: string; readonly reason: 'gini' | 'budget' }

/**
 * Members to disable: anyone over the false-prompt budget, and, when per-user
 * error is concentrated (Gini >= threshold over >= 5 members), the outliers.
 */
export function evaluateFairness(stats: readonly FairnessStat[]): FairnessVerdict[] {
  const rows = stats.map(stat => {
    const weeks = Number.isFinite(stat.weeksObserved) ? stat.weeksObserved : 0;
    const prompts = Number.isFinite(stat.falsePrompts) ? Math.max(0, stat.falsePrompts) : 0;
    return { key: stat.key, weeks, rate: prompts / Math.max(1, weeks) };
  });
  const rates = rows.map(row => row.rate);
  const concentrated = rows.length >= MIN_FAIRNESS_MEMBERS && gini(rates) >= GINI_DISABLE_THRESHOLD;
  const mid = median(rates);
  const verdicts: FairnessVerdict[] = [];
  for (const row of rows) {
    if (row.weeks >= MIN_FAIRNESS_WEEKS && row.rate > FALSE_PROMPT_BUDGET_PER_WEEK) verdicts.push({ key: row.key, reason: 'budget' });
    else if (concentrated && row.rate > 2 * mid && row.rate > 0.5 * FALSE_PROMPT_BUDGET_PER_WEEK) verdicts.push({ key: row.key, reason: 'gini' });
  }
  return verdicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
