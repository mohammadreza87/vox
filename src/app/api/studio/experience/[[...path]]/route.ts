import { getStudio } from '@/lib/studio/runtime';
import { handleExperienceRequest } from '@/lib/adaptive/runtime/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const studio = await getStudio();
    if (!studio.deps.experience) return Response.json({ error: 'experience_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return handleExperienceRequest(studio, studio.deps.experience, request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch {
    return Response.json({ error: 'experience_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const PUT = handle;
export const POST = handle;
