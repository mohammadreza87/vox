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
  try { const { agentId, action } = await params; return await handlePetRequest(await getStudio(), request, agentId, action ?? []); }
  catch { return Response.json({ error: 'pet_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = handle;
export const POST = handle;
