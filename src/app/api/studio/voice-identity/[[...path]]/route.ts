import { getStudio } from '@/lib/studio/runtime';
import { handleVoiceIdentityRequest } from '@/lib/adaptive/voice-identity/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const studio = await getStudio();
    if (!studio.deps.voiceIdentity) return Response.json({ error: 'voice_identity_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return handleVoiceIdentityRequest(studio, studio.deps.voiceIdentity, request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch {
    return Response.json({ error: 'voice_identity_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
