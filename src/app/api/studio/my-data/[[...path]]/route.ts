/**
 * The person's own data in Vox (export, erase, notes): src/lib/studio/my-data-http.ts. VoxxBot-signed only. The static
 * `my-data` segment wins over the Studio `[...path]` catch-all.
 */
import { getStudio } from '@/lib/studio/runtime';
import { handleMyDataRequest } from '@/lib/studio/my-data-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try { return await handleMyDataRequest(await getStudio(), request, (await params).path ?? [], process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'my_data_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
