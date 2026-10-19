import { getStudio } from '@/lib/studio/runtime';
import { handleAdaptiveRequest } from '@/lib/adaptive/persistence/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const studio = await getStudio();
    if (!studio.deps.adaptive) return Response.json({ error: 'adaptive_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return handleAdaptiveRequest(studio, studio.deps.adaptive, request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch {
    return Response.json({ error: 'adaptive_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
