import { getStudio } from '@/lib/studio/runtime';
import { handleExperimentExposure } from '@/lib/studio/experiments-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await handleExperimentExposure(await getStudio(), request, process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'experiments_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
