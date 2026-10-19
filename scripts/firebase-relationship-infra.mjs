#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionOrigin } from './firebase-production-env.mjs';

// Deliberately supports only a globally client-denied ruleset. More permissive
// projects require a separate reviewed rules proof; this script never edits rules.
export function verifyPrivateRules(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Firestore rules proof unavailable');
  const source = files.map(f => f.content || '').join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (!/service\s+cloud\.firestore\s*\{/.test(source) || !/match\s+\/databases\/\{[^}]+\}\/documents\s*\{/.test(source)) throw new Error('Unknown Firestore rules; manual review required');
  const remainder = source.replace(/\ballow\s+(?:read|write|get|list|create|update|delete)(?:\s*,\s*(?:read|write|get|list|create|update|delete))*\s*:\s*if\s+false\s*;/g, '');
  if (/\ballow\b/.test(remainder)) throw new Error('Firestore client access may expose private collections; manual review required');
}

export async function relationshipInfra(phase, env, { fetchImpl = fetch, token, publishSecret = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  if (!['prepare', 'activate', 'pause'].includes(phase)) throw new Error('Expected prepare, activate or pause');
  const mode = env.STUDIO_RELATIONSHIPS || 'off';
  if (!['off', 'shadow', 'live'].includes(mode)) throw new Error('Invalid relationship mode');
  const project = env.FIREBASE_PROJECT_ID;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '')) throw new Error('Invalid FIREBASE_PROJECT_ID');
  const jobName = `projects/${project}/locations/us-central1/jobs/vox-relationship-worker`;
  const scheduler = `https://cloudscheduler.googleapis.com/v1/${jobName}`;
  const api = async (url, method = 'GET', body, optional = false) => {
    let response;
    try { response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(65_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error(`Infrastructure ${method} request failed (${new URL(url).hostname})`); }
    if (optional && response.status === 404) return null;
    if (optional && mode === 'off' && response.status === 403 && url === scheduler && method === 'GET') {
      let details; try { details = (await response.json()).error?.details; } catch { /* fail closed below */ }
      if (Array.isArray(details) && details.some(d => d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && d.reason === 'SERVICE_DISABLED' && d.metadata?.service === 'cloudscheduler.googleapis.com')) return null;
    }
    if (!response.ok) throw new Error(`Infrastructure ${method} failed HTTP ${response.status} (${new URL(url).hostname}); verify enabled API and IAM`);
    try { return response.status === 204 ? {} : await response.json(); } catch { throw new Error('Infrastructure returned invalid JSON'); }
  };
  const pause = async () => {
    const job = await api(scheduler, 'GET', undefined, true);
    if (job?.state === 'ENABLED') await api(`${scheduler}:pause`, 'POST', {});
    else if (job && job.state !== 'PAUSED') throw new Error('Scheduler state cannot be safely paused');
    return job;
  };
  if (phase === 'pause' || mode === 'off' || (phase === 'activate' && mode === 'shadow')) {
    await pause(); return { phase, mode, scheduler: 'paused-or-absent' };
  }
  const origin = productionOrigin(env.STUDIO_PUBLIC_URL);
  // Stable purpose-separated credential; rotating STUDIO_SECRET rotates this
  // fallback too. A separately supplied worker credential takes precedence.
  const parentSecret = env.STUDIO_SECRET || '';
  const secret = env.STUDIO_RELATIONSHIP_WORKER_SECRET || (parentSecret.length >= 32 ? createHmac('sha256', parentSecret).update('vox:relationship-worker:v1').digest('hex') : '');
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error('Valid worker secret or 32+ character STUDIO_SECRET required');
  const publicRequest = async (path, options = {}) => {
    try { return await fetchImpl(`${origin}${path}`, { redirect: 'error', signal: AbortSignal.timeout(65_000), ...options }); }
    catch { throw new Error('Relationship runtime verification request failed'); }
  };
  if (phase === 'activate') {
    if (!/^[a-f0-9]{40}$/i.test(env.STUDIO_REVISION || '')) throw new Error('Exact STUDIO_REVISION required');
    let health; const h = await publicRequest('/api/studio/health');
    try { health = await h.json(); } catch { throw new Error('Invalid health response'); }
    if (!h.ok || health.status !== 'healthy' || health.revision !== env.STUDIO_REVISION) throw new Error('Production revision does not match candidate');
    const drain = await publicRequest('/api/studio/relationships/drain', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: '{"limit":2}' });
    let result; try { result = await drain.json(); } catch { throw new Error('Invalid worker JSON'); }
    if (!drain.ok || !result || !['claimed', 'sent', 'deferred', 'closed', 'suppressed', 'failed', 'shadow'].every(k => Number.isSafeInteger(result.result?.[k]) && result.result[k] >= 0) || result.result.claimed > 2) throw new Error('Authenticated worker verification failed');
    const split = value => [...new Set((value || '').split(/[,\s]+/).filter(Boolean))];
    const agents = split(env.STUDIO_RELATIONSHIP_AGENTS);
    const expected = { mode: 'live', roles: split(env.STUDIO_RELATIONSHIP_ROLES).sort(), allAgents: agents.includes('*'), explicitAgentCount: agents.filter(id => id !== '*').length, explicitPersonCount: split(env.STUDIO_RELATIONSHIP_PEOPLE).length };
    const actual = result.configuration;
    if (!actual || actual.mode !== expected.mode || JSON.stringify([...(actual.roles || [])].sort()) !== JSON.stringify(expected.roles) || actual.allAgents !== expected.allAgents || actual.explicitAgentCount !== expected.explicitAgentCount || actual.explicitPersonCount !== expected.explicitPersonCount) throw new Error('Relationship runtime configuration does not match pilot');
    const existing = await api(scheduler);
    if (existing.state !== 'PAUSED') throw new Error('Scheduler must be paused before activation');
    const started = now();
    try {
      // Force-run while paused, then wait beyond the 60s attempt deadline so
      // lastAttemptTime cannot be paired with a previous attempt's status.
      await api(`${scheduler}:run`, 'POST', {});
      for (let i = 0; i < 24; i++) {
        const job = await api(scheduler);
        if (now() - started >= 65_000 && Date.parse(job.lastAttemptTime || '') >= started && job.status && !job.status.code) {
          await api(`${scheduler}:resume`, 'POST', {});
          return { phase, revision: env.STUDIO_REVISION, scheduler: 'verified-success' };
        }
        if (now() - started >= 65_000 && Date.parse(job.lastAttemptTime || '') >= started && job.status?.code) throw new Error('Scheduler attempt failed');
        await sleep(5000);
      }
      throw new Error('Scheduler successful execution unavailable within verification window');
    } catch (error) { await pause(); throw error; }
  }
  // Pause before any infrastructure change, leaving activation to exact-revision checks.
  const oldJob = await pause();
  const directory = await api(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/studio/state?mask.fieldPaths=json`, 'GET', undefined, true);
  let members;
  try { members = directory ? JSON.parse(directory.fields?.json?.stringValue).members : []; } catch { throw new Error('Studio role counts unavailable'); }
  if (!Array.isArray(members)) throw new Error('Studio role counts unavailable');
  const roleCounts = { owner: members.filter(m => m.role === 'owner').length, superadmin: members.filter(m => m.role === 'superadmin').length };
  const release = await api(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
  if (!new RegExp(`^projects/${project}/rulesets/[A-Za-z0-9-]+$`).test(release.rulesetName || '')) throw new Error('Invalid Firestore ruleset reference');
  const rules = await api(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  verifyPrivateRules(rules.source?.files);
  const fieldUrl = (collection, field) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/${collection}/fields/${field}`;
  for (const [collection, field] of [['vox_relationships', 'nextDueAt'], ['vox_relationships', 'personaId'], ['vox_relationship_observations', 'at']]) {
    const config = await api(fieldUrl(collection, field));
    const indexes = config.indexConfig?.indexes || [];
    const directions = field === 'personaId' ? ['ASCENDING'] : field === 'at' ? ['DESCENDING'] : ['ASCENDING'];
    if (!directions.every(order => indexes.some(index => index.state === 'READY' && index.queryScope === 'COLLECTION' && index.fields?.some(f => f.fieldPath === field && f.order === order)))) throw new Error(`Required single-field index unavailable: ${collection}.${field}`);
  }
  for (const collection of ['vox_relationships', 'vox_relationship_observations']) {
    const url = fieldUrl(collection, 'expiresAt');
    let config = await api(url);
    if (config.ttlConfig?.state !== 'ACTIVE') {
      if (!config.ttlConfig || config.ttlConfig.state === 'STATE_UNSPECIFIED') await api(`${url}?updateMask=ttlConfig`, 'PATCH', { name: config.name, ttlConfig: {} });
      for (let i = 0; i < 24 && config.ttlConfig?.state !== 'ACTIVE'; i++) { await sleep(5000); config = await api(url); }
      if (config.ttlConfig?.state !== 'ACTIVE') throw new Error(`TTL not yet ACTIVE: ${collection}; rerun prepare after provisioning completes`);
    }
  }
  publishSecret(secret);
  const job = { name: jobName, description: 'Vox relationship worker; managed by firebase-relationship-infra', schedule: '* * * * *', timeZone: 'UTC', attemptDeadline: '60s', retryConfig: { retryCount: 0, maxRetryDuration: '0s' }, httpTarget: { uri: `${origin}/api/studio/relationships/drain`, httpMethod: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: Buffer.from('{"limit":2}').toString('base64') } };
  if (oldJob) await api(`${scheduler}?updateMask=description,schedule,timeZone,attemptDeadline,retryConfig,httpTarget`, 'PATCH', job);
  else {
    // Scheduler create has no atomic PAUSED option. First schedule 12 hours in
    // the future, pause it, then install the minute cadence while paused.
    const future = new Date(now() + 12 * 60 * 60 * 1000);
    await api(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/us-central1/jobs`, 'POST', { ...job, schedule: `${future.getUTCMinutes()} ${future.getUTCHours()} * * *` });
    await pause();
    await api(`${scheduler}?updateMask=schedule`, 'PATCH', { name: jobName, schedule: job.schedule });
  }
  const final = await api(scheduler);
  if (final.state !== 'PAUSED') throw new Error('Prepared scheduler is not paused');
  return { phase, mode, roleCounts, directory: directory ? 'present' : 'not-yet-initialized', scheduler: 'paused', rules: 'client-denied', ttl: 'active', indexes: 'ready' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { cert } = await import('firebase-admin/app');
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const credential = raw ? JSON.parse(raw) : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    let token;
    try { token = (await cert(credential).getAccessToken()).access_token; } catch { throw new Error('Service-account authentication failed; verify private credentials and cloud-platform access'); }
    const result = await relationshipInfra(process.argv[2], process.env, { token, publishSecret(secret) {
      console.log(`::add-mask::${secret}`);
      if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV required for private runtime packaging');
      appendFileSync(process.env.GITHUB_ENV, `STUDIO_RELATIONSHIP_WORKER_SECRET=${secret}\n`, { mode: 0o600 });
    } });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error instanceof SyntaxError ? 'Invalid private service-account configuration' : error.message); process.exitCode = 1; }
}
