/**
 * Reply-style procedural memory (S14 of docs/AGENT_INTELLIGENCE_SOLUTION.md,
 * section 4.10). A factored Beta-Bernoulli Thompson-sampling bandit over a
 * fixed set of low-risk reply-style arms, keyed by (person, persona, space,
 * route).
 *
 * NOT WIRED: nothing in the Studio runtime or the gateway constructs it.
 * Enabling it is gated on the DPIA covering behavioural adaptation and on
 * confirming that message_reaction updates reach persona bots in private
 * chats.
 *
 * Invariants:
 * - Explicit choices always win: a dimension pinned by an explicit request
 *   this turn or an explicit stored preference is never sampled, logged as an
 *   arm choice or updated.
 * - Sampling, posterior reads and learning happen only in private, non-guest
 *   chats after the caller's optional.personalization authorize callback.
 *   Reset, withdrawal and sweep are ungated deletions.
 * - Reply-rate alone never changes a posterior: bare replies and
 *   non-corrective follow-ups without a strong signal yield reward null.
 * - Rows are content-free: enums, numbers, a hashed subject key and a persona
 *   id. No message text, model output or raw personId is stored or logged.
 *
 * Pure apart from the injected store; no logging.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ResolvedPreference } from './index';

// ---------------------------------------------------------------------------
// Arms and constants
// ---------------------------------------------------------------------------

export const DIMENSION_ORDER = ['length', 'register', 'structure', 'closingQuestion', 'modality', 'language'] as const;
export type StyleDimension = typeof DIMENSION_ORDER[number];

export const ARMS = {
  length: ['brief', 'balanced', 'detailed'],
  register: ['formal', 'informal'],
  structure: ['plain', 'steps'],
  closingQuestion: ['no', 'yes'],
  modality: ['text', 'voice-default'],
  language: ['fa', 'en', 'mixed'],
} as const;
export type ArmOf<D extends StyleDimension> = typeof ARMS[D][number];

export interface ReplyStyle {
  length: ArmOf<'length'>;
  register: ArmOf<'register'>;
  structure: ArmOf<'structure'>;
  closingQuestion: ArmOf<'closingQuestion'>;
  modality: ArmOf<'modality'>;
  /** 'auto' mirrors the user's language. It is a valid style value but never an arm. */
  language: 'auto' | ArmOf<'language'>;
}
export type StyleSource = 'explicit_turn' | 'explicit_stored' | 'sampled' | 'persona_default';
/** Same labels as S09 DecisionLogRow.routeTaken. */
export type ReplyRoute = 'quick' | 'thoughtful' | 'web' | 'untriaged';
export type StyleSpace = 'work' | 'personal';

export const ROUTES: readonly ReplyRoute[] = ['quick', 'thoughtful', 'web', 'untriaged'];
export const SPACES: readonly StyleSpace[] = ['work', 'personal'];

/** The 4 lowest-risk dimensions. modality and language are opt-in through options.dimensions. */
export const DEFAULT_DIMENSIONS: readonly StyleDimension[] = ['length', 'register', 'structure', 'closingQuestion'];
export const DEFAULT_REPLY_STYLE: Readonly<ReplyStyle> = Object.freeze({
  length: 'balanced', register: 'informal', structure: 'plain', closingQuestion: 'no', modality: 'text', language: 'auto',
});
export const HALF_LIFE_MS = 90 * 86_400_000;
export const FOLLOW_UP_WINDOW_MS = 10 * 60_000;
export const SETTLE_WINDOW_MS = 24 * 3_600_000;
export const EVAL_RETENTION_MS = 90 * 86_400_000;
export const POSTERIOR_IDLE_DELETE_MS = 365 * 86_400_000;
export const DEFAULT_PROPENSITY_SAMPLES = 256;
export const MIN_PROPENSITY_SAMPLES = 16;
export const MAX_PROPENSITY_SAMPLES = 4096;
export const POLICY_VERSION = 'ts-beta-v1';
export const REWARD_WEIGHTS = { reaction: 1, explicit_thanks: 1, share_offer_accepted: 1, voice_reciprocated: 0.5, follow_up: 0.25 } as const;
/** Upper bound for alpha and beta (schema limit). */
export const MAX_BETA_PARAM = 1e6;

/** Key of one bandit: person × persona × space × route. personId is hashed before storage. */
export interface ReplyStyleScope {
  readonly personId: string;
  readonly personaId: string;
  readonly space: StyleSpace;
  readonly route: ReplyRoute;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export type RewardSignal =
  | { kind: 'reaction'; polarity: 'positive' | 'negative'; at: number }
  | { kind: 'follow_up'; corrective: boolean; at: number }
  | { kind: 'explicit_thanks'; at: number }
  | { kind: 'explicit_correction'; at: number }
  | { kind: 'share_offer_accepted'; at: number }
  | { kind: 'voice_reciprocated'; at: number }
  /** Accepted and always ignored: reply-rate alone never updates a posterior. */
  | { kind: 'reply'; at: number };

export const REWARD_KINDS = [
  'reaction_positive', 'reaction_negative', 'follow_up', 'follow_up_corrective',
  'explicit_thanks', 'explicit_correction', 'share_offer_accepted', 'voice_reciprocated',
] as const;
export type RewardKind = typeof REWARD_KINDS[number];

export interface RewardResult {
  reward: number | null;
  kinds: RewardKind[];
  reason: 'negative' | 'positive' | 'reply_only' | 'no_signal';
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface BetaParams { alpha: number; beta: number }

export interface PosteriorRow {
  schemaVersion: 1;
  id: string;
  subject: string;
  personaId: string;
  space: StyleSpace;
  route: ReplyRoute;
  dimension: StyleDimension;
  arms: Record<string, BetaParams>;
  updatedAt: number;
}

export interface ReplyStyleEvalRow {
  schemaVersion: 1;
  id: string;
  policyVersion: typeof POLICY_VERSION;
  context: {
    subject: string;
    personaId: string;
    space: StyleSpace;
    route: ReplyRoute;
    chatKind: 'private';
    pinned: Partial<Record<StyleDimension, 'explicit_turn' | 'explicit_stored'>>;
  };
  armChosen: Partial<Record<StyleDimension, string>>;
  /** Per sampled dimension, in (0,1]. */
  propensity: Partial<Record<StyleDimension, number>>;
  jointPropensity: number;
  unchosenArms: Partial<Record<StyleDimension, string[]>>;
  reward: number | null;
  rewardKinds: RewardKind[];
  at: number;
  expiresAt: number;
  settledAt?: number;
}

// ---------------------------------------------------------------------------
// Store seam
// ---------------------------------------------------------------------------

export interface ReplyStyleTxRead { exposureIds: readonly string[]; posteriorIds: readonly string[] }
export interface ReplyStyleTxSnapshot {
  exposures: ReadonlyMap<string, ReplyStyleEvalRow>;
  posteriors: ReadonlyMap<string, PosteriorRow>;
}
export interface ReplyStyleTxWrite<T> { exposures?: ReplyStyleEvalRow[]; posteriors?: PosteriorRow[]; result: T }
export interface ReplyStyleDeleteFilter { subject: string; personaId?: string; space?: StyleSpace }
export interface ReplyStyleEvalFilter { personaId?: string; since?: number; until?: number; limit?: number }

export interface ReplyStyleStore {
  /** Returns the valid rows among ids; missing and invalid rows are skipped. */
  readPosteriors(ids: readonly string[]): Promise<PosteriorRow[]>;
  /** Append; throws on a duplicate id or an invalid row. */
  recordExposure(row: ReplyStyleEvalRow): Promise<void>;
  /** Atomic: reads the requested rows, applies fn's writes; a throw commits nothing. */
  transact<T>(read: ReplyStyleTxRead, fn: (snapshot: ReplyStyleTxSnapshot) => ReplyStyleTxWrite<T>): Promise<T>;
  listEval(filter?: ReplyStyleEvalFilter): Promise<ReplyStyleEvalRow[]>;
  deleteSubject(filter: ReplyStyleDeleteFilter): Promise<{ posteriors: number; evals: number }>;
  /** Deletes eval rows with expiresAt <= now and posteriors with updatedAt <= now - POSTERIOR_IDLE_DELETE_MS. */
  sweep(now: number): Promise<{ posteriors: number; evals: number }>;
}

// ---------------------------------------------------------------------------
// Bandit API types
// ---------------------------------------------------------------------------

export interface ChooseInput {
  scope: ReplyStyleScope;
  chatKind: 'private' | 'group';
  guestAudience: boolean;
  personaDefault?: Partial<ReplyStyle>;
  /** Output of resolvePreferences; only source 'explicit' pins. */
  storedPreferences?: readonly ResolvedPreference[];
  explicitThisTurn?: Partial<ReplyStyle>;
  now?: number;
}
export interface ReplyStyleChoice {
  style: ReplyStyle;
  sources: Record<StyleDimension, StyleSource>;
  /** Present only when at least one dimension was sampled AND the eval row was recorded. */
  exposureId?: string;
}
export type SettleOutcome = 'updated' | 'no_update' | 'already_settled' | 'unknown_exposure' | 'expired' | 'not_allowed';
export interface SettleInput {
  exposureId: string;
  signals: readonly unknown[];
  now?: number;
  /**
   * The exposure's scope, needed to re-run authorize. Defaults to the scope
   * this bandit instance remembered at choose() time (process memory only:
   * raw personIds are never persisted). Without either, or when it does not
   * match the exposure, settle returns 'not_allowed' and writes nothing.
   */
  scope?: ReplyStyleScope;
}
export interface SettleResult { outcome: SettleOutcome; reward: number | null; kinds: RewardKind[] }
export interface PosteriorView {
  route: ReplyRoute;
  dimension: StyleDimension;
  /** evidence = alpha + beta - 2 after decay. */
  arms: Array<{ arm: string; mean: number; evidence: number }>;
  updatedAt: number;
}

export interface ReplyStyleBanditDeps {
  store: ReplyStyleStore;
  /** Caller's optional.personalization check for this person/persona/space; a throw counts as false. */
  authorize: (scope: ReplyStyleScope) => Promise<boolean>;
  /** [0,1); default Math.random. */
  rng?: () => number;
  /** Default Date.now. */
  now?: () => number;
  /** Default randomUUID. */
  newId?: () => string;
  /** 4..6 distinct dimensions; default DEFAULT_DIMENSIONS. */
  dimensions?: readonly StyleDimension[];
  /** Default 256, integer 16..4096. */
  propensitySamples?: number;
}

// ---------------------------------------------------------------------------
// Schemas (all strict)
// ---------------------------------------------------------------------------

const PERSONA_ID = /^[A-Za-z0-9_:-]{1,128}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const EVAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TIME = 8.64e15;
const MAX_PERSON_ID_LENGTH = 512;

const time = z.number().min(0).max(MAX_TIME);
const betaParamsSchema = z.object({
  alpha: z.number().min(1).max(MAX_BETA_PARAM),
  beta: z.number().min(1).max(MAX_BETA_PARAM),
}).strict();
const spaceSchema = z.enum(['work', 'personal']);
const routeSchema = z.enum(['quick', 'thoughtful', 'web', 'untriaged']);
const dimensionSchema = z.enum(DIMENSION_ORDER);

export const posteriorRowSchema: z.ZodType<PosteriorRow> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(HEX40),
  subject: z.string().regex(HEX32),
  personaId: z.string().regex(PERSONA_ID),
  space: spaceSchema,
  route: routeSchema,
  dimension: dimensionSchema,
  arms: z.record(z.string(), betaParamsSchema),
  updatedAt: time,
}).strict().superRefine((row, ctx) => {
  const expected: readonly string[] = ARMS[row.dimension];
  const keys = Object.keys(row.arms);
  if (keys.length !== expected.length || !expected.every((arm) => Object.prototype.hasOwnProperty.call(row.arms, arm))) {
    ctx.addIssue({ code: 'custom', message: 'arms_mismatch', path: ['arms'] });
  }
  if (row.id !== posteriorIdFor(row.subject, row.personaId, row.space, row.route, row.dimension)) {
    ctx.addIssue({ code: 'custom', message: 'id_mismatch', path: ['id'] });
  }
});

const pinnedSource = z.enum(['explicit_turn', 'explicit_stored']);
const pinnedSchema = z.object({
  length: pinnedSource.optional(), register: pinnedSource.optional(), structure: pinnedSource.optional(),
  closingQuestion: pinnedSource.optional(), modality: pinnedSource.optional(), language: pinnedSource.optional(),
}).strict();
const armChosenSchema = z.object({
  length: z.enum(ARMS.length).optional(), register: z.enum(ARMS.register).optional(),
  structure: z.enum(ARMS.structure).optional(), closingQuestion: z.enum(ARMS.closingQuestion).optional(),
  modality: z.enum(ARMS.modality).optional(), language: z.enum(ARMS.language).optional(),
}).strict();
const probability = z.number().gt(0).max(1);
const propensitySchema = z.object({
  length: probability.optional(), register: probability.optional(), structure: probability.optional(),
  closingQuestion: probability.optional(), modality: probability.optional(), language: probability.optional(),
}).strict();
const armList = z.array(z.string()).max(3);
const unchosenSchema = z.object({
  length: armList.optional(), register: armList.optional(), structure: armList.optional(),
  closingQuestion: armList.optional(), modality: armList.optional(), language: armList.optional(),
}).strict();

export const evalRowSchema: z.ZodType<ReplyStyleEvalRow> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(EVAL_ID),
  policyVersion: z.literal(POLICY_VERSION),
  context: z.object({
    subject: z.string().regex(HEX32),
    personaId: z.string().regex(PERSONA_ID),
    space: spaceSchema,
    route: routeSchema,
    chatKind: z.literal('private'),
    pinned: pinnedSchema,
  }).strict(),
  armChosen: armChosenSchema,
  propensity: propensitySchema,
  jointPropensity: probability,
  unchosenArms: unchosenSchema,
  reward: z.number().min(0).max(1).nullable(),
  rewardKinds: z.array(z.enum(REWARD_KINDS)).max(REWARD_KINDS.length),
  at: time,
  expiresAt: time,
  settledAt: time.optional(),
}).strict().superRefine((row, ctx) => {
  const chosen = DIMENSION_ORDER.filter((d) => row.armChosen[d] !== undefined);
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (chosen.length === 0) issue('no_sampled_dimension');
  let product = 1;
  for (const d of DIMENSION_ORDER) {
    const arm = row.armChosen[d];
    const p = row.propensity[d];
    const unchosen = row.unchosenArms[d];
    if (arm === undefined) {
      if (p !== undefined || unchosen !== undefined) issue('dimension_keys_mismatch');
      continue;
    }
    if (p === undefined || unchosen === undefined) { issue('dimension_keys_mismatch'); continue; }
    if (row.context.pinned[d] !== undefined) issue('pinned_dimension_sampled');
    const expected = (ARMS[d] as readonly string[]).filter((a) => a !== arm);
    if (unchosen.length !== expected.length || unchosen.some((a, i) => a !== expected[i])) issue('unchosen_arms_mismatch');
    product *= p;
  }
  if (chosen.length > 0 && Math.abs(product - row.jointPropensity) > 1e-9 * Math.max(1, product)) issue('joint_propensity_mismatch');
  if (new Set(row.rewardKinds).size !== row.rewardKinds.length) issue('duplicate_reward_kind');
  if (row.expiresAt < row.at) issue('expires_before_at');
  if (row.settledAt !== undefined && row.settledAt < row.at) issue('settled_before_at');
  if (row.settledAt === undefined && (row.reward !== null || row.rewardKinds.length > 0)) issue('unsettled_with_reward');
});

const signalAt = z.number().min(-MAX_TIME).max(MAX_TIME);
export const rewardSignalSchema: z.ZodType<RewardSignal> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reaction'), polarity: z.enum(['positive', 'negative']), at: signalAt }).strict(),
  z.object({ kind: z.literal('follow_up'), corrective: z.boolean(), at: signalAt }).strict(),
  z.object({ kind: z.literal('explicit_thanks'), at: signalAt }).strict(),
  z.object({ kind: z.literal('explicit_correction'), at: signalAt }).strict(),
  z.object({ kind: z.literal('share_offer_accepted'), at: signalAt }).strict(),
  z.object({ kind: z.literal('voice_reciprocated'), at: signalAt }).strict(),
  z.object({ kind: z.literal('reply'), at: signalAt }).strict(),
]);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** sha256('vox_reply_style:' + personId), hex, first 32 characters. Pseudonymous, not anonymous. */
export function subjectKey(personId: string): string {
  return sha256Hex(`vox_reply_style:${personId}`).slice(0, 32);
}

function posteriorIdFor(subject: string, personaId: string, space: StyleSpace, route: ReplyRoute, dimension: StyleDimension): string {
  return sha256Hex(JSON.stringify(['v1', subject, personaId, space, route, dimension])).slice(0, 40);
}

export function posteriorId(scope: ReplyStyleScope, dimension: StyleDimension): string {
  return posteriorIdFor(subjectKey(scope.personId), scope.personaId, scope.space, scope.route, dimension);
}

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

function isDimension(value: unknown): value is StyleDimension {
  return typeof value === 'string' && (DIMENSION_ORDER as readonly string[]).includes(value);
}

function isStyleValue(dimension: StyleDimension, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (dimension === 'language' && value === 'auto') return true;
  return (ARMS[dimension] as readonly string[]).includes(value);
}

/** Keeps only valid values; never throws. */
function sanitizeStyle(input: unknown): Partial<ReplyStyle> {
  const out: Partial<Record<StyleDimension, string>> = {};
  if (!input || typeof input !== 'object') return {};
  for (const d of DIMENSION_ORDER) {
    const value = (input as Record<string, unknown>)[d];
    if (isStyleValue(d, value)) out[d] = value as string;
  }
  return out as Partial<ReplyStyle>;
}

/**
 * For each dimension, the first available of: explicit request this turn,
 * explicit stored preference, sampled arm, persona default, DEFAULT_REPLY_STYLE.
 */
export function resolveReplyStyle(layers: {
  explicitThisTurn?: Partial<ReplyStyle>;
  stored?: Partial<ReplyStyle>;
  sampled?: Partial<ReplyStyle>;
  personaDefault?: Partial<ReplyStyle>;
}): { style: ReplyStyle; sources: Record<StyleDimension, StyleSource> } {
  const style: Record<string, string> = {};
  const sources = {} as Record<StyleDimension, StyleSource>;
  const ordered: Array<[Partial<ReplyStyle> | undefined, StyleSource]> = [
    [layers.explicitThisTurn, 'explicit_turn'],
    [layers.stored, 'explicit_stored'],
    [layers.sampled, 'sampled'],
    [layers.personaDefault, 'persona_default'],
  ];
  for (const d of DIMENSION_ORDER) {
    const hit = ordered.find(([layer]) => isStyleValue(d, layer?.[d]));
    style[d] = hit ? (hit[0] as Record<string, string>)[d] : DEFAULT_REPLY_STYLE[d];
    sources[d] = hit ? hit[1] : 'persona_default';
  }
  return { style: style as unknown as ReplyStyle, sources };
}

/**
 * Maps resolvePreferences output to pinned dimensions. Only source 'explicit'
 * pins; 'hypothesis', 'reset' and 'default' never do (after a reset the
 * bandit may sample again). language 'auto' does not pin.
 */
export function styleFromPreferences(resolved: readonly ResolvedPreference[]): Partial<ReplyStyle> {
  const out: Partial<ReplyStyle> = {};
  if (!Array.isArray(resolved)) return out;
  for (const preference of resolved) {
    if (!preference || preference.source !== 'explicit' || !preference.setting) continue;
    const setting = preference.setting;
    if (setting.key === 'response_length' && isStyleValue('length', setting.value)) out.length = setting.value;
    else if (setting.key === 'formatting' && setting.value === 'plain') out.structure = 'plain';
    else if (setting.key === 'formatting' && setting.value === 'structured') out.structure = 'steps';
    else if (setting.key === 'language' && (setting.value === 'en' || setting.value === 'fa')) out.language = setting.value;
  }
  return out;
}

/** Structurally identical to S09's TriageV2.explicitStyleRequest; no import. */
export function explicitRequestFromTurn(
  style?: 'brief' | 'detailed' | 'step_by_step' | 'listening' | 'unspecified',
  format?: 'voice' | 'text',
): Partial<ReplyStyle> {
  const out: Partial<ReplyStyle> = {};
  if (style === 'brief') out.length = 'brief';
  else if (style === 'detailed') out.length = 'detailed';
  else if (style === 'step_by_step') out.structure = 'steps';
  else if (style === 'listening') { out.length = 'brief'; out.closingQuestion = 'no'; }
  if (format === 'voice') out.modality = 'voice-default';
  else if (format === 'text') out.modality = 'text';
  return out;
}

// ---------------------------------------------------------------------------
// Follow-up classification and reward
// ---------------------------------------------------------------------------

export const EN_CORRECTION = /^\s*(no|nope|nah)\b|\bnot what i (meant|asked)\b|\b(try|do|say|write) (it|that) again\b|^\s*again\b|\bthat'?s (wrong|not right|incorrect)\b/i;
export const FA_CORRECTION = /^\s*(نه|نخیر)(?=\s|[،,.!؟?]|$)|منظورم\s*(این|اون)?\s*نبود|^\s*دوباره|دوباره\s*(بگو|بنویس|امتحان کن)|اشتباه\s*(ه|است|بود)/u;
export const EN_THANKS = /\b(thanks|thank you|thx|ty|perfect)\b/i;
export const FA_THANKS = /(ممنون|مرسی|سپاس|دستت درد نکنه|عالی بود)/u;

/**
 * Heuristic EN/FA classification of a follow-up message. Correction wins over
 * thanks, so "no problem, thanks" is corrective. The text is never returned,
 * stored or logged; only the label leaves this function.
 */
export function classifyFollowUp(text: string): 'corrective' | 'thanks' | 'neutral' {
  if (typeof text !== 'string') return 'neutral';
  const normalized = text.normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
  if (EN_CORRECTION.test(normalized) || FA_CORRECTION.test(normalized)) return 'corrective';
  if (EN_THANKS.test(normalized) || FA_THANKS.test(normalized)) return 'thanks';
  return 'neutral';
}

/**
 * Composite reward. Any negative wins (0). Strong positives, deduplicated by
 * kind, sum to the reward; a non-corrective follow-up adds 0.25 only next to
 * a strong positive. Bare replies and follow-ups alone yield null, which
 * never changes a posterior.
 */
export function computeReward(signals: readonly unknown[], exposureAt: number): RewardResult {
  const kinds = new Set<RewardKind>();
  let negative = false;
  let nonCorrectiveFollowUp = false;
  let reply = false;
  if (Array.isArray(signals) && Number.isFinite(exposureAt)) {
    for (const raw of signals) {
      const parsed = rewardSignalSchema.safeParse(raw);
      if (!parsed.success) continue;
      const signal = parsed.data;
      const elapsed = signal.at - exposureAt;
      const window = signal.kind === 'follow_up' ? FOLLOW_UP_WINDOW_MS : SETTLE_WINDOW_MS;
      if (!(elapsed >= 0 && elapsed <= window)) continue;
      switch (signal.kind) {
        case 'reaction':
          if (signal.polarity === 'positive') kinds.add('reaction_positive');
          else { kinds.add('reaction_negative'); negative = true; }
          break;
        case 'follow_up':
          if (signal.corrective) { kinds.add('follow_up_corrective'); negative = true; }
          else { kinds.add('follow_up'); nonCorrectiveFollowUp = true; }
          break;
        case 'explicit_correction':
          kinds.add('explicit_correction'); negative = true;
          break;
        case 'explicit_thanks':
        case 'share_offer_accepted':
        case 'voice_reciprocated':
          kinds.add(signal.kind);
          break;
        case 'reply':
          reply = true;
          break;
      }
    }
  }
  const ordered = REWARD_KINDS.filter((k) => kinds.has(k));
  if (negative) return { reward: 0, kinds: ordered, reason: 'negative' };
  const strong = (kinds.has('reaction_positive') ? REWARD_WEIGHTS.reaction : 0)
    + (kinds.has('explicit_thanks') ? REWARD_WEIGHTS.explicit_thanks : 0)
    + (kinds.has('share_offer_accepted') ? REWARD_WEIGHTS.share_offer_accepted : 0)
    + (kinds.has('voice_reciprocated') ? REWARD_WEIGHTS.voice_reciprocated : 0);
  if (strong === 0) {
    return { reward: null, kinds: ordered, reason: nonCorrectiveFollowUp || reply ? 'reply_only' : 'no_signal' };
  }
  const reward = Math.min(1, strong + (nonCorrectiveFollowUp ? REWARD_WEIGHTS.follow_up : 0));
  return { reward, kinds: ordered, reason: 'positive' };
}

// ---------------------------------------------------------------------------
// Decay and sampling
// ---------------------------------------------------------------------------

/** Pseudo-counts decay toward Beta(1,1): f = 0.5^(max(0, elapsed)/halfLife). Never below 1. */
export function decayBeta(p: BetaParams, elapsedMs: number, halfLifeMs: number = HALF_LIFE_MS): BetaParams {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const f = halfLifeMs > 0 && Number.isFinite(halfLifeMs) ? Math.pow(0.5, elapsed / halfLifeMs) : 1;
  return { alpha: 1 + Math.max(0, p.alpha - 1) * f, beta: 1 + Math.max(0, p.beta - 1) * f };
}

function draw(rng: () => number): number {
  const value = rng();
  if (typeof value !== 'number' || !(value >= 0 && value < 1)) throw new RangeError('reply_style_rng');
  return value;
}

/** Box–Muller standard normal from two uniforms. */
function normal(rng: () => number): number {
  const u1 = 1 - draw(rng); // (0, 1]
  const u2 = draw(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Marsaglia–Tsang gamma variate; shapes below 1 use the u^(1/a) boost. */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const boosted = sampleGamma(shape + 1, rng);
    return boosted * Math.pow(1 - draw(rng), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 1_000; attempt++) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = draw(rng);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // Unreachable with a sane rng; bounded so a degenerate rng cannot hang.
}

export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  if (!(alpha > 0) || !(beta > 0) || !Number.isFinite(alpha) || !Number.isFinite(beta)) throw new RangeError('reply_style_beta_params');
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const sum = x + y;
  return sum > 0 ? x / sum : 0.5;
}

/** mulberry32: deterministic [0,1) generator for tests and offline replay. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

// ---------------------------------------------------------------------------
// Bandit
// ---------------------------------------------------------------------------

const MAX_REMEMBERED_SCOPES = 10_000;

function validScope(scope: unknown): ReplyStyleScope | null {
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  if (typeof s.personId !== 'string' || s.personId.length === 0 || s.personId.length > MAX_PERSON_ID_LENGTH) return null;
  if (typeof s.personaId !== 'string' || !PERSONA_ID.test(s.personaId)) return null;
  if (!SPACES.includes(s.space as StyleSpace) || !ROUTES.includes(s.route as ReplyRoute)) return null;
  return Object.freeze({ personId: s.personId, personaId: s.personaId, space: s.space as StyleSpace, route: s.route as ReplyRoute });
}

function validTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIME ? value : null;
}

function clampParam(value: number): number {
  return Math.min(MAX_BETA_PARAM, Math.max(1, value));
}

export class ReplyStyleBandit {
  private readonly store: ReplyStyleStore;
  private readonly authorize: (scope: ReplyStyleScope) => Promise<boolean>;
  private readonly rng: () => number;
  private readonly clock: () => number;
  private readonly newId: () => string;
  private readonly dimensions: readonly StyleDimension[];
  private readonly propensitySamples: number;
  /** exposureId → scope, process memory only, so settle can re-run authorize. */
  private readonly scopes = new Map<string, ReplyStyleScope>();

  constructor(deps: ReplyStyleBanditDeps) {
    if (!deps || typeof deps.store !== 'object' || deps.store === null || typeof deps.authorize !== 'function') {
      throw new TypeError('reply_style_deps');
    }
    const dimensions: readonly unknown[] = deps.dimensions ?? DEFAULT_DIMENSIONS;
    if (!Array.isArray(dimensions) || dimensions.length < 4 || dimensions.length > 6
        || new Set(dimensions).size !== dimensions.length || !dimensions.every(isDimension)) {
      throw new RangeError('reply_style_dimensions');
    }
    const samples = deps.propensitySamples ?? DEFAULT_PROPENSITY_SAMPLES;
    if (!Number.isInteger(samples) || samples < MIN_PROPENSITY_SAMPLES || samples > MAX_PROPENSITY_SAMPLES) {
      throw new RangeError('reply_style_propensity_samples');
    }
    this.store = deps.store;
    this.authorize = deps.authorize;
    this.rng = deps.rng ?? Math.random;
    this.clock = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
    this.dimensions = DIMENSION_ORDER.filter((d) => (dimensions as readonly string[]).includes(d));
    this.propensitySamples = samples;
  }

  /** Never throws. Samples only in private, non-guest chats after authorize. */
  async choose(input: ChooseInput): Promise<ReplyStyleChoice> {
    const explicit = sanitizeStyle(input?.explicitThisTurn);
    const persona = sanitizeStyle(input?.personaDefault);
    // Fail closed: stored preferences are ignored too when the gate fails.
    const closed = (): ReplyStyleChoice => resolveReplyStyle({ explicitThisTurn: explicit, personaDefault: persona });
    try {
      if (input.chatKind !== 'private' || input.guestAudience !== false) return closed();
      const scope = validScope(input.scope);
      if (!scope) return closed();
      const now = validTime(input.now ?? this.clock());
      if (now === null) return closed();
      if (!(await this.allowed(scope))) return closed();

      const stored = styleFromPreferences(Array.isArray(input.storedPreferences) ? input.storedPreferences : []);
      const unsampled = (): ReplyStyleChoice => resolveReplyStyle({ explicitThisTurn: explicit, stored, personaDefault: persona });
      const pinned: Partial<Record<StyleDimension, 'explicit_turn' | 'explicit_stored'>> = {};
      const toSample: StyleDimension[] = [];
      for (const d of this.dimensions) {
        if (explicit[d] !== undefined) pinned[d] = 'explicit_turn';
        else if (stored[d] !== undefined) pinned[d] = 'explicit_stored';
        else toSample.push(d);
      }
      if (toSample.length === 0) return unsampled();

      let rows: PosteriorRow[];
      try {
        rows = await this.store.readPosteriors(toSample.map((d) => posteriorId(scope, d)));
      } catch {
        return closed();
      }
      const byDimension = new Map<StyleDimension, PosteriorRow>();
      for (const raw of Array.isArray(rows) ? rows : []) {
        const parsed = posteriorRowSchema.safeParse(raw);
        if (!parsed.success || parsed.data.id !== posteriorId(scope, parsed.data.dimension)) continue;
        byDimension.set(parsed.data.dimension, parsed.data);
      }

      const sampled: Partial<Record<StyleDimension, string>> = {};
      const propensity: Partial<Record<StyleDimension, number>> = {};
      const unchosenArms: Partial<Record<StyleDimension, string[]>> = {};
      let jointPropensity = 1;
      for (const d of toSample) {
        const arms: readonly string[] = ARMS[d];
        const row = byDimension.get(d);
        const params = arms.map((arm) => {
          const stored = row?.arms[arm];
          return stored ? decayBeta(stored, now - row.updatedAt) : { alpha: 1, beta: 1 };
        });
        const chosen = argmax(params.map((p) => sampleBeta(p.alpha, p.beta, this.rng)));
        const wins = new Array<number>(arms.length).fill(0);
        for (let round = 0; round < this.propensitySamples; round++) {
          wins[argmax(params.map((p) => sampleBeta(p.alpha, p.beta, this.rng)))]++;
        }
        const p = (wins[chosen] + 1) / (this.propensitySamples + arms.length);
        sampled[d] = arms[chosen];
        propensity[d] = p;
        unchosenArms[d] = arms.filter((_, i) => i !== chosen);
        jointPropensity *= p;
      }

      const id = this.newId();
      const row: ReplyStyleEvalRow = {
        schemaVersion: 1,
        id,
        policyVersion: POLICY_VERSION,
        context: {
          subject: subjectKey(scope.personId), personaId: scope.personaId, space: scope.space, route: scope.route,
          chatKind: 'private', pinned,
        },
        armChosen: sampled,
        propensity,
        jointPropensity,
        unchosenArms,
        reward: null,
        rewardKinds: [],
        at: now,
        expiresAt: now + EVAL_RETENTION_MS,
      };
      try {
        await this.store.recordExposure(evalRowSchema.parse(row));
      } catch {
        // Every sampled reply must be logged for offline evaluation; otherwise do not sample.
        return unsampled();
      }
      this.remember(id, scope);
      return {
        ...resolveReplyStyle({ explicitThisTurn: explicit, stored, sampled: sampled as Partial<ReplyStyle>, personaDefault: persona }),
        exposureId: id,
      };
    } catch {
      return closed();
    }
  }

  /** Idempotent. Re-runs authorize before any posterior write. */
  async settle(input: SettleInput): Promise<SettleResult> {
    const none = (outcome: SettleOutcome, kinds: RewardKind[] = []): SettleResult => ({ outcome, reward: null, kinds });
    const exposureId = input?.exposureId;
    if (typeof exposureId !== 'string' || !EVAL_ID.test(exposureId)) return none('unknown_exposure');
    const now = validTime(input.now ?? this.clock());
    if (now === null) throw new RangeError('reply_style_now');
    const scope = input.scope !== undefined ? validScope(input.scope) : this.scopes.get(exposureId) ?? null;
    const allowed = scope ? await this.allowed(scope) : false;
    const posteriorIds = scope ? DIMENSION_ORDER.map((d) => posteriorId(scope, d)) : [];

    const result = await this.store.transact<SettleResult>({ exposureIds: [exposureId], posteriorIds }, (snapshot) => {
      const exposure = snapshot.exposures.get(exposureId);
      if (!exposure) return { result: none('unknown_exposure') };
      if (exposure.settledAt !== undefined) return { result: none('already_settled') };
      const settled = (reward: number | null, kinds: RewardKind[]): ReplyStyleEvalRow =>
        ({ ...exposure, reward, rewardKinds: kinds, settledAt: Math.max(now, exposure.at) });
      if (now > exposure.at + SETTLE_WINDOW_MS) return { exposures: [settled(null, [])], result: none('expired') };
      const context = exposure.context;
      if (!scope || subjectKey(scope.personId) !== context.subject || scope.personaId !== context.personaId
          || scope.space !== context.space || scope.route !== context.route) {
        // Unknown or mismatched scope: write nothing, so the right caller can still settle.
        return { result: none('not_allowed') };
      }
      if (!allowed) return { exposures: [settled(null, [])], result: none('not_allowed') };

      const outcome = computeReward(input.signals, exposure.at);
      if (outcome.reward === null) {
        return { exposures: [settled(null, outcome.kinds)], result: none('no_update', outcome.kinds) };
      }
      const reward = outcome.reward;
      const posteriors: PosteriorRow[] = [];
      for (const d of DIMENSION_ORDER) {
        const chosen = exposure.armChosen[d];
        if (chosen === undefined) continue; // pinned or disabled dimensions are never touched
        const id = posteriorId(scope, d);
        const previous = snapshot.posteriors.get(id);
        const arms: Record<string, BetaParams> = {};
        for (const arm of ARMS[d] as readonly string[]) {
          const current = previous?.arms[arm] ?? { alpha: 1, beta: 1 };
          const decayed = previous ? decayBeta(current, now - previous.updatedAt) : current;
          arms[arm] = arm === chosen
            ? { alpha: clampParam(decayed.alpha + reward), beta: clampParam(decayed.beta + 1 - reward) }
            : decayed;
        }
        posteriors.push({
          schemaVersion: 1, id, subject: context.subject, personaId: context.personaId, space: context.space,
          route: context.route, dimension: d, arms, updatedAt: now,
        });
      }
      return {
        exposures: [settled(reward, outcome.kinds)],
        posteriors,
        result: { outcome: 'updated', reward, kinds: outcome.kinds },
      };
    });
    if (result.outcome !== 'not_allowed' || (scope && !allowed)) this.scopes.delete(exposureId);
    return result;
  }

  /** "Why this?" view. Not consent-gated; the caller must pass an authenticated scope. */
  async posteriors(scope: Omit<ReplyStyleScope, 'route'> & { route?: ReplyRoute }, now?: number): Promise<PosteriorView[]> {
    const routes = scope?.route === undefined ? ROUTES : [scope.route];
    const valid = routes.map((route) => validScope({ ...scope, route }));
    if (valid.some((s) => s === null)) throw new RangeError('reply_style_scope');
    const at = validTime(now ?? this.clock());
    if (at === null) throw new RangeError('reply_style_now');
    const wanted = new Map<string, { route: ReplyRoute; dimension: StyleDimension; order: number }>();
    let order = 0;
    for (const s of valid as ReplyStyleScope[]) {
      for (const d of DIMENSION_ORDER) wanted.set(posteriorId(s, d), { route: s.route, dimension: d, order: order++ });
    }
    const rows = await this.store.readPosteriors([...wanted.keys()]);
    const views: Array<PosteriorView & { order: number }> = [];
    for (const raw of rows) {
      const parsed = posteriorRowSchema.safeParse(raw);
      if (!parsed.success) continue;
      const key = wanted.get(parsed.data.id);
      if (!key || key.dimension !== parsed.data.dimension) continue;
      const row = parsed.data;
      views.push({
        route: key.route,
        dimension: key.dimension,
        arms: (ARMS[row.dimension] as readonly string[]).map((arm) => {
          const p = decayBeta(row.arms[arm], at - row.updatedAt);
          return { arm, mean: p.alpha / (p.alpha + p.beta), evidence: p.alpha + p.beta - 2 };
        }),
        updatedAt: row.updatedAt,
        order: key.order,
      });
    }
    return views.sort((a, b) => a.order - b.order)
      .map((view) => ({ route: view.route, dimension: view.dimension, arms: view.arms, updatedAt: view.updatedAt }));
  }

  /** Deletes posteriors and eval rows for one subject, persona and space, across routes. Never gated. */
  async reset(scope: { personId: string; personaId: string; space: StyleSpace }): Promise<{ posteriors: number; evals: number }> {
    const valid = validScope({ ...scope, route: 'untriaged' });
    if (!valid) throw new RangeError('reply_style_scope');
    this.forget((s) => s.personId === valid.personId && s.personaId === valid.personaId && s.space === valid.space);
    return this.store.deleteSubject({ subject: subjectKey(valid.personId), personaId: valid.personaId, space: valid.space });
  }

  /** Consent withdrawal: deletes everything of one subject across personas, in one space or both. Never gated. */
  async withdraw(scope: { personId: string; space?: StyleSpace }): Promise<{ posteriors: number; evals: number }> {
    const personId = scope?.personId;
    if (typeof personId !== 'string' || personId.length === 0 || personId.length > MAX_PERSON_ID_LENGTH) throw new RangeError('reply_style_scope');
    if (scope.space !== undefined && !SPACES.includes(scope.space)) throw new RangeError('reply_style_scope');
    this.forget((s) => s.personId === personId && (scope.space === undefined || s.space === scope.space));
    return this.store.deleteSubject({ subject: subjectKey(personId), ...(scope.space === undefined ? {} : { space: scope.space }) });
  }

  /** Retention: eval rows past expiresAt and posteriors idle for more than 365 days. */
  async sweep(now?: number): Promise<{ posteriors: number; evals: number }> {
    const at = validTime(now ?? this.clock());
    if (at === null) throw new RangeError('reply_style_now');
    return this.store.sweep(at);
  }

  private async allowed(scope: ReplyStyleScope): Promise<boolean> {
    try {
      return (await this.authorize(scope)) === true;
    } catch {
      return false;
    }
  }

  private remember(exposureId: string, scope: ReplyStyleScope): void {
    this.scopes.delete(exposureId);
    this.scopes.set(exposureId, scope);
    while (this.scopes.size > MAX_REMEMBERED_SCOPES) {
      const oldest = this.scopes.keys().next().value;
      if (oldest === undefined) break;
      this.scopes.delete(oldest);
    }
  }

  private forget(match: (scope: ReplyStyleScope) => boolean): void {
    for (const [id, scope] of this.scopes) if (match(scope)) this.scopes.delete(id);
  }
}
