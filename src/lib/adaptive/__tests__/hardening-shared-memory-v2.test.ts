/**
 * S08 hardening (F021, F073, F109): SharedMemoryService.readContext with
 * TIREH_SHARING_V2=1. The base suite (shared-memory.test.ts) pins its two
 * consent cases to the flag unset; this file holds the flag-on arm.
 *
 * Under the flag, membership in the container plus the per-container agent
 * (read) grant is enough: no participant needs optional.personalization. The
 * product pause (storedPersonalizationAllowed false) still denies, for a
 * private reader and for a group audience. Whether group audiences should keep
 * every recipient's consent requirement is product decision (k); these cases
 * pin the current v2 behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AdaptiveRepository, accountIdFor, digest } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { SharedMemoryRepository } from '../shared/repository';
import { SharedMemoryService, type SharedAuthority } from '../shared/service';

const START = 1_800_000_000_000;
const roots: string[] = [];
let seq = 0;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function setup(options: { pausedFor?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vox-shared-v2-')); roots.push(root);
  const now = START;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'shared-v2-synthetic', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [101, 102, 103].map((id) => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, index) => ({ schemaVersion: 1, id: `shared-v2-approval-${index}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'shared-v2-synthetic', effectiveAt: START, reviewExpiresAt: START + 400 * 86400_000,
      owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const real = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(root, 'private'))), { ...adaptiveOptionsFromManifest(manifest), now: () => now });
  for (const id of [101, 102, 103]) await real.confirm(id, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  // The product pause (storedPersonalizationAllowed:false) for one person, reported by both authority reads.
  const paused = options.pausedFor;
  const adaptive = paused === undefined ? real : new Proxy(real, {
    get(target, prop) {
      if (prop === 'readAuthority') {
        return async (id: number, space: 'work' | 'personal') => {
          const profile = await target.readAuthority(id, space);
          return id === paused ? { ...profile, storedPersonalizationAllowed: false } : profile;
        };
      }
      if (prop === 'readAuthorityNow') {
        return (id: number, space: 'work' | 'personal') => {
          const profile = target.readAuthorityNow(id, space);
          return id === paused ? { ...profile, storedPersonalizationAllowed: false } : profile;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  let members = [101, 102], guests = false;
  const group = (id: string) => (id === 'chat--100' ? { memberTelegramIds: members, hasGuests: guests, revision: digest([members, guests]) } : null);
  const authority: SharedAuthority = {
    member: async () => ({ active: true, agentIds: ['aria'] }),
    group: async (id) => group(id),
    agent: async (id) => ({ active: id === 'aria' }),
    memberNow: () => ({ active: true, agentIds: ['aria'] }),
    groupNow: group,
    agentNow: (id) => ({ active: id === 'aria' }),
    readSnapshotNow: ({ telegramIds, agentId, groupIds }) => ({
      members: telegramIds.map((telegramId) => ({ telegramId, active: true, agentIds: ['aria'] })),
      agent: { active: agentId === 'aria' },
      groups: groupIds.map((groupId) => ({ groupId, value: group(groupId) })),
    }),
  };
  const service = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared')), 'synthetic'), adaptive, authority, () => now);
  const create = async (options: { group?: boolean; agents?: string[] } = {}) => {
    const preview = await service.preview(101, { space: 'work', kind: options.group ? 'group' : 'selected', recipientTelegramIds: [102], ...(options.group ? { groupId: 'chat--100' } : {}) });
    const snapshot = await service.create(101, { space: 'work', eventId: `create-${++seq}`, expectedRevision: 0, previewToken: preview.previewToken,
      agentIds: options.agents ?? ['aria'], text: 'SHARED_CANARY' });
    return snapshot.containers.at(-1)!;
  };
  const personalization = async (id: number) => (await real.read(id, 'work')).purposes.find((p) => p.purpose === 'optional.personalization')!.state;
  return { service, create, personalization, setGroup: (ids: number[], hasGuests = false) => { members = ids; guests = hasGuests; } };
}

const texts = (result: { memories: Array<{ text: string }> }) => result.memories.map((m) => m.text);
const GROUP = { audienceTelegramIds: [101, 102], groupId: 'chat--100' };

describe('SharedMemoryService.readContext with TIREH_SHARING_V2=1', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

  it('group audience: membership plus the agent read grant is enough without optional.personalization', async () => {
    const ctx = await setup();
    await ctx.create({ group: true });
    // Nobody granted personalization.
    expect(await ctx.personalization(101)).toBe('not_asked');
    expect(await ctx.personalization(102)).toBe('not_asked');
    const group = await ctx.service.readContext(101, 'work', 'aria', GROUP);
    expect(texts(group)).toEqual(['SHARED_CANARY']);
    expect(await ctx.service.readContextAuthority(101, 'work', 'aria', GROUP)).toEqual({ revision: group.revision });
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', GROUP))).toEqual(['SHARED_CANARY']);
  });

  it('private reader: a recipient reads without optional.personalization; a non-member gets nothing', async () => {
    const ctx = await setup();
    await ctx.create();
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual(['SHARED_CANARY']);
    expect(texts(await ctx.service.readContext(103, 'work', 'aria', { audienceTelegramIds: [103] }))).toEqual([]);
  });

  it('the read grant is still required: a container without the agent grant gives nothing', async () => {
    const ctx = await setup();
    await ctx.create({ group: true, agents: [] });
    expect(texts(await ctx.service.readContext(101, 'work', 'aria', GROUP))).toEqual([]);
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual([]);
  });

  it('a pause (storedPersonalizationAllowed false) still denies, for the paused reader and for any group audience with them', async () => {
    const ctx = await setup({ pausedFor: 102 });
    await ctx.create({ group: true });
    expect(texts(await ctx.service.readContext(101, 'work', 'aria', GROUP))).toEqual([]);
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', GROUP))).toEqual([]);
    expect(texts(await ctx.service.readContext(102, 'work', 'aria', { audienceTelegramIds: [102] }))).toEqual([]);
  });

  it('the exact live group audience is still required: a stranger in the audience, guests or roster drift deny', async () => {
    const ctx = await setup();
    await ctx.create({ group: true });
    await expect(ctx.service.readContext(101, 'work', 'aria', { audienceTelegramIds: [101, 103], groupId: 'chat--100' })).rejects.toMatchObject({ code: 'audience_denied' });
    ctx.setGroup([101, 102], true);
    await expect(ctx.service.readContext(101, 'work', 'aria', GROUP)).rejects.toMatchObject({ code: 'audience_denied' });
  });
});
