import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyFirebaseProduction } from './firebase-production-verify.mjs';

const env = { STUDIO_SECRET: 'fixture-only-secret-with-more-than-32-characters', STUDIO_REVISION: 'a'.repeat(40) };
function harness(overrides = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    const path = url.pathname; calls.push({ path, options });
    if (path in overrides) return overrides[path]();
    if (path === '/api/studio/health') return Response.json({ status: 'healthy', revision: env.STUDIO_REVISION, transport: 'webhook', bots: true });
    if (path === '/api/studio/telegram/setup') return Response.json({ manager: true, agents: ['fixture-agent'], failed: [] });
    if (path === '/studio') return new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/api/studio/me') return Response.json({ error: 'Unauthorized' }, { status: 401 });
    return new Response(null, { status: 404 });
  };
  return { fetch, calls };
}

test('production verification registers webhooks and checks exact revision and route protections', async () => {
  const h = harness(); const result = await verifyFirebaseProduction(env, h.fetch);
  assert.equal(result.registeredAgentCount, 1); assert.equal(result.revision, env.STUDIO_REVISION);
  assert.equal(h.calls[0].path, '/api/studio/health');
  const setup = h.calls.find(call => call.path === '/api/studio/telegram/setup');
  assert.equal(setup.options.method, 'POST'); assert.equal(setup.options.headers.Authorization, `Bearer ${env.STUDIO_SECRET}`);
  assert.equal(h.calls.filter(call => call.path === '/api/studio/health').length, 2);
});

test('wrong revision or runtime fails before registering any webhook', async () => {
  for (const body of [{ status: 'healthy', revision: 'b'.repeat(40), transport: 'webhook', bots: true }, { status: 'healthy', revision: env.STUDIO_REVISION, transport: 'polling', bots: true }, { status: 'unhealthy', revision: env.STUDIO_REVISION }]) {
    const h = harness({ '/api/studio/health': () => Response.json(body) });
    await assert.rejects(verifyFirebaseProduction(env, h.fetch), /health/);
    assert.equal(h.calls.some(call => call.path.includes('/setup')), false);
  }
});

test('HTTP errors and partial bot registration fail without logging response bodies', async () => {
  for (const response of [() => new Response('sensitive-response-must-not-appear', { status: 502 }), () => Response.json({ manager: false, agents: [], failed: [] }), () => Response.json({ manager: true, agents: [], failed: ['agent-id'] }), () => Response.json({ manager: true })]) {
    const h = harness({ '/api/studio/telegram/setup': response });
    await assert.rejects(verifyFirebaseProduction(env, h.fetch), error => !error.message.includes('sensitive-response-must-not-appear'));
  }
});

test('unauthenticated access, legacy exposure and missing Studio page fail deployment', async () => {
  for (const [path, response] of [['/api/studio/me', () => Response.json({ user: {} })], ['/api/chat/anything.png', () => Response.json({ exposed: true })], ['/studio', () => new Response(null, { status: 503 })]]) {
    await assert.rejects(verifyFirebaseProduction(env, harness({ [path]: response }).fetch));
  }
});
