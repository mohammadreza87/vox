import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStudio, validateStudioConfig } from '../runtime';
import type { RelationshipKey } from '../../relationships';
import type { RelationshipPermit } from '../../adaptive/relationships/contracts';

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn(), getStorage: vi.fn(), bucket: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));
vi.mock('firebase-admin/storage', () => ({ getStorage: firebase.getStorage }));
const keyFor = (account = 300, space: 'work' | 'personal' = 'personal', agent = 'removed-agent'): RelationshipKey => ({ personaId: agent, chatKey: `private-person-${account}`, audience: { kind: 'private', personId: `person-${account}` },
  scope: { schemaVersion: 1, accountId: `telegram-account:${account}`, personId: `person-${account}`, bindingId: `binding-${account}`, tenantId: `tenant-${account}`, space, spaceId: `${space}-${account}`, containerId: `container-${space}-${account}` } });
const dirs: string[] = [];
const globals = globalThis as unknown as { __voxStudio?: unknown };
// F051: v1-pinned runtime wiring; the S09 flags would swap in the OpenAI SDK decider under jsdom.
beforeEach(() => { vi.stubEnv('STUDIO_DECIDER', ''); vi.stubEnv('TRIAGE_QUESTION_SET', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); delete globals.__voxStudio; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function configure(overrides: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-scoped-runtime-')); dirs.push(dir);
  const env = { NODE_ENV: 'test', STUDIO_SECRET: 'scoped-runtime-test-secret-with-32-characters', ANTHROPIC_API_KEY: 'test-key', VOXX_BOT_TOKEN: '', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir,
    STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '0', STUDIO_ADAPTIVE_POLICY_JSON: '', STUDIO_SCOPED_RELATIONSHIPS: '1', STUDIO_RELATIONSHIPS: 'live', STUDIO_RELATIONSHIP_AGENTS: 'agent', STUDIO_RELATIONSHIP_PEOPLE: '300',
    STUDIO_RELATIONSHIP_ROLES: '', OPENAI_API_KEY: 'test-openai', ...overrides };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return dir;
}
async function seed(studio: Awaited<ReturnType<typeof getStudio>>, key: RelationshipKey) {
  await studio.deps.relationshipStore!.update(key, (state) => {
    state.disabled = true; state.timeZone = 'Europe/Tallinn'; state.unansweredCount = 1; state.lastOutreachAt = '2026-10-19T10:00:00Z';
    state.preferences = ['source-a', 'source-b'].map(sourceId => ({ key: sourceId, value: `PRIVATE_${sourceId}`, sourceId, updatedAt: '2026-10-19T12:00:00Z' }));
  });
}

describe('scoped relationship runtime wiring', () => {
  it('persists assessed restrictive controls in account/agent/space authority independently of the current link', async () => {
    configure(); const studio = await getStudio(); const key = keyFor();
    await seed(studio, key);
    await studio.deps.relationships!.deps.applyScopedControl!(key, 'stop');
    const controls = await studio.deps.adaptive!.withAccountDocument(300, document => document.relationships.controls);
    expect(controls).toContainEqual(expect.objectContaining({ agentId: 'removed-agent', space: 'personal', disabled: true }));
    expect((await studio.deps.relationshipStore!.read(key)).disabled).toBe(true);
    expect((await studio.deps.relationshipStore!.read(key)).preferences).toEqual([]);
    const rebound = { ...key, scope: { ...key.scope!, bindingId: 'new-thirty-day-link' } };
    await studio.deps.relationshipStore!.update(rebound, () => undefined);
    expect((await studio.deps.adaptive!.withAccountDocument(300, document => document.relationships.controls))[0].disabled).toBe(true);
    const until = new Date(Date.now() + 7 * 86_400_000);
    await studio.deps.relationships!.deps.applyScopedControl!(rebound, 'pause', until);
    expect((await studio.deps.adaptive!.withAccountDocument(300, document => document.relationships.controls))[0].pausedUntil).toBe(until.getTime());
    expect((await studio.deps.relationshipStore!.read(rebound)).pausedUntil).toBe(until.toISOString());
  });
  it.each(['', '0', 'true'] as const)('requires the literal release switch 1; %s keeps providers off and controls accessible', async value => {
    configure({ STUDIO_SCOPED_RELATIONSHIPS: value });
    const studio = await getStudio();
    expect(studio.deps.relationships?.mode).toBe('off'); expect(studio.deps.relationshipAuthority).toBeDefined();
    const status = await studio.deps.adaptive!.withAccountDocument(300, (document, now) => studio.deps.adaptive!.capabilityStatus(document, 'auto_memory', now));
    expect(status.reason).toBe('feature_not_released');
    await studio.deps.relationships!.control(keyFor(), 'stop');
    expect((await studio.deps.relationshipStore!.read(keyFor())).disabled).toBe(true);
  });
  it('uses the scoped mode and releases the adaptive capability gate only with the explicit switch', async () => {
    configure(); const studio = await getStudio();
    expect(studio.deps.relationships?.mode).toBe('live');
    const status = await studio.deps.adaptive!.withAccountDocument(300, (document, now) => studio.deps.adaptive!.capabilityStatus(document, 'auto_memory', now));
    expect(status.reason).toBe('approval_missing');
    expect(validateStudioConfig(process.env).scopedRelationshipsEnabled).toBe(true);
  });
  it('loads fresh file namespaces without reading legacy relationship data or observations', async () => {
    const dir = configure();
    writeFileSync(join(dir, 'relationships.json'), 'legacy invalid payload containing PRIVATE_CANARY');
    writeFileSync(join(dir, 'relationship-observations.json'), 'legacy invalid payload containing PRIVATE_CANARY');
    const studio = await getStudio();
    expect((await studio.deps.relationshipStore!.read(keyFor())).preferences).toEqual([]);
    expect(await studio.deps.observations!.recent()).toEqual([]);
    await seed(studio, keyFor());
    const { readFileSync } = await import('fs');
    expect(readFileSync(join(dir, 'scoped-relationships-v1.json'), 'utf8')).toContain('PRIVATE_source-a');
  });
  it('requires fresh Studio cohort access before consulting the authoritative account ledger', async () => {
    configure(); const studio = await getStudio();
    const cohort = vi.spyOn(studio, 'relationshipCohortEnabled').mockResolvedValue(false);
    const authorize = vi.spyOn(studio.deps.relationshipAuthority!, 'authorize').mockResolvedValue(null);
    const key = keyFor(); const hook = studio.deps.relationships!.deps.authorize!;
    expect(await hook({ key, sourceIds: ['source-a'], phase: 'context' })).toBeNull(); expect(authorize).not.toHaveBeenCalled();
    cohort.mockResolvedValue(true);
    const permit = { key, fingerprint: 'fresh-policy' } as RelationshipPermit;
    authorize.mockResolvedValue(permit);
    expect(await hook({ key, sourceIds: ['source-a'], phase: 'observe', expectedFingerprint: 'prior-policy' })).toBe(permit);
    expect(cohort).toHaveBeenCalledWith('removed-agent', 300);
    expect(authorize).toHaveBeenCalledWith(key, ['source-a'], 'observe', 'prior-policy');
  });
  it('purges orphaned agent records by exact account and space without reentering authority', async () => {
    configure(); const studio = await getStudio();
    const personal = keyFor(), work = keyFor(300, 'work'), other = keyFor(301);
    for (const key of [personal, work, other]) await seed(studio, key);
    const authorize = vi.spyOn(studio.deps.relationshipAuthority!, 'authorize');
    await studio.deps.adaptive!.notifyRelationshipInvalidation({ telegramId: 300, space: 'personal', reason: 'consent_revoked' });
    expect(authorize).not.toHaveBeenCalled();
    const cleared = await studio.deps.relationshipStore!.read(personal);
    expect(cleared.preferences).toEqual([]); expect(cleared.disabled).toBe(true); expect(cleared.timeZone).toBe('Europe/Tallinn'); expect(cleared.unansweredCount).toBe(1); expect(cleared.lastOutreachAt).toBe('2026-10-19T10:00:00Z');
    expect((await studio.deps.relationshipStore!.read(work)).preferences).toHaveLength(2);
    expect((await studio.deps.relationshipStore!.read(other)).preferences).toHaveLength(2);
  });
  it('honors optional agent and source filters on invalidation', async () => {
    configure(); const studio = await getStudio();
    const first = keyFor(), second = keyFor(300, 'personal', 'other-agent');
    for (const key of [first, second]) await seed(studio, key);
    await studio.deps.adaptive!.notifyRelationshipInvalidation({ telegramId: 300, space: 'personal', agentId: 'removed-agent', sourceIds: ['source-a'], reason: 'source_deleted' });
    expect((await studio.deps.relationshipStore!.read(first)).preferences.map(p => p.sourceId)).toEqual(['source-b']);
    expect((await studio.deps.relationshipStore!.read(first)).forgottenSourceIds).toContain('source-a');
    expect((await studio.deps.relationshipStore!.read(second)).preferences).toHaveLength(2);
  });
  it('uses isolated Firestore data, durable controls, epochs and observation namespaces', async () => {
    configure({ STUDIO_STORAGE: 'firestore', STUDIO_MEDIA_BUCKET: 'test-bucket' });
    const names: string[] = [];
    const collection = (name: string) => { names.push(name); return { doc: (id: string) => ({ path: `${name}/${id}`, set: vi.fn(async () => undefined) }) }; };
    const db = { collection, runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: async () => ({ get: () => undefined }), set: vi.fn() }) } as unknown as Firestore;
    firebase.getAdminDb.mockResolvedValue(db); firebase.getAdminApp.mockResolvedValue({}); firebase.getStorage.mockReturnValue({ bucket: firebase.bucket }); firebase.bucket.mockReturnValue({});
    const studio = await getStudio();
    await studio.deps.relationships!.control(keyFor(), 'stop');
    expect(names).toEqual(expect.arrayContaining(['vox_scoped_relationships_v1', 'vox_scoped_relationships_v1_controls', 'vox_scoped_relationships_v1_epochs', 'vox_scoped_relationship_observations_v1']));
    expect(names).not.toContain('vox_relationships'); expect(names).not.toContain('vox_relationship_observations');
  });
});
