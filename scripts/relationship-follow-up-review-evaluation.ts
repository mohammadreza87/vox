/** Single-shot fictional review evaluation; no gateway, composer, transport or real user. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { OpenAIFollowUpReview, FOLLOW_UP_REVIEW_QUESTIONS, FOLLOW_UP_REVIEW_THRESHOLDS, routeFollowUpReview } from '../src/lib/relationships/follow-up-review';
import { groundTiming, temporalContext, temporalGate, type TimingProposal } from '../src/lib/relationships/temporal';
import { RELATIONSHIP_DECISION_MODEL } from '../src/lib/relationships/observer';
import type { DecisionAction } from '../src/lib/relationships/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'src/lib/relationships/simulation/follow-up-review-holdout-fixtures.json');
const NAMES = ['meaningful_continuity', 'content_violation'] as const;
type Name = typeof NAMES[number];
type Category = 'positive' | 'content_negative' | 'timing_gate' | 'harmful_draft';
type Status = 'typed' | 'refusal' | 'invalid' | 'timeout' | 'http_error' | 'network_error' | 'not_called';
interface Case {
  id: string; category: Category; acceptable: DecisionAction[]; expectedTemporalGate: 'defer' | null;
  sourceAt: string; sourceText: string; timing: TimingProposal; facts: string[]; candidate: string;
}
interface Fixture {
  schemaVersion: number; id: string; now: string; labelPolicy: string;
  criteria: { minimumPositiveSends: number; positiveCases: number; maximumForbiddenSends: number; expectedProviderRequests: number; requiredTypedResponses: number };
  cases: Case[];
}
interface Result {
  id: string; category: Category; acceptable: DecisionAction[]; temporalGate: 'defer' | 'close' | null;
  requested: boolean; status: Status; predicates: Record<Name, number | null>; httpStatus: number | null; effectiveAction: DecisionAction;
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const emptyPredicates = (): Record<Name, number | null> => ({ meaningful_continuity: null, content_violation: null });
function parse(value: unknown): { status: 'typed' | 'refusal' | 'invalid'; predicates: Record<Name, number | null> } {
  const predicates = emptyPredicates(); let status: 'typed' | 'refusal' | 'invalid' = 'invalid';
  if (!value || typeof value !== 'object' || !('answers' in value) || !Array.isArray(value.answers) || value.answers.length !== 2) return { status, predicates };
  let valid = 0;
  for (const name of NAMES) {
    const matching = value.answers.filter((a: unknown) => a && typeof a === 'object' && 'name' in a && a.name === name);
    if (matching.length !== 1) continue;
    const answer = matching[0];
    if (answer.type === 'refusal') { status = 'refusal'; continue; }
    if (answer.type === 'predicate' && typeof answer.probability === 'number' && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1) {
      predicates[name] = answer.probability; valid++;
    }
  }
  if (valid === 2) status = 'typed';
  return { status, predicates };
}
async function boundedJSON(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); return null; } chunks.push(next.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
  } finally { reader.releaseLock(); }
}
function fakeBody(c: Case) {
  return { answers: [
    { type: 'predicate', name: 'meaningful_continuity', probability: c.id === 'review-negative-utility' ? 0.1 : 0.95 },
    { type: 'predicate', name: 'content_violation', probability: c.category === 'harmful_draft' || c.id === 'review-negative-rejected' ? 0.98 : 0.02 },
  ] };
}
function selfCheck() {
  assert.equal(routeFollowUpReview({ answers: [
    { type: 'predicate', name: 'meaningful_continuity', probability: 0.8 },
    { type: 'predicate', name: 'content_violation', probability: 0.1 },
  ] }), 'send');
  assert.equal(routeFollowUpReview({ answers: [
    { type: 'predicate', name: 'meaningful_continuity', probability: 0.95 },
    { type: 'predicate', name: 'content_violation', probability: 0.11 },
  ] }), 'stay_quiet');
  assert.equal(parse({ answers: [
    { type: 'refusal', name: 'meaningful_continuity', reason: 'never retained' },
    { type: 'predicate', name: 'content_violation', probability: 0 },
  ] }).status, 'refusal');
  assert.equal(parse({ answers: [{ type: 'predicate', name: 'meaningful_continuity', probability: 9 }] }).status, 'invalid');
}
async function main() {
  selfCheck();
  const fake = process.argv.includes('--fake'); const real = process.argv.includes('--real-model');
  if (fake === real) throw new Error('Choose one explicit provider mode.');
  const maxCalls = Number(option('--max-calls') ?? '9');
  if (!Number.isInteger(maxCalls) || maxCalls !== 9) throw new Error('This frozen evaluation requires a nine-request cap.');
  const fixtureBytes = readFileSync(FIXTURE); const fixture = JSON.parse(fixtureBytes.toString('utf8')) as Fixture;
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.cases.length, 12); assert.equal(new Set(fixture.cases.map((c) => c.id)).size, 12);
  assert.deepEqual(fixture.criteria, { minimumPositiveSends: 3, positiveCases: 4, maximumForbiddenSends: 0, expectedProviderRequests: 9, requiredTypedResponses: 9 });
  for (const c of fixture.cases) {
    assert.ok(['positive', 'content_negative', 'timing_gate', 'harmful_draft'].includes(c.category));
    assert.ok(c.candidate.length > 0 && c.candidate.length <= 1000);
  }
  const now = new Date(fixture.now); assert.ok(Number.isFinite(now.getTime()));
  // Check every quoted proposal and expected code gate before spending any provider request.
  const prepared = fixture.cases.map((c) => {
    const timing = groundTiming(c.timing, { text: c.sourceText, sourceId: `fictional-source-${sha(c.id).slice(0, 12)}`, sourceAt: new Date(c.sourceAt), timeZone: 'UTC' });
    assert.ok(timing, `Ungrounded fictional timing: ${c.id}`);
    const gate = temporalGate(timing, now); assert.equal(gate, c.expectedTemporalGate, `Unexpected temporal gate: ${c.id}`);
    return { c, timing, gate };
  });
  assert.equal(prepared.filter((p) => p.gate === null).length, 9);
  const directory = resolve(option('--dir') ?? '/tmp/vox-follow-up-review-evaluation');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const actualDirectory = realpathSync(directory);
  if (!/^\/(?:private\/)?tmp\//.test(actualDirectory) || !relative(ROOT, actualDirectory).startsWith('..')) throw new Error('Use a dedicated directory outside the repository under /tmp.');
  if (existsSync(join(directory, 'manifest.json')) || existsSync(join(directory, 'report.json'))) throw new Error('Use a new evidence directory.');
  let key = 'offline-placeholder';
  if (real) {
    const envPath = option('--env'); if (!envPath) throw new Error('A local env file is required.');
    key = dotenv.parse(readFileSync(resolve(envPath))).OPENAI_API_KEY;
    if (!key) throw new Error('The local env file is missing the required key.');
  }
  const sourcePaths = ['scripts/relationship-follow-up-review-evaluation.ts', 'src/lib/relationships/follow-up-review.ts', 'src/lib/relationships/temporal.ts', 'src/lib/relationships/observer.ts'];
  const fingerprint = { gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), fixtureSHA256: sha(fixtureBytes),
    sources: Object.fromEntries(sourcePaths.map((path) => [path, sha(readFileSync(join(ROOT, path)))])),
    contractSHA256: sha(JSON.stringify({ model: RELATIONSHIP_DECISION_MODEL, questions: FOLLOW_UP_REVIEW_QUESTIONS, thresholds: FOLLOW_UP_REVIEW_THRESHOLDS })) };
  const frozenAt = new Date().toISOString();
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  write('manifest.json', { schemaVersion: 1, fixtureId: fixture.id, frozenAt, fingerprint, labelPolicy: fixture.labelPolicy, criteria: fixture.criteria,
    model: RELATIONSHIP_DECISION_MODEL, thresholds: FOLLOW_UP_REVIEW_THRESHOLDS, maxCalls, concurrency: 1,
    cases: fixture.cases.map(({ id, category, acceptable, expectedTemporalGate }) => ({ id, category, acceptable, expectedTemporalGate })) });
  let requests = 0; const results: Result[] = [];
  for (const { c, timing, gate } of prepared) {
    if (gate) { results.push({ id: c.id, category: c.category, acceptable: c.acceptable, temporalGate: gate, requested: false, status: 'not_called', predicates: emptyPredicates(), httpStatus: null, effectiveAction: gate }); continue; }
    let raw: { status: Status; predicates: Record<Name, number | null> } = { status: 'invalid', predicates: emptyPredicates() };
    let httpStatus: number | null = null; let timedOut = false; let effectiveAction: DecisionAction = 'stay_quiet';
    const fetcher: typeof fetch = async (url, init) => {
      requests++; assert.ok(requests <= maxCalls);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, RELATIONSHIP_DECISION_MODEL); assert.deepEqual(body.questions, FOLLOW_UP_REVIEW_QUESTIONS);
      const input = JSON.parse(body.input); assert.equal(input.exactCandidate, c.candidate);
      let response: Response;
      try { response = fake ? Response.json(fakeBody(c)) : await fetch(url, init); }
      catch (error) { timedOut = init?.signal?.aborted === true || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)); throw new Error('sanitized_transport_failure'); }
      httpStatus = response.status;
      if (response.ok) raw = parse(await boundedJSON(response.clone()));
      return response;
    };
    const context = [temporalContext(timing, now), `Authorized fictional current conversation facts:\n${JSON.stringify({ latestUserStatement: c.sourceText, currentFacts: c.facts })}`].join('\n');
    try { effectiveAction = await new OpenAIFollowUpReview(key, fetcher).choose({ context, candidate: c.candidate, phase: 'reconsider', now }); }
    catch (error) {
      raw.status = timedOut || (error instanceof Error && error.message === 'Follow-up review timed out') ? 'timeout' : httpStatus !== null && httpStatus >= 400 ? 'http_error' : httpStatus !== null ? 'invalid' : 'network_error';
    }
    results.push({ id: c.id, category: c.category, acceptable: c.acceptable, temporalGate: null, requested: true, status: raw.status, predicates: raw.predicates, httpStatus, effectiveAction });
  }
  assert.equal(requests, maxCalls);
  const called = results.filter((r) => r.requested); const positives = called.filter((r) => r.category === 'positive');
  const positiveSends = positives.filter((r) => r.effectiveAction === 'send').length;
  const forbiddenSends = results.filter((r) => r.category !== 'positive' && r.effectiveAction === 'send').length;
  const typedResponses = called.filter((r) => r.status === 'typed').length;
  const timingGates = results.filter((r) => r.category === 'timing_gate');
  const codeGatePasses = timingGates.filter((r) => !r.requested && r.temporalGate === 'defer' && r.effectiveAction === 'defer').length;
  const passed = positiveSends >= fixture.criteria.minimumPositiveSends && forbiddenSends === 0 && typedResponses === 9 && codeGatePasses === 3;
  const sourceUnchanged = sourcePaths.every((path) => sha(readFileSync(join(ROOT, path))) === fingerprint.sources[path]);
  const report = { schemaVersion: 1, fixtureId: fixture.id, frozenAt, evidence: fake ? 'offline_fake' : 'fictional_real_provider', fingerprint,
    model: RELATIONSHIP_DECISION_MODEL, thresholds: FOLLOW_UP_REVIEW_THRESHOLDS, calls: fake ? 0 : requests, adapterRequests: requests, maxCalls, concurrency: 1,
    criteria: fixture.criteria, passed, sourceUnchanged,
    modelMetrics: { calledCases: called.length, positiveCases: positives.length, positiveSends, positiveMisses: positives.length - positiveSends,
      forbiddenSends, negativeCases: called.length - positives.length, sendPrecision: positiveSends + forbiddenSends ? positiveSends / (positiveSends + forbiddenSends) : null,
      sendRecall: positiveSends / positives.length, typedResponses },
    codeGates: { cases: timingGates.length, passed: codeGatePasses, providerRequests: timingGates.filter((r) => r.requested).length },
    statuses: Object.fromEntries(['typed', 'refusal', 'invalid', 'timeout', 'http_error', 'network_error', 'not_called'].map((status) => [status, results.filter((r) => r.status === status).length])),
    results,
    limits: ['Facts, timing proposals and exact drafts are preauthored fictional data, not actual model extraction or composer output.', 'groundTiming validates structure and literal quote containment; it does not prove that a normalized date semantically matches its source.', 'Single-author labels and one-shot responses do not establish human satisfaction, population precision/recall, reliability or end-to-end gateway behavior.', 'The rejected-topic direct review tests content compatibility; application assessor closure, privacy and delivery gates require separate evidence.', 'No threshold tuning, retries, real user or transport. Temporal code gates are excluded from model metrics.'],
  };
  write('report.json', report);
  process.stdout.write(`${JSON.stringify({ reportPath: join(directory, 'report.json'), evidence: report.evidence, passed, fingerprint, calls: report.calls,
    modelMetrics: report.modelMetrics, codeGates: report.codeGates, statuses: report.statuses, sourceUnchanged })}\n`);
  if (!passed || !sourceUnchanged) process.exitCode = 2;
}
main().catch(() => { process.stderr.write('Follow-up review evaluation failed; raw errors and credentials are never printed. Inspect sanitized evidence and arguments.\n'); process.exitCode = 1; });
