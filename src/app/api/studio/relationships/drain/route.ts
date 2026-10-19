import { timingSafeEqual } from 'crypto';
import { getStudio } from '@/lib/studio/runtime';
import { boundedStudioRequest } from '@/lib/studio/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Auth is checked before runtime startup, storage access, or model/provider calls. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STUDIO_RELATIONSHIP_WORKER_SECRET ?? '';
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  const headers = { 'Cache-Control': 'no-store' };
  if (secret.length < 32 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  let limit = 2;
  try {
    const bounded = await boundedStudioRequest(request, 1024);
    const text = await bounded.text();
    if (text) {
      const body = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'limit') ||
        (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 5))) throw new Error('invalid');
      limit = body.limit ?? limit;
    }
  } catch { return Response.json({ error: 'Invalid worker request' }, { status: 400, headers }); }
  try {
    const studio = await getStudio();
    return Response.json({ result: await studio.drainRelationships(limit) }, { headers });
  } catch { return Response.json({ error: 'Relationship worker unavailable' }, { status: 503, headers }); }
}
