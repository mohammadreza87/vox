/**
 * Telegram webhook for TIREH persona bots.
 * POST /api/tireh/telegram/{personaId}
 *
 * Fails closed: requests without the exact X-Telegram-Bot-Api-Secret-Token
 * are rejected, and a missing TIREH_WEBHOOK_SECRET disables the endpoint.
 * Processing errors still return 200 so Telegram does not retry forever;
 * retries that do arrive are de-duplicated by update_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPersonaGateway } from '@/lib/tireh/runtime';
import { logger } from '@/lib/logger';
import type { TelegramUpdate } from '@/lib/tireh/telegram/client';
import { isValidWebhookSecret } from '@/lib/tireh/telegram/webhook-auth';
import { logTelegramDiagnostic } from '@/lib/tireh/telegram/diagnostics';

interface RouteParams {
  params: Promise<{ personaId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const expected = process.env.TIREH_WEBHOOK_SECRET;
  if (!expected) {
    logTelegramDiagnostic(logger, 'persona_webhook_disabled');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  if (!isValidWebhookSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { personaId } = await params;

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof update?.update_id !== 'number') {
    return NextResponse.json({ error: 'Invalid update' }, { status: 400 });
  }

  try {
    const gateway = await getPersonaGateway();
    const result = await gateway.handleUpdate(personaId, update);
    if (result === 'unknown-persona') {
      return NextResponse.json({ error: 'Unknown persona' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, result });
  } catch {
    logTelegramDiagnostic(logger, 'persona_webhook_failed');
    return NextResponse.json({ ok: false });
  }
}
