import { getStudio } from '@/lib/studio/runtime';
import { getConnectionsApplication } from '@/lib/connections/runtime';
import { handleAgentConnectionsRequest } from '@/lib/connections/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ agentId: string; path?: string[] }> }) {
  try {
    const studio = await getStudio();
    const { agentId, path } = await params;
    return handleAgentConnectionsRequest(studio, (actor, space) => getConnectionsApplication(studio, actor, space), request, agentId, path ?? []);
  } catch { return Response.json({ error: 'connections_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
