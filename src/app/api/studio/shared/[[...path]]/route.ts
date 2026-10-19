import { getStudio } from '@/lib/studio/runtime';
import { handleSharedRequest } from '@/lib/adaptive/shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const studio = await getStudio();
    // Parent runtime owns service construction; storage never enters StudioState.
    const shared = studio.deps.shared;
    if (!shared) return Response.json({ error: 'shared_memory_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return handleSharedRequest(studio, shared, request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch {
    return Response.json({ error: 'shared_memory_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
