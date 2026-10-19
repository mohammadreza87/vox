import { getStudio } from '@/lib/studio/runtime';
import { handleLearningRequest } from '@/lib/studio/learning-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    return handleLearningRequest(await getStudio(), request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch { return Response.json({ error: 'learning_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
