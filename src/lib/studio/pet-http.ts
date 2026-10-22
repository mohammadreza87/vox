/**
 * Vox Pet API (brief §3.6–3.8): `/api/studio/pet/:agentId[/care|/talk|/talk-voice]`.
 *
 * Auth is per agent: initData is signed with the bot that opened the page, so it is verified with
 * that agent's own token (never a loop over tokens) and bot A's initData can never act on agent B.
 * The path's agentId is only a routing hint. Roles: a member who may use the agent is owner (its
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
import { verifyInitData } from './auth';
import { normalizeLook, stageFor } from './character';
import { converseAuthorized } from './conversation';
import { boundedStudioRequest } from './http';
import { canUseAgent, formingDay, visibilityOf } from './permissions';
import { petStoreFor, sweepPetCare, PetCareChangedError } from './pet-store';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from './ratelimit';
import { trustedStudioRequestOrigin } from './request-origin';
import { StudioError, type Studio } from './service';
import type { Agent, StudioState } from './types';
import type { DirectAuthorityEvaluator } from '../adaptive/persistence/authority';
import { digest } from '../adaptive/persistence/repository';
import { isSchemaValidationError } from '../error-contract';
import { apply, decay, newCare, open, talk, type CareResult } from '../pet/care';
import { isGoodbye } from '../pet/goodbye';
import {
  PET_ACTIONS, PET_TZ_HEADER, type CareResponse, type PetAction, type PetCare, type PetErrorCode, type PetExportResponse, type PetForgetResponse,
  type PetPrivateView, type PetRole, type PetView, type TalkResponse, type TalkVoiceResponse,
} from '../pet/types';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_INIT_DATA = 16_384;
/** verifyInitData's default max age (24 h, like the rest of Studio in v1) */
const INIT_DATA_MAX_AGE_S = 86_400;
const MAX_CARE_BYTES = 1024;
const MAX_TALK_BYTES = 16 * 1024;
const MAX_TALK_CHARS = 2000;

const careSchema = z.object({ action: z.enum(PET_ACTIONS as unknown as [PetAction, ...PetAction[]]), n: z.number().int().min(1).max(50).optional() }).strict();
const talkSchema = z.object({ text: z.string().trim().min(1).max(MAX_TALK_CHARS) }).strict();

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
interface Gate { at: number; active: boolean; tokenEnc?: string; token: string | null }
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
  const gate: Gate = { at: now, active, ...(agent?.tokenEnc ? { tokenEnc: agent.tokenEnc } : {}), token: active ? studio.botToken(agent!) : null };
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

type PetRoute = 'view' | 'export' | 'care' | 'talk' | 'talk-voice' | 'forget';
function routeOf(method: string, path: string[]): PetRoute | null {
  const action = path.join('/');
  if (method === 'GET') return action === '' ? 'view' : action === 'export' ? 'export' : null;
  if (method !== 'POST') return null;
  return action === 'care' || action === 'talk' || action === 'talk-voice' || action === 'forget' ? action : null;
}

const contentType = (request: Request) => request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

async function jsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bounded = await boundedStudioRequest(request, maxBytes);
  try { return await bounded.json(); } catch { throw new StudioError(400, 'Invalid JSON'); }
}

export async function handlePetRequest(studio: Studio, request: Request, agentId: string, path: string[]): Promise<Response> {
  try {
    if (process.env.STUDIO_PET_DISABLED === '1') return fail('pet_unavailable', 503);
    const limiter = limiterFor(studio);
    const method = request.method.toUpperCase();
    const route = routeOf(method, path);
    if (!route || !AGENT_ID.test(agentId)) return fail('pet_unavailable', 404);
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (!initData || initData.length > MAX_INIT_DATA || !plausibleInitData(initData)) return fail('authentication_required', 401);
    if (method === 'POST') {
      const expected = trustedStudioRequestOrigin(request.url, studio.deps.webAppUrl);
      if (!expected) return fail('pet_unavailable', 503);
      if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') return fail('origin_denied', 403);
    }

    let gate = await gateFor(studio, limiter, agentId);
    if (!gate.active) return fail('pet_unavailable', 404);
    // this agent's own entrance: a busy public pet never starves another agent, or the Studio
    await limiter.consume('ingress', `pet:${agentId}`);
    if (!gate.token) return fail('pet_unavailable', 503);
    // The opening bot signed this initData; another agent's bot never verifies it.
    let user = verifyInitData(initData, gate.token);
    if (!user && Date.now() - gate.at >= GATE_REFRESH_MS) {
      gate = await gateFor(studio, limiter, agentId, true);
      user = gate.active && gate.token ? verifyInitData(initData, gate.token) : null;
    }
    if (!user) return fail('authentication_required', 401);
    await limiter.consume('api', user.id);

    // authenticated: the current state decides from here (the gate may be up to GATE_TTL_MS old)
    const state = await studio.deps.store.read();
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent || agent.status !== 'active' || !agent.bot) return fail('pet_unavailable', 404);
    if (agent.tokenEnc !== gate.tokenEnc) {
      const token = studio.botToken(agent);
      if (!token) return fail('pet_unavailable', 503);
      if (verifyInitData(initData, token)?.id !== user.id) return fail('authentication_required', 401);
    }
    void sweepPetCare(studio);
    const pets = await petStoreFor(studio);

    // The person's own pet data, whatever their role (a guest, someone removed from Studio, a blocked
    // person): the signed initData proves who they are.
    if (route === 'export') {
      // A failing choice store never blocks the pet export: pet care still goes out.
      const choices = await studio.agentChoicesFor(user.id).catch(() => []);
      const circles = await studio.circleParticipationFor(user.id).catch(() => []);
      const body: PetExportResponse = { petCare: await pets.listForUser(user.id), ...(choices.length ? { agentChoices: choices } : {}), ...(circles.length ? { circles } : {}) };
      return json(body, 200, { 'Content-Disposition': 'attachment; filename="vox-pet-export.json"' });
    }
    if (route === 'forget') {
      await limiter.consume('mutation', user.id);
      // Circle rows and choices are erased first, so a failing store fails the request before pet care is touched.
      const circles = await studio.forgetCircles(user.id), choices = await studio.forgetAgentChoices(user.id), erased = await pets.eraseUser(user.id);
      const body: PetForgetResponse = { erased, ...(choices ? { choicesErased: choices } : {}), ...(circles ? { circlesErased: circles } : {}) };
      return json(body);
    }

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

    if (route === 'view') {
      const opened = await step((care, at) => { const o = open(care, at, stage); return { care: o.care, result: { ...o, at } }; });
      const view: PetView = {
        careEpoch: expectedEpoch, agentId: agent.id, name: agent.persona.name, look: normalizeLook(agent.look), stage, formingDay: formingDay(agent, new Date(now)),
        botUsername: agent.bot.username, voice: !!agent.voice && !!studio.deps.eleven,
        listen: role !== 'guest' && (!!studio.deps.openai || !!studio.deps.eleven), role, care: opened.care, now: opened.at,
        ...(opened.welcome ? { welcome: { souvenir: souvenir(agent.id, user.id, opened.at), awayMs: opened.welcome.awayMs } } : {}),
        ...(opened.stageUp ? { stageUp: opened.stageUp } : {}),
        ...(opened.bondMilestone === undefined ? {} : { bondMilestone: opened.bondMilestone }),
      };
      finalCareFence();
      return json(view);
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
    const turn = await studio.callTurn(member, agent.id, await audio.arrayBuffer(), audio.type || 'audio/webm', 'work', request.signal, { surface: 'pet', speak: spoken, authorize, authorizeNow, beforeDelivery });
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
    if (StudioRateLimitError.is(error)) return fail('rate_limited', 429, {}, { 'Retry-After': String(error.retryAfterSeconds) });
    if (isSchemaValidationError(error)) return fail('invalid_request', 400);
    // 409/503 come from the call path (settings changed, no listening provider); the rest are the request's fault.
    if (StudioError.is(error)) return fail(error.status === 409 || error.status === 503 ? 'conversation_failed' : 'invalid_request', error.status);
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
