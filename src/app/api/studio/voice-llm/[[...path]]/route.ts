/**
 * The custom LLM behind live voice calls: ElevenLabs posts OpenAI-style chat
 * completion requests here (any sub-path, e.g. /v1/chat/completions) and
 * speaks the streamed reply. See src/lib/studio/voice-call.ts.
 */

import { getStudio } from '@/lib/studio/runtime';
import { handleVoiceLlm } from '@/lib/studio/voice-call';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const studio = await getStudio().catch(() => null);
  if (!studio) return Response.json({ error: { message: 'Vox Studio is not configured' } }, { status: 503 });
  return handleVoiceLlm(studio, request);
}
