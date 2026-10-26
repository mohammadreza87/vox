/**
 * "My data" API (`/api/studio/my-data`): a person's own pet care and play, agent choices, group participation, notes and
 * connection records, with export and erase. It replaces the pet page's export and forget, which trusted agent-signed initData: an agent's
 * creator holds that bot's token (BotFather), so they could forge it for anyone, or harvest a genuine one by
 * repointing the bot's menu. Here only initData signed by the manager bot (VOXX_BOT_TOKEN, which only Vox holds) is
 * accepted, so the caller is the Telegram account itself.
 *
 * - Members, pending people and outsiders who only ever used a public agent all work. Nothing here creates a Studio
 *   member (no ensureMember), reads a member row, or touches the rights-intake lifecycle.
 * - Everything is scoped to the verified account; no route takes a person id. A note copy is erased only when that
 *   account owns it (CircleNotes.eraseOwn checks the copy's owner).
 * - No query strings; bodies are JSON and at most 4 KiB; writes need the Studio origin; every request is rate limited.
 *
 * Routes: GET '' (export), POST forget (body `{ "confirm": true }`), DELETE notes/:copyId.
 */

import { z } from 'zod';
import { isSchemaValidationError } from '../error-contract';
import { verifyManagerInitData } from './initdata-trust';
import { boundedStudioRequest } from './http';
import { petStoreFor } from './pet-store';
import { petPlayStoreFor } from './pet-play-store';
import { petCheckinStoreFor } from './pet-checkins/store';
import { noteCheckinStop } from './pet-checkins/deliver';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from './ratelimit';
import { trustedStudioRequestOrigin } from './request-origin';
import { StudioError, type Studio } from './service';
import type { MyDataErrorCode, MyDataForgetResponse, MyDataNoteEraseResponse, MyDataResponse } from './my-data-contract';
import type { ConnectionsExport } from '../connections/rights';

const MAX_INIT_DATA = 16_384;
const MAX_BODY = 4 * 1024;
const COPY_ID = /^[0-9a-z]{1,11}-[A-Za-z0-9_-]{12}$/;
const forgetSchema = z.object({ confirm: z.literal(true) }).strict();

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const fail = (error: MyDataErrorCode, status: number, headers: Record<string, string> = {}) => json({ error }, status, headers);

const limiters = new WeakMap<Studio, StudioRateLimiter>();
function limiterFor(studio: Studio): StudioRequestRateLimiter {
  if (studio.deps.rateLimiter) return studio.deps.rateLimiter;
  let limiter = limiters.get(studio);
  if (!limiter) { limiter = new StudioRateLimiter(); limiters.set(studio, limiter); }
  return limiter;
}

/** The person's own connection records in both spaces (never tokens), present only when any exist; a flag when they could not be read. */
async function connectionsForExport(studio: Studio, telegramId: number): Promise<Pick<MyDataResponse, 'connections' | 'connectionsUnavailable'>> {
  try {
    const found: ConnectionsExport[] = [];
    for (const space of ['work', 'personal'] as const) { const one = await studio.connectionsFor(telegramId, space); if (one) found.push(one); }
    return found.length ? { connections: found } : {};
  } catch { (studio.deps.logger ?? console).warn('[studio] connections_export_failed'); return { connectionsUnavailable: true }; }
}

/** `managerToken`: VOXX_BOT_TOKEN. Agent bots' tokens are never tried here. */
export async function handleMyDataRequest(studio: Studio, request: Request, path: string[], managerToken: string): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    const route = method === 'GET' && path.length === 0 ? 'export'
      : method === 'POST' && path.length === 1 && path[0] === 'forget' ? 'forget'
      : method === 'DELETE' && path.length === 2 && path[0] === 'notes' && COPY_ID.test(path[1]) ? 'note' : null;
    if (!route) return fail('not_found', 404);
    const url = new URL(request.url);
    if (url.search !== '') return fail('invalid_request', 400);
    const limiter = limiterFor(studio);
    await limiter.consume('ingress', 'my-data');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (!initData || initData.length > MAX_INIT_DATA || !managerToken) return fail('authentication_required', 401);
    if (method !== 'GET') {
      const expected = trustedStudioRequestOrigin(request.url, studio.deps.webAppUrl);
      if (!expected) return fail('my_data_unavailable', 503);
      if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') return fail('origin_denied', 403);
    }
    const user = verifyManagerInitData(studio, initData, managerToken, 'my_data');
    if (!user) return fail('authentication_required', 401);
    await limiter.consume('api', user.id);
    const pets = await petStoreFor(studio);

    if (route === 'export') {
      // A failing side store never blocks the export: pet care still goes out (as the pet export did).
      const choices = await studio.agentChoicesFor(user.id).catch(() => []);
      const circles = await studio.circleParticipationFor(user.id).catch(() => []);
      const notes = await studio.notesFor(user.id).catch(() => []);
      const connections = await connectionsForExport(studio, user.id);
      const petCare = await pets.listForUser(user.id);
      // Play (design §3.4) is content-free; a failing play store never blocks the export either.
      const petPlay = await petPlayStoreFor(studio).then((plays) => plays.listForUser(user.id)).catch(() => {
        (studio.deps.logger ?? console).warn('[studio] pet_play_export_failed');
        return [];
      });
      // Check-ins (design §5) are content-free too; a failing store never blocks the export.
      const petCheckins = await petCheckinStoreFor(studio).then((store) => store.get(user.id)).catch(() => {
        (studio.deps.logger ?? console).warn('[studio] pet_checkins_export_failed');
        return null;
      });
      // Display names only for the agents the person's own records already name.
      const named = new Set([...petCare.map((c) => c.agentId), ...petPlay.map((p) => p.agentId), ...choices.map((c) => c.agentId), ...notes.flatMap((n) => n.agentIds),
        ...(connections.connections ?? []).flatMap((e) => [...e.connections.flatMap((c) => c.agentId ? [c.agentId] : []), ...e.grants.map((g) => g.agentId)])]);
      const state = await studio.deps.store.read();
      const agentNames: Record<string, string> = {};
      for (const agent of state.agents) if (named.has(agent.id)) agentNames[agent.id] = agent.persona.name;
      const body: MyDataResponse = { petCare, ...(choices.length ? { agentChoices: choices } : {}), ...(circles.length ? { circles } : {}), ...(notes.length ? { notes } : {}),
        ...(petPlay.length ? { petPlay } : {}), ...(petCheckins ? { petCheckins } : {}), ...connections, agentNames };
      return json(body, 200, { 'Content-Disposition': 'attachment; filename="vox-my-data.json"' });
    }

    const jsonBody = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
    if (route === 'forget' && !jsonBody) return fail('json_required', 415);
    await limiter.consume('mutation', user.id);
    if (route === 'note') {
      const body: MyDataNoteEraseResponse = { erased: await studio.circleNotes.eraseOwn(user.id, path[1]) };
      return json(body);
    }
    const bounded = await boundedStudioRequest(request, MAX_BODY);
    let input: unknown;
    try { input = await bounded.json(); } catch { return fail('invalid_request', 400); }
    forgetSchema.parse(input);
    // Circle rows, note copies, channel post drafts, choices and play first, so a failing store fails before pet care is touched.
    const circles = await studio.forgetCircles(user.id), notes = await studio.forgetNotes(user.id);
    await studio.forgetChannelDrafts(user.id);
    const choices = await studio.forgetAgentChoices(user.id);
    // Play shares care's erasure epoch: both erasures rotate it, so no open from before this forget can write either.
    const played = await (await petPlayStoreFor(studio)).eraseUser(user.id);
    // Check-ins go too; any check-in still being sent fails its final fence (noteCheckinStop).
    noteCheckinStop(user.id);
    const checkins = await (await petCheckinStoreFor(studio)).eraseUser(user.id);
    const erased = await pets.eraseUser(user.id);
    // Connections in both spaces, for every agent: best-effort, it never fails the forget (a vault entry may wait for the broker).
    const connections = await studio.forgetConnections(user.id);
    const body: MyDataForgetResponse = { erased, ...(choices ? { choicesErased: choices } : {}), ...(circles ? { circlesErased: circles } : {}), ...(notes ? { notesErased: notes } : {}),
      ...(played ? { playErased: played } : {}), ...(checkins ? { checkinsErased: checkins } : {}),
      ...(connections.erased ? { connectionsErased: connections.erased } : {}), ...(connections.pending ? { connectionsPending: connections.pending } : {}) };
    return json(body);
  } catch (error) {
    if (StudioRateLimitError.is(error)) return fail('rate_limited', 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (isSchemaValidationError(error)) return fail('invalid_request', 400);
    if (StudioError.is(error)) return fail(error.status === 413 ? 'too_large' : 'invalid_request', error.status === 413 ? 413 : 400);
    return fail('my_data_unavailable', 503);
  }
}
