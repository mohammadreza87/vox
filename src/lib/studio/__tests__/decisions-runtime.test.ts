/**
 * S09 runtime wiring: STUDIO_DECIDER=service and TIREH_DECISION_LOG=1.
 * Env and global reset follow runtime.test.ts; a non-production env means no
 * Telegram probe. Duck typing, never instanceof (route bundles carry their
 * own class copies). No provider network call is made.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudio } from '../runtime';
import type { NewDecisionLogRow } from '../../tireh/decisions/log';

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
  const dir = mkdtempSync(join(tmpdir(), 'vox-decisions-runtime-'));
  dirs.push(dir);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', STUDIO_SECRET: 'decisions-runtime-test-secret-with-32-characters', ANTHROPIC_API_KEY: 'test-anthropic-key',
    VOXX_BOT_TOKEN: '', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir, STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '0',
    STUDIO_RELATIONSHIPS: 'off', STUDIO_RELATIONSHIP_AGENTS: '', STUDIO_RELATIONSHIP_PEOPLE: '', STUDIO_RELATIONSHIP_ROLES: '',
    STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_EXPERIMENTS_ENABLED: '', STUDIO_IMPROVEMENT_TRUST_JSON: '',
    STUDIO_DECISIONS: '', STUDIO_DECISIONS_ENABLED: '', STUDIO_DECIDER: '', TRIAGE_QUESTION_SET: '', TIREH_DECISION_LOG: '',
    OPENAI_API_KEY: 'synthetic-openai-key', K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // The suite runs under jsdom; the server OpenAI SDK refuses browser-like globals.
  vi.stubGlobal('navigator', undefined);
  return dir;
}

const spyFetch = () => {
  const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(async () => { throw new Error('network disabled in tests'); });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const noOpenAICall = (fetchMock: ReturnType<typeof spyFetch>) =>
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false);

const ROW: NewDecisionLogRow = {
  questionSetVersion: 'v1', names: ['effort', 'live_info', 'memorable', 'wants_voice'], answers: [{ name: 'memorable', type: 'predicate', probability: 0.2 }],
  outcome: 'answered', elapsedMs: 240, routeTaken: 'thoughtful', personaId: 'aria', chatKind: 'private', language: 'en', at: new Date('2026-10-20T10:00:00Z'),
};

describe('S09 runtime wiring', () => {
  it('flags unset: the decider is the base OpenAIMedia (no decideDetailed) and there is no decision log', async () => {
    const dir = configure();
    const fetchMock = spyFetch();
    const studio = await getStudio();
    expect(studio.deps.decider).toBeDefined();
    expect(studio.deps.decider).toBe(studio.deps.openai);
    expect(studio.deps.decider!.decideDetailed).toBeUndefined();
    expect(studio.deps.decisionLog).toBeUndefined();
    expect(existsSync(join(dir, 'decision-log-v1.jsonl'))).toBe(false);
    noOpenAICall(fetchMock);
  });

  it('STUDIO_DECIDER=service selects a ServiceDecider (decideDetailed and decideParts)', async () => {
    configure({ STUDIO_DECIDER: 'service' });
    const fetchMock = spyFetch();
    const studio = await getStudio();
    const decider = studio.deps.decider!;
    expect(typeof decider.decide).toBe('function');
    expect(typeof decider.decideDetailed).toBe('function');
    expect(typeof decider.decideParts).toBe('function');
    expect(decider).not.toBe(studio.deps.openai);
    noOpenAICall(fetchMock);
  });

  it('STUDIO_DECIDER=service with STUDIO_DECISIONS=off keeps no decider', async () => {
    configure({ STUDIO_DECIDER: 'service', STUDIO_DECISIONS: 'off' });
    spyFetch();
    expect((await getStudio()).deps.decider).toBeUndefined();
  });

  it('STUDIO_DECIDER=service without OPENAI_API_KEY keeps no decider', async () => {
    configure({ STUDIO_DECIDER: 'service', OPENAI_API_KEY: '' });
    spyFetch();
    expect((await getStudio()).deps.decider).toBeUndefined();
  });

  it('TIREH_DECISION_LOG=1 wires a file sink under the data dir', async () => {
    const dir = configure({ TIREH_DECISION_LOG: '1' });
    const fetchMock = spyFetch();
    const studio = await getStudio();
    const sink = studio.deps.decisionLog as (NonNullable<typeof studio.deps.decisionLog> & { flush(): Promise<void> }) | undefined;
    expect(sink).toBeDefined();
    sink!.record(ROW);
    await sink!.flush();
    const lines = readFileSync(join(dir, 'decision-log-v1.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ personaId: 'aria', questionSetVersion: 'v1', at: '2026-10-20T10:00:00.000Z', id: expect.any(String) });
    noOpenAICall(fetchMock);
  });
});
