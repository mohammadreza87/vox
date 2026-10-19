/**
 * Telegram webhooks for Vox Studio in serverless mode (STUDIO_PUBLIC_URL set).
 *
 *   POST /api/studio/telegram/manager      VoxxBot updates
 *   POST /api/studio/telegram/<agentId>    an agent bot's updates
 *   POST /api/studio/telegram/setup        (Authorization: Bearer STUDIO_SECRET)
 *                                          points every bot at this deployment
 *
 * Each bot gets its own secret_token derived from STUDIO_SECRET, so a request
 * can only act as the bot it was registered for.
 */

import { getStudio } from '@/lib/studio/runtime';
import { boundedStudioRequest, MAX_STUDIO_JSON_BYTES } from '@/lib/studio/http';
import { StudioError } from '@/lib/studio/service';
import { handleAgentUpdate, handleManagerUpdate, isValidWebhookSecret, registerWebhooks } from '@/lib/studio/updates';
import type { TelegramUpdate } from '@/lib/tireh/telegram/client';
import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ key: string }>;
}

function bearerMatches(header: string | null, secret: string): boolean {
  const token = /^Bearer[ \t]+(.+)$/i.exec(header ?? '')?.[1];
  if (!token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request, { params }: RouteParams) {
  const { key } = await params;
  const secret = process.env.STUDIO_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: 'Vox Studio is not configured' }, { status: 503 });
  const authorized = key === 'setup'
    ? bearerMatches(request.headers.get('authorization'), secret)
    : isValidWebhookSecret(secret, key, request.headers.get('x-telegram-bot-api-secret-token'));
  if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let update: TelegramUpdate | undefined;
  try {
    const bounded = await boundedStudioRequest(request, MAX_STUDIO_JSON_BYTES);
    if (key !== 'setup') {
      const parsed: unknown = await bounded.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('update_id' in parsed) || !Number.isSafeInteger(parsed.update_id) || Number(parsed.update_id) < 0) {
        return Response.json({ error: 'Bad JSON' }, { status: 400 });
      }
      update = parsed as TelegramUpdate;
    }
  } catch (error) {
    if (StudioError.is(error) && error.status === 413) return Response.json({ error: 'Request body too large' }, { status: 413 });
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }

  let studio;
  try {
    studio = await getStudio();
  } catch {
    console.error('[studio] webhook: not configured');
    return Response.json({ error: 'Vox Studio is not configured' }, { status: 503 });
  }

  if (key === 'setup') {
    const base = process.env.STUDIO_PUBLIC_URL;
    if (!base) return Response.json({ error: 'Vox Studio is not configured' }, { status: 400 });
    try {
      const result = await registerWebhooks(studio, base);
      const complete = result.manager && result.failed.length === 0;
      return Response.json(result, { status: complete ? 200 : 502 });
    } catch {
      console.error('[studio] webhook setup failed');
      return Response.json({ error: 'Bot setup failed. Please try again.' }, { status: 502 });
    }
  }

  try {
    if (key === 'manager') await handleManagerUpdate(studio, update!);
    else await handleAgentUpdate(studio, key, update!);
  } catch {
    // Answer 200 anyway: a Telegram retry storm can't fix a bug, and the
    // gateway's deduper already guards against double handling.
    console.error(`[studio] webhook ${key} failed`);
  }
  return Response.json({ ok: true });
}
