/**
 * Vox Pet API (brief §3.8). All logic lives in src/lib/studio/pet-http.ts. The static `pet` segment
 * wins over the Studio `[...path]` catch-all.
 */
import { getStudio } from '@/lib/studio/runtime';
import { handlePetRequest } from '@/lib/studio/pet-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A talk turn may hear, think and speak; matches the Studio call route. */
export const maxDuration = 120;
async function handle(request: Request, { params }: { params: Promise<{ agentId: string; action?: string[] }> }) {
  // The manager token verifies only launches through its Main Mini App (Circles S4), and only when they name this agent.
  try { const { agentId, action } = await params; return await handlePetRequest(await getStudio(), request, agentId, action ?? [], process.env.VOXX_BOT_TOKEN ?? ''); }
  catch { return Response.json({ error: 'pet_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
