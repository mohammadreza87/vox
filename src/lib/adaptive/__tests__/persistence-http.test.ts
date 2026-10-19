import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { handleAdaptiveRequest } from '../persistence/http';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const TOKEN = '12345:synthetic-test-bot-token';
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'vox-adaptive-http-')); directories.push(directory);
  const service = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)));
  const studio = { deps: {}, ensureMember: async (user: { id: number }) => ({ telegramId: user.id, role: 'member' }) } as unknown as Studio;
  const auth = signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN);
  function request(path: string[], body?: unknown, options: { auth?: string; origin?: string; raw?: string; contentType?: string } = {}) {
    const headers: Record<string, string> = { 'x-telegram-init-data': options.auth ?? auth };
    if (body !== undefined || options.raw !== undefined) { headers['Content-Type'] = options.contentType ?? 'application/json'; headers.Origin = options.origin ?? 'https://vox.test'; }
    const req = new Request(`https://vox.test/api/studio/adaptive/${path.join('/')}`, { method: body !== undefined || options.raw !== undefined ? 'POST' : 'GET', headers,
      ...(body !== undefined || options.raw !== undefined ? { body: options.raw ?? JSON.stringify(body) } : {}) });
    return handleAdaptiveRequest(studio, service, req, path, TOKEN);
  }
  return { service, studio, request };
}
describe('authenticated adaptive API boundary', () => {
  it('requires signed authentication even when Studio development impersonation exists', async () => {
    const { request } = await setup();
    expect((await request([], undefined, { auth: '' })).status).toBe(401);
    expect((await request([], undefined, { auth: 'telegramId=123' })).status).toBe(401);
    const result = await request([]);
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect((await result.json()).identity.confirmed).toBe(false);
  });
  it('rejects cross-origin mutations and untrusted person/age/policy injection without writing confirmation', async () => {
    const { request } = await setup();
    expect((await request(['identity'], { confirm: true }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await request(['identity'], { confirm: true, personId: 'victim' })).status).toBe(400);
    expect((await request(['identity'], { confirm: true, adultConfirmed: 'true' })).status).toBe(400);
    expect((await request(['identity'], { confirm: true, jurisdiction: 'US' })).status).toBe(400);
    expect((await (await request([])).json()).identity.confirmed).toBe(false);
    const confirmed = await request(['identity'], { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).identity).toMatchObject({ confirmed: true, verification: 'account_confirmation', adultDeclared: true });
  });
  it('rejects oversized, malformed and non-JSON bodies before service mutation', async () => {
    const { request } = await setup();
    expect((await request(['identity'], undefined, { raw: '{' })).status).toBe(400);
    expect((await request(['identity'], undefined, { raw: 'a'.repeat(8193) })).status).toBe(413);
    expect((await request(['identity'], { confirm: true }, { contentType: 'text/plain' })).status).toBe(415);
  });
  it('prevents a pending member or admin identity from bypassing this account profile boundary', async () => {
    const { studio, service } = await setup();
    studio.ensureMember = async () => ({ telegramId: 123, name: 'Pending', joinedAt: '', role: 'pending' });
    const req = new Request('https://vox.test/api/studio/adaptive', { headers: { 'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN) } });
    expect((await handleAdaptiveRequest(studio, service, req, [], TOKEN)).status).toBe(403);
  });
});
