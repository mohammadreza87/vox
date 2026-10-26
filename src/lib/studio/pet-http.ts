/**
 * Vox Pet API (brief §3.6–3.8): `/api/studio/pet/:agentId[/care|/play|/talk|/talk-voice]`, plus the circle routes of a pet
 * opened over a group (Circles S4: `circle`, `circle/decision`, `circle/leave`, `notes`, `notes/:copyId`) and
 * `/api/studio/pet/launch`, which maps a launch code to its agent.
 *
 * Auth is per agent: initData is signed with the bot that opened the page, so it is verified with
 * that agent's own token (never a loop over tokens) and bot A's initData can never act on agent B.
 * An agent's creator owns its bot and can read the token, so the HMAC alone proves nothing: Telegram's Ed25519
 * `signature` is required too (initdata-trust.ts; only view and care may run without one, and only under
 * STUDIO_INITDATA_SIGNATURE=shadow). A creator can still harvest genuine signed initData by repointing
 * the bot's menu, so nothing that erases or discloses a person's data across agents runs here at all: export and
 * forget answer 410 `moved_to_vox` and notes answer `circle_use_vox` for agent-signed requests; those live on the
 * VoxxBot-signed "My data" page (my-data-http.ts), which the pet's Settings button opens (PetView.dataUrl).
 * The path's agentId is only a routing hint. One exception (S4, R2 decision 5): a launch through the manager bot's
 * Main Mini App is signed by the manager bot; it is accepted only for the launch routes, while that route is on, and
 * only when the signed start_param names this agent (and a group it is in), so the manager's signature proves who the
 * person is, never which agent they may reach. Roles: a member who may use the agent is owner (its
 * creator) or member; a public agent's non-member is a guest (look, touch, care; talk opens the DM);
 * anyone else gets 403 with just enough to draw the character asleep. Nothing here creates a Studio
 * member (no ensureMember). Writes need the Studio origin; every request is rate limited.
 *
 * The page is public-facing and chatty (tap flushes every 2 s), so it never touches the Studio's own
 * entrance bucket: each agent has its own (`pet:<agentId>`), and a malformed or stale initData is
 * turned away before any state read. The pre-auth facts about an agent (active, its decrypted token)
 * come from a short per-process cache; the authenticated request still reads current state.
 */

import { z } from 'zod';
import type { InitDataUser } from './auth';
import { agentInitDataExpired, verifyAgentInitData, verifyManagerInitData } from './initdata-trust';
import { circleDecision, circleLeave, circleNotes, CirclePetError, circleView, groupForCode } from './circle-pet';
import { normalizeLook, stageFor } from './character';
import { converseAuthorized } from './conversation';
import { boundedStudioRequest } from './http';
import { canUseAgent, formingDay, visibilityOf } from './permissions';
import { petStoreFor, sweepPetCare, PetCareChangedError } from './pet-store';
import { petPlayStoreFor, sweepPetPlay } from './pet-play-store';
import { lightAgentMoment, petGrowthStoreFor } from './pet-growth-store';
import { agentMoments, noteRef } from './growth';
import { growthView, SEASON_MOMENT, type PetGrowthView } from '../pet/growth';
import { receiptOwner } from '../circles/codec';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from './ratelimit';
import { trustedStudioRequestOrigin } from './request-origin';
import { StudioError, type CallTurnSink, type Studio } from './service';
import type { Agent, StudioState } from './types';
import type { DirectAuthorityEvaluator } from '../adaptive/persistence/authority';
import { digest } from '../adaptive/persistence/repository';
import { isSchemaValidationError } from '../error-contract';
import { agentShortCode, parsePetLaunch, sameShort } from '../circles/codec';
import { apply, decay, newCare, open, safeZone, talk, type CareResult } from '../pet/care';
import { isGoodbye } from '../pet/goodbye';
import {
  activeSeason, applyPlay, ASK_IDS, BOOK_MOMENT_IDS, GAME_IDS, KEEPSAKE_IDS, MOMENT_ID, newPlay, PLAY_LIMITS, PLAY_ROOMS, playView, roomMoment, ROUND_OUTCOMES, SEASON_IDS,
  SEED_KINDS, TIP_IDS, WEAR_SLOTS, WEARABLE_IDS, type PetPlayView, type PlayResponse, type SeasonId,
} from '../pet/play';
import {
  PET_ACTIONS, PET_TZ_HEADER, type CareResponse, type GrowthConfirmResponse, type PetAction, type PetCare, type PetErrorCode,
  type PetPrivateView, type PetRole, type PetView, type TalkResponse, type TalkVoiceResponse, type TalkVoiceStreamEvent,
} from '../pet/types';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_INIT_DATA = 16_384;
/** verifyInitData's default max age (24 h, like the rest of Studio in v1) */
const INIT_DATA_MAX_AGE_S = 86_400;
/** Agent-signed talk and consent: a harvested initData stays usable for at most an hour (D2). */
const AGENT_STRICT_MAX_AGE_S = 3_600;
const MAX_CARE_BYTES = 1024;
const MAX_TALK_BYTES = 16 * 1024;
const MAX_TALK_CHARS = 2000;

const careSchema = z.object({ action: z.enum(PET_ACTIONS as unknown as [PetAction, ...PetAction[]]), n: z.number().int().min(1).max(50).optional() }).strict();
const talkSchema = z.object({ text: z.string().trim().min(1).max(MAX_TALK_CHARS) }).strict();
const MAX_CIRCLE_BYTES = 1024;
/** A launch code (`p_…`) or a bare join code (the DM button's `?j=`): unverified intent, mapped on the server. */
const circleCode = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const decisionSchema = z.object({ code: circleCode, choice: z.enum(['joined', 'reply_only', 'declined']), revision: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  eventId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/).optional() }).strict();
const leaveSchema = z.object({ code: circleCode }).strict();
const MAX_PLAY_BYTES = 1024;
const oneOf = <T extends string>(list: readonly T[]) => z.enum(list as unknown as [T, ...T[]]);
/** POST play (design §3.4): one small idempotent mutation over catalogue ids only; no free text can be sent. */
const playSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('lightItem'), item: oneOf(KEEPSAKE_IDS) }).strict(),
  z.object({ op: z.literal('wear'), slot: oneOf(WEAR_SLOTS), item: oneOf(WEARABLE_IDS).nullable() }).strict(),
  z.object({ op: z.literal('plantSeed'), seed: oneOf(SEED_KINDS) }).strict(),
  z.object({ op: z.literal('waterSeed') }).strict(),
  z.object({ op: z.literal('bookMoment'), moment: oneOf(BOOK_MOMENT_IDS) }).strict(),
  z.object({ op: z.literal('gameRound'), game: oneOf(GAME_IDS), outcome: oneOf(ROUND_OUTCOMES), round: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/) }).strict(),
  z.object({ op: z.literal('tipSeen'), tip: oneOf(TIP_IDS) }).strict(),
  z.object({ op: z.literal('tipDismissed'), tip: oneOf(TIP_IDS) }).strict(),
  z.object({ op: z.literal('askSeen'), ask: oneOf(ASK_IDS) }).strict(),
  z.object({ op: z.literal('askDeclined'), ask: oneOf(ASK_IDS) }).strict(),
  z.object({ op: z.literal('askAccepted'), ask: oneOf(ASK_IDS) }).strict(),
  z.object({ op: z.literal('seasonCelebrated'), season: oneOf(SEASON_IDS) }).strict(),
  z.object({ op: z.literal('roomVisited'), room: oneOf(PLAY_ROOMS) }).strict(),
]);
const NOTE_COPY_ID = /^[0-9a-z]{1,11}-[A-Za-z0-9_-]{12}$/;
/** POST growth/confirm (design §4.11): the person tapped yes on "Shall I keep this as …?" after an explicit save. */
const growthConfirmSchema = z.object({ momentId: z.string().regex(MOMENT_ID), noteId: z.string().regex(NOTE_COPY_ID).optional() }).strict();
const MAX_GROWTH_BYTES = 512;
/** An open moves the play record's `seenAt` (the guest sweep's clock) at most this often: one small write a day, not one per open. */
const PLAY_SEEN_EVERY_MS = 12 * 60 * 60 * 1000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers },
});
const fail = (error: PetErrorCode, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ error, ...extra }, status, headers);

const limiters = new WeakMap<Studio, StudioRateLimiter>();
function limiterFor(studio: Studio): StudioRequestRateLimiter {
  if (studio.deps.rateLimiter) return studio.deps.rateLimiter;
  let limiter = limiters.get(studio);
  if (!limiter) { limiter = new StudioRateLimiter(); limiters.set(studio, limiter); }
  return limiter;
}

/**
 * A cheap look at initData before anything is read: a hash of the right shape, a current auth_date and
 * a user. Only the shape: the signature is verified once the agent's token is known.
 */
export function plausibleInitData(initData: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  let params: URLSearchParams;
  try { params = new URLSearchParams(initData); } catch { return false; }
  if (!/^[0-9a-f]{64}$/.test(params.get('hash') ?? '')) return false;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > nowSeconds + 30 || nowSeconds - authDate > INIT_DATA_MAX_AGE_S) return false;
  return /"id"\s*:\s*[1-9]/.test(params.get('user') ?? '');
}

/** What the pre-auth gate knows about an agent: read from state at most once per GATE_TTL_MS per process. */
interface Gate { at: number; active: boolean; tokenEnc?: string; token: string | null; botId: number }
const gates = new WeakMap<Studio, Map<string, Gate>>();
const GATE_TTL_MS = 30_000;
/** a signature that fails against a cached token this old re-reads the agent once (a refreshed token) */
const GATE_REFRESH_MS = 5_000;
const GATE_MAX = 512;

/**
 * The agent's pre-auth facts. A cache miss is a full state read and a token decrypt, so misses share
 * one pet-wide entrance bucket: junk aimed at made-up agents can only exhaust that, never a real
 * agent's own bucket or the Studio's.
 */
async function gateFor(studio: Studio, limiter: StudioRequestRateLimiter, agentId: string, fresh = false): Promise<Gate> {
  let cache = gates.get(studio);
  if (!cache) { cache = new Map(); gates.set(studio, cache); }
  const now = Date.now();
  const hit = cache.get(agentId);
  if (hit && !fresh && now - hit.at < GATE_TTL_MS) return hit;
  await limiter.consume('ingress', 'pet');
  const state = await studio.deps.store.read();
  const agent = state.agents.find((a) => a.id === agentId);
  const active = !!agent && agent.status === 'active' && !!agent.bot;
  const gate: Gate = { at: now, active, ...(agent?.tokenEnc ? { tokenEnc: agent.tokenEnc } : {}), token: active ? studio.botToken(agent!) : null, botId: agent?.bot?.id ?? 0 };
  cache.delete(agentId);
  if (cache.size >= GATE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(agentId, gate);
  return gate;
}

/** owner | member | guest, or null for "This one's private" (also a blocked person, without saying so). */
export function petRole(state: StudioState, agent: Agent, userId: number): PetRole | null {
  if ((agent.blocked ?? []).includes(userId)) return null;
  if (canUseAgent(state.members.find((m) => m.telegramId === userId), agent)) return agent.createdBy === userId ? 'owner' : 'member';
  return visibilityOf(agent) === 'public' ? 'guest' : null;
}

/**
 * The welcome-back line. v1 uses a warm canned line (never guilt, never "I missed you"); the brief's
 * memory-generated souvenir needs an LLM call outside `converse` and is not built yet.
 */
const SOUVENIRS = [
  "You're back! I saved you the comfiest spot.",
  'I kept a little sunshine for you.',
  'Hi again! I practised my best hop while you were out.',
  "You're here! I collected some cloud fluff for you.",
  'Welcome back! I learned a new wiggle.',
];
export function souvenir(agentId: string, userId: number, now: number): string {
  const seed = `${agentId}:${userId}:${Math.floor(now / 86_400_000)}`;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SOUVENIRS[h % SOUVENIRS.length];
}

/** Server time the care rules run on (the Studio clock, so tests control it). */
const clock = (studio: Studio) => (studio.deps.now?.() ?? new Date()).getTime();

type PetRoute = 'view' | 'export' | 'care' | 'play' | 'talk' | 'talk-voice' | 'forget' | 'circle' | 'circle-decision' | 'circle-leave' | 'notes' | 'notes-erase' | 'growth-confirm';
/** What a manager-signed launch (S4) may do: the person's own pet and the circle. Talk stays with the agent's own bot (the DM). */
const LAUNCH_ROUTES: ReadonlySet<PetRoute> = new Set(['view', 'care', 'play', 'circle', 'circle-decision', 'circle-leave', 'notes', 'notes-erase']);
/**
 * Low-value routes that may run on agent-signed initData without Telegram's signature, only under the shadow switch:
 * the person's own pet in this one agent (play is authorised exactly like care). Never the circle view (it names the group and the other joined members).
 */
const RELAXABLE: ReadonlySet<PetRoute> = new Set(['view', 'care', 'play']);
/** Agent-signed routes that act as the person (talk) or record their consent: a 1 h window instead of 24 h. */
const STRICT_AGE: ReadonlySet<PetRoute> = new Set(['talk', 'talk-voice', 'circle-decision', 'circle-leave', 'growth-confirm']);
/** Moved to the VoxxBot-signed My data page (my-data-http.ts): never authorised by any pet initData again. */
const MOVED: ReadonlySet<PetRoute> = new Set(['export', 'forget']);
const COPY_ID = /^[0-9a-z]{1,11}-[A-Za-z0-9_-]{12}$/;
function routeOf(method: string, path: string[]): { route: PetRoute; copyId?: string } | null {
  const action = path.join('/');
  if (method === 'GET') return action === '' ? { route: 'view' } : action === 'export' || action === 'play' || action === 'circle' || action === 'notes' ? { route: action } : null;
  if (method === 'DELETE') return path.length === 2 && path[0] === 'notes' && COPY_ID.test(path[1]) ? { route: 'notes-erase', copyId: path[1] } : null;
  if (method !== 'POST') return null;
  if (action === 'circle/decision' || action === 'circle/leave') return { route: action === 'circle/decision' ? 'circle-decision' : 'circle-leave' };
  if (action === 'growth/confirm') return { route: 'growth-confirm' };
  return action === 'care' || action === 'play' || action === 'talk' || action === 'talk-voice' || action === 'forget' ? { route: action } : null;
}

/**
 * S4 route b: initData the manager bot signed for its Main Mini App. Only while that route is on (Studio.mainApp),
 * and only when the signed start_param is a launch code whose short names this agent.
 */
function managerLaunch(studio: Studio, initData: string, agentId: string, managerToken: string): { user: InitDataUser; code: string } | null {
  if (!managerToken || !studio.mainApp()) return null;
  const code = new URLSearchParams(initData).get('start_param');
  const launch = parsePetLaunch(code);
  if (!launch || !sameShort(launch.short, agentShortCode(studio.deps.secret, agentId))) return null;
  const user = verifyManagerInitData(studio, initData, managerToken, 'pet');
  return user ? { user, code: code! } : null;
}

const contentType = (request: Request) => request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

async function jsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bounded = await boundedStudioRequest(request, maxBytes);
  try { return await bounded.json(); } catch { throw new StudioError(400, 'Invalid JSON'); }
}

/** `managerToken`: VOXX_BOT_TOKEN, for launches through the manager bot's Main Mini App (S4); empty = none accepted. */
export async function handlePetRequest(studio: Studio, request: Request, agentId: string, path: string[], managerToken = ''): Promise<Response> {
  try {
    if (process.env.STUDIO_PET_DISABLED === '1') return fail('pet_unavailable', 503);
    const limiter = limiterFor(studio);
    const method = request.method.toUpperCase();
    const routed = routeOf(method, path);
    if (!routed || !AGENT_ID.test(agentId)) return fail('pet_unavailable', 404);
    const { route } = routed;
    // Erase and export left the agent-signed page (a creator can forge or harvest its initData): nothing is read or erased.
    if (MOVED.has(route)) return fail('moved_to_vox', 410);
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (!initData || initData.length > MAX_INIT_DATA || !plausibleInitData(initData)) return fail('authentication_required', 401);
    if (method !== 'GET') {
      const expected = trustedStudioRequestOrigin(request.url, studio.deps.webAppUrl);
      if (!expected) return fail('pet_unavailable', 503);
      if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') return fail('origin_denied', 403);
    }

    let gate = await gateFor(studio, limiter, agentId);
    if (!gate.active) return fail('pet_unavailable', 404);
    // this agent's own entrance: a busy public pet never starves another agent, or the Studio
    await limiter.consume('ingress', `pet:${agentId}`);
    if (!gate.token) return fail('pet_unavailable', 503);
    // The opening bot signed this initData; another agent's bot never verifies it. Telegram's signature is required.
    const agentSigned = (g: Gate) => g.token ? verifyAgentInitData(studio, initData, { token: g.token, botId: g.botId }, 'pet',
      { relaxable: RELAXABLE.has(route), ...(STRICT_AGE.has(route) ? { maxAgeSeconds: AGENT_STRICT_MAX_AGE_S } : {}) }) : null;
    let user = agentSigned(gate);
    // The signed launch code when the manager bot signed this initData (S4); unset for the agent's own bot.
    let launched: string | undefined;
    if (!user && LAUNCH_ROUTES.has(route)) {
      const launch = managerLaunch(studio, initData, agentId, managerToken);
      if (launch) { user = launch.user; launched = launch.code; }
    }
    if (!user && Date.now() - gate.at >= GATE_REFRESH_MS) {
      gate = await gateFor(studio, limiter, agentId, true);
      user = gate.active ? agentSigned(gate) : null;
    }
    // Genuine initData only past the 1 h talk/consent window (a Mini App left open): "reopen me", not "outside".
    if (!user) return fail(STRICT_AGE.has(route) && gate.active && gate.token && agentInitDataExpired(studio, initData, { token: gate.token, botId: gate.botId })
      ? 'session_expired' : 'authentication_required', 401);
    await limiter.consume('api', user.id);

    // authenticated: the current state decides from here (the gate may be up to GATE_TTL_MS old)
    const state = await studio.deps.store.read();
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent || agent.status !== 'active' || !agent.bot) return fail('pet_unavailable', 404);
    // A manager-signed launch must still name a group this agent is in, under current state, with Circles on for that
    // chat (STUDIO_CIRCLE_CHATS): a de-listed chat's old card links open nothing, as with the flag off.
    if (launched) {
      const named = groupForCode(studio, state, agent, launched);
      if (!named || !studio.circleGroups.on(named.chatId)) return fail('authentication_required', 401);
    }
    if (!launched && agent.tokenEnc !== gate.tokenEnc) {
      const token = studio.botToken(agent);
      if (!token) return fail('pet_unavailable', 503);
      if (agentSigned({ ...gate, token, botId: agent.bot.id })?.id !== user.id) return fail('authentication_required', 401);
    }
    // Note texts are readable and erasable only in Vox (My data), or through a VoxxBot-signed launch (S4).
    if (route.startsWith('notes') && !launched) return fail('circle_use_vox', 403);
    void sweepPetCare(studio);
    void sweepPetPlay(studio);
    const pets = await petStoreFor(studio);

    if (route.startsWith('circle') || route.startsWith('notes')) return await circleRoute(studio, limiter, request, route, routed.copyId, agent, user.id, state, launched);

    const currentEpoch = await pets.erasureEpoch(user.id);
    const expectedEpoch = method === 'POST' ? request.headers.get('x-pet-care-epoch') ?? 'initial' : currentEpoch;
    if (expectedEpoch !== currentEpoch) throw new PetCareChangedError('Pet care changed');
    const now = clock(studio);
    const stage = stageFor(formingDay(agent, new Date(now)), agent.status);
    const role = petRole(state, agent, user.id);
    if (!role) {
      const body: PetPrivateView = { error: 'pet_private', name: agent.persona.name, look: normalizeLook(agent.look), stage };
      return json(body, 403);
    }
    const tz = request.headers.get(PET_TZ_HEADER) ?? undefined;
    const currentPetNow = () => {
      if (request.signal.aborted) return false;
      try {
        const current = studio.deps.store.readCommittedForEffect?.();
        const active = current?.agents.find(a => a.id === agent.id && a.status === 'active');
        return !!current && !!active && active.tokenEnc === agent.tokenEnc && petRole(current, active, user.id) !== null;
      } catch { return false; }
    };
    const finalCareFence = () => {
      if (!currentPetNow() || pets.erasureEpochNow?.(user.id) !== expectedEpoch) throw new PetCareChangedError('Pet care changed');
    };
    /**
     * Decay (and first meeting), then `fn`, saved atomically, on the clock at the moment of the write:
     * never earlier than the record, so a slow request (a talk turn) can't roll the cap windows back.
     */
    const step = <T>(fn: (care: PetCare, at: number) => { care: PetCare; result: T }) => pets.update(agent.id, user.id, (current) => {
      if (!currentPetNow()) throw new PetCareChangedError('Pet care changed');
      const at = Math.max(clock(studio), current?.lastUpdatedAt ?? 0);
      return fn(decay(current ?? newCare(agent.id, user.id, at, tz ?? 'UTC', stage), at, tz), at);
    }, expectedEpoch);

    const formed = formingDay(agent, new Date(now)) === null;
    /**
     * The person's play record as the page reads it (design §3.4), or undefined when the play store fails: a broken
     * play store never closes the pet. An open moves `seenAt` (the guest sweep's clock) at most every 12 hours.
     */
    const readPlay = async (at: number, zone: string): Promise<PetPlayView | undefined> => {
      try {
        const plays = await petPlayStoreFor(studio);
        let current = await plays.get(agent.id, user.id);
        if (current && at - current.seenAt >= PLAY_SEEN_EVERY_MS) {
          current = await plays.update(agent.id, user.id, (stored) => {
            if (!currentPetNow()) throw new PetCareChangedError('Pet care changed');
            const play = stored ? { ...stored, seenAt: Math.max(stored.seenAt, at) } : null;
            return { play, result: play };
          }, expectedEpoch);
        }
        return playView(current ?? newPlay(agent.id, user.id, at), at, zone);
      } catch (error) {
        if (PetCareChangedError.is(error)) throw error;
        (studio.deps.logger ?? console).warn('[studio] pet_play_read_failed');
        return undefined;
      }
    };

    /**
     * The growth moments as this person sees them (design §4.11): the agent's definitions, the agent-wide lit records
     * and this person's own (`litMine`). Undefined when the growth store fails: a broken store never closes the pet.
     */
    const readGrowth = async (litMine: ReadonlyArray<{ id: string }>): Promise<PetGrowthView | undefined> => {
      try {
        return growthView(agentMoments(agent), await (await petGrowthStoreFor(studio)).get(agent.id), litMine);
      } catch {
        (studio.deps.logger ?? console).warn('[studio] pet_growth_read_failed');
        return undefined;
      }
    };
    /** Lights an agent-wide moment after a play op; never fails the request (logged, content-free). */
    const lightShared = async (id: string, kind: 'room' | 'season', at: number) => {
      try { await lightAgentMoment(studio, agent.id, { id, kind, at }); }
      catch { (studio.deps.logger ?? console).warn('[studio] pet_growth_light_failed'); }
    };

    if (route === 'view') {
      const dataUrl = studio.dataLink();
      const opened = await step((care, at) => { const o = open(care, at, stage); return { care: o.care, result: { ...o, at } }; });
      const play = await readPlay(opened.at, opened.care.tz);
      // Growth moments belong to the agent's circle (design §4.11): a guest of a public agent never sees them.
      const growth = role === 'guest' ? undefined : await readGrowth(play?.litMine ?? []);
      const listen = role !== 'guest' && !launched && (!!studio.deps.openai || !!studio.deps.eleven);
      const view: PetView = {
        careEpoch: expectedEpoch, agentId: agent.id, name: agent.persona.name, look: normalizeLook(agent.look), stage, formingDay: formingDay(agent, new Date(now)),
        botUsername: agent.bot.username, voice: !!agent.voice && (studio.deps.tts !== undefined ? !!studio.deps.tts?.canSynthesize : !!studio.deps.eleven),
        listen, role, care: opened.care, now: opened.at,
        // UX-02: who hears the audio is the transcription provider callTurn uses (OpenAI first); locations and retention are unresolved
        ...(listen ? { voiceNotice: { providers: studio.deps.openai ? 'OpenAI' : 'ElevenLabs' } } : {}),
        ...(launched ? { talkInDm: true as const } : {}),
        ...(dataUrl ? { dataUrl } : {}),
        ...(opened.welcome ? { welcome: { souvenir: souvenir(agent.id, user.id, opened.at), awayMs: opened.welcome.awayMs } } : {}),
        ...(opened.stageUp ? { stageUp: opened.stageUp } : {}),
        ...(opened.bondMilestone === undefined ? {} : { bondMilestone: opened.bondMilestone }),
        ...(play ? { play } : {}),
        ...(growth ? { growth } : {}),
      };
      finalCareFence();
      return json(view);
    }

    // Play (design §3.4): its own record beside care, on care's epoch and fences. Guests play too; strangers never reach here.
    if (route === 'play') {
      const plays = await petPlayStoreFor(studio);
      const care = await pets.get(agent.id, user.id);
      const zone = safeZone(tz ?? care?.tz);
      if (method === 'GET') {
        const current = await plays.get(agent.id, user.id);
        const view = playView(current ?? newPlay(agent.id, user.id, now), now, zone);
        finalCareFence();
        return json({ play: view, now } satisfies PlayResponse);
      }
      if (contentType(request) !== 'application/json') return fail('json_required', 415);
      const input = playSchema.parse(await jsonBody(request, MAX_PLAY_BYTES));
      // A festival celebrates once per person per Persian year across all their agents (§4.10).
      let celebratedElsewhere: ReadonlySet<SeasonId> | undefined;
      if (input.op === 'seasonCelebrated') {
        const on = activeSeason(now, zone);
        if (on?.season === input.season) {
          const elsewhere = (await plays.listForUser(user.id)).some((p) => p.agentId !== agent.id && p.seasons[input.season] === on.year);
          if (elsewhere) celebratedElsewhere = new Set([input.season]);
        }
      }
      const moments = agentMoments(agent);
      const accessMoments = input.op === 'askAccepted' ? moments.filter((m) => m.kind === 'access').map((m) => m.id) : undefined;
      const done = await plays.update(agent.id, user.id, (current) => {
        if (!currentPetNow()) throw new PetCareChangedError('Pet care changed');
        const at = Math.max(clock(studio), current?.updatedAt ?? 0);
        const r = applyPlay(current ?? newPlay(agent.id, user.id, at), input, { now: at, tz: zone, stage, formed, bond: care?.bond ?? 0,
          ...(celebratedElsewhere ? { celebratedElsewhere } : {}), ...(accessMoments ? { accessMoments } : {}) });
        return { play: r.play, result: { ...r, at } };
      }, expectedEpoch);
      // Growth (§4.11), server-side only: a first room visit also lights the agent-wide room moment the first time anyone
      // visits; a first festival celebration lights its season moment for the whole agent. An accepted ask lit a personal
      // access moment inside applyPlay. Nothing is lit on a guard (a repeat, a cap, out of season).
      // visits. A guest's play never lights the agent's moments and never sees them (§4.11: the circle's, not the public's).
      const shares = !done.guard && role !== 'guest';
      if (shares && input.op === 'roomVisited') await lightShared(roomMoment(input.room), 'room', done.at);
      if (shares && input.op === 'seasonCelebrated') await lightShared(SEASON_MOMENT(input.season), 'season', done.at);
      const view = playView(done.play, done.at, zone);
      const growth = role !== 'guest' && (input.op === 'roomVisited' || input.op === 'seasonCelebrated' || input.op === 'askAccepted') ? await readGrowth(view.litMine) : undefined;
      finalCareFence();
      const body: PlayResponse = { play: view, now: done.at, ...(done.guard ? { guard: done.guard } : {}), ...(growth ? { growth } : {}) };
      return json(body);
    }

    // Growth confirm (§4.11): the only way a taught moment lights. The person made an explicit "remember this" save and
    // then tapped yes on the pet's suggested match; never inferred from conversation. Members only, like talk.
    if (route === 'growth-confirm') {
      if (role === 'guest') return fail('guest_talk', 403, { botUsername: agent.bot.username });
      if (contentType(request) !== 'application/json') return fail('json_required', 415);
      await limiter.consume('mutation', user.id);
      const input = growthConfirmSchema.parse(await jsonBody(request, MAX_GROWTH_BYTES));
      const moment = agentMoments(agent).find((m) => m.id === input.momentId && m.kind === 'taught');
      if (!moment) return fail('invalid_request', 404, { message: 'moment_not_found' });
      // The source note: the person's own active copy that names this agent (the id names its owner; nobody else's is read).
      let origin: 'dm' | 'group' | undefined;
      if (input.noteId) {
        const at = clock(studio);
        const copy = receiptOwner(input.noteId) === user.id && studio.deps.notesLedger
          ? (await studio.deps.notesLedger.read(user.id))?.copies.find((c) => c.copyId === input.noteId && c.status === 'active'
            && c.agentIds.includes(agent.id) && Date.parse(c.expiresAt) > at) : undefined;
        if (!copy) return fail('invalid_request', 404, { message: 'note_not_found' });
        origin = copy.origin;
      }
      const ref = input.noteId ? noteRef(studio.deps.secret, input.noteId) : undefined;
      let lit: GrowthConfirmResponse['lit'] = null;
      // A fact saved for the circle teaches the whole agent; a private save (or no note named) lights it for this person only.
      if (origin === 'group') {
        if (!currentPetNow()) throw new PetCareChangedError('Pet care changed');
        lit = await lightAgentMoment(studio, agent.id, { id: moment.id, kind: 'taught', at: clock(studio), ...(ref ? { ref } : {}) }) ? 'agent' : null;
      } else {
        const plays = await petPlayStoreFor(studio);
        lit = await plays.update(agent.id, user.id, (current) => {
          if (!currentPetNow()) throw new PetCareChangedError('Pet care changed');
          const at = Math.max(clock(studio), current?.updatedAt ?? 0);
          const play = current ?? newPlay(agent.id, user.id, at);
          if (play.litMine.some((l) => l.id === moment.id) || play.litMine.length >= PLAY_LIMITS.litMine) return { play: null, result: null };
          return { play: { ...play, updatedAt: at, seenAt: Math.max(play.seenAt, at), litMine: [...play.litMine, { id: moment.id, litAt: at, ...(ref ? { ref } : {}) }] }, result: 'mine' as const };
        }, expectedEpoch);
      }
      const current = await (await petPlayStoreFor(studio)).get(agent.id, user.id);
      const growth = await readGrowth(current?.litMine ?? []);
      finalCareFence();
      const body: GrowthConfirmResponse = { lit, ...(growth ? { growth } : {}) };
      return json(body);
    }

    if (route === 'care') {
      if (contentType(request) !== 'application/json') return fail('json_required', 415);
      const input = careSchema.parse(await jsonBody(request, MAX_CARE_BYTES));
      const done = await step((care, at) => { const r = apply(care, input.action, at, input.n); return { care: r.care, result: { ...r, at } }; });
      finalCareFence();
      return json(careResponse(done, done.at));
    }

    // Talk: guests chat in the DM, where the stranger rules live (brief §5 #1).
    if (role === 'guest') return fail('guest_talk', 403, { botUsername: agent.bot.username });
    await limiter.consume('mutation', user.id);

    // Synchronous, committed final fence also applies to legacy FILE, not just indexed transport.
    const admission: DirectAuthorityEvaluator<string | null> = (d, at) => {
      const adaptive = studio.deps.adaptive!;
      const grants = d.agentGrants.filter(g => g.agentId === agent.id && g.space === 'work');
      const allowed = adaptive.isCoreAllowed(d, at) && grants.some(g => g.allowed);
      const policy = adaptive.capabilityStatus(d, 'core_text', at);
      return { value: allowed ? digest([adaptive.coreFingerprint(d, at), grants]) : null, denied: !allowed,
        ...(allowed ? { deadline: Math.min(d.binding!.expiresAt, policy.validUntil ?? at) } : {}) };
    };
    const readAdmissionNow = (): string | null => {
      const adaptive = studio.deps.adaptive;
      if (!adaptive || !currentPetNow() || pets.erasureEpochNow?.(user.id) !== expectedEpoch) return null;
      try {
        const first = adaptive.readDirectAuthorityForEffect(user.id, 'work', admission);
        if (first.status !== 'ready' || !first.value) return null;
        const authority = studio.replyAuthorityNow(agent.id, user.id);
        const second = adaptive.readDirectAuthorityForEffect(user.id, 'work', admission);
        return second.status === 'ready' && second.value === first.value &&
          studio.replyAuthorityNow(agent.id, user.id) === authority && pets.erasureEpochNow?.(user.id) === expectedEpoch
          ? digest([first.value, authority]) : null;
      } catch { return null; }
    };
    if (!studio.deps.adaptive) return fail('conversation_failed', 503, { message: 'conversation_unavailable' });
    // Prime authority through the canonical path, then compare committed data synchronously.
    await studio.deps.adaptive.withAccountDocument(user.id, () => undefined);
    const admitted = readAdmissionNow();
    if (!admitted) return fail('conversation_failed', 403, { message: 'conversation_not_permitted' });
    const authorizeNow = () => readAdmissionNow() === admitted;
    const authorize = async () => {
      await studio.deps.adaptive!.withAccountDocument(user.id, () => undefined);
      await pets.erasureEpoch(user.id);
      return authorizeNow();
    };
    let settled: CareResult | undefined;
    const beforeDelivery = async () => {
      if (!await authorize()) throw new StudioError(409, 'The conversation settings changed.');
      settled = await step((care, at) => { const r = talk(care, at); return { care: r.care, result: r }; });
    };

    if (route === 'talk') {
      if (contentType(request) !== 'application/json') return fail('json_required', 415);
      const input = talkSchema.parse(await jsonBody(request, MAX_TALK_BYTES));
      // Same private chat and space as the DM (gateway: private-<person>, 'work'), so one memory.
      const turn = await converseAuthorized(studio, user, { agentId: agent.id, space: 'work', text: input.text }, request.signal, { surface: 'pet', authorize, authorizeNow, beforeDelivery });
      if (!turn.ok) return fail('conversation_failed', turn.status, { message: turn.error }, turn.headers);
      const done = settled!;
      const body: TalkResponse = { reply: turn.reply, ...(turn.turnId ? { turnId: turn.turnId } : {}), care: done.care,
        ...(isGoodbye(input.text) ? { goodbye: true } : {}), ...(done.bondMilestone === undefined ? {} : { bondMilestone: done.bondMilestone }) };
      return json(body);
    }

    // talk-voice: the existing call path (hear → think → speak) with the pet surface's reply shape.
    if (!studio.deps.openai && !studio.deps.eleven) return fail('conversation_failed', 501, { message: 'voice_unavailable' });
    if (!contentType(request)?.startsWith('multipart/form-data')) return fail('invalid_request', 415);
    await limiter.consume('expensive', user.id);
    await limiter.consume('call', user.id);
    const member = state.members.find((m) => m.telegramId === user.id)!;
    const form = await (await boundedStudioRequest(request)).formData().catch(() => { throw new StudioError(400, 'Expected audio'); });
    const audio = form.get('audio');
    // FormDataEntryValue is string | File; checking that (not instanceof) works across realms.
    if (audio === null || typeof audio === 'string') return fail('invalid_request', 400);
    // Spoken replies only when the agent has its own voice (brief §5 #8): otherwise no speech is made at all.
    const spoken = !!agent.voice;
    // Hands-free (§8A.2): a device-local mode; the page says so per turn and the prompt gets the hands-free frame.
    const handsFree = form.get('handsFree');
    const options = { surface: 'pet' as const, speak: spoken, authorize, authorizeNow, beforeDelivery, ...(handsFree === 'true' || handsFree === '1' ? { handsFree: true } : {}) };
    const bytes = await audio.arrayBuffer(), mime = audio.type || 'audio/webm';
    // ?stream=1 (§8A.3): NDJSON, one event per sentence as soon as it is spoken. Without it, one JSON body as before.
    if (new URL(request.url).searchParams.get('stream') === '1') {
      return await ndjsonTurn(async (emit) => {
        const sink: CallTurnSink = {
          transcript: (text) => emit({ type: 'transcript', text }),
          reply: (text) => emit({ type: 'reply', text }),
          sentence: ({ i, text, audio: speech, mimeType }) => emit({ type: 'sentence', i, text, ...(speech && mimeType ? { audio: speech.toString('base64'), mimeType } : {}) }),
        };
        const turn = await studio.callTurnStream(member, agent.id, bytes, mime, 'work', request.signal, options, sink);
        if (!turn.transcript) { emit({ type: 'transcript', text: '' }); return { type: 'done' }; }
        // `settled` is set by beforeDelivery; a turn that somehow skipped it still ends cleanly (no care in the event).
        const done = settled;
        return { type: 'done', ...(turn.turnId ? { turnId: turn.turnId } : {}), ...(done ? { care: done.care } : {}),
          ...(isGoodbye(turn.transcript) ? { goodbye: true } : {}), ...(done?.bondMilestone === undefined ? {} : { bondMilestone: done.bondMilestone }) };
      });
    }
    const turn = await studio.callTurn(member, agent.id, bytes, mime, 'work', request.signal, options);
    if (!turn.transcript) {
      const empty: TalkVoiceResponse = { transcript: '', reply: '' };
      return json(empty);
    }
    const done = settled!;
    const body: TalkVoiceResponse = {
      transcript: turn.transcript, reply: turn.reply,
      ...(turn.audio && spoken ? { audio: turn.audio } : {}),
      ...(turn.turnId ? { turnId: turn.turnId } : {}), care: done.care,
      ...(isGoodbye(turn.transcript) ? { goodbye: true } : {}),
      ...(done.bondMilestone === undefined ? {} : { bondMilestone: done.bondMilestone }),
    };
    return json(body);
  } catch (error) {
    if (PetCareChangedError.is(error)) return fail('conversation_failed', 409, { message: 'pet_care_changed' });
    if (CirclePetError.is(error)) return fail(error.code, error.status);
    if (StudioRateLimitError.is(error)) return fail('rate_limited', 429, {}, { 'Retry-After': String(error.retryAfterSeconds) });
    if (isSchemaValidationError(error)) return fail('invalid_request', 400);
    // 409/503 come from the call path (settings changed, no listening provider); the rest are the request's fault.
    if (StudioError.is(error)) return fail(error.status === 409 || error.status === 503 ? 'conversation_failed' : 'invalid_request', error.status);
    return fail('pet_unavailable', 503);
  }
}

/** The fixed code an NDJSON stream ends with when the turn fails after the 200 headers went out. */
function streamErrorCode(error: unknown): Extract<TalkVoiceStreamEvent, { type: 'error' }>['code'] {
  if (PetCareChangedError.is(error)) return 'pet_care_changed';
  if (StudioError.is(error) && error.status === 409) return 'settings_changed';
  if (StudioRateLimitError.is(error)) return 'rate_limited';
  return 'conversation_failed';
}

/**
 * POST talk-voice?stream=1 (design §8A.3): `application/x-ndjson`, one JSON event per line, in order (transcript,
 * reply, sentence…, done). Nothing is sent until the first event exists, so a turn refused before it (not permitted,
 * no transcript provider) still answers with its usual HTTP status and JSON error; after that, a failure is the last
 * line, `{ "type": "error", "code" }`, and nothing further is spoken.
 */
async function ndjsonTurn(run: (emit: (event: TalkVoiceStreamEvent) => void) => Promise<TalkVoiceStreamEvent>): Promise<Response> {
  const encoder = new TextEncoder();
  const queue: string[] = [];
  let started = false, finished = false;
  let wake: (() => void) | null = null;
  let firstEvent!: () => void;
  const first = new Promise<void>((resolve) => { firstEvent = resolve; });
  const push = (event: TalkVoiceStreamEvent) => { queue.push(`${JSON.stringify(event)}\n`); wake?.(); };
  const task = run((event) => { started = true; push(event); firstEvent(); })
    .then((done) => { started = true; push(done); }, (error: unknown) => {
      if (!started) throw error;
      push({ type: 'error', code: streamErrorCode(error) });
    })
    .finally(() => { finished = true; wake?.(); });
  // A failure before any event is the route's ordinary error response.
  await Promise.race([first, task]);
  task.catch(() => undefined);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!queue.length && !finished) await new Promise<void>((resolve) => { wake = resolve; });
      wake = null;
      const line = queue.shift();
      if (line !== undefined) controller.enqueue(encoder.encode(line));
      else controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
}

/**
 * The circle routes (S4) for someone the pet admits: GET circle (a present member only), POST circle/decision and
 * circle/leave, GET notes (their own copies), DELETE notes/:copyId (their own copy). A manager-signed launch speaks
 * for the group its signed start_param names, never another. Mutations are rate limited like the other writes.
 */
async function circleRoute(studio: Studio, limiter: StudioRequestRateLimiter, request: Request, route: PetRoute, copyId: string | undefined, agent: Agent, userId: number, state: StudioState, launched?: string): Promise<Response> {
  if (!petRole(state, agent, userId)) {
    const body: PetPrivateView = { error: 'pet_private', name: agent.persona.name, look: normalizeLook(agent.look), stage: stageFor(formingDay(agent, new Date(clock(studio))), agent.status) };
    return json(body, 403);
  }
  try {
    return await circleAction(studio, limiter, request, route, copyId, agent, userId, state, launched);
  } catch (error) {
    if (CirclePetError.is(error) || StudioRateLimitError.is(error) || isSchemaValidationError(error) || StudioError.is(error)) throw error;
    // A store failing under a circle route is the sheet's to show ("try again"); pet_unavailable would end the pet.
    (studio.deps.logger ?? console).warn('[studio] circle_pet_failed');
    return fail('circle_failed', 503);
  }
}

async function circleAction(studio: Studio, limiter: StudioRequestRateLimiter, request: Request, route: PetRoute, copyId: string | undefined, agent: Agent, userId: number, state: StudioState, launched?: string): Promise<Response> {
  if (route === 'notes-erase') {
    await limiter.consume('mutation', userId);
    return json({ erased: await studio.circleNotes.eraseOwn(userId, copyId!) });
  }
  let body: z.infer<typeof decisionSchema> | z.infer<typeof leaveSchema> | undefined;
  if (request.method.toUpperCase() === 'POST') {
    if (contentType(request) !== 'application/json') return fail('json_required', 415);
    await limiter.consume('mutation', userId);
    body = (route === 'circle-decision' ? decisionSchema : leaveSchema).parse(await jsonBody(request, MAX_CIRCLE_BYTES));
  }
  const asked = body?.code ?? new URL(request.url).searchParams.get('code') ?? undefined;
  if (launched && asked && asked !== launched) return fail('circle_unavailable', 404);
  const code = launched ?? asked, group = groupForCode(studio, state, agent, code);
  if (route === 'circle') return json(await circleView(studio, agent, userId, group, !!launched));
  if (route === 'circle-decision') return json(await circleDecision(studio, agent, userId, group, body as z.infer<typeof decisionSchema>, !!launched));
  if (route === 'circle-leave') return json(await circleLeave(studio, agent, userId, group));
  return json(await circleNotes(studio, agent, userId, group));
}

/**
 * GET /api/studio/pet/launch (S4): which agent a launch code names, for the pet launch page the manager bot's Main
 * Mini App (/studio, rewritten) shows. The code must name an active agent in the group its join code names, and the
 * initData must be signed by the manager bot (while that route is on) or by that agent's own bot (its own Main Mini
 * App). Only with Circles on; it reveals an agent id the person's own launch already pointed at, nothing else.
 */
export async function handlePetLaunch(studio: Studio, request: Request, managerToken = ''): Promise<Response> {
  try {
    if (process.env.STUDIO_PET_DISABLED === '1') return fail('pet_unavailable', 503);
    if (request.method.toUpperCase() !== 'GET') return fail('pet_unavailable', 404);
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (!initData || initData.length > MAX_INIT_DATA || !plausibleInitData(initData)) return fail('authentication_required', 401);
    const launch = parsePetLaunch(new URLSearchParams(initData).get('start_param'));
    if (!launch || studio.circlesMode() !== 'circles') return fail('pet_unavailable', 404);
    const limiter = limiterFor(studio);
    await limiter.consume('ingress', 'pet');
    const state = await studio.deps.store.read();
    const group = state.groups.find((g) => g.joinCode === launch.joinCode);
    // The per-chat switch (STUDIO_CIRCLE_CHATS) stops the entrance too: a de-listed chat's card links name nothing.
    if (!group || !studio.circleGroups.on(group.chatId)) return fail('pet_unavailable', 404);
    const agent = group.agentIds.map((id) => state.agents.find((a) => a.id === id && a.status === 'active' && !!a.bot))
      .find((a): a is Agent => !!a && sameShort(launch.short, agentShortCode(studio.deps.secret, a.id)));
    if (!agent) return fail('pet_unavailable', 404);
    const own = studio.botToken(agent);
    const user = (managerToken && studio.mainApp() ? verifyManagerInitData(studio, initData, managerToken, 'pet_launch') : null)
      ?? (own ? verifyAgentInitData(studio, initData, { token: own, botId: agent.bot!.id }, 'pet_launch', { relaxable: true }) : null);
    if (!user) return fail('authentication_required', 401);
    await limiter.consume('api', user.id);
    return json({ agentId: agent.id });
  } catch (error) {
    if (StudioRateLimitError.is(error)) return fail('rate_limited', 429, {}, { 'Retry-After': String(error.retryAfterSeconds) });
    return fail('pet_unavailable', 503);
  }
}

function careResponse(done: CareResult, now: number): CareResponse {
  return {
    care: done.care, now,
    ...(done.guard ? { guard: done.guard } : {}),
    ...(done.bondMilestone === undefined ? {} : { bondMilestone: done.bondMilestone }),
  };
}
