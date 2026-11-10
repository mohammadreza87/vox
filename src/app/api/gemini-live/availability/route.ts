import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/middleware';
import { canUseGeminiLive } from '@/features/call/lib/gemini-access.mjs';

async function handler(request: AuthenticatedRequest) {
  const enabled = process.env.VOX_WEB_CALLS_ONLY === '1' &&
    process.env.NEXT_PUBLIC_VOX_GEMINI_LIVE === '1' &&
    Boolean(process.env.NEXT_PUBLIC_VOX_GEMINI_LIVE_SOCKET) &&
    canUseGeminiLive(request.user);
  return NextResponse.json({ enabled }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withAuth(handler);
