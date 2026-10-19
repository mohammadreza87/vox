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
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request, { params }: RouteParams) {
  const { key } = await params;
  let studio;
  try {
    studio = await getStudio();
  } catch (error) {
    console.error('[studio] webhook: not configured', (error as Error).message);
    return Response.json({ error: 'Vox Studio is not configured' }, { status: 503 });
  }

  if (key === 'setup') {
    if (!bearerMatches(request.headers.get('authorization'), studio.deps.secret)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const base = process.env.STUDIO_PUBLIC_URL;
    if (!base) return Response.json({ error: 'STUDIO_PUBLIC_URL is not set' }, { status: 400 });
    try {
      return Response.json(await registerWebhooks(studio, base));
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 502 });
    }
  }

  if (!isValidWebhookSecret(studio.deps.secret, key, request.headers.get('x-telegram-bot-api-secret-token'))) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  try {
    if (key === 'manager') await handleManagerUpdate(studio, update);
    else await handleAgentUpdate(studio, key, update);
  } catch (error) {
    // Answer 200 anyway: a Telegram retry storm can't fix a bug, and the
    // gateway's deduper already guards against double handling.
    console.error(`[studio] webhook ${key} failed:`, (error as Error).message);
  }
  return Response.json({ ok: true });
}
