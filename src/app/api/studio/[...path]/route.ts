/**
 * Vox Studio API. All routes live in src/lib/studio/http.ts.
 */

import { getStudio } from '@/lib/studio/runtime';
import { handleStudioRequest } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, { params }: RouteParams) {
  const { path } = await params;
  let studio;
  try {
    studio = await getStudio();
  } catch (error) {
    return Response.json({ error: `Vox Studio is not configured: ${(error as Error).message}` }, { status: 503 });
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
