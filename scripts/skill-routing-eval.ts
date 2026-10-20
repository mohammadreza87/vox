/**
 * Skill routing eval (docs/SKILL_ROUTING.md, "Success measures").
 *
 * For each labelled case in scripts/evals/skill-routing/cases.json this builds
 * the Decisions request exactly as Telegram triage does for a private chat:
 * the routable choices come from the production policy `routableSkillsFor`
 * (work roles only; lifestyle and custom agents get none), the questions from
 * `triageQuestions(persona, false, routable)` and the input from `triageInput`.
 * Cases whose role is not routed by policy are not sent: they are reported as
 * "unrouted by policy", never as misses. Then:
 *   - with OPENAI_API_KEY set: one POST /v1/decisions per routed case (no
 *     retries), keeps the full response including per-option probabilities,
 *     reads the pick through `readTriage(…, routable).skills` as production
 *     does, saves the raw run under scripts/evals/skill-routing/results/ and
 *     writes docs/agent-skills/SKILL_ROUTING_EVAL.md;
 *   - without it: validates the dataset, prints the request for three routed
 *     cases and exits 0. Nothing is sent anywhere.
 *
 *   npm run eval:skills                                        # dry run
 *   npx dotenv -e .env.local -- npm run eval:skills            # real run
 *   npm run eval:skills -- --only ua- --concurrency 2          # partial run, no report
 *
 * Options: --only <id prefix>, --limit <n>, --concurrency <n> (default 4),
 * --timeout <ms> (default 10000; latency over the 2 s production budget is
 * reported separately), --compare <results file>, --no-report, --dry,
 * --no-baseline (skip the paired request without the skill question that
 * every fourth routed case sends to measure the question's added latency),
 * --variant <json file> (try proposed wording without editing packs or the
 * runtime: { "whenToUse": { "<skill id>": "Use when…" }, "instructions": "…",
 * "noneDescription": "…" }; saved as variant-*.json, compared with the latest
 * run, no report), --cases <json file> (another case file, such as
 * heldout.json; saved as cases-*.json, no report), --from <results file>
 * (rebuild the report from a saved run without calling the API).
 *
 * The analysis of misses (label vs router vs description) is human work: it
 * lives in scripts/evals/skill-routing/review.json and is merged into the report.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, getRole, resolveSkills } from '../src/lib/studio/skills/catalog';
import { routableSkillsFor } from '../src/lib/studio/skills/render';
import { askedSkill, readTriage, TRIAGE_TIMEOUT_MS, triageInput, triageQuestions, type DecisionAnswer, type DecisionQuestion } from '../src/lib/tireh/triage';
import { MAX_ROUTABLE_SKILLS, NO_SKILL, readSkillPick, SECOND_SKILL_PROBABILITY, SKILL_MIN_CONFIDENCE, SKILL_QUESTION, skillQuestion, type SkillChoice, type SkillPick } from '../src/lib/tireh/skill-routing';
import type { Persona } from '../src/lib/tireh/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = join(ROOT, 'scripts/evals/skill-routing');
const CASES_PATH = join(EVAL_DIR, 'cases.json');
const REVIEW_PATH = join(EVAL_DIR, 'review.json');
const RESULTS_DIR = join(EVAL_DIR, 'results');
const REPORT_PATH = join(ROOT, 'docs/agent-skills/SKILL_ROUTING_EVAL.md');
const ENDPOINT = 'https://api.openai.com/v1/decisions';
const TARGETS = { routedCorrect: 0.85, routedCorrectFa: 0.8, nonePrecision: 0.9 };

// ---------- dataset ----------

type Lang = 'en' | 'fa' | 'finglish';
interface Line { who: 'user' | 'agent'; text: string }
interface Case { id: string; roleId: string; lang: Lang; history?: Line[]; message: string; expected: string[]; tags?: string[]; note: string }
interface Dataset { version: number; userName: string; personas: Record<string, string>; cases: Case[] }

type Verdict = 'router' | 'label' | 'description' | 'ambiguous' | 'transport';
interface Experiment { label: string; variant?: string; main?: string; heldout?: string }
interface Rewrite { skillId: string; before?: string; proposed: string; status?: 'proposed' | 'applied'; why: string; cases: string[] }
interface Review {
  labelFixes?: Array<{ id: string; before: string[]; after: string[]; why: string }>;
  /** Judgements of misses in the current run, keyed by case id. */
  cases?: Record<string, { verdict: Verdict; note: string }>;
  /** Open "use when" proposals. */
  rewrites?: Rewrite[];
  /** The held-out run (a file in results/) to report next to the current run. */
  heldout?: string;
  /** Saved runs (file names in results/) comparing wording under the current policy. */
  experiments?: Experiment[];
  notes?: string[];
  /** An earlier run under a different policy, kept as a labelled section. */
  historical?: {
    title: string; intro: string; run: string; previousRun?: string;
    cases?: Record<string, { verdict: Verdict; note: string }>;
    experiments?: Experiment[];
    rewrites?: Rewrite[];
    notes?: string[];
  };
}

/** Proposed wording to try without editing packs or the runtime (see --variant). */
interface Variant { whenToUse?: Record<string, string>; instructions?: string; noneDescription?: string }
let VARIANT: Variant = {};

const LANGS: Lang[] = ['en', 'fa', 'finglish'];
const LANG_LABEL: Record<Lang, string> = { en: 'English', fa: 'Persian', finglish: 'Finglish' };

/**
 * The production policy for an agent hired with the role's default skills:
 * `routableSkillsFor` (work roles only, pinned removed, capped), offered only
 * when there is a real choice, as `renderSkillSet` and the gateway require.
 */
function routableFor(roleId: string): SkillChoice[] {
  const role = getRole(roleId);
  const choices = routableSkillsFor(role, resolveSkills(role?.skills ?? []))
    .map(({ id, title, whenToUse }) => ({ id, title, whenToUse: (VARIANT.whenToUse?.[id] ?? whenToUse).trim() }));
  return skillQuestion(choices) ? choices : [];
}

function validate(data: Dataset): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const pinned = new Set(CATALOG.skills.filter((s) => s.pinned).map((s) => s.id));
  for (const c of data.cases) {
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    const role = getRole(c.roleId);
    if (!role) { problems.push(`${c.id}: unknown role ${c.roleId}`); continue; }
    if (!data.personas[c.roleId]) problems.push(`${c.id}: no persona name for ${c.roleId}`);
    if (!LANGS.includes(c.lang)) problems.push(`${c.id}: lang ${c.lang}`);
    if (!c.message.trim()) problems.push(`${c.id}: empty message`);
    if ((c.history ?? []).length > 3) problems.push(`${c.id}: more than 3 history lines`);
    for (const h of c.history ?? []) if (h.who !== 'user' && h.who !== 'agent') problems.push(`${c.id}: history who ${h.who}`);
    if (!c.expected.length) problems.push(`${c.id}: no expected label`);
    if (c.expected.includes(NO_SKILL) && c.expected.length > 1) problems.push(`${c.id}: none mixed with skill ids`);
    // Roles the policy does not route keep their labels (checked against the
    // role's unpinned defaults) so they can be scored if the policy changes.
    const routable = routableFor(c.roleId);
    const allowed = new Set(routable.length ? routable.map((s) => s.id) : role.skills.filter((id) => !pinned.has(id)));
    for (const id of c.expected) {
      if (id === NO_SKILL) continue;
      if (pinned.has(id)) problems.push(`${c.id}: expects pinned skill ${id}`);
      else if (!allowed.has(id)) problems.push(`${c.id}: ${id} is not a routable default of ${c.roleId}`);
    }
  }
  return problems;
}

function personaFor(data: Dataset, roleId: string): Persona {
  const role = getRole(roleId)!;
  return {
    id: `eval-${roleId}`, name: data.personas[roleId], role: role.title, personality: '', communicationStyle: '', values: [],
    voice: { elevenLabsVoiceId: '', description: '' }, ownerId: 'eval', identityVersion: 1, replyWithVoice: 'never',
  };
}

/** The exact input and questions production would send for this case (private chat). */
function requestFor(data: Dataset, c: Case): { input: string; questions: DecisionQuestion[]; routable: SkillChoice[]; asked: boolean } {
  const persona = personaFor(data, c.roleId);
  const routable = routableFor(c.roleId);
  const lines = [...(c.history ?? []), { who: 'user' as const, text: c.message }]
    .map((l) => ({ who: l.who === 'agent' ? persona.name : data.userName, text: l.text }));
  const questions = triageQuestions(persona, false, routable.length ? routable : undefined)
    .map((q) => q.name !== SKILL_QUESTION || q.type !== 'choice' ? q : {
      ...q,
      instructions: VARIANT.instructions ?? q.instructions,
      choices: q.choices.map((ch) => (ch.value === NO_SKILL && VARIANT.noneDescription ? { ...ch, description: VARIANT.noneDescription } : ch)),
    });
  return { input: triageInput(persona, lines), questions, routable, asked: askedSkill(questions) };
}

// ---------- provider call (mirrors OpenAIMedia.decide, keeping probabilities) ----------

type Status = 'ok' | 'http_error' | 'timeout' | 'network_error' | 'refusal' | 'missing' | 'invalid' | 'not_asked';

interface Row {
  id: string; roleId: string; pack: string; lang: Lang; tags: string[]; expected: string[];
  status: Status; httpStatus: number | null; latencyMs: number | null; inputTokens: number | null;
  answer: { choice: string; confidence: number; probabilities?: Array<{ value: string; probability: number }> } | null;
  pick: SkillPick | null;
  /** `policy`: the role is not routed, so no skill question is asked (not a miss). */
  outcome: 'skill' | 'none' | 'unrouted' | 'policy';
  unroutedReason: null | 'error' | 'triage_invalid' | 'refusal' | 'missing' | 'invalid' | 'off_list' | 'low_confidence';
  triageValid: boolean;
  routedCorrect: boolean; top1Correct: boolean; rawTop1Correct: boolean;
  runnerUp: boolean; runnerUpRescued: boolean;
  /** Paired latency of the same request without the skill question (sampled cases only). */
  baselineLatencyMs?: number | null;
  response: unknown;
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Same parse as OpenAIMedia.decideObserved, plus per-option probabilities on choices. */
function parseAnswers(json: { answers?: Array<Record<string, unknown>> }): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  for (const a of json.answers ?? []) {
    const name = typeof a.name === 'string' ? a.name : '';
    const confidence = typeof a.confidence === 'number' ? a.confidence : 0;
    if (a.type === 'predicate' && typeof a.probability === 'number') answers[name] = { type: 'predicate', probability: a.probability };
    else if (a.type === 'choice' && typeof a.choice === 'string') {
      const probabilities = Array.isArray(a.probabilities)
        ? (a.probabilities as Array<Record<string, unknown>>).filter((p) => p && typeof p.value === 'string' && unit(p.probability))
          .map((p) => ({ value: p.value as string, probability: p.probability as number }))
        : [];
      answers[name] = { type: 'choice', choice: a.choice, confidence, ...(probabilities.length ? { probabilities } : {}) };
    } else if (a.type === 'score' && typeof a.score === 'number') answers[name] = { type: 'score', score: a.score, confidence };
  }
  return answers;
}

/** Latency of the same triage request without the skill question, or null on failure. */
async function baselineLatency(data: Dataset, c: Case, key: string, model: string, timeoutMs: number): Promise<number | null> {
  const { input, questions } = requestFor(data, c);
  const started = performance.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, questions: questions.filter((q) => q.name !== SKILL_QUESTION) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.json().catch(() => ({}));
    return response.ok ? Math.round(performance.now() - started) : null;
  } catch { return null; }
}

function blankRow(c: Case): Row {
  return {
    id: c.id, roleId: c.roleId, pack: getRole(c.roleId)!.pack, lang: c.lang, tags: c.tags ?? [], expected: c.expected,
    status: 'invalid', httpStatus: null, latencyMs: null, inputTokens: null, answer: null, pick: null, outcome: 'unrouted', unroutedReason: 'error',
    triageValid: false, routedCorrect: false, top1Correct: false, rawTop1Correct: false, runnerUp: false, runnerUpRescued: false, response: null,
  };
}

async function runCase(data: Dataset, c: Case, key: string, model: string, timeoutMs: number): Promise<Row> {
  const { input, questions, routable, asked } = requestFor(data, c);
  const row = blankRow(c);
  if (!asked) return { ...row, status: 'not_asked', outcome: 'policy', unroutedReason: null };
  const expectedNone = c.expected.includes(NO_SKILL);
  const started = performance.now();
  let json: { answers?: Array<Record<string, unknown>>; usage?: { input_tokens?: unknown } } = {};
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    json = (await response.json().catch(() => ({}))) as typeof json;
    row.latencyMs = Math.round(performance.now() - started);
    row.httpStatus = response.status;
    if (!response.ok) {
      row.status = 'http_error';
      const error = (json as { error?: { type?: unknown; code?: unknown } }).error;
      row.response = { error: { type: error?.type ?? null, code: error?.code ?? null } };
      return row;
    }
  } catch (error) {
    row.status = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network_error';
    return row;
  }
  row.response = json;
  row.inputTokens = typeof json.usage?.input_tokens === 'number' ? json.usage.input_tokens : null;
  const answers = parseAnswers(json);
  // Production reads the pick through readTriage: if the rest of triage does
  // not parse, the whole triage (and so the pick) is null and the turn is unrouted.
  const triage = readTriage(answers, false, 'mentions', routable);
  row.triageValid = triage !== null;
  const rawSkill = (json.answers ?? []).find((a) => a?.name === SKILL_QUESTION);
  const skill = answers[SKILL_QUESTION];
  if (!rawSkill) row.status = 'missing';
  else if (rawSkill.type === 'refusal') row.status = 'refusal';
  else if (skill?.type !== 'choice') row.status = 'invalid';
  else row.status = 'ok';
  if (skill?.type === 'choice') {
    row.answer = { choice: skill.choice, confidence: skill.confidence, ...(skill.probabilities ? { probabilities: skill.probabilities } : {}) };
    row.rawTop1Correct = expectedNone ? skill.choice === NO_SKILL : c.expected.includes(skill.choice);
  }
  row.pick = triage === null ? null : 'skills' in triage ? triage.skills ?? null : readSkillPick(skill, routable);
  if (row.pick) {
    row.outcome = row.pick.ids.length ? 'skill' : 'none';
    row.unroutedReason = null;
    row.routedCorrect = expectedNone ? row.pick.ids.length === 0 : row.pick.ids.some((id) => c.expected.includes(id));
    row.top1Correct = expectedNone ? row.pick.ids.length === 0 : c.expected.includes(row.pick.ids[0]);
    row.runnerUp = row.pick.ids.length === 2;
    row.runnerUpRescued = row.runnerUp && !row.top1Correct && row.routedCorrect;
  } else {
    const ids = new Set(routable.map((s) => s.id));
    row.unroutedReason = !row.triageValid ? 'triage_invalid' : row.status === 'refusal' ? 'refusal' : row.status === 'missing' ? 'missing' : skill?.type !== 'choice' ? 'invalid'
      : skill.choice !== NO_SKILL && !ids.has(skill.choice) ? 'off_list' : !unit(skill.confidence) ? 'invalid' : 'low_confidence';
  }
  return row;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// ---------- scoring ----------

interface Metrics {
  n: number; routedCorrect: number; top1: number; rawTop1: number; unrouted: number; wrong: number;
  expectedNone: number; pickedNone: number; noneHits: number; nonePrecision: number | null; noneRecall: number | null;
  skillPicks: number; runnerUps: number; rescues: number;
}

const scored = (rows: Row[]) => rows.filter((r) => r.outcome !== 'policy');

/** Metrics over the cases a skill question was asked for; policy-unrouted cases are left out. */
function metrics(all: Row[]): Metrics {
  const rows = scored(all);
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const expectedNone = count((r) => r.expected.includes(NO_SKILL));
  const pickedNone = count((r) => r.outcome === 'none');
  const noneHits = count((r) => r.outcome === 'none' && r.expected.includes(NO_SKILL));
  return {
    n: rows.length, routedCorrect: count((r) => r.routedCorrect), top1: count((r) => r.top1Correct), rawTop1: count((r) => r.rawTop1Correct),
    unrouted: count((r) => r.outcome === 'unrouted'), wrong: count((r) => r.outcome !== 'unrouted' && !r.routedCorrect),
    expectedNone, pickedNone, noneHits, nonePrecision: pickedNone ? noneHits / pickedNone : null, noneRecall: expectedNone ? noneHits / expectedNone : null,
    skillPicks: count((r) => r.outcome === 'skill'), runnerUps: count((r) => r.runnerUp), rescues: count((r) => r.runnerUpRescued),
  };
}

const pct = (num: number, den: number) => (den ? `${((100 * num) / den).toFixed(1)}%` : 'n/a');
const ratio = (v: number | null) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}
const latenciesOf = (rows: Row[]) => scored(rows).map((r) => r.latencyMs).filter((v): v is number => v !== null);

/** What the turn would load: the playbook ids, `none`, or `unrouted`. */
const outcomeKey = (r: Pick<Row, 'outcome' | 'pick'>) => (r.outcome === 'skill' ? r.pick!.ids.join('+') : r.outcome);
const topKey = (r: Pick<Row, 'outcome' | 'pick'>) => (r.outcome === 'skill' ? r.pick!.ids[0] : r.outcome);

interface RunFile { startedAt: string; finishedAt: string; model: string; catalogVersion: string; casesSha256: string; timeoutMs: number; rows: Row[] }
const loadRun = (file: string): RunFile | undefined => {
  const path = file.includes('/') ? resolve(file) : join(RESULTS_DIR, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as RunFile) : undefined;
};

function previousRun(current: string): string | undefined {
  if (!existsSync(RESULTS_DIR)) return undefined;
  return readdirSync(RESULTS_DIR).filter((f) => /^run-.*\.json$/.test(f) && f < current).sort().pop();
}

interface Stability { file: string; compared: number; sameOutcome: number; sameTop: number; sameCorrectness: number; sameConfidence: number; flips: Array<{ id: string; before: string; after: string }> }

/** Agreement on cases scored in both runs (policy-unrouted cases are not compared). */
function stability(rows: Row[], file: string): Stability | undefined {
  const earlier = loadRun(file);
  if (!earlier) return undefined;
  const before = new Map(scored(earlier.rows).map((r) => [r.id, r]));
  const both = scored(rows).filter((r) => before.has(r.id));
  const flips = both.filter((r) => outcomeKey(r) !== outcomeKey(before.get(r.id)!))
    .map((r) => ({ id: r.id, before: describePick(before.get(r.id)!), after: describePick(r) }));
  return {
    file: file.replace(/^.*\//, ''), compared: both.length, sameOutcome: both.length - flips.length,
    sameTop: both.filter((r) => topKey(r) === topKey(before.get(r.id)!)).length,
    sameCorrectness: both.filter((r) => r.routedCorrect === before.get(r.id)!.routedCorrect).length,
    sameConfidence: both.filter((r) => r.answer?.confidence === before.get(r.id)!.answer?.confidence).length, flips,
  };
}

function describePick(r: Row): string {
  if (r.outcome === 'policy') return 'unrouted by policy';
  if (r.outcome === 'skill') return r.pick!.ids.join(' + ');
  if (r.outcome === 'none') return 'none';
  const raw = r.answer ? `, raw ${r.answer.choice} @ ${r.answer.confidence.toFixed(2)}` : '';
  return `unrouted (${r.unroutedReason}${raw})`;
}

// ---------- report ----------

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const verdict = (ok: boolean) => (ok ? 'met' : '**not met**');

function metricsRow(label: string, m: Metrics): string {
  return `| ${label} | ${m.n} | ${pct(m.routedCorrect, m.n)} | ${pct(m.top1, m.n)} | ${pct(m.wrong, m.n)} | ${pct(m.unrouted, m.n)} | ${ratio(m.nonePrecision)} (${m.noneHits}/${m.pickedNone}) | ${ratio(m.noneRecall)} (${m.noneHits}/${m.expectedNone}) |`;
}
const METRICS_HEAD = '| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |\n|---|---:|---:|---:|---:|---:|---:|---:|';

function targetRows(rows: Row[]): string[] {
  const all = metrics(rows);
  const fa = metrics(rows.filter((r) => r.lang === 'fa'));
  return [
    '| Measure | Target | Result | |', '|---|---|---:|---|',
    `| Correct skill, any acceptable label (unrouted counts as a miss) | ≥ 85% | ${pct(all.routedCorrect, all.n)} (${all.routedCorrect}/${all.n}) | ${verdict(all.n > 0 && all.routedCorrect / all.n >= TARGETS.routedCorrect)} |`,
    `| Correct skill, Persian script | ≥ 80% | ${pct(fa.routedCorrect, fa.n)} (${fa.routedCorrect}/${fa.n}) | ${verdict(fa.n > 0 && fa.routedCorrect / fa.n >= TARGETS.routedCorrectFa)} |`,
    `| \`none\` precision | ≥ 90% | ${ratio(all.nonePrecision)} (${all.noneHits}/${all.pickedNone}) | ${verdict((all.nonePrecision ?? 0) >= TARGETS.nonePrecision)} |`,
    `| Wrong route | (none set) | ${pct(all.wrong, all.n)} (${all.wrong}) | |`,
    `| Unrouted (keeps the full prompt) | (none set) | ${pct(all.unrouted, all.n)} (${all.unrouted}) | |`,
  ];
}

function missTable(rows: Row[], data: Dataset[], judgements: Review['cases']): string[] {
  const misses = scored(rows).filter((r) => !r.routedCorrect);
  if (!misses.length) return ['No misses.', ''];
  const message = (id: string) => data.flatMap((d) => d.cases).find((c) => c.id === id)?.message ?? '';
  const top = (r: Row) => (r.answer?.probabilities ?? []).slice().sort((a, b) => b.probability - a.probability).slice(0, 3)
    .map((p) => `${p.value.replace(/^[a-z]+\./, '')} ${p.probability.toFixed(2)}`).join(', ');
  const judge = (id: string) => (judgements?.[id] ? `${judgements[id].verdict}: ${judgements[id].note}` : 'not yet reviewed');
  return ['| Case | Lang | Message | Expected | Got | Conf. | Top probabilities | Judgement |', '|---|---|---|---|---|---:|---|---|',
    ...misses.map((r) => `| ${r.id} | ${r.lang} | ${esc(clip(message(r.id), 90))} | ${r.expected.join(', ')} | ${esc(describePick(r))} | ${r.answer ? r.answer.confidence.toFixed(2) : 'n/a'} | ${esc(top(r))} | ${esc(judge(r.id))} |`), ''];
}

function rewriteBlocks(rewrites: Rewrite[], level = '###'): string[] {
  return rewrites.flatMap((w) => {
    const current = CATALOG.skills.find((s) => s.id === w.skillId)?.whenToUse ?? '(skill not found)';
    const lines = w.status === 'applied'
      ? [`- **Was:** ${w.before ?? '(not recorded)'}`, `- **Applied:** ${current}`]
      : [`- **Now:** ${current}`, `- **Proposed:** ${w.proposed}`];
    return [`${level} \`${w.skillId}\`${w.status === 'applied' ? ' (applied)' : ''}`, '', ...lines, `- **Why:** ${w.why} (cases: ${w.cases.join(', ')})`, ''];
  });
}

function experimentTable(experiments: Experiment[], intro: string): string[] {
  const loaded = experiments.map((e) => ({ ...e, m: e.main ? loadRun(e.main) : undefined, x: e.heldout ? loadRun(e.heldout) : undefined })).filter((e) => e.m || e.x);
  if (!loaded.length) return [];
  const cell = (r?: RunFile) => { if (!r) return ['n/a', 'n/a', 'n/a']; const m = metrics(r.rows); return [`${pct(m.routedCorrect, m.n)} (${m.routedCorrect}/${m.n})`, `${m.wrong} / ${m.unrouted}`, `${ratio(m.nonePrecision)} / ${ratio(m.noneRecall)}`]; };
  return [intro, '', '| Wording | Main: routed correct | Main: wrong / unrouted | Main: `none` P / R | Held-out: routed correct | Held-out: wrong / unrouted | Held-out: `none` P / R |', '|---|---:|---:|---:|---:|---:|---:|',
    ...loaded.map((e) => `| ${e.label}${e.variant ? ` (\`${e.variant}\`)` : ''} | ${[...cell(e.m), ...cell(e.x)].join(' | ')} |`), ''];
}

function datasetSummary(data: Dataset, rows: Row[]): string {
  const cases = data.cases;
  const policy = new Set(rows.filter((r) => r.outcome === 'policy').map((r) => r.id));
  const work = cases.filter((c) => !policy.has(c.id));
  const packOf = (c: Case) => getRole(c.roleId)!.pack;
  const byPack = (list: Case[]) => [...new Set(list.map(packOf))].map((p) => `${p} ${list.filter((c) => packOf(c) === p).length} (${new Set(list.filter((c) => packOf(c) === p).map((c) => c.roleId)).size} roles)`).join(', ');
  const tag = (list: Case[], t: string) => list.filter((c) => c.tags?.includes(t)).length;
  const none = (list: Case[]) => list.filter((c) => c.expected.includes(NO_SKILL)).length;
  const sizes = [...new Set(work.map((c) => c.roleId))].map((r) => routableFor(r).length);
  return [
    `- **${cases.length} cases** over **${new Set(cases.map((c) => c.roleId)).size} roles** in all five packs: ${byPack(cases)}. Languages: ${LANGS.map((l) => `${LANG_LABEL[l]} ${cases.filter((c) => c.lang === l).length}`).join(', ')}.`,
    `- **Scored under the shipped policy (work roles): ${work.length} cases** over ${new Set(work.map((c) => c.roleId)).size} roles: ${byPack(work)}. Persian script ${pct(work.filter((c) => c.lang === 'fa').length, work.length)} (${work.filter((c) => c.lang === 'fa').length}), Finglish ${work.filter((c) => c.lang === 'finglish').length}, English ${work.filter((c) => c.lang === 'en').length}. Expected \`none\`: ${none(work)} (${pct(none(work), work.length)}). Two acceptable labels: ${work.filter((c) => c.expected.length === 2).length}. Needs the history line: ${tag(work, 'history')}.`,
    `- **Unrouted by policy: ${policy.size} lifestyle cases** (${new Set(cases.filter((c) => policy.has(c.id)).map((c) => c.roleId)).size} roles). No skill question is asked for them, so they are not sent and not counted as misses. Their labels stay in \`cases.json\` for the historical comparison and for any future policy change.`,
    `- **Routable choices per work role:** ${sizes.length ? `${Math.min(...sizes)} to ${Math.max(...sizes)}` : 'n/a'} skills plus \`none\`.`,
  ].join('\n');
}

function pinnedSummary(): string {
  const pinned = CATALOG.skills.filter((s) => s.pinned);
  const perRole = CATALOG.roles.map((r) => ({ id: r.id, n: r.skills.filter((id) => pinned.some((p) => p.id === id)).length })).filter((r) => r.n > 0);
  const most = Math.max(0, ...perRole.map((r) => r.n));
  const lines = pinned.map((s) => {
    const defaults = CATALOG.roles.filter((r) => r.skills.includes(s.id)).map((r) => r.id);
    const optional = CATALOG.roles.filter((r) => r.optionalSkills.includes(s.id)).map((r) => r.id);
    return `| \`${s.id}\` | ${defaults.length ? defaults.join(', ') : '(none)'} | ${optional.length ? optional.join(', ') : '(none)'} |`;
  });
  return [`${pinned.length} skills are pinned: always in the prompt in full, never offered to Decisions. The most pinned skills in any role's default set is ${most} (${perRole.filter((r) => r.n === most).map((r) => r.id).join(', ')}).`, '',
    '| Pinned skill | In the default set of | Optional for |', '|---|---|---|', ...lines].join('\n');
}

function latencyParagraphs(rows: Row[]): string[] {
  const latencies = latenciesOf(rows);
  const over = latencies.filter((v) => v > TRIAGE_TIMEOUT_MS).length;
  const tokens = scored(rows).map((r) => r.inputTokens).filter((v): v is number => v !== null);
  const out = [`Whole triage request, measured from this machine through the sandbox proxy (production will differ): p50 **${quantile(latencies, 0.5)} ms**, p95 **${quantile(latencies, 0.95)} ms**, max ${latencies.length ? Math.max(...latencies) : 'n/a'} ms. **${over} of ${latencies.length}** calls (${pct(over, latencies.length)}) went over the ${TRIAGE_TIMEOUT_MS} ms production triage budget; in production those turns would time out and stay unrouted. Mean input: ${tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 'n/a'} tokens per request.`, ''];
  const pairs = scored(rows).filter((r) => typeof r.baselineLatencyMs === 'number' && r.latencyMs !== null);
  if (pairs.length) {
    const deltas = pairs.map((r) => r.latencyMs! - r.baselineLatencyMs!);
    out.push(`**Added latency, paired.** On ${pairs.length} sampled cases, the same request was also sent without the \`skill\` question, alternating which went first. Median ${quantile(pairs.map((r) => r.latencyMs!), 0.5)} ms with the question and ${quantile(pairs.map((r) => r.baselineLatencyMs!), 0.5)} ms without. Median paired difference **${quantile(deltas, 0.5)} ms** (p25 ${quantile(deltas, 0.25)} ms, p75 ${quantile(deltas, 0.75)} ms). Proxy jitter is about the same size, so read this as an estimate.`, '');
  }
  return out;
}

function stabilityLines(stab: Stability | undefined): string[] {
  if (!stab) return ['No earlier run to compare with.', ''];
  const out = [`Compared with \`${stab.file}\` on ${stab.compared} scored cases: the same playbooks (or \`none\` / unrouted) in **${pct(stab.sameOutcome, stab.compared)}**, the same first choice in ${pct(stab.sameTop, stab.compared)}, the same correct/incorrect verdict in ${pct(stab.sameCorrectness, stab.compared)}, and the identical confidence in ${pct(stab.sameConfidence, stab.compared)}.`, ''];
  if (stab.flips.length) out.push('| Case | Earlier run | This run |', '|---|---|---|', ...stab.flips.map((f) => `| ${f.id} | ${esc(f.before)} | ${esc(f.after)} |`), '');
  return out;
}

function buildReport(data: Dataset, heldoutData: Dataset | undefined, run: RunFile, review: Review, stab: Stability | undefined): string {
  const rows = run.rows;
  const all = metrics(rows);
  const latencies = latenciesOf(rows);
  const policyCount = rows.filter((r) => r.outcome === 'policy').length;
  const heldoutRun = review.heldout ? loadRun(review.heldout) : undefined;
  const held = heldoutRun ? metrics(heldoutRun.rows) : undefined;
  const statuses = (['ok', 'http_error', 'timeout', 'network_error', 'refusal', 'missing', 'invalid'] as Status[]).map((s) => [s, scored(rows).filter((r) => r.status === s).length] as const).filter(([, n]) => n);
  const unroutedReasons = [...new Set(scored(rows).map((r) => r.unroutedReason).filter(Boolean))].map((reason) => `${reason} ${scored(rows).filter((r) => r.unroutedReason === reason).length}`);
  const datasets = [data, ...(heldoutData ? [heldoutData] : [])];

  const out: string[] = [];
  out.push('# Skill routing eval', '');
  out.push(`Run ${run.startedAt.slice(0, 16).replace('T', ' ')} UTC against \`${run.model}\`, catalog \`${run.catalogVersion}\`, cases \`${run.casesSha256.slice(0, 12)}\`. Spec: \`docs/SKILL_ROUTING.md\`. Regenerate with \`npm run eval:skills\` (needs \`OPENAI_API_KEY\`; one Decisions call per work-role case, plus a paired call for every fourth).`, '');

  out.push('## Headline: shipped policy (work roles only)', '');
  out.push(`Routing applies only to agents with a library **work** role (\`routableSkillsFor\` in \`src/lib/studio/skills/render.ts\`). Lifestyle and custom agents are always unrouted, because their triggers describe mood or health and routing could drop a fitness or nutrition safety screen. All numbers below are for the **${all.n} work-role cases**. The **${policyCount} lifestyle cases are unrouted by policy**: they are not sent and not counted as misses.`, '');
  out.push(...targetRows(rows));
  out.push(`| Latency, whole triage call | 0 added (same request) | p50 ${quantile(latencies, 0.5) ?? 'n/a'} ms, p95 ${quantile(latencies, 0.95) ?? 'n/a'} ms | see Latency |`);
  if (stab) out.push(`| Run-to-run agreement (same playbooks loaded) | (none set) | ${pct(stab.sameOutcome, stab.compared)} (${stab.sameOutcome}/${stab.compared}) | vs \`${stab.file}\` |`);
  if (held) out.push(`| Held-out work-role cases, routed correct | (none set) | ${pct(held.routedCorrect, held.n)} (${held.routedCorrect}/${held.n}) | see Held-out |`);
  out.push('');

  out.push('## Method', '');
  out.push([
    '- **Request built as production builds it.** For each case the script makes a minimal persona: the case persona name and the role title, with no personality text. Lines are `history + message`, with the user shown by a person name and the agent by the persona name. It then calls `triageInput(persona, lines)` and `triageQuestions(persona, false, routable)` from `src/lib/tireh/triage.ts` (private chat). That call adds the `skill` question when `routable` offers a real choice, giving 5 questions per request. `askedSkill(questions)` decides whether the case is scored.',
    `- **Routable choices from the production policy.** \`routableSkillsFor(role, skills)\` (imported, not re-implemented) for an agent hired with the role's default skills. Work roles get their skills minus pinned ones, capped at ${MAX_ROUTABLE_SKILLS}; lifestyle roles get none. Each choice is \`{ id, title, whenToUse }\`, plus \`none\`.`,
    `- **One raw \`fetch\` per scored case** to \`POST ${ENDPOINT}\` with model \`${run.model}\` (\`OPENAI_DECISION_MODEL\` or the production default), mirroring \`OpenAIMedia.decide\`. No retries, concurrency 4, client timeout ${run.timeoutMs} ms. Each full response, including per-option probabilities, is saved under \`scripts/evals/skill-routing/results/\`.`,
    `- **Answer read as production reads it:** \`readTriage(answers, false, 'mentions', routable).skills\`, which applies \`readSkillPick\`. A pick needs confidence ≥ ${SKILL_MIN_CONFIDENCE}; a runner-up joins when its own probability is ≥ ${SECOND_SKILL_PROBABILITY}. Anything else is unrouted, including a triage response that does not parse.`,
    '- **Definitions.** *Routed correct:* the pick is not null and any picked id is an acceptable label (or the pick is `none` and the label is `none`). *Top-1 correct:* the first picked id is acceptable. *Wrong route:* a non-null pick that is not routed-correct. *`none` precision:* the share of `none` picks labelled `none`. *`none` recall:* the share of `none` labels picked `none`.',
    '- **Labels** were written before the first run, by one author, from each skill\'s "use when" line; ambiguous cases list both acceptable ids. Messages are written the way people chat: Persian with the English work words people really use, plus some Finglish. No message pastes a skill title or "use when" text.',
  ].join('\n'), '');

  out.push('## Dataset', '', datasetSummary(data, rows), '');
  out.push('### Pinned safety skills', '', pinnedSummary(), '');

  out.push('## Results (work roles)', '', '### Overall and by language', '', METRICS_HEAD, metricsRow('All work roles', all));
  for (const l of LANGS) out.push(metricsRow(LANG_LABEL[l], metrics(rows.filter((r) => r.lang === l))));
  out.push(metricsRow('Persian + Finglish', metrics(rows.filter((r) => r.lang !== 'en'))), '');
  out.push('### By pack', '', METRICS_HEAD);
  for (const p of [...new Set(scored(rows).map((r) => r.pack))]) out.push(metricsRow(p, metrics(rows.filter((r) => r.pack === p))));
  out.push('');
  const typeRows = ([
    ['Single-message cases', (r: Row) => !r.tags.includes('history')], ['Needs history', (r: Row) => r.tags.includes('history')],
    ['Two acceptable labels', (r: Row) => r.expected.length === 2], ['Small talk and quick facts', (r: Row) => r.tags.includes('smalltalk') || r.tags.includes('quickfact')],
  ] as const).map(([label, f]) => [label, metrics(rows.filter(f))] as const).filter(([, m]) => m.n > 0);
  out.push('### By case type', '', METRICS_HEAD, ...typeRows.map(([label, m]) => metricsRow(label, m)), '');
  out.push('### Latency', '', ...latencyParagraphs(rows));
  out.push('### Runner-ups and provider behaviour', '');
  out.push(`- Skill picks: ${all.skillPicks}. A runner-up was added to **${pct(all.runnerUps, all.skillPicks)}** of them (${all.runnerUps}); it rescued a wrong first choice in ${all.rescues} case(s).`);
  out.push(`- The \`skill\` answer carried per-option probabilities in ${scored(rows).filter((r) => r.answer?.probabilities?.length).length} of ${scored(rows).filter((r) => r.answer).length} responses. Raw top choice correct, ignoring the confidence threshold: ${pct(all.rawTop1, all.n)}.`);
  out.push(`- Statuses: ${statuses.map(([s, n]) => `${s} ${n}`).join(', ')}. Unrouted reasons: ${unroutedReasons.length ? unroutedReasons.join(', ') : 'none'}.`, '');
  out.push('### Stability', '', ...stabilityLines(stab));

  out.push('## Every work-role miss', '');
  out.push('A miss is any scored case that is not routed-correct (wrong route or unrouted). Judgements: **router** (the label is right and the router erred), **label** (the label was wrong), **description** (a skill\'s "use when" line misleads routing), **ambiguous** (both readings are fair), **transport** (the call failed).', '');
  out.push(...missTable(rows, datasets, review.cases));

  if (heldoutRun && held) {
    const heldPolicy = heldoutRun.rows.filter((r) => r.outcome === 'policy').length;
    out.push('## Held-out set', '');
    out.push(`\`scripts/evals/skill-routing/heldout.json\` was written after the first all-roles run and never used to tune wording. Under the shipped policy, ${held.n} of its cases are work-role cases and ${heldPolicy} are lifestyle cases, unrouted by policy. Run ${heldoutRun.startedAt.slice(0, 16).replace('T', ' ')} UTC, catalog \`${heldoutRun.catalogVersion}\`. The work-role subset is small and aimed at known weak spots: "what do I reply" support requests and problem statements that ask nothing. Treat it as a smoke test.`, '');
    out.push(METRICS_HEAD, metricsRow('Held-out work roles', held), '');
    out.push(...missTable(heldoutRun.rows, datasets, review.cases));
  }

  const current = experimentTable(review.experiments ?? [], 'Candidate wording, run with `--variant` under the shipped policy (work-role cases only; packs and runtime untouched), on the main set and the held-out work cases.');
  if (current.length) out.push('## Wording experiments (work roles)', '', ...current);
  if (review.rewrites?.length) out.push('## Proposed "use when" rewrites', '', 'Not applied: pack text other than `pinned` is the product lead\'s call.', '', ...rewriteBlocks(review.rewrites));
  if (review.notes?.length) out.push('## Notes and limits', '', ...review.notes.map((n) => `- ${n}`), '');

  const h = review.historical;
  const hRun = h ? loadRun(h.run) : undefined;
  if (h && hRun) {
    const hAll = metrics(hRun.rows);
    const hLat = latenciesOf(hRun.rows);
    const hStab = h.previousRun ? stability(hRun.rows, h.previousRun) : undefined;
    out.push(`## Historical: ${h.title}`, '', h.intro, '');
    out.push(`Run ${hRun.startedAt.slice(0, 16).replace('T', ' ')} UTC, catalog \`${hRun.catalogVersion}\`, all ${hAll.n} cases scored.`, '');
    out.push(...targetRows(hRun.rows));
    out.push(`| Latency, whole triage call | 0 added (same request) | p50 ${quantile(hLat, 0.5)} ms, p95 ${quantile(hLat, 0.95)} ms | |`);
    if (hStab) out.push(`| Run-to-run agreement | (none set) | ${pct(hStab.sameOutcome, hStab.compared)} (${hStab.sameOutcome}/${hStab.compared}) | vs \`${hStab.file}\` |`);
    out.push('', METRICS_HEAD, metricsRow('All roles', hAll));
    for (const l of LANGS) out.push(metricsRow(LANG_LABEL[l], metrics(hRun.rows.filter((r) => r.lang === l))));
    for (const p of [...new Set(hRun.rows.map((r) => r.pack))]) out.push(metricsRow(`Pack: ${p}`, metrics(hRun.rows.filter((r) => r.pack === p))));
    out.push('', '### Misses in that run', '', ...missTable(hRun.rows, datasets, h.cases));
    const table = experimentTable(h.experiments ?? [], 'Each candidate wording was run with `--variant`, leaving packs and runtime untouched, over the main set and over all 18 held-out cases. The held-out set targets known weak spots, so its absolute numbers are lower by design. Compare rows, not sets.');
    if (table.length) out.push('### Wording experiments (all roles, before the policy)', '', ...table);
    if (h.rewrites?.length) out.push('### Rewrites from that run', '', ...rewriteBlocks(h.rewrites, '####'));
    if (h.notes?.length) out.push('### Notes from that run', '', ...h.notes.map((n) => `- ${n}`), '');
  }
  return out.join('\n');
}

// ---------- main ----------

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

const readReview = (): Review => (existsSync(REVIEW_PATH) ? (JSON.parse(readFileSync(REVIEW_PATH, 'utf8')) as Review) : {});
const readDataset = (path: string): Dataset | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Dataset) : undefined);

async function main() {
  const casesOption = option('--cases');
  const bytes = readFileSync(casesOption ? resolve(casesOption) : CASES_PATH);
  const data = JSON.parse(bytes.toString('utf8')) as Dataset;
  const variantPath = option('--variant');
  if (variantPath) VARIANT = JSON.parse(readFileSync(resolve(variantPath), 'utf8')) as Variant;
  for (const [id, text] of Object.entries(VARIANT.whenToUse ?? {})) {
    if (!CATALOG.skills.some((sk) => sk.id === id)) throw new Error(`variant rewrites unknown skill ${id}`);
    if (!/^Use when/.test(text) || text.length > 220) throw new Error(`variant whenToUse for ${id} must start "Use when" and be ≤ 220 chars (${text.length})`);
  }
  const problems = validate(data);
  if (problems.length) {
    console.error(`cases have ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  const only = option('--only');
  const limit = Number(option('--limit') ?? 0) || undefined;
  const cases = data.cases.filter((c) => !only || c.id.startsWith(only)).slice(0, limit);
  const partial = cases.length !== data.cases.length || Boolean(casesOption);
  const model = process.env.OPENAI_DECISION_MODEL ?? 'gpt-6-luna';
  const concurrency = Math.max(1, Math.min(8, Number(option('--concurrency') ?? 4) || 4));
  const timeoutMs = Math.max(1000, Number(option('--timeout') ?? 10_000) || 10_000);
  const routed = cases.filter((c) => routableFor(c.roleId).length);

  console.log(`Skill routing eval: ${data.cases.length} cases, ${routed.length} on work roles (scored), ${cases.length - routed.length} unrouted by policy; ${pct(routed.filter((c) => c.lang === 'fa').length, routed.length)} of scored cases Persian; catalog ${CATALOG.version}; model ${model}.`);
  console.log(`Pinned (never offered): ${CATALOG.skills.filter((s) => s.pinned).map((s) => s.id).join(', ') || '(none)'}`);

  const from = option('--from');
  if (from) {
    const run = loadRun(from);
    if (!run) throw new Error(`no results file ${from}`);
    if (run.casesSha256 !== createHash('sha256').update(bytes).digest('hex')) console.warn('Warning: cases.json changed since this run; labels in the report are the current ones.');
    const name = from.replace(/^.*\//, '');
    const earlier = option('--compare') ?? previousRun(name);
    writeFileSync(REPORT_PATH, `${buildReport(data, readDataset(join(EVAL_DIR, 'heldout.json')), run, readReview(), earlier ? stability(run.rows, earlier) : undefined)}\n`);
    console.log(`Report rebuilt from ${name}${earlier ? ` (stability vs ${earlier})` : ''}: ${relative(ROOT, REPORT_PATH)}`);
    return;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key || process.argv.includes('--dry')) {
    console.log(`\n${key ? '--dry' : 'OPENAI_API_KEY is not set'}: printing three requests only. Nothing was sent.\n`);
    const samples = [routed.find((c) => c.lang === 'en' && !c.history), routed.find((c) => c.lang === 'fa' && !c.history), routed.find((c) => c.history?.length)].filter((c): c is Case => Boolean(c));
    for (const c of samples) {
      const { input, questions } = requestFor(data, c);
      console.log(`===== ${c.id} [${c.roleId}, ${c.lang}] expected ${c.expected.join(' | ')} =====`);
      console.log(JSON.stringify({ model, input, questions }, null, 2), '\n');
    }
    return;
  }

  const startedAt = new Date().toISOString();
  let done = 0;
  // Every fourth routed case also sends the same request without the skill
  // question, alternating which goes first, to measure what the question costs.
  const baselineEvery = process.argv.includes('--no-baseline') ? 0 : 4;
  const routedIndex = new Map(routed.map((c, i) => [c.id, i]));
  const rows = await pool(cases, concurrency, async (c) => {
    const i = routedIndex.get(c.id);
    const paired = baselineEvery > 0 && i !== undefined && i % baselineEvery === 0;
    const before = paired && i % (2 * baselineEvery) === 0 ? await baselineLatency(data, c, key, model, timeoutMs) : undefined;
    const row = await runCase(data, c, key, model, timeoutMs);
    if (paired) row.baselineLatencyMs = before !== undefined ? before : await baselineLatency(data, c, key, model, timeoutMs);
    done++;
    if (done % 25 === 0 || done === cases.length) process.stdout.write(`  ${done}/${cases.length}\n`);
    return row;
  });
  const run: RunFile & { variant?: Variant } = { ...(variantPath ? { variant: VARIANT } : {}), startedAt, finishedAt: new Date().toISOString(), model, catalogVersion: CATALOG.version, casesSha256: createHash('sha256').update(bytes).digest('hex'), timeoutMs, rows };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const base = (path: string) => path.replace(/^.*\//, '').replace(/\.json$/, '');
  const kind = [casesOption ? `cases-${base(casesOption)}` : '', variantPath ? `variant-${base(variantPath)}` : '', !casesOption && !variantPath ? (partial ? 'partial' : 'run') : '']
    .filter(Boolean).join('-');
  const file = `${kind}-${startedAt.replace(/[:.]/g, '-')}.json`;
  const previous = option('--compare') ?? (partial ? undefined : previousRun(file));
  writeFileSync(join(RESULTS_DIR, file), `${JSON.stringify(run, null, 2)}\n`);

  const m = metrics(rows);
  const faM = metrics(rows.filter((r) => r.lang === 'fa'));
  const latencies = latenciesOf(rows);
  const stab = previous ? stability(rows, previous) : undefined;
  console.log(`\nWork roles (${m.n} scored, ${rows.length - m.n} unrouted by policy):`);
  console.log(`Routed correct ${pct(m.routedCorrect, m.n)} (target 85%), Persian ${pct(faM.routedCorrect, faM.n)} (target 80%), none precision ${ratio(m.nonePrecision)} (target 90%), none recall ${ratio(m.noneRecall)}.`);
  console.log(`Top-1 ${pct(m.top1, m.n)}, wrong route ${pct(m.wrong, m.n)}, unrouted ${pct(m.unrouted, m.n)}, runner-up on ${pct(m.runnerUps, m.skillPicks)} of skill picks.`);
  console.log(`Latency p50 ${quantile(latencies, 0.5)} ms, p95 ${quantile(latencies, 0.95)} ms; ${latencies.filter((v) => v > TRIAGE_TIMEOUT_MS).length} over the ${TRIAGE_TIMEOUT_MS} ms triage budget.`);
  if (stab) console.log(`Agreement with ${stab.file}: ${pct(stab.sameOutcome, stab.compared)} same playbooks, ${pct(stab.sameTop, stab.compared)} same first choice, ${pct(stab.sameConfidence, stab.compared)} identical confidence.`);
  if (stab && variantPath) for (const f of stab.flips) console.log(`  changed ${f.id}: ${f.before} → ${f.after}`);
  console.log(`\nMisses:`);
  for (const r of scored(rows).filter((x) => !x.routedCorrect)) console.log(`  ${r.id} [${r.lang}] expected ${r.expected.join(' | ')} → ${describePick(r)}${r.answer ? ` @ ${r.answer.confidence.toFixed(2)}` : ''}`);
  console.log(`\nRaw run: ${relative(ROOT, join(RESULTS_DIR, file))}`);

  if (!partial && !variantPath && !process.argv.includes('--no-report')) {
    writeFileSync(REPORT_PATH, `${buildReport(data, readDataset(join(EVAL_DIR, 'heldout.json')), run, readReview(), stab)}\n`);
    console.log(`Report: ${relative(ROOT, REPORT_PATH)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `Skill routing eval failed: ${error.message}` : 'Skill routing eval failed');
  process.exitCode = 1;
});
