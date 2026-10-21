import { getStudio } from '@/lib/studio/runtime';
import { handlePublicMcpCallback } from '@/lib/connections/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return await handlePublicMcpCallback(await getStudio(), request); }
  catch { return new Response('Return to your agent in Telegram and try connecting again.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } }); }
}
