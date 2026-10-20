import { getStudio } from '@/lib/studio/runtime';
import { handleProductPauseRequest } from '@/lib/studio/product-pause-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try { return await handleProductPauseRequest(await getStudio(), request, process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'product_pause_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
