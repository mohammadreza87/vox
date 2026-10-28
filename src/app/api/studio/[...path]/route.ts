/**
 * Vox Studio API. All routes live in src/lib/studio/http.ts.
 */

import { getStudio } from '@/lib/studio/runtime';
import { handleStudioRequest } from '@/lib/studio/http';
import { memoryAccountOperationalHealth } from '@/lib/studio/memory-account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Two parallel portraits plus the Telegram push; matches firebase.json timeoutSeconds. */
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, { params }: RouteParams) {
  const { path } = await params;
  const memoryAccountRequested=request.method==='GET'&&path.length===1&&path[0]==='health'&&request.headers.get('x-vox-memory-account-readiness')==='1';
  const memoryAccountUnavailable=memoryAccountRequested?{memoryAccount:{version:1 as const,state:'unavailable' as const}}:{};
  let studio;
  try {
    studio = await getStudio();
  } catch (error) {
    if(memoryAccountRequested)return Response.json({status:'unhealthy',...memoryAccountUnavailable},{status:503,headers:{'Cache-Control':'no-store'}});
    if (process.env.NODE_ENV === 'production') {
      return Response.json({ error: 'Vox Studio is unavailable.', status: 'unhealthy' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: `Vox Studio is not configured: ${(error as Error).message}` }, { status: 503 });
  }
  if (request.method === 'GET' && path.length === 1 && path[0] === 'health') {
    try {
      await studio.deps.store.read();
    } catch {
      return Response.json({ status: 'unhealthy',...memoryAccountUnavailable }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const transport = studio.deps.webhookBase ? 'webhook' : 'polling';
    const bots = transport === 'webhook' ? !!studio.deps.managerBot : (globalThis as unknown as { __voxBots?: boolean }).__voxBots === true;
    let ready = transport === 'webhook' ? bots : process.env.STUDIO_BOTS !== '1' || bots;
    try { studio.deps.fileRuntimeOwner?.assertCurrent(); } catch { return Response.json({ status: 'unhealthy',...memoryAccountUnavailable }, { status:503, headers:{'Cache-Control':'no-store'} }); }
    const memoryAccount=memoryAccountRequested?memoryAccountOperationalHealth(studio):undefined;
    if(memoryAccount?.state==='unavailable')ready=false;
    return Response.json({ status: ready ? 'healthy' : 'unhealthy', revision: process.env.STUDIO_REVISION ?? 'unknown', transport, bots, ...(memoryAccount?{memoryAccount}:{}) }, {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const devId = process.env.NODE_ENV !== 'production' ? Number(process.env.STUDIO_DEV_USER_ID) : NaN;
  return handleStudioRequest(studio, request, path, {
    botToken: process.env.VOXX_BOT_TOKEN ?? '',
    devUser: Number.isSafeInteger(devId) && devId > 0 ? { id: devId, first_name: process.env.STUDIO_DEV_USER_NAME ?? 'Dev' } : null,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
