#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionOrigin } from './firebase-production-env.mjs';

export async function verifyFirebaseProduction(env, fetchImpl = fetch) {
  const origin = productionOrigin(env.STUDIO_PUBLIC_URL || undefined);
  const revision = env.STUDIO_REVISION;
  if (!/^[a-f0-9]{40}$/i.test(revision || '')) throw new Error('STUDIO_REVISION must contain the full deployed Git commit SHA.');
  if (!env.STUDIO_SECRET || env.STUDIO_SECRET.length < 32) throw new Error('STUDIO_SECRET is required for webhook setup.');
  const request = async (path, options = {}) => {
    try {
      return await fetchImpl(new URL(path, origin), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(60_000), ...options });
    } catch { throw new Error(`Production request failed: ${path}`); }
  };
  const json = async (response, path) => {
    if (!response.ok) throw new Error(`Production request failed: ${path} (HTTP ${response.status})`);
    try { return await response.json(); } catch { throw new Error(`Production returned invalid JSON: ${path}`); }
  };
  const checkHealth = async () => {
    const path = '/api/studio/health';
    const body = await json(await request(path), path);
    if (body.status !== 'healthy' || body.revision !== revision || body.transport !== 'webhook' || body.bots !== true) throw new Error('Production health does not match the deployed webhook runtime and revision.');
  };
  // Verify the revision before changing Telegram webhook registrations.
  await checkHealth();
  const setupPath = '/api/studio/telegram/setup';
  const setup = await json(await request(setupPath, { method: 'POST', headers: { Authorization: `Bearer ${env.STUDIO_SECRET}` } }), setupPath);
  if (setup.manager !== true || !Array.isArray(setup.agents) || !Array.isArray(setup.failed) || setup.failed.length !== 0) {
    throw new Error('Production Telegram webhook setup did not register every bot successfully.');
  }
  await checkHealth();
  const studio = await request('/studio');
  if (studio.status !== 200 || !studio.headers.get('content-type')?.includes('text/html')) throw new Error('Production Studio page is unavailable.');
  const me = await request('/api/studio/me');
  if (me.status !== 401) throw new Error('Production Studio must reject unauthenticated sessions with HTTP 401.');
  for (const path of ['/app', '/login', '/api/chat', '/api/chat/anything.png', '/api/tts', '/_next/image?url=%2Ffavicon.ico&w=64&q=75']) {
    if ((await request(path)).status !== 404) throw new Error(`Legacy route is exposed in production: ${path}`);
  }
  return { origin, revision, registeredAgentCount: setup.agents.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyFirebaseProduction(process.env);
    console.log(`Production verified at ${result.origin}/studio for ${result.revision}; ${result.registeredAgentCount} agent webhooks registered.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
