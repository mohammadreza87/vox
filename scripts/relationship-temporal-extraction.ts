/** Twelve frozen fictional cases through the actual structured relationship assessor. No real delivery. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { StudioRelationshipAssessor } from '../src/lib/studio/relationship-assessor';
import { groundTiming, temporalGate, type TimingProposal } from '../src/lib/relationships/temporal';
import type { Assessment } from '../src/lib/relationships/types';
import type { LLM } from '../src/lib/tireh/llm';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
interface Expected { kind?: TimingProposal['kind']; requireFollowUp?: boolean; startsAt?: string; endsAt?: string; unknownEnd?: boolean; gate?: 'defer' | 'close' | null; busyUntil?: string; situationTopic?: string; noTiming?: boolean }
interface Case { id: string; category: 'ongoing' | 'dated' | 'busy' | 'boundary'; text: string; context: string; expected: Expected }
interface Fixture { schemaVersion: number; id: string; now: string; sourceAt: string; timeZone: string; model: string; policy: string; cases: Case[] }
async function main() {
  const fake = process.argv.includes('--fake'); assert.notEqual(fake, process.argv.includes('--real-model'));
  const concurrency = Number(option('--concurrency') ?? 3); assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 3);
  const fixtureBytes = readFileSync(join(ROOT, 'src/lib/relationships/simulation/temporal-assessor-fixtures.json')); const fixture = JSON.parse(fixtureBytes.toString()) as Fixture;
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.cases.length, 12); assert.equal(fixture.model, 'claude-haiku-5-5');
  assert.ok(fixture.cases.filter(c => c.category === 'ongoing').length >= 4); assert.ok(fixture.cases.filter(c => c.category === 'dated').length >= 4); assert.ok(fixture.cases.filter(c => c.category === 'busy').length >= 2);
  const dir = resolve(option('--dir') ?? '/tmp/vox-temporal-extraction'); mkdirSync(dir, { recursive: true, mode: 0o700 }); assert.match(realpathSync(dir), /^\/(?:private\/)?tmp\//); assert.equal(existsSync(join(dir, 'manifest.json')), false);
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let apiKey = 'offline-placeholder';
  if (!fake) { assert.equal(option('--env'), '/Volumes/Workspace/Ludaxis/vox/.env.local'); apiKey = dotenv.parse(readFileSync(option('--env')!)).ANTHROPIC_API_KEY; assert.ok(apiKey); }
  const fingerprint = { fixture: hash(fixtureBytes), evaluator: hash(readFileSync(fileURLToPath(import.meta.url))), temporal: hash(readFileSync(join(ROOT, 'src/lib/relationships/temporal.ts'))), assessor: hash(readFileSync(join(ROOT, 'src/lib/studio/relationship-assessor.ts'))) };
  write('manifest.json', { frozenAt: new Date().toISOString(), fingerprint, fixture, maxCalls: 12, concurrency, sdkRetries: 0, assessorTimeoutMs: 12000, model: fixture.model, evidence: fake ? 'offline_fake' : 'fictional_real_provider' });
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 12000 }); let calls = 0;
  async function run(c: Case) {
    const llm: LLM = { async complete(request) {
      calls++; assert.ok(calls <= 12);
      if (fake) {
        if (c.expected.noTiming) return '{}';
        const timing: TimingProposal = { kind: c.expected.kind!, evidenceQuote: c.text, eventWindow: c.expected.startsAt || c.expected.endsAt ? { startsAt: c.expected.startsAt, endsAt: c.expected.endsAt } : undefined, busyUntil: c.expected.busyUntil };
        return JSON.stringify({ situations: [{ topic: c.expected.situationTopic || c.id, summary: 'Fictional current user project.', status: 'open', timing }], followUp: { topic: c.expected.situationTopic || c.id, purpose: 'Fictional meaningful continuity.', dueAt: '2026-10-20T12:00:00Z', timing } });
      }
      const response = await client.messages.create({ model: fixture.model, system: request.system, messages: request.messages, max_tokens: request.maxTokens ?? 1600 });
      if (response.stop_reason === 'max_tokens') throw new Error('safe_incomplete');
      return response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').trim();
    } };
    let assessment: Assessment | null = null; let status: 'assessment' | 'provider_or_parse_failure' = 'provider_or_parse_failure';
    try { assessment = await new StudioRelationshipAssessor(llm, 12000).assess({ key: { personaId: 'fictional-extraction', chatKey: c.id, audience: { kind: 'private', personId: c.id } }, text: c.text, context: c.context, now: new Date(fixture.now), sourceAt: new Date(fixture.sourceAt), timeZone: fixture.timeZone }); status = 'assessment'; } catch { /* Never persist provider exceptions or bodies. */ }
    const allTiming = [assessment?.followUp?.timing, ...(assessment?.situations ?? []).map(s => s.timing)].filter((t): t is TimingProposal => !!t);
    const situation = c.expected.situationTopic ? assessment?.situations?.find(s => s.topic === c.expected.situationTopic) : undefined;
    const proposal = c.expected.situationTopic ? situation?.timing : assessment?.followUp?.timing ?? allTiming[0];
    const grounded = proposal ? groundTiming(proposal, { text: c.text, sourceId: `fictional:${c.id}`, sourceAt: new Date(fixture.sourceAt), timeZone: fixture.timeZone }) : null;
    const checks: Record<string, boolean> = { assessment: status === 'assessment' };
    if (c.expected.noTiming) checks.noCrossPersonTiming = allTiming.length === 0 && !assessment?.followUp;
    else {
      checks.groundedLiteralEvidence = grounded !== null;
      checks.kind = grounded?.kind === c.expected.kind;
      if (c.expected.requireFollowUp) checks.meaningfulFollowUp = !!assessment?.followUp;
      if (c.expected.situationTopic) checks.sameTopicReschedule = !!situation?.timing && situation.status === 'open';
      for (const field of ['startsAt', 'endsAt'] as const) if (c.expected[field]) checks[field] = !!grounded?.eventWindow?.[field] && new Date(grounded.eventWindow[field]!).toISOString() === c.expected[field];
      if (c.expected.unknownEnd) checks.unknownEndPreserved = !grounded?.eventWindow?.endsAt;
      if (c.expected.busyUntil) checks.busyUntil = !!grounded?.busyUntil && new Date(grounded.busyUntil).toISOString() === c.expected.busyUntil;
      if ('gate' in c.expected) checks.deterministicGate = temporalGate(grounded ?? undefined, new Date(fixture.now)) === c.expected.gate;
    }
    return { id: c.id, category: c.category, status, assessment, grounded, checks, passed: Object.values(checks).every(Boolean) };
  }
  const rows: Awaited<ReturnType<typeof run>>[] = new Array(fixture.cases.length); let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < fixture.cases.length) { const i = cursor++; rows[i] = await run(fixture.cases[i]); } }));
  const report = { fingerprint, evidence: fake ? 'offline_fake' : 'fictional_real_provider', model: fixture.model, calls: fake ? 0 : calls, passed: rows.filter(r => r.passed).length, total: rows.length,
    categories: Object.fromEntries(['ongoing', 'dated', 'busy', 'boundary'].map(category => { const selected = rows.filter(r => r.category === category); return [category, { cases: selected.length, passed: selected.filter(r => r.passed).length }]; })), rawResults: rows,
    limits: ['Single-author fictional labels, one shot and small sample.', 'Date extraction is model-derived. Code validates shape, literal source attribution, ordering, and time comparisons only.', 'No actual composer, real-user benefit, delivery, deployment or temporal truth guarantee.'] };
  write('report.json', report); process.stdout.write(JSON.stringify({ directory: dir, calls: report.calls, passed: report.passed, total: report.total, categories: report.categories }) + '\n');
}
main().catch(() => { process.stderr.write('Temporal extraction evaluation failed; details suppressed.\n'); process.exitCode = 1; });
