import { getStudio } from '@/lib/studio/runtime';
import { getConnectionsApplication } from '@/lib/connections/runtime';
import { handleConnectionsRequest } from '@/lib/connections/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const studio = await getStudio();
    return handleConnectionsRequest(studio, (actor, space) => getConnectionsApplication(studio, actor, space), request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? '');
  } catch { return Response.json({ error: 'connections_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
