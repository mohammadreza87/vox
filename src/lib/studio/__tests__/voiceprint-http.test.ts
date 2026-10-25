import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest, type RouterOptions } from '../http';
import { StudioRateLimitError, type StudioRequestRateLimiter } from '../ratelimit';
import { ID, makeStudio, seedOrg, type Harness } from './helpers';
import { setupVoiceprints } from './voiceprint-fixtures';

const BOT_TOKEN = '555:voxx-test-token';
const opts: RouterOptions = { botToken: BOT_TOKEN, devUser: null };
let h: Harness;
let consume: Mock<StudioRequestRateLimiter['consume']>;
const originalBlob = globalThis.Blob;
// jsdom replaces Blob; the route runs on Node, where FormData files are Node Blobs (as in http.test.ts).
afterEach(() => { globalThis.Blob = originalBlob; });

beforeEach(async () => {
  h = makeStudio();
  await seedOrg(h);
  consume = vi.fn<StudioRequestRateLimiter['consume']>(async () => undefined);
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
const SAMPLE = 'AUDIO_CANARY_http|opus';

describe('voice-enroll routes', { timeout: 30_000 }, () => {
  it('validate the statement, audio and space before any provider call', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    expect(await call(request('POST', 'voice-enroll', { fields: { space: 'work' }, audio: SAMPLE })))
      .toEqual({ status: 400, json: { error: 'Explicit consent statement required.' } });
    expect(await call(request('POST', 'voice-enroll', { fields: { space: 'work', statement: 'accepted' } })))
      .toEqual({ status: 400, json: { error: 'Expected audio' } });
    expect(await call(request('POST', 'voice-enroll', { fields: { space: 'x', statement: 'accepted' }, audio: SAMPLE })))
      .toEqual({ status: 400, json: { error: 'Choose Work or Personal.' } });
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
  });

  it('with the flag unset POST is 404', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice, flag: false });
    h.studio.deps.voiceprints = s.service;
    expect(await call(request('POST', 'voice-enroll', { fields: { space: 'work', statement: 'accepted' }, audio: SAMPLE })))
      .toEqual({ status: 404, json: { error: 'Voice recognition is not available.' } });
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
  });

  it('enrolls on the happy path, returns {voiceprint} without template, and consumes the expensive and call limiters', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    const enrolled = await call(request('POST', 'voice-enroll', { fields: { space: 'work', statement: 'accepted' }, audio: SAMPLE }));
    expect(enrolled.status).toBe(200);
    expect(enrolled.json.voiceprint).toMatchObject({ space: 'work', enrolled: true, available: true, consent: 'granted', channel: 'mini_app' });
    expect(JSON.stringify(enrolled.json)).not.toMatch(/template|consentEventId|vp1\./);
    expect(scopes()).toEqual(expect.arrayContaining(['mutation', 'expensive', 'call']));
    expect(consume).toHaveBeenCalledWith('call', ID.alice);
    expect(consume).toHaveBeenCalledWith('expensive', ID.alice);
    expect(s.speech.measure.mock.calls[0][1]).toBe('audio/webm');
  });

  it('a refused enrollment maps to a fixed message', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice, consent: false });
    h.studio.deps.voiceprints = s.service;
    expect(await call(request('POST', 'voice-enroll', { fields: { statement: 'accepted' }, audio: SAMPLE })))
      .toEqual({ status: 403, json: { error: 'Turn on Voice recognition in Privacy and memory first.' } });
    await s.consent();
    s.speech.result = { netSpeechMs: 1_000, speakers: 1 };
    expect(await call(request('POST', 'voice-enroll', { fields: { statement: 'accepted' }, audio: SAMPLE })))
      .toEqual({ status: 422, json: { error: 'Record at least 10 seconds of your own speech.' } });
  });

  it('an exhausted call limiter answers 429 before the provider', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    consume.mockImplementation(async (scope: string) => { if (scope === 'call') throw new StudioRateLimitError(30); });
    const res = await call(request('POST', 'voice-enroll', { fields: { statement: 'accepted' }, audio: SAMPLE }));
    expect(res.status).toBe(429);
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
  });

  it('GET returns the status and DELETE deletes, per space; an invalid space is 400', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    await s.enroll();
    expect(await call(request('GET', 'voice-enroll?space=work'))).toMatchObject({ status: 200, json: { voiceprint: { space: 'work', enrolled: true } } });
    expect(await call(request('GET', 'voice-enroll?space=elsewhere'))).toEqual({ status: 400, json: { error: 'Choose Work or Personal.' } });
    expect(await call(request('DELETE', 'voice-enroll?space=personal'))).toMatchObject({ status: 200, json: { voiceprint: { space: 'personal', enrolled: false } } });
    expect(await s.store.get(`tg-${ID.alice}`, 'work')).not.toBeNull();
    expect(await call(request('DELETE', 'voice-enroll'))).toMatchObject({ status: 200, json: { voiceprint: { space: 'work', enrolled: false } } });
    expect(await s.store.get(`tg-${ID.alice}`, 'work')).toBeNull();
    expect(scopes()).not.toContain('expensive');
  });

  it('a member can only affect their own row: there is no id path and other methods are 404', async () => {
    const s = await setupVoiceprints({ telegramId: ID.alice });
    h.studio.deps.voiceprints = s.service;
    await s.enroll();
    expect(await call(request('DELETE', `voice-enroll/${ID.alice}`, { as: ID.bob }))).toEqual({ status: 404, json: { error: 'Not found' } });
    expect(await call(request('DELETE', 'voice-enroll?space=work', { as: ID.bob }))).toMatchObject({ status: 200, json: { voiceprint: { enrolled: false } } });
    expect(await s.store.get(`tg-${ID.alice}`, 'work')).not.toBeNull();
    expect(await call(request('PUT', 'voice-enroll'))).toEqual({ status: 404, json: { error: 'Not found' } });
  });

  it('without voiceprints wired the route is the base 404 and consumes no expensive or call limit', async () => {
    expect(h.studio.deps.voiceprints).toBeUndefined();
    for (const r of [request('GET', 'voice-enroll?space=work'), request('DELETE', 'voice-enroll?space=work'),
      request('POST', 'voice-enroll', { fields: { statement: 'accepted' }, audio: SAMPLE })]) {
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
    expect(await call(request('POST', 'voice-enroll', { as: ID.pending, fields: { statement: 'accepted' }, audio: SAMPLE }))).toMatchObject({ status: 403 });
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
  });
});
