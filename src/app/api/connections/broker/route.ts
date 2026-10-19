import { getStudio } from '@/lib/studio/runtime';
import { handleStudioBrokerControl } from '@/lib/connections/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return handleStudioBrokerControl(await getStudio(), request); }
  catch { return Response.json({ error: 'broker_control_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
