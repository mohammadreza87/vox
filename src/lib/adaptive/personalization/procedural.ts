/**
 * Reply-style procedural memory: a Beta-Bernoulli Thompson-sampling policy over
 * six fixed, low-risk reply-style dimensions, keyed by a hashed person key,
 * persona, space and route (docs/AGENT_INTELLIGENCE_SOLUTION.md sections 2.6,
 * 4.10 and section 5 step 14).
 *
 * Library only: nothing in the gateway, Studio or runtime imports it. Every
 * choose/settle call takes a call-time optional.personalization check. Rows are
 * content-free: enums, hashes, ids, numbers and dates, enforced by strict
 * schemas. Reply-rate alone never changes a posterior.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ResolvedPreference } from './index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPLY_STYLE_POLICY_VERSION = 1 as const;
export const REPLY_STYLE_ARMS = {
  length: ['brief', 'balanced', 'detailed'],
  register: ['formal', 'informal'],
  structure: ['plain', 'steps'],
  modality: ['text', 'voice_default'],
  language: ['fa', 'en', 'mixed'],
  closingQuestion: ['yes', 'no'],
} as const;
export type ReplyStyleDimension = keyof typeof REPLY_STYLE_ARMS;
export const REPLY_STYLE_DIMENSIONS: readonly ReplyStyleDimension[] = Object.freeze(
  ['length', 'register', 'structure', 'modality', 'language', 'closingQuestion'] as const);

export const DEFAULT_HALF_LIFE_MS = 90 * 86_400_000;
export const FOLLOW_UP_WINDOW_MS = 10 * 60_000;
export const REWARD_WINDOW_MS = 24 * 3_600_000;
export const EVAL_RETENTION_MS = 90 * 86_400_000;
export const DEFAULT_PROPENSITY_SAMPLES = 200;
export const MIN_PROPENSITY_SAMPLES = 16;
export const MAX_PROPENSITY_SAMPLES = 2000;
/** Cap on alpha + beta of one arm, so old evidence can always be outweighed. */
export const MAX_EVIDENCE = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplyStyle = { readonly [D in ReplyStyleDimension]: (typeof REPLY_STYLE_ARMS)[D][number] };
export type ReplyStyleSource = 'explicit_turn' | 'explicit_stored' | 'reset' | 'sampled' | 'persona_default';
/** Same labels as S09 DecisionLogRow.routeTaken. */
export type ReplyRoute = 'quick' | 'thoughtful' | 'web' | 'untriaged';
export type ReplySpace = 'work' | 'personal';
/** Structurally identical to S09 TriageV2.explicitStyleRequest; deliberately not imported. */
export type ExplicitStyleRequest = 'brief' | 'detailed' | 'step_by_step' | 'listening' | 'unspecified';

export interface ReplyStyleKey { readonly personId: string; readonly personaId: string; readonly space: ReplySpace; readonly route: ReplyRoute }

/** Beta(alpha, beta); updatedAt in epoch ms. */
export interface ArmPosterior { alpha: number; beta: number; updatedAt: number }
export interface ReplyStylePosteriorDoc {
  schemaVersion: 1;
  /** posteriorDocId(key), 64 hex. */
  id: string;
  /** personKeyOf(personId), 32 hex; the raw personId is never stored. */
  personKey: string;
  personaId: string; space: ReplySpace; route: ReplyRoute;
  /** Only arms of REPLY_STYLE_ARMS[D]. */
  arms: { [D in ReplyStyleDimension]?: { [arm: string]: ArmPosterior } };
  updatedAt: number;
}

export type ReplySignalKind = 'reaction_positive' | 'reaction_negative' | 'follow_up' | 'corrective_follow_up' | 'share_offer_accepted'
  | 'voice_reciprocated' | 'explicit_thanks' | 'explicit_correction' | 'correction_phrase';

/** Content-free outcome signals computed by the caller; no field carries text. */
export interface ReplyOutcomeSignals {
  readonly reaction?: 'positive' | 'negative';
  readonly followUp?: { readonly at: number; readonly corrective: boolean | 'unknown' };
  readonly shareOfferAccepted?: boolean;
  readonly voiceReciprocated?: boolean;
  readonly explicitThanks?: boolean;
  /** For example triage explicit_correction >= the caller's threshold. */
  readonly explicitCorrection?: boolean;
  /** The caller ran detectCorrectionPhrase on the follow-up; the text is not passed. */
  readonly correctionPhrase?: boolean;
  /** Ignored by design: reply-rate alone never produces a reward. */
  readonly replied?: boolean;
}
export interface CompositeReward { readonly reward: 0 | 1 | null; readonly positives: ReplySignalKind[]; readonly negatives: ReplySignalKind[] }

export interface ReplyStyleEvalRecord {
  schemaVersion: 1;
  /** The decisionId. */
  id: string;
  /** expiresAt = at + evalRetentionMs. */
  at: number; expiresAt: number;
  /** dimensions: the policy's configured dimensions at decision time. */
  context: { personKey: string; personaId: string; space: ReplySpace; route: ReplyRoute; policyVersion: 1; dimensions: ReplyStyleDimension[] };
  /** The full delivered style. */
  armChosen: ReplyStyle;
  sources: Record<ReplyStyleDimension, ReplyStyleSource>;
  /** (0,1]; the product of dimensionPropensity. */
  propensity: number;
  /** Sampled dimensions only. */
  dimensionPropensity: { [D in ReplyStyleDimension]?: number };
  /** Sampled dimensions only, table order. */
  unchosenArms: { [D in ReplyStyleDimension]?: string[] };
  /** Null until settled. */
  reward: 0 | 1 | null;
  rewardSignals?: ReplySignalKind[];
  settledAt?: number;
}

export interface ReplyStyleStore {
  get(key: ReplyStyleKey): Promise<ReplyStylePosteriorDoc | null>;
  appendDecision(record: ReplyStyleEvalRecord): Promise<void>;
  /** Atomic: loads the decision and its posterior doc, runs mutate, persists the returned values or nothing. */
  settle<T>(decisionId: string, mutate: (decision: ReplyStyleEvalRecord | null, doc: ReplyStylePosteriorDoc | null) =>
    { decision?: ReplyStyleEvalRecord; doc?: ReplyStylePosteriorDoc; result: T }): Promise<T>;
  listPosteriors(filter: { personKey: string; personaId?: string; space?: ReplySpace }): Promise<ReplyStylePosteriorDoc[]>;
  listDecisions(filter: { since?: number; until?: number; limit?: number }): Promise<ReplyStyleEvalRecord[]>;
  deleteScope(filter: { personKey: string; personaId?: string; space?: ReplySpace }): Promise<{ posteriors: number; decisions: number }>;
  /** Deletes eval rows with expiresAt <= now. */
  sweep(now: number): Promise<number>;
}

/** optional.personalization, evaluated at call time. */
export type PersonalizationCheck = () => boolean | Promise<boolean>;

export interface ChooseReplyStyleInput {
  readonly key: ReplyStyleKey;
  readonly audience: 'private' | 'group';
  readonly guestAudience: boolean;
  readonly personaDefault: ReplyStyle;
  readonly explicitThisTurn?: Partial<ReplyStyle>;
  readonly storedPreferences?: readonly ResolvedPreference[];
  readonly personalizationAllowed: PersonalizationCheck;
}
export interface ReplyStyleChoice {
  readonly style: ReplyStyle;
  readonly sources: Readonly<Record<ReplyStyleDimension, ReplyStyleSource>>;
  /** Present only when a record was written. */
  readonly decisionId?: string;
  /** 1 when nothing was sampled. */
  readonly propensity: number;
}
export interface SettleReplyStyleInput { readonly decisionId: string; readonly signals: ReplyOutcomeSignals; readonly personalizationAllowed: PersonalizationCheck }
export type SettleResult = { readonly updated: true; readonly reward: 0 | 1 }
  | { readonly updated: false; readonly reason: 'personalization_off' | 'no_signal' | 'unknown_decision' | 'already_settled' | 'expired' | 'store_error' };
export interface PosteriorView { readonly route: ReplyRoute; readonly dimension: ReplyStyleDimension; readonly arm: string; readonly alpha: number; readonly beta: number; readonly mean: number; readonly updatedAt: number }

export interface ReplyStylePolicyOptions {
  readonly store: ReplyStyleStore;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly dimensions?: readonly ReplyStyleDimension[];
  readonly halfLifeMs?: number;
  readonly propensitySamples?: number;
  readonly evalRetentionMs?: number;
}

// ---------------------------------------------------------------------------
// Schemas (strict: an unknown key such as `text` fails to parse)
// ---------------------------------------------------------------------------

const SPACES = ['work', 'personal'] as const;
const ROUTES = ['quick', 'thoughtful', 'web', 'untriaged'] as const;
const SOURCES = ['explicit_turn', 'explicit_stored', 'reset', 'sampled', 'persona_default'] as const;
const SIGNAL_KINDS = ['reaction_positive', 'reaction_negative', 'follow_up', 'corrective_follow_up', 'share_offer_accepted',
  'voice_reciprocated', 'explicit_thanks', 'explicit_correction', 'correction_phrase'] as const;
/** Persona ids and decision ids. */
export const REPLY_STYLE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const ID_PATTERN = REPLY_STYLE_ID_PATTERN;

const hex32 = z.string().regex(/^[0-9a-f]{32}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const idString = z.string().regex(ID_PATTERN);
const time = z.number().int().nonnegative().safe();
const spaceSchema = z.enum(SPACES);
const routeSchema = z.enum(ROUTES);
const dimensionSchema = z.enum(REPLY_STYLE_DIMENSIONS as unknown as [ReplyStyleDimension, ...ReplyStyleDimension[]]);
const evidence = z.number().finite().min(1).max(MAX_EVIDENCE);
const armPosteriorSchema = z.object({ alpha: evidence, beta: evidence, updatedAt: time }).strict();
const armEnum = <D extends ReplyStyleDimension>(d: D) => z.enum(REPLY_STYLE_ARMS[d] as unknown as [string, ...string[]]);
const perDimension = <S extends z.ZodTypeAny>(make: (d: ReplyStyleDimension) => S) =>
  Object.fromEntries(REPLY_STYLE_DIMENSIONS.map(d => [d, make(d)])) as Record<ReplyStyleDimension, S>;
const armsOfDimension = (d: ReplyStyleDimension) =>
  z.object(Object.fromEntries(REPLY_STYLE_ARMS[d].map(arm => [arm, armPosteriorSchema.optional()]))).strict().optional();

export const replyStylePosteriorDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: hex64,
  personKey: hex32,
  personaId: idString,
  space: spaceSchema,
  route: routeSchema,
  arms: z.object(perDimension(armsOfDimension)).strict(),
  updatedAt: time,
}).strict() as unknown as z.ZodType<ReplyStylePosteriorDoc>;

const propensityValue = z.number().gt(0).max(1);
export const replyStyleEvalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: idString,
  at: time,
  expiresAt: time,
  context: z.object({
    personKey: hex32, personaId: idString, space: spaceSchema, route: routeSchema,
    policyVersion: z.literal(REPLY_STYLE_POLICY_VERSION),
    dimensions: z.array(dimensionSchema).min(1).max(REPLY_STYLE_DIMENSIONS.length),
  }).strict(),
  armChosen: z.object(perDimension(armEnum)).strict(),
  sources: z.object(perDimension(() => z.enum(SOURCES))).strict(),
  propensity: propensityValue,
  dimensionPropensity: z.object(perDimension(() => propensityValue.optional())).strict(),
  unchosenArms: z.object(perDimension(d => z.array(armEnum(d)).max(REPLY_STYLE_ARMS[d].length - 1).optional())).strict(),
  reward: z.union([z.literal(0), z.literal(1), z.null()]),
  rewardSignals: z.array(z.enum(SIGNAL_KINDS)).max(SIGNAL_KINDS.length).optional(),
  settledAt: time.optional(),
}).strict().refine(r => r.expiresAt >= r.at) as unknown as z.ZodType<ReplyStyleEvalRecord>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Pseudonymous person key: sha256 of a domain-separated personId, first 32 hex chars. */
export function personKeyOf(personId: string): string {
  return sha256(`vox-reply-style:v1:${personId}`).slice(0, 32);
}

/** Posterior doc id from an already hashed person key (stores locate docs from eval rows this way). */
export function posteriorDocIdForPersonKey(personKey: string, personaId: string, space: ReplySpace, route: ReplyRoute): string {
  return sha256(JSON.stringify(['reply-style', personKey, personaId, space, route]));
}

export function posteriorDocId(key: ReplyStyleKey): string {
  return posteriorDocIdForPersonKey(personKeyOf(key.personId), key.personaId, key.space, key.route);
}

const prior = (updatedAt: number): ArmPosterior => ({ alpha: 1, beta: 1, updatedAt });

/** Exponential decay toward the Beta(1,1) prior; never below it; updatedAt is unchanged. */
export function decayPosterior(p: ArmPosterior, now: number, halfLifeMs: number = DEFAULT_HALF_LIFE_MS): ArmPosterior {
  const w = now <= p.updatedAt ? 1 : 2 ** (-(now - p.updatedAt) / halfLifeMs);
  return { alpha: 1 + Math.max(0, p.alpha - 1) * w, beta: 1 + Math.max(0, p.beta - 1) * w, updatedAt: p.updatedAt };
}

/** Decays to now, then adds one Bernoulli observation; evidence is capped at MAX_EVIDENCE. */
export function updatePosterior(p: ArmPosterior, reward: 0 | 1, now: number, halfLifeMs: number = DEFAULT_HALF_LIFE_MS): ArmPosterior {
  const decayed = decayPosterior(p, now, halfLifeMs);
  let alpha = decayed.alpha + reward;
  let beta = decayed.beta + (1 - reward);
  if (alpha + beta > MAX_EVIDENCE) {
    const scale = (MAX_EVIDENCE - 2) / ((alpha - 1) + (beta - 1));
    alpha = 1 + (alpha - 1) * scale;
    beta = 1 + (beta - 1) * scale;
  }
  return { alpha, beta, updatedAt: now };
}

function draw(random: () => number): number {
  const u = random();
  if (typeof u !== 'number' || !(u >= 0 && u < 1)) throw new RangeError('reply_style_rng_out_of_range');
  return u;
}

function standardNormal(random: () => number): number {
  const u1 = 1 - draw(random); // (0, 1]: log(0) cannot occur
  const u2 = draw(random);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const MAX_GAMMA_ITERATIONS = 1_000;
function sampleGamma(shape: number, random: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, random) * (1 - draw(random)) ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < MAX_GAMMA_ITERATIONS; i++) {
    let x: number;
    let v: number;
    do { x = standardNormal(random); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = draw(random);
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  throw new RangeError('reply_style_gamma_no_convergence');
}

/** One Beta(alpha, beta) draw via two Gamma draws. Throws RangeError on a bad RNG or bad shape. */
export function sampleBeta(alpha: number, beta: number, random: () => number): number {
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) throw new RangeError('reply_style_bad_shape');
  const x = sampleGamma(alpha, random);
  const y = sampleGamma(beta, random);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/** Deterministic 32-bit RNG for tests and offline replay. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isArm = (d: ReplyStyleDimension, value: unknown): boolean =>
  typeof value === 'string' && (REPLY_STYLE_ARMS[d] as readonly string[]).includes(value);

type MutableStyle = { -readonly [D in ReplyStyleDimension]?: ReplyStyle[D] };

/** Maps resolvePreferences output to pins. Hypotheses and defaults never pin. */
export function pinsFromResolvedPreferences(resolved: readonly ResolvedPreference[], personaDefault: ReplyStyle):
  { pins: Partial<ReplyStyle>; sources: Partial<Record<ReplyStyleDimension, 'explicit_stored' | 'reset'>> } {
  const pins: MutableStyle = {};
  const sources: Partial<Record<ReplyStyleDimension, 'explicit_stored' | 'reset'>> = {};
  const pin = <D extends ReplyStyleDimension>(d: D, value: ReplyStyle[D], source: 'explicit_stored' | 'reset') => {
    pins[d] = value as MutableStyle[D];
    sources[d] = source;
  };
  for (const preference of resolved) {
    const setting = preference.setting;
    const dimension: ReplyStyleDimension | null = setting.key === 'response_length' ? 'length'
      : setting.key === 'language' ? 'language' : setting.key === 'formatting' ? 'structure' : null;
    if (!dimension) continue;
    if (preference.source === 'reset') { pin(dimension, personaDefault[dimension], 'reset'); continue; }
    if (preference.source !== 'explicit') continue;
    if (setting.key === 'response_length' && isArm('length', setting.value)) pin('length', setting.value, 'explicit_stored');
    else if (setting.key === 'language') {
      if (setting.value === 'en' || setting.value === 'fa') pin('language', setting.value, 'explicit_stored');
      else if (setting.value === 'auto') pin('language', personaDefault.language, 'explicit_stored');
    } else if (setting.key === 'formatting') {
      if (setting.value === 'plain') pin('structure', 'plain', 'explicit_stored');
      else if (setting.value === 'structured') pin('structure', 'steps', 'explicit_stored');
    }
  }
  return { pins: pins as Partial<ReplyStyle>, sources };
}

/** The pure precedence resolver: explicit this turn > stored pin > sampled > persona default. */
export function resolveReplyStyle(input: { personaDefault: ReplyStyle; explicitThisTurn?: Partial<ReplyStyle>; stored?: ReturnType<typeof pinsFromResolvedPreferences>; sampled?: Partial<ReplyStyle> }):
  { style: ReplyStyle; sources: Record<ReplyStyleDimension, ReplyStyleSource> } {
  const style: MutableStyle = {};
  const sources = {} as Record<ReplyStyleDimension, ReplyStyleSource>;
  for (const d of REPLY_STYLE_DIMENSIONS) {
    const turn = input.explicitThisTurn?.[d];
    const stored = input.stored?.pins[d];
    const sampled = input.sampled?.[d];
    if (isArm(d, turn)) { style[d] = turn as never; sources[d] = 'explicit_turn'; }
    else if (isArm(d, stored)) { style[d] = stored as never; sources[d] = input.stored?.sources[d] ?? 'explicit_stored'; }
    else if (isArm(d, sampled)) { style[d] = sampled as never; sources[d] = 'sampled'; }
    else { style[d] = input.personaDefault[d] as never; sources[d] = 'persona_default'; }
  }
  return { style: style as ReplyStyle, sources };
}

export function styleFromExplicitRequest(request: ExplicitStyleRequest): Partial<ReplyStyle> {
  switch (request) {
    case 'brief': return { length: 'brief' };
    case 'detailed': return { length: 'detailed' };
    case 'step_by_step': return { structure: 'steps' };
    default: return {};
  }
}

/** Composite reward. Any negative gives 0, else any positive gives 1, else null. `replied` is never read. */
export function compositeReward(signals: ReplyOutcomeSignals, replyAt: number): CompositeReward {
  const followUp = signals.followUp;
  const inWindow = followUp !== undefined && Number.isFinite(followUp.at) && Number.isFinite(replyAt)
    && followUp.at - replyAt >= 0 && followUp.at - replyAt <= FOLLOW_UP_WINDOW_MS;
  const negatives: ReplySignalKind[] = [];
  const positives: ReplySignalKind[] = [];
  if (signals.explicitCorrection === true) negatives.push('explicit_correction');
  if (signals.correctionPhrase === true) negatives.push('correction_phrase');
  if (signals.reaction === 'negative') negatives.push('reaction_negative');
  if (inWindow && followUp?.corrective === true) negatives.push('corrective_follow_up');
  if (signals.reaction === 'positive') positives.push('reaction_positive');
  if (inWindow && followUp?.corrective === false) positives.push('follow_up');
  if (signals.shareOfferAccepted === true) positives.push('share_offer_accepted');
  if (signals.voiceReciprocated === true) positives.push('voice_reciprocated');
  if (signals.explicitThanks === true) positives.push('explicit_thanks');
  return { reward: negatives.length > 0 ? 0 : positives.length > 0 ? 1 : null, positives, negatives };
}

const CORRECTION_PATTERNS: readonly RegExp[] = [
  /^(no|nope)\b(?!\s+(problem|worries|need|rush|thanks|thank you)\b)/,
  /\b(try|say|do( it)?|explain( it)?) again\b/,
  /^again[.!?]*$/,
  /\bnot what i (meant|asked|wanted)\b/,
  /\byou misunderstood\b/,
  /\bthat'?s (wrong|not right|incorrect)\b/,
  /^نه(?=$|[\s،,.!؟?])(?!\s*(ممنون|مرسی|مشکلی|نیازی))/,
  /دوباره(?=$|[\s،,.!؟?])/,
  /منظورم\s*(این|اون|آن)\s*نبود/,
  /اشتباه\s*(متوجه|فهمیدی|گفتی|است|ه)/,
  /درست\s*نیست/,
];

/** Pure EN/FA heuristic for "no / again / not what I meant". The text is never retained, logged or returned. */
export function detectCorrectionPhrase(text: string): boolean {
  if (typeof text !== 'string') return false;
  const normalized = text.normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌ـ]/g, '')
    .trim()
    .toLowerCase();
  return CORRECTION_PATTERNS.some(pattern => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const validKey = (key: ReplyStyleKey): boolean =>
  typeof key.personId === 'string' && key.personId.length > 0 && ID_PATTERN.test(key.personaId)
  && (SPACES as readonly string[]).includes(key.space) && (ROUTES as readonly string[]).includes(key.route);

const argmax = (values: readonly number[]): number => {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
};

export class ReplyStylePolicy {
  private readonly store: ReplyStyleStore;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly dimensions: readonly ReplyStyleDimension[];
  private readonly halfLifeMs: number;
  private readonly propensitySamples: number;
  private readonly evalRetentionMs: number;

  constructor(options: ReplyStylePolicyOptions) {
    const dimensions = options.dimensions ?? REPLY_STYLE_DIMENSIONS;
    if (dimensions.length === 0) throw new Error('reply_style_no_dimensions');
    if (new Set(dimensions).size !== dimensions.length) throw new Error('reply_style_duplicate_dimension');
    if (dimensions.some(d => !REPLY_STYLE_DIMENSIONS.includes(d))) throw new Error('reply_style_unknown_dimension');
    const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) throw new Error('reply_style_bad_half_life');
    const samples = options.propensitySamples ?? DEFAULT_PROPENSITY_SAMPLES;
    if (!Number.isInteger(samples) || samples < MIN_PROPENSITY_SAMPLES || samples > MAX_PROPENSITY_SAMPLES) throw new Error('reply_style_bad_propensity_samples');
    const evalRetentionMs = options.evalRetentionMs ?? EVAL_RETENTION_MS;
    if (!Number.isSafeInteger(evalRetentionMs) || evalRetentionMs <= 0) throw new Error('reply_style_bad_retention');
    this.store = options.store;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    // Fixed table order regardless of the order given.
    this.dimensions = REPLY_STYLE_DIMENSIONS.filter(d => dimensions.includes(d));
    this.halfLifeMs = halfLifeMs;
    this.propensitySamples = samples;
    this.evalRetentionMs = evalRetentionMs;
  }

  /** Never throws. Any gate, audience, store or RNG problem yields the non-sampled resolution. */
  async choose(input: ChooseReplyStyleInput): Promise<ReplyStyleChoice> {
    let fallback: ReplyStyleChoice;
    try {
      const stored = pinsFromResolvedPreferences(input.storedPreferences ?? [], input.personaDefault);
      const base = resolveReplyStyle({ personaDefault: input.personaDefault, explicitThisTurn: input.explicitThisTurn, stored });
      fallback = { style: base.style, sources: base.sources, propensity: 1 };
      const unpinned = this.dimensions.filter(d => base.sources[d] === 'persona_default');
      if (input.audience !== 'private' || input.guestAudience !== false || unpinned.length === 0) return fallback;
      if (await input.personalizationAllowed() !== true) return fallback;
      if (!validKey(input.key)) return fallback;

      const doc = await this.store.get(input.key);
      const at = this.now();
      const sampled: MutableStyle = {};
      const dimensionPropensity: ReplyStyleEvalRecord['dimensionPropensity'] = {};
      const unchosenArms: ReplyStyleEvalRecord['unchosenArms'] = {};
      let propensity = 1;
      for (const d of unpinned) {
        const arms = REPLY_STYLE_ARMS[d] as readonly string[];
        const posteriors = arms.map(arm => decayPosterior(doc?.arms[d]?.[arm] ?? prior(at), at, this.halfLifeMs));
        const drawAll = () => posteriors.map(p => sampleBeta(p.alpha, p.beta, this.random));
        const chosen = argmax(drawAll());
        let wins = 0;
        for (let i = 0; i < this.propensitySamples; i++) if (argmax(drawAll()) === chosen) wins++;
        const p = Math.min(1, Math.max(wins / this.propensitySamples, 1 / (this.propensitySamples + 1)));
        sampled[d] = arms[chosen] as never;
        dimensionPropensity[d] = p;
        unchosenArms[d] = arms.filter((_, i) => i !== chosen);
        propensity *= p;
      }
      const resolved = resolveReplyStyle({ personaDefault: input.personaDefault, explicitThisTurn: input.explicitThisTurn, stored, sampled });
      if (await input.personalizationAllowed() !== true) return fallback;
      const decisionId = this.newId();
      await this.store.appendDecision({
        schemaVersion: 1,
        id: decisionId,
        at,
        expiresAt: at + this.evalRetentionMs,
        context: { personKey: personKeyOf(input.key.personId), personaId: input.key.personaId, space: input.key.space,
          route: input.key.route, policyVersion: REPLY_STYLE_POLICY_VERSION, dimensions: [...this.dimensions] },
        armChosen: resolved.style,
        sources: resolved.sources,
        propensity,
        dimensionPropensity,
        unchosenArms,
        reward: null,
      });
      return { style: resolved.style, sources: resolved.sources, decisionId, propensity };
    } catch {
      return fallbackChoice(input.personaDefault, input.explicitThisTurn, input.storedPreferences);
    }
  }

  /** Never throws. Updates only sampled dimensions, only the chosen arm, only on a non-null composite reward. */
  async settle(input: SettleReplyStyleInput): Promise<SettleResult> {
    try {
      if (await input.personalizationAllowed() !== true) return { updated: false, reason: 'personalization_off' };
    } catch {
      return { updated: false, reason: 'personalization_off' };
    }
    const signals = input.signals ?? {};
    // A reward is only possible with a time-independent signal or a definite follow-up; skip the store otherwise.
    const possible = compositeReward({ ...signals, followUp: undefined }, 0).reward !== null
      || (signals.followUp !== undefined && typeof signals.followUp.corrective === 'boolean');
    if (!possible) return { updated: false, reason: 'no_signal' };
    try {
      const now = this.now();
      return await this.store.settle<SettleResult>(input.decisionId, (decision, doc) => {
        if (!decision) return { result: { updated: false, reason: 'unknown_decision' } };
        const outcome = compositeReward(signals, decision.at);
        if (outcome.reward === null) return { result: { updated: false, reason: 'no_signal' } };
        if (decision.reward !== null) return { result: { updated: false, reason: 'already_settled' } };
        if (now - decision.at > REWARD_WINDOW_MS) return { result: { updated: false, reason: 'expired' } };
        const reward = outcome.reward;
        const { personKey, personaId, space, route } = decision.context;
        const next: ReplyStylePosteriorDoc = doc ? structuredClone(doc) : {
          schemaVersion: 1, id: posteriorDocIdForPersonKey(personKey, personaId, space, route),
          personKey, personaId, space, route, arms: {}, updatedAt: now,
        };
        const sampledDimensions = REPLY_STYLE_DIMENSIONS.filter(d => decision.sources[d] === 'sampled');
        for (const d of sampledDimensions) {
          const arm = decision.armChosen[d];
          const current = next.arms[d]?.[arm] ?? prior(now);
          next.arms[d] = { ...(next.arms[d] ?? {}), [arm]: updatePosterior(current, reward, now, this.halfLifeMs) };
        }
        next.updatedAt = Math.max(next.updatedAt, now);
        const settled: ReplyStyleEvalRecord = {
          ...structuredClone(decision), reward,
          rewardSignals: [...outcome.positives, ...outcome.negatives], settledAt: now,
        };
        return { decision: settled, ...(sampledDimensions.length > 0 ? { doc: next } : {}), result: { updated: true, reward } };
      });
    } catch {
      return { updated: false, reason: 'store_error' };
    }
  }

  /** The person's own view ("Why this?"), decayed to now. Not gated: it is an access right. */
  async describe(scope: { personId: string; personaId: string; space: ReplySpace }): Promise<PosteriorView[]> {
    const now = this.now();
    const docs = await this.store.listPosteriors({ personKey: personKeyOf(scope.personId), personaId: scope.personaId, space: scope.space });
    const views: PosteriorView[] = [];
    for (const doc of [...docs].sort((a, b) => ROUTES.indexOf(a.route) - ROUTES.indexOf(b.route))) {
      for (const d of REPLY_STYLE_DIMENSIONS) {
        for (const arm of REPLY_STYLE_ARMS[d] as readonly string[]) {
          const posterior = doc.arms[d]?.[arm];
          if (!posterior) continue;
          const decayed = decayPosterior(posterior, now, this.halfLifeMs);
          views.push({ route: doc.route, dimension: d, arm, alpha: decayed.alpha, beta: decayed.beta,
            mean: decayed.alpha / (decayed.alpha + decayed.beta), updatedAt: posterior.updatedAt });
        }
      }
    }
    return views;
  }

  /** Experience-screen Reset: deletes posteriors and eval rows for (person, persona, space), all routes. */
  reset(scope: { personId: string; personaId: string; space: ReplySpace }): Promise<{ posteriors: number; decisions: number }> {
    return this.store.deleteScope({ personKey: personKeyOf(scope.personId), personaId: scope.personaId, space: scope.space });
  }

  /** optional.personalization withdrawal, product pause or epoch bump: deletes every posterior and eval row of the person (in `space` when given). */
  withdraw(personId: string, space?: ReplySpace): Promise<{ posteriors: number; decisions: number }> {
    return this.store.deleteScope({ personKey: personKeyOf(personId), ...(space === undefined ? {} : { space }) });
  }
}

function fallbackChoice(personaDefault: ReplyStyle, explicitThisTurn: Partial<ReplyStyle> | undefined,
  storedPreferences: readonly ResolvedPreference[] | undefined): ReplyStyleChoice {
  try {
    const stored = pinsFromResolvedPreferences(storedPreferences ?? [], personaDefault);
    const base = resolveReplyStyle({ personaDefault, explicitThisTurn, stored });
    return { style: base.style, sources: base.sources, propensity: 1 };
  } catch {
    const sources = Object.fromEntries(REPLY_STYLE_DIMENSIONS.map(d => [d, 'persona_default'])) as Record<ReplyStyleDimension, ReplyStyleSource>;
    return { style: personaDefault, sources, propensity: 1 };
  }
}
