import { getStudio } from '@/lib/studio/runtime';
import { handlePublicMcpClientMetadata } from '@/lib/connections/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return await handlePublicMcpClientMetadata(await getStudio()); }
  catch { return Response.json({ error: 'mcp_client_metadata_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
