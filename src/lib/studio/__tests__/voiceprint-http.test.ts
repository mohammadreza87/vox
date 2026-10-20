import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest, type RouterOptions } from '../http';
import { ID, makeStudio, seedOrg, type Harness } from './helpers';
import { setupVoiceprints } from './voiceprint-fixtures';

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
let h: Harness;
let consume: ReturnType<typeof vi.fn>;
const originalBlob = globalThis.Blob;
// jsdom replaces Blob; the route runs on Node, where FormData files are Node Blobs (as in http.test.ts).
afterEach(() => { globalThis.Blob = originalBlob; });

beforeEach(async () => {
  h = makeStudio();
  await seedOrg(h);
  consume = vi.fn(async () => undefined);
  h.studio.deps.rateLimiter = { consume };
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
});

function request(method: string, path: string, options: { as?: number; fields?: Record<string, string>; audio?: string } = {}) {
  const headers: Record<string, string> = { 'x-telegram-init-data': signInitData({ id: options.as ?? ID.alice, first_name: 'U' }, BOT_TOKEN) };
  let body: string | undefined;
  if (options.fields || options.audio !== undefined) {
    const boundary = '----voxvoiceprint';
    headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    const parts = Object.entries(options.fields ?? {}).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    if (options.audio !== undefined) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="sample.webm"\r\nContent-Type: audio/webm\r\n\r\n${options.audio}\r\n`);
    body = `${parts.join('')}--${boundary}--\r\n`;
  }
  return new Request(`http://localhost/api/studio/${path}`, { method, headers, body });
}
async function call(r: Request) {
  const path = new URL(r.url).pathname.replace('/api/studio/', '').split('/').filter(Boolean);
  const res = await handleStudioRequest(h.studio, r, path, opts);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const scopes = () => consume.mock.calls.map(c => c[0]);

describe('voice-enroll routes', () => {
  it('require the explicit statement, then enroll and return status without template or consent id', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    const refused = await call(request('POST', 'voice-enroll', { fields: { space: 'work' }, audio: 'SPEAKER:alice|sample' }));
    expect(refused).toEqual({ status: 400, json: { error: 'Confirm the explicit consent statement first.' } });
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    const enrolled = await call(request('POST', 'voice-enroll', { fields: { space: 'work', statement: 'enroll_my_voice' }, audio: 'SPEAKER:alice|sample' }));
    expect(enrolled.status).toBe(200);
    expect(enrolled.json).toMatchObject({ space: 'work', enrolled: true, available: true, channel: 'mini_app' });
    expect(enrolled.json).not.toHaveProperty('template');
    expect(enrolled.json).not.toHaveProperty('consentEventId');
    expect(JSON.stringify(enrolled.json)).not.toContain('vpk1.');
    expect(scopes()).toContain('expensive');
    expect(scopes()).toContain('call');
    expect(consume).toHaveBeenCalledWith('call', ID.alice);
    expect((await s.store.get(`tg-${ID.alice}`, 'work'))?.channel).toBe('mini_app');
  });

  it('reads and deletes with ?space= and rejects an invalid space', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    await s.enroll();
    expect(await call(request('GET', 'voice-enroll?space=work'))).toMatchObject({ status: 200, json: { space: 'work', enrolled: true } });
    expect(await call(request('GET', 'voice-enroll?space=elsewhere'))).toEqual({ status: 400, json: { error: 'Choose Work or Personal.' } });
    expect(await call(request('DELETE', 'voice-enroll?space=personal'))).toMatchObject({ status: 200, json: { space: 'personal', enrolled: false } });
    expect(await s.store.get(`tg-${ID.alice}`, 'work')).not.toBeNull();
    expect(await call(request('DELETE', 'voice-enroll?space=work'))).toMatchObject({ status: 200, json: { space: 'work', enrolled: false } });
    expect(await s.store.get(`tg-${ID.alice}`, 'work')).toBeNull();
    expect(await call(request('DELETE', 'voice-enroll?space=bogus'))).toMatchObject({ status: 400 });
    expect(scopes()).not.toContain('expensive');
  });

  it('maps a refused enrollment to a fixed message', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice, consent: false });
    h.studio.deps.voiceprints = s.service;
    expect(await call(request('POST', 'voice-enroll', { fields: { statement: 'enroll_my_voice' }, audio: 'SPEAKER:alice|x' })))
      .toEqual({ status: 403, json: { error: 'Turn on Voice recognition in Privacy first.' } });
    s.estimator.set({ netMs: 1_000, grossMs: 2_000 });
    await s.changeConsent();
    expect(await call(request('POST', 'voice-enroll', { fields: { statement: 'enroll_my_voice' }, audio: 'SPEAKER:alice|x' })))
      .toEqual({ status: 422, json: { error: 'Record at least 10 seconds of your own speech.' } });
  });

  it('returns the base 404 without voiceprints and consumes no expensive or call limit', async () => {
    expect(h.studio.deps.voiceprints).toBeUndefined();
    for (const r of [request('GET', 'voice-enroll?space=work'), request('DELETE', 'voice-enroll?space=work'),
      request('POST', 'voice-enroll', { fields: { statement: 'enroll_my_voice' }, audio: 'SPEAKER:alice|x' })]) {
      expect(await call(r)).toEqual({ status: 404, json: { error: 'Not found' } });
    }
    expect(scopes()).not.toContain('expensive');
    expect(scopes()).not.toContain('call');
  });

  it('a pending member gets the existing 403', async () => {
    const s = await setupVoiceprints({ telegramId: ID.pending });
    h.studio.deps.voiceprints = s.service;
    expect(await call(request('GET', 'voice-enroll?space=work', { as: ID.pending })))
      .toEqual({ status: 403, json: { error: 'Waiting for an admin to approve you.' } });
    expect(await call(request('POST', 'voice-enroll', { as: ID.pending, fields: { statement: 'enroll_my_voice' }, audio: 'x' }))).toMatchObject({ status: 403 });
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
  });
});
