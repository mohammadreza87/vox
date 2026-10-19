import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage, MemoryAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { StudioStore } from '../../studio/store';
import type { Studio } from '../../studio/service';
import { handleAdaptiveRequest } from '../persistence/http';
import { signInitData } from '../../studio/auth';
export const CORRECTION_NOW = Date.UTC(2026, 9, 20, 12), CORRECTION_USER = 123;
export async function correctionFixture(file = true) {
  const directory = await mkdtemp(join(tmpdir(), 'vox-correction-'));
  let now = CORRECTION_NOW, eligible = true;
  const storage = file ? new FileAdaptiveStorage(join(directory, 'adaptive')) : new MemoryAdaptiveStorage();
  const policy = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-correction', enabledCapabilities: ['core_text'],
    accounts: [123, 124].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: [{ schemaVersion: 1, id: 'synthetic-correction-core', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'synthetic-correction', effectiveAt: now, reviewExpiresAt: now + 365 * 86400_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
  const service = new AdaptiveService(new AdaptiveRepository(storage), { ...policy, now: () => now,
    capabilityPolicy: (context, at) => eligible ? policy.capabilityPolicy?.(context, at) : undefined });
  const store = new StudioStore(join(directory, 'studio'));
  await store.update(state => { state.members.push({ telegramId: 123, name: 'Synthetic member', role: 'member', joinedAt: '' }, { telegramId: 124, name: 'Synthetic owner', role: 'owner', joinedAt: '' }); });
  const studio = { deps: { adaptive: service, store }, ensureMember: async (user: { id: number }) => (await store.read()).members.find(m => m.telegramId === user.id)! } as unknown as Studio;
  for (const id of [123, 124]) await service.confirm(id, { confirm: true, adultConfirmed: true });
  const save = async (text = 'Original own note', space: 'work' | 'personal' = 'work', id = 123) => {
    const snapshot = await service.createMemory(id, { space, text, expectedRevision: (await service.read(id, space)).revision, eventId: randomUUID() });
    return snapshot.memories.at(-1)!;
  };
  const note = await save();
  const input = (text = 'Corrected own note', revision = note.revision) => ({ space: 'work' as const, text, expectedRevision: revision, eventId: randomUUID() });
  const token = '123:synthetic-correction';
  const request = (memoryId: string, body: unknown, options: { id?: number; headers?: Record<string, string>; signal?: AbortSignal; method?: string } = {}) => handleAdaptiveRequest(studio, service,
    new Request(`https://vox.synthetic/api/studio/adaptive/memories/${memoryId}`, { method: options.method ?? 'PUT', signal: options.signal,
      headers: { origin: 'https://vox.synthetic', 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: options.id ?? 123, first_name: 'Synthetic' }, token), ...options.headers }, body: JSON.stringify(body) }), ['memories', memoryId], token);
  return { directory, storage, service, store, studio, note, input, save, request, setNow: (value: number) => { now = value; }, deny: () => { eligible = false; },
    close: () => rm(directory, { recursive: true, force: true, maxRetries: 3 }) };
}
