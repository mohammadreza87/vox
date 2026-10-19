import test from 'node:test';
import assert from 'node:assert/strict';
import { relationshipInfra, verifyPrivateRules } from './firebase-relationship-infra.mjs';
const secret = 'a'.repeat(64);
const env = { FIREBASE_PROJECT_ID: 'vox-production', STUDIO_RELATIONSHIPS: 'live', STUDIO_RELATIONSHIP_WORKER_SECRET: secret, STUDIO_PUBLIC_URL: 'https://vox.example.com' };
const denied = [{ content: 'rules_version = "2"; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }' }];
function fixture({ rules = denied, missingIndex = false } = {}) {
  const calls = []; let state = 'PAUSED'; let published;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    let data = {};
    if (url.includes('cloudscheduler')) {
      if (url.endsWith(':pause')) state = 'PAUSED';
      else if (url.endsWith(':resume')) state = 'ENABLED';
      else if (method === 'POST' && url.endsWith('/jobs')) state = 'ENABLED';
      data = { state };
    } else if (url.includes('/documents/studio/state')) data = { fields: { json: { stringValue: JSON.stringify({ members: [{ role: 'owner', telegramId: 777 }, { role: 'member' }] }) } } };
    else if (url.includes('/releases/')) data = { rulesetName: 'projects/vox-production/rulesets/rules-1' };
    else if (url.includes('/rulesets/')) data = { source: { files: rules } };
    else if (url.includes('/fields/')) { const field = url.split('/').at(-1); data = { name: 'field', ttlConfig: { state: 'ACTIVE' }, indexConfig: { indexes: missingIndex ? [] : [{ state: 'READY', queryScope: 'COLLECTION', fields: [{ fieldPath: field, order: field === 'at' ? 'DESCENDING' : 'ASCENDING' }] }] } }; }
    return Response.json(data);
  };
  return { calls, options: { token: 'fixture-token', fetchImpl, sleep: async () => {}, publishSecret: value => { published = value; } }, published: () => published };
}
test('reuses secret and provisions only named paused worker with bounded payload', async () => {
  const f = fixture(); const report = await relationshipInfra('prepare', env, f.options);
  assert.equal(f.published(), secret); assert.deepEqual(report.roleCounts, { owner: 1, superadmin: 0 });
  assert.equal(JSON.stringify(report).includes('777'), false);
  assert.equal(f.calls.some(c => c.url.includes(':addVersion')), false);
  const patch = f.calls.find(c => c.method === 'PATCH' && c.url.includes('cloudscheduler'));
  assert.equal(patch.body.name, 'projects/vox-production/locations/us-central1/jobs/vox-relationship-worker');
  assert.equal(patch.body.schedule, '* * * * *'); assert.equal(patch.body.attemptDeadline, '60s');
  assert.deepEqual(patch.body.retryConfig, { retryCount: 0, maxRetryDuration: '0s' });
  assert.equal(Buffer.from(patch.body.httpTarget.body, 'base64').toString(), '{"limit":2}');
  assert.equal(report.scheduler, 'paused');
});
test('derives stable purpose-separated secret without secret-manager API', async () => {
  const f = fixture(); const result = await relationshipInfra('prepare', { ...env, STUDIO_RELATIONSHIP_WORKER_SECRET: undefined, STUDIO_SECRET: 'parent'.repeat(10) }, f.options);
  assert.match(f.published(), /^[a-f0-9]{64}$/);
  assert.notEqual(f.published(), 'parent'.repeat(10));
  assert.equal(f.calls.some(c => c.url.includes('secretmanager')), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test('off has no mutation when job already paused and no other API access', async () => {
  const f = fixture(); await relationshipInfra('prepare', { ...env, STUDIO_RELATIONSHIPS: 'off' }, f.options);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
});
test('invalid origin fails before transport', async () => {
  const f = fixture(); await assert.rejects(relationshipInfra('prepare', { ...env, STUDIO_PUBLIC_URL: 'http://localhost:3000' }, f.options), /HTTPS/); assert.equal(f.calls.length, 0);
});
test('unknown/permissive rules fail closed before secret, TTL or job mutation', async () => {
  const f = fixture({ rules: [{ content: denied[0].content.replace('if false', 'if request.auth != null') }] });
  await assert.rejects(relationshipInfra('prepare', env, f.options), /client access/);
  assert.equal(f.calls.some(c => c.method !== 'GET'), false);
  assert.throws(() => verifyPrivateRules([{ content: 'unknown' }]), /Unknown/);
});
test('missing single field index fails without silently modifying index config', async () => {
  const f = fixture({ missingIndex: true }); await assert.rejects(relationshipInfra('prepare', env, f.options), /single-field index/);
  assert.equal(f.calls.some(c => c.method === 'PATCH'), false);
});
test('API errors exclude response body and credential', async () => {
  await assert.rejects(relationshipInfra('pause', env, { token: secret, fetchImpl: async () => new Response(secret, { status: 403 }) }), e => !e.message.includes(secret) && /403/.test(e.message));
});
test('activate verifies revision, actual pilot config and current scheduler attempt', async () => {
  const revision = 'a'.repeat(40); const calls = []; let attempt = false; let time = 1000;
  const config = { mode: 'live', roles: ['owner', 'superadmin'], allAgents: true, explicitAgentCount: 0, explicitPersonCount: 0 };
  const result = await relationshipInfra('activate', { ...env, STUDIO_REVISION: revision, STUDIO_RELATIONSHIP_AGENTS: '*', STUDIO_RELATIONSHIP_ROLES: 'owner,superadmin' }, { token: 'test', now: () => time, sleep: async ms => { time += ms; }, fetchImpl: async (url, options = {}) => {
    calls.push(url);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', revision });
    if (url.endsWith('/drain')) { assert.equal(options.body, '{"limit":2}'); return Response.json({ result: { claimed: 0, sent: 0, deferred: 0, closed: 0, suppressed: 0, failed: 0, shadow: 0 }, configuration: config }); }
    if (url.endsWith(':run')) attempt = true;
    return Response.json(attempt ? { lastAttemptTime: new Date(2000).toISOString(), status: {} } : { state: 'PAUSED' });
  } });
  assert.equal(result.scheduler, 'verified-success'); assert.equal(calls.some(url => url.endsWith(':resume')), true);
});
test('activate wrong pilot fails before resume', async () => {
  const revision = 'a'.repeat(40); const calls = [];
  await assert.rejects(relationshipInfra('activate', { ...env, STUDIO_REVISION: revision }, { token: 'test', fetchImpl: async url => {
    calls.push(url);
    return Response.json(url.endsWith('/health') ? { status: 'healthy', revision } : { result: { claimed: 0, sent: 0, deferred: 0, closed: 0, suppressed: 0, failed: 0, shadow: 0 }, configuration: { mode: 'off' } });
  } }), /pilot/);
  assert.equal(calls.some(url => url.endsWith(':resume')), false);
});
test('missing Studio directory reports zero roles pending first login', async () => {
  const f = fixture(); const transport = f.options.fetchImpl;
  f.options.fetchImpl = async (url, options) => url.includes('/documents/studio/state') ? new Response('{}', { status: 404 }) : transport(url, options);
  const result = await relationshipInfra('prepare', env, f.options);
  assert.equal(result.directory, 'not-yet-initialized'); assert.deepEqual(result.roleCounts, { owner: 0, superadmin: 0 });
});
test('off activate does not require revision or runtime and shadow activate stays paused', async () => {
  for (const mode of ['off', 'shadow']) {
    const f = fixture(); const result = await relationshipInfra('activate', { ...env, STUDIO_RELATIONSHIPS: mode }, f.options);
    assert.equal(result.mode, mode); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
  }
});
test('shadow prepare qualifies storage and packages credential but never runs scheduler', async () => {
  const f = fixture(); const result = await relationshipInfra('prepare', { ...env, STUDIO_RELATIONSHIPS: 'shadow' }, f.options);
  assert.equal(result.mode, 'shadow'); assert.equal(result.scheduler, 'paused'); assert.equal(f.published(), secret);
  assert.equal(f.calls.some(c => /:(?:resume|run)$/.test(c.url)), false);
});
test('invalid mode fails before any request', async () => {
  const f = fixture(); await assert.rejects(relationshipInfra('prepare', { ...env, STUDIO_RELATIONSHIPS: 'invalid' }, f.options), /Invalid relationship mode/); assert.equal(f.calls.length, 0);
});
test('off tolerates only explicit Scheduler SERVICE_DISABLED not IAM denial', async () => {
  const disabled = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', metadata: { service: 'cloudscheduler.googleapis.com' } }] } };
  const off = { ...env, STUDIO_RELATIONSHIPS: 'off' };
  const result = await relationshipInfra('activate', off, { fetchImpl: async () => Response.json(disabled, { status: 403 }) });
  assert.equal(result.scheduler, 'paused-or-absent');
  await assert.rejects(relationshipInfra('prepare', off, { fetchImpl: async () => Response.json({ error: { details: [{ reason: 'IAM_PERMISSION_DENIED' }] } }, { status: 403 }) }), /403/);
});
test('activation ignores previous attempt failure while current attempt is in progress', async () => {
  const revision = 'b'.repeat(40); let time = 1000; let running = false;
  const configuration = { mode: 'live', roles: [], allAgents: false, explicitAgentCount: 0, explicitPersonCount: 0 };
  const report = { claimed: 0, sent: 0, deferred: 0, closed: 0, suppressed: 0, failed: 0, shadow: 0 };
  const result = await relationshipInfra('activate', { ...env, STUDIO_REVISION: revision }, { now: () => time, sleep: async ms => { time += ms; }, fetchImpl: async url => {
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', revision });
    if (url.endsWith('/drain')) return Response.json({ result: report, configuration });
    if (url.endsWith(':run')) running = true;
    return Response.json(running ? { lastAttemptTime: new Date(2000).toISOString(), status: time < 66000 ? { code: 13 } : {} } : { state: 'PAUSED' });
  } });
  assert.equal(result.scheduler, 'verified-success');
});
