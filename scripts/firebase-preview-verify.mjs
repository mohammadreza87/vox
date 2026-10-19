#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public preview smoke check. Never registers bots or sends authenticated work. */
export async function verifyFirebasePreview(value, fetchImpl = fetch) {
  let origin;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+--pr\d+-[a-z0-9-]+\.web\.app$/.test(url.hostname)) throw new Error();
    origin = url.origin;
  } catch { throw new Error('PREVIEW_URL must be a Firebase pull-request preview origin.'); }

  const checks = await Promise.all([
    ['/', 'GET'], ['/studio', 'GET'], ['/api/studio/relationships/drain', 'POST'],
  ].map(async ([path, method]) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {
        method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000),
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
      });
    } catch { throw new Error(`Preview request failed: ${method} ${path}`); }
    const expected = method === 'POST' ? 401 : 200;
    if (response.status !== expected) throw new Error(`Preview ${method} ${path}: HTTP ${response.status}, expected ${expected}.`);
    const contentType = response.headers.get('content-type') || '';
    if (method === 'POST') {
      let body;
      try { body = contentType.includes('application/json') ? await response.json() : null; } catch { body = null; }
      if (body?.error !== 'Unauthorized') throw new Error('Preview worker did not return its expected unauthorized response.');
    } else if (!contentType.includes('text/html')) throw new Error(`Preview ${path} did not return HTML.`);
    return { path, status: response.status };
  }));
  return { origin, checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyFirebasePreview(process.env.PREVIEW_URL);
    console.log(`Preview HTTP checks passed at ${result.origin}: landing and Studio pages load; worker rejects unauthenticated requests.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
