import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/middleware';
import { checkRateLimitSecure, getApiRateLimiter, getRateLimitIdentifier } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

/** Generous for redials, small enough that one account cannot farm sessions. */
const SESSIONS_PER_MINUTE = 6;

/**
 * Legacy /app voice calls: a short-lived signed URL for the shared ElevenLabs
 * agent. Only a signed-in Firebase user may ask, within a per-account budget.
 * The URL itself is a bearer credential that ElevenLabs cannot bind to the
 * caller, so it is never logged; neither is anything the caller sent.
 * Studio live calls use /api/studio/voice-llm with a signed call token instead.
 */
async function handler(request: AuthenticatedRequest) {
  try {
    const limited = await checkRateLimitSecure(getApiRateLimiter(),
      `convai-session:${getRateLimitIdentifier(request, request.userId)}`, SESSIONS_PER_MINUTE, 60_000);
    if (!limited.success && limited.response) return limited.response;

    const body = (await request.json().catch(() => null)) as { contactName?: unknown; voiceId?: unknown } | null;
    if (typeof body?.contactName !== 'string' || !body.contactName.trim() || typeof body.voiceId !== 'string' || !body.voiceId.trim()) {
      return NextResponse.json({ error: 'contactName and voiceId are required' }, { status: 400 });
    }

    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!agentId) return NextResponse.json({ error: 'ElevenLabs agent not configured' }, { status: 500 });
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsKey) return NextResponse.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });

    const signedUrlResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': elevenLabsKey } },
    );
    if (!signedUrlResponse.ok) {
      logger.error({ status: signedUrlResponse.status }, '[ConvAI Session] Failed to get signed URL');
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
    const { signed_url: signedUrl } = (await signedUrlResponse.json()) as { signed_url?: unknown };
    if (typeof signedUrl !== 'string' || !signedUrl) return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });

    logger.info({ userId: request.userId }, '[ConvAI Session] Session created');
    return NextResponse.json({ signedUrl, overrides: {}, agentId });
  } catch {
    logger.error('[ConvAI Session] Error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const POST = withAuth(handler);
