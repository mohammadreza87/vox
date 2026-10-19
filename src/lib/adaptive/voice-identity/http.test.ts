import { describe, expect, it } from 'vitest';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import { handleVoiceIdentityRequest } from './http';
import { setupVoiceIdentity, scope } from './test-fixtures';
const TOKEN = '12345:synthetic-voice-test';
async function setup() {
  const fixture = await setupVoiceIdentity();
  const studio = { deps: {}, ensureMember: async (u: { id: number }) => ({ telegramId: u.id, role: 'member' }) } as unknown as Studio;
  const auth = signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN);
  const call = (path: string[], body?: unknown, options: { auth?: string; origin?: string; raw?: string; contentType?: string; query?: Record<string, string> } = {}) => {
    const headers = { 'x-telegram-init-data': options.auth ?? auth, origin: options.origin ?? 'https://vox.test', 'content-type': options.contentType ?? 'application/json' };
    const query = new URLSearchParams(options.query ?? scope).toString();
    const req = new Request(`https://vox.test/api/studio/voice-identity/${path.join('/')}?${query}`, { method: body !== undefined || options.raw !== undefined ? 'POST' : 'GET', headers,
      ...(body !== undefined || options.raw !== undefined ? { body: options.raw ?? JSON.stringify(body) } : {}) });
    return handleVoiceIdentityRequest(studio, fixture.service, req, path, TOKEN);
  };
  return { ...fixture, studio, call };
}
describe('voice identity authenticated HTTP synthetic integration', () => {
  it('runs disclosure, separate enrollment, scoped live sample, test hint and deletion over the real HTTP/service/storage path', async () => {
    const { call, consent } = await setup(); await consent();
    const first = await call([]); expect(first.headers.get('cache-control')).toBe('no-store');
    const read = await first.json();
    const presented = await (await call(['present'], { ...scope, expectedRevision: read.revision, locale: 'fa' })).json();
    expect(presented.notice.locale).toBe('fa'); expect(presented.notice.body).toContain('افشای');
    const accepted = await (await call(['enroll'], { ...scope, expectedRevision: presented.revision, receipt: presented.receipt, statement: 'enroll_my_voice', selfOnly: true })).json();
    const capture = await (await call(['begin'], { ...scope, expectedRevision: accepted.revision, mode: 'enroll', selfOnly: true })).json();
    const enrolled = await call(['sample'], undefined, { raw: 'synthetic-live-sample', contentType: 'audio/webm', query: { ...scope, captureId: capture.capture.id } });
    expect(enrolled.status).toBe(200); expect((await enrolled.json()).status.enrollment).toBe('enrolled');
    const snapshot = await (await call([])).json();
    const test = await (await call(['begin'], { ...scope, expectedRevision: snapshot.revision, mode: 'test', selfOnly: true })).json();
    const hint = await (await call(['sample'], undefined, { raw: 'synthetic-live-query', contentType: 'audio/webm', query: { ...scope, captureId: test.capture.id } })).json();
    expect(hint.hint).toEqual({ outcome: 'possible_self', identityChanged: false, authenticationRequired: true });
    const deleted = await (await call(['delete'], scope)).json(); expect(deleted).toMatchObject({ enrollment: 'none', deletion: 'online_completed' });
    expect((await call(['sample'], undefined, { raw: 'replayed-query', contentType: 'audio/webm', query: { ...scope, captureId: test.capture.id } })).status).toBe(403);
  });
  it('rejects unauthenticated/pending/cross-origin requests, arbitrary identity/candidate injection and sample bytes before eligible capture', async () => {
    const { call, studio, consent, provider } = await setup();
    expect((await call([], undefined, { auth: '' })).status).toBe(401);
    expect((await call([], undefined, { auth: 'telegramId=123' })).status).toBe(401);
    expect((await call(['present'], { ...scope, expectedRevision: 0, locale: 'en' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await call(['sample'], undefined, { raw: 'unconsented-audio', contentType: 'audio/webm', query: { ...scope, captureId: '33333333-3333-4333-8333-333333333333' } })).status).toBe(403);
    await consent();
    expect((await call(['present'], { ...scope, expectedRevision: 0, locale: 'en', personId: 'victim' })).status).toBe(400);
    expect((await call(['begin'], { ...scope, expectedRevision: 0, mode: 'test', selfOnly: true, candidates: ['victim'] })).status).toBe(400);
    expect((await call(['enroll'], { ...scope, expectedRevision: 0, receipt: '33333333-3333-4333-8333-333333333333', statement: 'enroll_my_voice', selfOnly: false })).status).toBe(400);
    studio.ensureMember = async () => ({ telegramId: 123, role: 'pending', name: 'Pending', joinedAt: '' });
    expect((await call([])).status).toBe(403); expect(provider.extract).not.toHaveBeenCalled();
  });
  it('bounds actual upload bytes and refuses unsupported audio formats before provider work', async () => {
    const { call, consent, intent, begin, provider } = await setup(); await consent(); await intent(); const capture = await begin();
    const query = { ...scope, captureId: capture.capture!.id };
    expect((await call(['sample'], undefined, { raw: 'x'.repeat(1_000_001), contentType: 'audio/webm', query })).status).toBe(413);
    expect((await call(['sample'], undefined, { raw: 'sample', contentType: 'video/mp4', query })).status).toBe(415);
    expect(provider.inspect).not.toHaveBeenCalled(); expect(provider.extract).not.toHaveBeenCalled();
  });
});
