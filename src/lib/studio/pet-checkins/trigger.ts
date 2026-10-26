/**
 * `POST /api/studio/pet/checkins/run` (design §5, open decision 2): a scheduled HTTPS trigger (Cloud Scheduler) for
 * webhook deployments, which have no in-process scheduler. `Authorization: Bearer <STUDIO_PET_CHECKINS_TRIGGER_SECRET>`,
 * compared in constant time. With the secret unset (or shorter than 32 characters) the route does not exist: 404.
 * Optional JSON body `{ "maxSends"?: 1-200, "deadlineMs"?: 1000-120000 }`. Answers `{ result: CheckinRunReport }`;
 * with STUDIO_PET_CHECKINS off the report is `{ off: true, … }` and nothing is read or sent. Auth is checked before the
 * runtime starts or any store is read.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { boundedStudioRequest } from '../http';
import type { Studio } from '../service';
import { runPetCheckins, type CheckinRunOptions } from './run';

const headers = { 'Cache-Control': 'no-store' };
export const CHECKIN_TRIGGER_MIN_SECRET = 32;

/** Constant-time: both sides hashed to the same length first. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const given = createHash('sha256').update(header ?? '').digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected) && (header ?? '') === `Bearer ${secret}`;
}

export async function handleCheckinTrigger(request: Request, studio: () => Promise<Studio>, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  const secret = env.STUDIO_PET_CHECKINS_TRIGGER_SECRET ?? '';
  if (secret.length < CHECKIN_TRIGGER_MIN_SECRET) return Response.json({ error: 'not_found' }, { status: 404, headers });
  if (request.method.toUpperCase() !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
  if (!bearerMatches(request.headers.get('authorization'), secret)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const options: CheckinRunOptions = {};
  try {
    const text = await (await boundedStudioRequest(request, 512)).text();
    if (text.trim()) {
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
      const b = body as Record<string, unknown>;
      if (Object.keys(b).some((k) => k !== 'maxSends' && k !== 'deadlineMs')) throw new Error('invalid');
      if (b.maxSends !== undefined) { if (!Number.isInteger(b.maxSends) || (b.maxSends as number) < 1 || (b.maxSends as number) > 200) throw new Error('invalid'); options.maxSends = b.maxSends as number; }
      if (b.deadlineMs !== undefined) { if (!Number.isInteger(b.deadlineMs) || (b.deadlineMs as number) < 1000 || (b.deadlineMs as number) > 120_000) throw new Error('invalid'); options.deadlineMs = b.deadlineMs as number; }
    }
  } catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers }); }
  try {
    return Response.json({ result: await runPetCheckins(await studio(), { ...options, signal: request.signal }) }, { headers });
  } catch { return Response.json({ error: 'checkins_unavailable' }, { status: 503, headers }); }
}
