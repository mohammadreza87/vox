/**
 * Pet check-ins trigger (design §5, open decision 2): src/lib/studio/pet-checkins/trigger.ts. The static `checkins`
 * segment wins over `[agentId]`. 404 unless STUDIO_PET_CHECKINS_TRIGGER_SECRET is set; nothing is sent unless
 * STUDIO_PET_CHECKINS=on.
 */
import { getStudio } from '@/lib/studio/runtime';
import { handleCheckinTrigger } from '@/lib/studio/pet-checkins/trigger';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One bounded run: the per-run deadline is at most 120 s. */
export const maxDuration = 150;
export async function POST(request: Request) {
  return handleCheckinTrigger(request, getStudio);
}
