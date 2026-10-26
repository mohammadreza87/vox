/**
 * H3 runtime wiring of the Step 9 block: the runtime-built ServiceDecider keeps
 * main's TRIAGE_TIMEOUT_MS cap (F177) and reports provider timeouts as
 * 'timeout' (F030); the Decisions readiness codes and the images-without-triage
 * warning are logged only in their configurations (F070, F121, F130). Env and
 * global reset follow decisions-runtime.test.ts. Duck typing, never instanceof.
 * No provider network call is made.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudio } from '../runtime';
import { DecisionService, type DecisionContext, type DecisionResult } from '../../adaptive/decisions';
import { TRIAGE_TIMEOUT_MS, type DecisionQuestion } from '../../tireh/triage';

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn(), getStorage: vi.fn(), bucket: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));
vi.mock('firebase-admin/storage', () => ({ getStorage: firebase.getStorage }));

const dirs: string[] = [];
const globalState = globalThis as unknown as { __voxStudio?: unknown };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete globalState.__voxStudio;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function configure(overrides: NodeJS.ProcessEnv = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-h3-runtime-'));
  dirs.push(dir);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', STUDIO_SECRET: 'h3-runtime-test-secret-with-32-characters-x', ANTHROPIC_API_KEY: 'test-anthropic-key',
    VOXX_BOT_TOKEN: '', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir, STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '0',
    STUDIO_RELATIONSHIPS: 'off', STUDIO_RELATIONSHIP_AGENTS: '', STUDIO_RELATIONSHIP_PEOPLE: '', STUDIO_RELATIONSHIP_ROLES: '',
    STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_EXPERIMENTS_ENABLED: '', STUDIO_IMPROVEMENT_TRUST_JSON: '',
    STUDIO_DECISIONS: '', STUDIO_DECISIONS_ENABLED: '', STUDIO_DECIDER: '', TRIAGE_QUESTION_SET: '', TIREH_DECISION_LOG: '', STUDIO_IMAGES: '',
    DECISIONS_ZDR_APPROVED: '', DECISIONS_EU_ENDPOINT_CONFIRMED: '', DECISIONS_SAFETY_ID_SALT: '',
    OPENAI_API_KEY: 'synthetic-openai-key', K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // The suite runs under jsdom; the server OpenAI SDK refuses browser-like globals.
  vi.stubGlobal('navigator', undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network disabled in tests'); }));
  return dir;
}

const questions: DecisionQuestion[] = [{ type: 'predicate', name: 'memorable', instructions: 'Is it worth remembering?' }];
const warnings = (warn: ReturnType<typeof vi.spyOn>) => warn.mock.calls.map(([line]) => String(line));

describe('Step 9 runtime decider (H3)', () => {
  it('caps a 5000 ms request at TRIAGE_TIMEOUT_MS (main\'s studioDecider deadline)', async () => {
    configure({ STUDIO_DECIDER: 'service' });
    const seen: DecisionContext[] = [];
    vi.spyOn(DecisionService.prototype, 'evaluate').mockImplementation(async (context: DecisionContext): Promise<DecisionResult> => {
      seen.push(context);
      return { status: 'unknown', reason: 'timeout', elapsedMs: 0 };
    });
    const decider = (await getStudio()).deps.decider!;
    expect(typeof decider.decideDetailed).toBe('function');
    await decider.decide('SYNTHETIC', questions, 5000);
    await decider.decide('SYNTHETIC', questions, 300);
    expect(seen.map((c) => c.deadlineMs)).toEqual([TRIAGE_TIMEOUT_MS, 300]);
    expect(TRIAGE_TIMEOUT_MS).toBe(2000);
    // No salt configured: no identifier, even when the caller names a subject.
    await decider.decide('SYNTHETIC', questions, 5000, { authorize: async () => 'k', subject: 'person-1' });
    expect(seen[2]).not.toHaveProperty('safetyIdentifier');
  });

  it('builds the safety identifier only from a configured salt', async () => {
    configure({ STUDIO_DECIDER: 'service', DECISIONS_SAFETY_ID_SALT: 'synthetic-salt-0123456789abcdef-0123456789' });
    const seen: DecisionContext[] = [];
    vi.spyOn(DecisionService.prototype, 'evaluate').mockImplementation(async (context: DecisionContext): Promise<DecisionResult> => {
      seen.push(context);
      return { status: 'unknown', reason: 'timeout', elapsedMs: 0 };
    });
    const decider = (await getStudio()).deps.decider!;
    await decider.decide('SYNTHETIC', questions, 2000, { authorize: async () => 'k', subject: 'person-1' });
    expect(seen[0].safetyIdentifier).toMatch(/^vox_[0-9a-f]{32}$/);
    expect(seen[0].safetyIdentifier).not.toContain('person-1');
  });

  it('the runtime triage service reports provider timeouts as timeout, not provider_error', async () => {
    configure({ STUDIO_DECIDER: 'service' });
    // The SDK's fetch rejects as a connection timeout would; nothing leaves the process.
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); }));
    const decider = (await getStudio()).deps.decider!;
    const detail = await decider.decideDetailed!('SYNTHETIC', questions, 2000, { authorize: async () => 'k' });
    expect(detail).toMatchObject({ answers: {}, outcome: 'unknown', unknownReason: 'timeout' });
  });

  it('logs the readiness codes under STUDIO_DECIDER=service, and nothing with the default decider', async () => {
    configure({ STUDIO_DECIDER: 'service' });
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStudio();
    expect(warnings(warn).filter((l) => l.startsWith('[vox] decisions_readiness:'))).toEqual([
      '[vox] decisions_readiness:zdr_unconfirmed', '[vox] decisions_readiness:eu_endpoint_unconfirmed', '[vox] decisions_readiness:safety_identifier_salt_missing',
    ]);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete globalState.__voxStudio;
    configure();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStudio();
    expect(warnings(warn).some((l) => l.includes('decisions_readiness'))).toBe(false);
  });

  it('warns images_without_image_triage under STUDIO_IMAGES=1 without STUDIO_DECIDER=service, once', async () => {
    configure({ STUDIO_IMAGES: '1' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStudio();
    expect(warnings(warn).filter((l) => l === '[vox] images_without_image_triage')).toHaveLength(1);
  });

  it('does not warn about images with the service decider, or with STUDIO_IMAGES unset', async () => {
    for (const overrides of [{ STUDIO_IMAGES: '1', STUDIO_DECIDER: 'service' }, { STUDIO_IMAGES: '' }]) {
      configure(overrides);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await getStudio();
      expect(warnings(warn).some((l) => l.includes('images_without_image_triage'))).toBe(false);
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      delete globalState.__voxStudio;
    }
  });

  it('STUDIO_IMAGES=1 with the service decider but no OPENAI_API_KEY still warns (no image triage)', async () => {
    configure({ STUDIO_IMAGES: '1', STUDIO_DECIDER: 'service', OPENAI_API_KEY: '' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStudio();
    expect(warnings(warn)).toContain('[vox] images_without_image_triage');
  });
});
