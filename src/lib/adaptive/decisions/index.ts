import { measureStage, observedUsage } from '../observation/trace';
import OpenAI from 'openai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { MAX_IMAGE_URL_LENGTH, minimizeImageDataUrl } from '../prediction/image';

/** Verified against OpenAI's Decisions guide/API reference on 2026-10-19.
 * SDK 6.9.1 has no decisions resource. Its public post() supports the documented
 * POST /v1/decisions; upgrade/replace this seam independently of consumers.
 * https://developers.openai.com/api/docs/guides/decisions
 * https://developers.openai.com/api/reference/resources/decisions/methods/create
 */
export const DECISIONS_MODEL = 'gpt-6-luna';
const text = z.string().min(1).max(2048);
const base = { name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), instructions: text };
const choice = z.object({ value: z.string().min(1).max(64), description: text }).strict();
export const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('predicate') }).strict(),
  z.object({ ...base, type: z.literal('choice'), choices: z.array(choice).min(2).max(16) }).strict(),
  z.object({ ...base, type: z.literal('score'), levels: z.array(z.object({ label: text, description: text }).strict()).min(2).max(8) }).strict(),
]);
export type DecisionQuestion = z.infer<typeof questionSchema>;
const imageUrl = z.string().max(MAX_IMAGE_URL_LENGTH).transform((v, ctx) => {
  try { return minimizeImageDataUrl(v); } catch { ctx.addIssue({ code: 'custom', message: 'invalid_image' }); return z.NEVER; }
});
export const decisionEvidenceSchema = z.union([z.string().min(1).max(8192), z.array(z.object({
  role: z.literal('user'), content: z.tuple([z.object({ type: z.literal('input_text'), text: z.string().min(1).max(4096) }).strict(),
    z.object({ type: z.literal('input_image'), image_url: imageUrl, detail: z.literal('low') }).strict()]),
}).strict()).length(1)]);
const requestSchema = z.object({ input: decisionEvidenceSchema, questions: z.array(questionSchema).min(1).max(7) }).strict()
  .refine(r => new Set(r.questions.map(q => q.name)).size === r.questions.length)
  .refine(r => r.questions.every(q => q.type !== 'choice' || new Set(q.choices.map(c => c.value)).size === q.choices.length));
export type DecisionInput = z.infer<typeof requestSchema>;
const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string(), type: z.literal('predicate'), probability }),
  z.object({ name: z.string(), type: z.literal('choice'), choice: z.string(), confidence: probability,
    probabilities: z.array(z.object({ value: z.string(), probability })) }),
  z.object({ name: z.string(), type: z.literal('score'), score: z.number().finite(), confidence: probability,
    probabilities: z.array(z.object({ value: z.number().int().nonnegative(), label: z.string(), probability })) }),
  z.object({ name: z.string(), type: z.literal('refusal') }),
]);
export type DecisionAnswer = z.infer<typeof answerSchema>;
export type DecisionUnknownReason = 'disabled' | 'invalid_input' | 'unauthorized' | 'stale' | 'cancelled' |
  'timeout' | 'rate_limited' | 'unsupported' | 'provider_error' | 'malformed' | 'refusal' | 'budget' | 'busy' | 'circuit_open';
export type DecisionResult =
  | { status: 'unknown'; reason: DecisionUnknownReason; elapsedMs: number; inputTokens?: number }
  | { status: 'answered'; model: string; answers: DecisionAnswer[]; elapsedMs: number; inputTokens?: number };
export interface DecisionProvider {
  readonly committedExportFence?: true;
  evaluate(input: DecisionInput, signal: AbortSignal, authorizeNow?: () => boolean): Promise<unknown>;
}
const decisionAuthority = new AsyncLocalStorage<{ signal: AbortSignal; authorizeNow?: () => boolean }>();
const guardedProvider = Symbol('guarded-decision-transport');

/** No credentials are read here. Inject a configured, permitted SDK client. No auto-retry. */
export class OpenAIDecisionProvider implements DecisionProvider {
  readonly committedExportFence?: true;
  constructor(private readonly client: Pick<OpenAI, 'post'>, guard?: typeof guardedProvider) { if (guard === guardedProvider) this.committedExportFence = true; }
  /** SDK public constructor transport hook; no provider request is made here. */
  static guarded(options: { apiKey: string; dangerouslyAllowBrowser?: boolean }, transportFetch: typeof fetch = globalThis.fetch): OpenAIDecisionProvider {
    return new OpenAIDecisionProvider(new OpenAI({ ...options, maxRetries: 0, logLevel: 'off', fetch: (input, init) => {
      const scope = decisionAuthority.getStore();
      if (scope?.signal.aborted || scope?.authorizeNow && !scope.authorizeNow()) throw new Error('decision_authority_changed');
      return transportFetch(input, init);
    } }), guardedProvider);
  }
  evaluate(input: DecisionInput, signal: AbortSignal, authorizeNow?: () => boolean): Promise<unknown> {
    // Parse again at provider boundary: unknown fields cannot be serialized to OpenAI.
    const parsed = requestSchema.parse(input);
    return decisionAuthority.run({ signal, authorizeNow }, () => this.client.post<unknown>('/decisions', {
      body: { model: DECISIONS_MODEL, input: parsed.input, questions: parsed.questions,
        prompt_cache_options: { mode: 'explicit' } },
      signal, timeout: 500, maxRetries: 0,
    }));
  }
}

export interface DecisionContext {
  readonly enabled: boolean;
  readonly revision: number;
  readonly currentRevision: () => number;
  /** Current deterministic authorization fingerprint including scope, source,
   * audience, grants/consent and policy versions; null denies. Never model output. */
  readonly authorize: () => Promise<string | null>;
  readonly authorizeNow?: () => boolean;
  /** Loads only minimized input AFTER authorization. Never persisted in diagnostics. */
  readonly loadInput: () => Promise<DecisionInput>;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

function validateAnswers(raw: unknown, input: DecisionInput): { answers: DecisionAnswer[]; model: string; inputTokens?: number } | null {
  const response = z.object({ model: z.literal(DECISIONS_MODEL), answers: z.array(answerSchema),
    usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional() }).safeParse(raw);
  if (!response.success || response.data.answers.length !== input.questions.length) return null;
  const answers = response.data.answers;
  if (new Set(answers.map(a => a.name)).size !== answers.length) return null;
  for (const question of input.questions) {
    const answer = answers.find(a => a.name === question.name);
    if (!answer) return null;
    if (answer.type === 'refusal') continue;
    if (answer.type !== question.type) return null;
    if (answer.type === 'choice' && question.type === 'choice') {
      const values = question.choices.map(c => c.value);
      if (!values.includes(answer.choice) || answer.probabilities.length !== values.length ||
          new Set(answer.probabilities.map(p => p.value)).size !== values.length ||
          answer.probabilities.some(p => !values.includes(p.value)) ||
          Math.abs(answer.probabilities.reduce((sum, p) => sum + p.probability, 0) - 1) > 0.01) return null;
    }
    if (answer.type === 'score' && question.type === 'score') {
      if (answer.score < 0 || answer.score > question.levels.length - 1 ||
          answer.probabilities.length !== question.levels.length ||
          new Set(answer.probabilities.map(p => p.value)).size !== question.levels.length ||
          answer.probabilities.some(p => p.value >= question.levels.length || p.label !== question.levels[p.value].label) ||
          Math.abs(answer.probabilities.reduce((sum, p) => sum + p.probability, 0) - 1) > 0.01 ||
          Math.abs(answer.probabilities.reduce((sum, p) => sum + p.value * p.probability, 0) - answer.score) > 0.01) return null;
    }
  }
  return { answers, model: response.data.model, inputTokens: response.data.usage?.input_tokens };
}

/** Returns semantic evidence only. This service cannot write memory, grant access,
 * identify a person, speak, send a notification, or commit any tool action. */
export class DecisionService {
  private failures = 0;
  private blockedUntil = 0;
  constructor(private readonly provider: DecisionProvider, private readonly now: () => number = Date.now) {}
  get committedExportFence(): boolean { return this.provider.committedExportFence === true; }
  async evaluate(context: DecisionContext): Promise<DecisionResult> {
    return measureStage('decisions', () => this.evaluateObserved(context), result => result.status === 'answered' ? 'succeeded' : ['cancelled', 'stale'].includes(result.reason) ? 'cancelled' : 'unknown');
  }
  private async evaluateObserved(context: DecisionContext): Promise<DecisionResult> {
    const started = this.now();
    const unknown = (reason: DecisionUnknownReason, inputTokens?: number): DecisionResult =>
      ({ status: 'unknown', reason, elapsedMs: Math.max(0, this.now() - started), ...(inputTokens === undefined ? {} : { inputTokens }) });
    if (!context.enabled) return unknown('disabled');
    if (context.authorizeNow && !this.committedExportFence) return unknown('unsupported');
    if (this.blockedUntil > started) return unknown('circuit_open');
    if (context.deadlineMs !== undefined && (!Number.isFinite(context.deadlineMs) || context.deadlineMs < 1)) return unknown('invalid_input');
    if (context.signal?.aborted) return unknown('cancelled');
    if (context.currentRevision() !== context.revision) return unknown('stale');
    const controller = new AbortController();
    let stopReason: 'timeout' | 'cancelled' = 'timeout';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const deadline = Math.min(500, Math.max(1, context.deadlineMs ?? 500));
    const stop = new Promise<DecisionResult>(resolve => {
      cancel = () => { stopReason = 'cancelled'; controller.abort(); resolve(unknown('cancelled')); };
      context.signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); resolve(unknown('timeout')); }, deadline);
    });
    const run = async (): Promise<DecisionResult> => {
      try {
        const before = await context.authorize();
        if (controller.signal.aborted) return unknown(stopReason);
        if (!before) return unknown('unauthorized');
        const parsed = requestSchema.safeParse(await context.loadInput());
        if (!parsed.success) return unknown('invalid_input');
        if (context.currentRevision() !== context.revision) return unknown('stale');
        if (controller.signal.aborted) return unknown(stopReason);
        // Source/policy may have changed while loading even minimized input.
        if (await context.authorize() !== before || context.currentRevision() !== context.revision) return unknown('stale');
        if (controller.signal.aborted) return unknown(stopReason);
        if (context.authorizeNow && !context.authorizeNow()) return unknown('unauthorized');
        const raw = await this.provider.evaluate(parsed.data, controller.signal, context.authorizeNow);
        if (controller.signal.aborted) return unknown(stopReason);
        const result = validateAnswers(raw, parsed.data);
        if (!result) return unknown('malformed');
        observedUsage('openai', 'gpt', { inputTokens: result.inputTokens });
        if (context.currentRevision() !== context.revision || await context.authorize() !== before || context.currentRevision() !== context.revision) return unknown('stale', result.inputTokens);
        if (controller.signal.aborted) return unknown(stopReason, result.inputTokens);
        if (result.answers.some(a => a.type === 'refusal')) return unknown('refusal', result.inputTokens);
        return { status: 'answered', ...result, elapsedMs: Math.max(0, this.now() - started) };
      } catch (error) {
        if (controller.signal.aborted) return unknown(stopReason);
        const status = typeof error === 'object' && error && 'status' in error ? error.status : null;
        const name = error instanceof Error ? error.name : '';
        return unknown(name === 'APIConnectionTimeoutError' ? 'timeout' : status === 429 ? 'rate_limited' : status === 404 ? 'unsupported' : 'provider_error');
      }
    };
    try {
      const result = await Promise.race([run(), stop]);
      if (result.status === 'answered') this.failures = 0;
      else if (['timeout', 'rate_limited', 'provider_error', 'unsupported'].includes(result.reason)) {
        if (++this.failures >= 3) this.blockedUntil = this.now() + 30_000;
      }
      return result;
    }
    finally { if (timer) clearTimeout(timer); if (cancel) context.signal?.removeEventListener('abort', cancel); }
  }
}

/** One controller per live session. Never a shared cross-user cache. */
export class PredictionSession {
  private revision = 0;
  private evaluations = 0;
  private active?: AbortController;
  constructor(private readonly service: DecisionService) {}
  revise(): number {
    this.active?.abort();
    this.active = undefined;
    return ++this.revision;
  }
  cancel(): void { this.revise(); }
  startTurn(): number { this.evaluations = 0; return this.revise(); }
  async prepare(context: Omit<DecisionContext, 'revision' | 'currentRevision' | 'signal'>): Promise<DecisionResult> {
    if (this.active) return { status: 'unknown', reason: 'busy', elapsedMs: 0 };
    if (this.evaluations >= 2) return { status: 'unknown', reason: 'budget', elapsedMs: 0 };
    this.evaluations++;
    const controller = new AbortController();
    this.active = controller;
    try { return await this.service.evaluate({ ...context, revision: this.revision, currentRevision: () => this.revision, signal: controller.signal }); }
    finally { if (this.active === controller) this.active = undefined; }
  }
}
