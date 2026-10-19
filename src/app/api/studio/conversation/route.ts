import { getStudio } from '@/lib/studio/runtime';
import { handleConversationRequest } from '@/lib/studio/conversation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleConversationRequest(await getStudio(), request, process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'conversation_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
