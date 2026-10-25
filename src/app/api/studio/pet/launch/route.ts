/**
 * Circles S4: which agent a pet launch code names (src/lib/studio/pet-http.ts handlePetLaunch). The static
 * `launch` segment wins over `[agentId]`.
 */
import { getStudio } from '@/lib/studio/runtime';
import { handlePetLaunch } from '@/lib/studio/pet-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return await handlePetLaunch(await getStudio(), request, process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'pet_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
