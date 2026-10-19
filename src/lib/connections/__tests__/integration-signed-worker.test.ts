import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { handleStudioBrokerControl } from '../runtime';
import { signBrokerRequest } from '../broker/auth';
import { signInitData } from '../../studio/auth';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vox-independent-worker-')); directories.push(directory);
  const key = new Uint8Array(32).fill(52); const keyFile = join(directory, 'qa-worker-auth'); const configFile = join(directory, 'qa-config.json');
  await writeFile(keyFile, Buffer.from(key).toString('hex'), { mode: 0o600 });
  await writeFile(configFile, JSON.stringify({ schemaVersion: 1, enabled: true, profiles: [] }), { mode: 0o600 });
  vi.stubEnv('STUDIO_STORAGE', 'file'); vi.stubEnv('STUDIO_DATA_DIR', directory); vi.stubEnv('STUDIO_CONNECTIONS_CONFIG_FILE', configFile);
  vi.stubEnv('STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', keyFile); vi.stubEnv('STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1:9');
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage())); await adaptive.confirm(1001, { confirm: true });
  const state = { members: [{ telegramId: 1001, role: 'member', firstName: 'QA' }], agents: [], groups: [], audit: [] } as unknown as StudioState;
  const studio = { deps: { adaptive, store: { read: async () => structuredClone(state) } } } as unknown as Studio;
  const body = JSON.stringify({ action: 'drainWorkflows', actor: { accountId: 'telegram-account:1001' }, space: 'work', maxOccurrences: 1 });
  const signed = () => ({ 'content-type': 'application/json', ...signBrokerRequest(key, 'POST', '/api/connections/broker', body) });
  const invoke = (headers: Record<string, string>) => handleStudioBrokerControl(studio,
    new Request('http://127.0.0.1/api/connections/broker', { method: 'POST', headers, body }));
  return { configFile, body, signed, invoke };
}

describe('independent actual Studio signed worker control route (temporary empty stores)', () => {
  it('Telegram credentials cannot drain workflows; HMAC worker may drain and its replay is denied', async () => {
    const f = await fixture();
    const telegram = await f.invoke({ 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: 1001, first_name: 'QA' }, 'SYNTHETIC_MANAGER_TOKEN') });
    expect(telegram.status).toBe(401);
    const headers = f.signed(); const accepted = await f.invoke(headers);
    expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ occurrences: [], quiet: true });
    expect((await f.invoke(headers)).status).toBe(401);
  });

  it('the current configuration kill switch denies even a correctly signed worker request', async () => {
    const f = await fixture(); await writeFile(f.configFile, JSON.stringify({ schemaVersion: 1, enabled: false, profiles: [] }));
    const response = await f.invoke(f.signed());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'connections_paused' });
  });
});
