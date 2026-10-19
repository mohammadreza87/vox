import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyFirebasePreview } from './firebase-preview-verify.mjs';

const preview = 'https://example--pr43-codex-test-abc.web.app';
const ok = (url) => url.pathname.endsWith('/drain')
  ? Response.json({ error: 'Unauthorized' }, { status: 401 })
  : new Response('<html>Preview</html>', { headers: { 'content-type': 'text/html' } });

test('preview probes public pages and worker rejection without credentials or webhook setup', async () => {
  const calls = [];
  const result = await verifyFirebasePreview(preview, async (url, options) => {
    calls.push({ url, options }); return ok(url);
  });
  assert.equal(result.checks.length, 3);
  assert.deepEqual(calls.map(({ url }) => url.pathname), ['/', '/studio', '/api/studio/relationships/drain']);
  const worker = calls[2].options;
  assert.equal(worker.method, 'POST'); assert.equal(worker.body, '{}');
  assert.equal(worker.headers.Authorization, undefined);
  assert.equal(worker.redirect, 'manual');
});

test('a green deployment with a failed runtime is rejected without exposing response bodies', async () => {
  await assert.rejects(verifyFirebasePreview(preview, async () => new Response('private stack details', { status: 500 })),
    error => /HTTP 500/.test(error.message) && !error.message.includes('private stack'));
});

test('redirects, wrong content, and an unprotected or proxy-blocked worker fail verification', async () => {
  for (const response of [new Response(null, { status: 302 }), new Response('not HTML')]) {
    await assert.rejects(verifyFirebasePreview(preview, async (url) => url.pathname === '/' ? response : ok(url)));
  }
  for (const response of [Response.json({ result: 'delivered' }), new Response('proxy rejected', { status: 401 }), Response.json({ error: 'other' }, { status: 401 })]) {
    await assert.rejects(verifyFirebasePreview(preview, async (url) => url.pathname.endsWith('/drain') ? response : ok(url)));
  }
});

test('invalid and production targets fail before making requests; network failures omit details', async () => {
  for (const value of [undefined, 'https://example.web.app', `${preview}/studio`, `${preview}?token=private`, `http://${new URL(preview).host}`, `https://user:secret@${new URL(preview).host}`]) {
    await assert.rejects(verifyFirebasePreview(value, async () => assert.fail('No request expected')), /preview origin/);
  }
  await assert.rejects(verifyFirebasePreview(preview, async () => { throw new Error('private transport detail'); }),
    error => /Preview request failed/.test(error.message) && !error.message.includes('private transport'));
});
