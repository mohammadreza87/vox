/** Frozen fictional feedback smoke test. No gateway, live state, recipient or transport is loaded. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { OpenAIRelationshipFeedback } from '../src/lib/relationships/feedback';
import type { FeedbackOutcome, FeedbackScope } from '../src/lib/relationships/types';

type Result = { outcome: FeedbackOutcome; scope: FeedbackScope };
interface Case { id: string; topic: string; previousAssistant: string; text: string; expected: Result }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const fake = process.argv.includes('--fake'); assert.notEqual(fake, process.argv.includes('--real-model'), 'Choose fake or real-model');
  const concurrency = Number(option('--concurrency') ?? 3); assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 3);
  const fixtureBytes = readFileSync(join(ROOT, 'src/lib/relationships/simulation/feedback-evaluation-fixtures.json'));
  const fixture = JSON.parse(fixtureBytes.toString()) as { schemaVersion: number; id: string; now: string; cases: Case[] };
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.cases.length, 8); assert.equal(new Set(fixture.cases.map((c) => c.id)).size, 8);
  const dir = resolve(option('--dir') ?? '/tmp/vox-feedback-evaluation'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  assert.match(realpathSync(dir), /^\/(?:private\/)?tmp\//); assert.equal(existsSync(join(dir, 'manifest.json')), false, 'Use a fresh evidence directory');
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  let key = 'offline-placeholder';
  if (!fake) { assert.equal(option('--env'), '/Volumes/Workspace/Ludaxis/vox/.env.local'); key = dotenv.parse(readFileSync(option('--env')!)).OPENAI_API_KEY; assert.ok(key, 'OPENAI_API_KEY missing'); }
  const fingerprint = { fixture: hash(fixtureBytes), evaluator: hash(readFileSync(fileURLToPath(import.meta.url))), adapter: hash(readFileSync(join(ROOT, 'src/lib/relationships/feedback.ts'))) };
  write('manifest.json', { frozenAt: new Date().toISOString(), fingerprint, fixture, model: 'gpt-6-luna', fixedCutoff: .7, maxCalls: 8, concurrency, timeoutMs: 6000, retries: 0, evidence: fake ? 'offline_fake' : 'fictional_real_provider' });
  let calls = 0; let cursor = 0; let halt = false;
  const rows: Array<{ id: string; expected: Result; actual: Result | null; confidence: number | null; status: string; matches: boolean }> = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!halt && cursor < fixture.cases.length) {
      const c = fixture.cases[cursor++]; let confidence: number | null = null; let httpStatus: number | null = null;
      const fetcher: typeof fetch = async (url, init) => {
        calls++; assert.ok(calls <= 8, 'Provider call budget exceeded');
        const response = fake ? Response.json({ answers: [{ name: 'feedback', type: 'choice', choice: `${c.expected.outcome}_${c.expected.scope}`, confidence: .94 }] }) : await fetch(url, init);
        httpStatus = response.status;
        // This projection is numeric metadata only; no provider bodies are stored.
        if (response.ok) {
          const clone = response.clone(); const reader = clone.body!.getReader(); const parts: Uint8Array[] = []; let size = 0;
          try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65536) { await reader.cancel(); break; } parts.push(next.value); }
            if (size <= 65536) { const value = JSON.parse(Buffer.concat(parts).toString('utf8')); const raw = value.answers?.find((a: { name?: string }) => a.name === 'feedback')?.confidence; if (typeof raw === 'number' && raw >= 0 && raw <= 1) confidence = raw; }
          } catch { /* The production adapter validates its own bounded result. */ } finally { reader.releaseLock(); }
        }
        return response;
      };
      try {
        const actual = await new OpenAIRelationshipFeedback(key, fetcher).classify({ text: c.text, previousAssistant: c.previousAssistant, topic: c.topic, now: new Date(fixture.now) });
        rows.push({ id: c.id, expected: c.expected, actual, confidence, status: 'choice', matches: actual.outcome === c.expected.outcome && actual.scope === c.expected.scope });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const status = httpStatus !== null && httpStatus >= 400 ? `http_${httpStatus}` : message.includes('timed out') ? 'timeout' : message.includes('unavailable') ? 'unavailable' : 'invalid_or_network';
        rows.push({ id: c.id, expected: c.expected, actual: null, confidence, status, matches: false }); halt = true;
      }
      write(`${c.id}.json`, rows.find((row) => row.id === c.id));
    }
  }));
  rows.sort((a, b) => fixture.cases.findIndex((c) => c.id === a.id) - fixture.cases.findIndex((c) => c.id === b.id));
  const summary = { evidence: fake ? 'offline_fake' : 'fictional_real_provider', model: 'gpt-6-luna', fingerprint, cases: fixture.cases.length, completed: rows.length, calls, matched: rows.filter((r) => r.matches).length, unavailable: rows.filter((r) => r.actual === null).length, rows };
  write('summary.json', summary); console.log(JSON.stringify({ ...summary, rows: undefined, evidenceDirectory: dir }, null, 2));
  if (summary.matched !== fixture.cases.length) process.exitCode = 1;
}
main().catch(() => { console.error('Feedback evaluation failed before completion; no provider body or credential was logged.'); process.exitCode = 1; });
