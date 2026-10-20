import { getStudio } from '@/lib/studio/runtime';
import { handleRightsRequest } from '@/lib/studio/rights-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try { return await handleRightsRequest(await getStudio(), request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'rights_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
