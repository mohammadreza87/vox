/**
 * Glean-style negative-identity tests: the search result is the ground truth.
 * For every scope kind and sensitivity, a CANARY record is written through a
 * real store, then every kind of outsider asks for it by its own words. They
 * must get zero rows from selectMemories (v1 and v2), no scope key that
 * matches the record, nothing through the full gateway pipeline in either flag
 * state, and nothing through the vector path even when the index ignores every
 * filter. Positive controls prove the record is reachable for an authorized
 * reader, so the empty results are meaningful.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PersonaGateway } from '../gateway';
import type { TelegramBotClient, TelegramUpdate } from '../telegram/client';
import { createFileStores } from '../memory/file-store';
import { FakeEmbeddingProvider } from '../memory/embeddings';
import { audienceScopeKeys, selectMemories, vectorCandidates } from '../memory/retrieval';
import {
  InMemoryChatHistoryStore,
  InMemoryMemoryStore,
  InMemoryShareOfferStore,
  InMemoryUpdateDeduper,
  type MemoryStore,
  type NewMemory,
} from '../memory/store';
import { scopeKey } from '../memory/visibility';
import { OrgDirectory } from '../org/directory';
import type { ChatContext, MemoryRecord, MemoryScope, MemorySensitivity } from '../types';
import { fakeBot, FakeLLM, groupText, privateText } from './fixtures';
import { CHAT_IDS, chatFor, EVAL_NOW, evalOrg, evalOrgConfig, TELEGRAM } from './memory-eval/org';
import { fakeFirestore, vectorStore } from './memory-v2-fakes';

const org = evalOrg();
/** The same org, but gameend-team is heard by guests (everyone else in it is authorized). */
const guestOrg = new OrgDirectory({
  ...evalOrgConfig(),
  groups: evalOrgConfig().groups.map((g) => (g.id === 'gameend-team' ? { ...g, hasGuests: true } : g)),
});
const STRANGER_TG = 9999;

type OutsiderKind = 'stranger' | 'guest' | 'outside-scope' | 'removed-member' | 'other-group' | 'guest-group' | 'group-with-owner';

interface Reader {
  label: string;
  kind: OutsiderKind | 'insider';
  chat: ChatContext;
  /** How the same reader reaches the gateway. */
  update: (text: string) => TelegramUpdate;
  guestOrg?: boolean;
}

const privateReader = (personId: keyof typeof TELEGRAM, kind: Reader['kind']): Reader => ({
  label: `p:${personId}`, kind, chat: chatFor(org, `p:${personId}`), update: (text) => privateText(TELEGRAM[personId], text),
});
const stranger: Reader = {
  label: 'stranger', kind: 'stranger', chat: { kind: 'private', chatKey: 'private-stranger', personId: 'stranger' },
  update: (text) => privateText(STRANGER_TG, text),
};
const guest = { ...privateReader('negar', 'guest') };
const groupReader = (groupId: 'gameend-team' | 'leads', kind: Reader['kind'], speaker: keyof typeof TELEGRAM = 'reza'): Reader => ({
  label: `g:${groupId}`, kind, chat: chatFor(org, `g:${groupId}`), update: (text) => groupText(CHAT_IDS[groupId], TELEGRAM[speaker], text),
});
const guestGroup: Reader = {
  label: 'g:gameend-team+guests', kind: 'guest-group',
  chat: { kind: 'group', chatKey: 'group-gameend-team', group: { ...org.getGroup('gameend-team')!, hasGuests: true } },
  update: (text) => groupText(CHAT_IDS['gameend-team'], TELEGRAM.milad, text), guestOrg: true,
};

interface Case {
  name: string;
  marker: string;
  words: string;
  scope: MemoryScope;
  auth: string[];
  sensitivity: MemorySensitivity;
  outsiders: Reader[];
  insiders: Reader[];
}

const privateOutsiders = [stranger, guest, privateReader('parastoo', 'outside-scope'), privateReader('sina', 'outside-scope'),
  privateReader('arman', 'outside-scope'), groupReader('leads', 'group-with-owner'), groupReader('gameend-team', 'group-with-owner'), guestGroup];

const CASES: Case[] = [
  { name: 'private/normal', marker: 'CANARY_S06_PRIVATE_NORMAL_41', words: 'nebula codename roadmap', scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'normal',
    outsiders: privateOutsiders, insiders: [privateReader('reza', 'insider')] },
  { name: 'private/personal', marker: 'CANARY_S06_PRIVATE_PERSONAL_42', words: 'orchid clinic appointment', scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'personal',
    outsiders: privateOutsiders, insiders: [privateReader('reza', 'insider')] },
  { name: 'private/confidential', marker: 'CANARY_S06_PRIVATE_CONFIDENTIAL_43', words: 'granite equity grant', scope: { kind: 'private', personId: 'reza' }, auth: ['reza'], sensitivity: 'confidential',
    outsiders: privateOutsiders, insiders: [privateReader('reza', 'insider')] },
  { name: 'people', marker: 'CANARY_S06_PEOPLE_44', words: 'harbor acquisition shortlist', scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, auth: ['parastoo', 'reza'], sensitivity: 'normal',
    outsiders: [stranger, guest, privateReader('milad', 'outside-scope'), privateReader('sina', 'outside-scope'), privateReader('arman', 'outside-scope'),
      groupReader('leads', 'other-group'), guestGroup],
    insiders: [privateReader('parastoo', 'insider'), privateReader('reza', 'insider')] },
  { name: 'group', marker: 'CANARY_S06_GROUP_45', words: 'lantern boss fight', scope: { kind: 'group', groupId: 'gameend-team' }, auth: ['arman', 'milad', 'parastoo', 'reza'], sensitivity: 'normal',
    outsiders: [stranger, guest, privateReader('sina', 'outside-scope'), privateReader('arman', 'removed-member'), groupReader('leads', 'other-group'), guestGroup],
    insiders: [groupReader('gameend-team', 'insider', 'milad'), privateReader('milad', 'insider')] },
  { name: 'project', marker: 'CANARY_S06_PROJECT_46', words: 'saffron shader budget', scope: { kind: 'project', projectId: 'gameend' }, auth: ['arman', 'milad', 'parastoo', 'reza'], sensitivity: 'normal',
    outsiders: [stranger, guest, privateReader('sina', 'outside-scope'), privateReader('arman', 'removed-member'), groupReader('gameend-team', 'other-group'), guestGroup],
    insiders: [privateReader('milad', 'insider')] },
  { name: 'company', marker: 'CANARY_S06_COMPANY_47', words: 'cobalt lease renewal', scope: { kind: 'company', companyId: 'joyixir' }, auth: ['sina'], sensitivity: 'normal',
    outsiders: [stranger, guest, privateReader('reza', 'outside-scope'), privateReader('parastoo', 'outside-scope'), privateReader('arman', 'outside-scope'),
      groupReader('leads', 'other-group'), guestGroup],
    insiders: [privateReader('sina', 'insider')] },
  { name: 'org', marker: 'CANARY_S06_ORG_48', words: 'meridian offsite venue', scope: { kind: 'org' }, auth: ['arman', 'milad', 'parastoo', 'reza', 'sina'], sensitivity: 'normal',
    outsiders: [stranger, guest, groupReader('gameend-team', 'other-group'), groupReader('leads', 'other-group'), guestGroup],
    insiders: [privateReader('arman', 'insider'), privateReader('sina', 'insider')] },
];

const content = (c: Case) => `The ${c.words} detail is ${c.marker}`;
const query = (c: Case) => `Aria, what is the ${c.words} detail?`;
let event = 0;

function newMemory(c: Case, extra: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria',
    content: content(c),
    type: 'fact',
    scope: c.scope,
    authorizedPersonIds: [...c.auth],
    sensitivity: c.sensitivity,
    source: { personId: c.auth.includes('reza') ? 'reza' : c.auth[0], chatKind: c.scope.kind === 'group' ? 'group' : 'private', ...(c.scope.kind === 'group' ? { groupId: c.scope.groupId } : {}), eventIds: [`neg-${++event}`], at: new Date('2026-10-15T09:00:00Z') },
    aboutPersonIds: [],
    topic: c.words,
    confidence: 0.9,
    ...extra,
  };
}

const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllEnvs(); });

function storeOf(kind: 'memory' | 'file'): MemoryStore {
  if (kind === 'memory') return new InMemoryMemoryStore();
  const dir = mkdtempSync(join(tmpdir(), 'tireh-negative-'));
  dirs.push(dir);
  return createFileStores(join(dir, 'state.json')).memories;
}

describe.each(['memory', 'file'] as const)('negative identity through selectMemories (%s store)', (storeKind) => {
  for (const c of CASES) {
    it(`${c.name}: every outsider gets zero rows in v1 and v2, and an insider gets the record`, async () => {
      const store = storeOf(storeKind);
      const written = await store.add(newMemory(c));
      const active = await store.listActive('aria');
      expect(active.map((m) => m.id)).toEqual([written.id]);
      for (const mode of ['v1', 'v2'] as const) {
        for (const reader of c.outsiders) {
          const rows = selectMemories(org, active, reader.chat, { query: query(c), mode, now: EVAL_NOW });
          expect([c.name, mode, reader.label, reader.kind, rows.length]).toEqual([c.name, mode, reader.label, reader.kind, 0]);
          expect(audienceScopeKeys(org, reader.chat)).not.toContain(scopeKey(written.scope));
        }
        for (const reader of c.insiders) {
          const rows = selectMemories(org, active, reader.chat, { query: query(c), mode, now: EVAL_NOW });
          expect([c.name, mode, reader.label, rows.map((m) => m.id)]).toEqual([c.name, mode, reader.label, [written.id]]);
        }
      }
    });
  }
});

function gatewayFor(orgDirectory: OrgDirectory) {
  const llm = new FakeLLM();
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  history.bindMemoryStore(memories);
  const bot = fakeBot();
  const gateway = new PersonaGateway({
    org: orgDirectory,
    llm,
    memories,
    offers: new InMemoryShareOfferStore(),
    history,
    deduper: new InMemoryUpdateDeduper(),
    voice: null,
    botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => EVAL_NOW,
  });
  const observed = () => JSON.stringify([llm.replyRequests, llm.extractionRequests, llm.replyPrompts, bot.sent, [...history.chats.entries()]]);
  return { gateway, llm, memories, observed };
}

describe.each([['unset', ''], ['TIREH_RETRIEVAL_V2=1', '1']])('negative identity through the full gateway pipeline (%s)', (_label, flag) => {
  for (const c of CASES) {
    it(`${c.name}: no outsider prompt, reply, bot message or history row contains the canary`, async () => {
      vi.stubEnv('TIREH_RETRIEVAL_V2', flag);
      const outcomes: string[] = [];
      for (const reader of c.outsiders) {
        const { gateway, memories, observed } = gatewayFor(reader.guestOrg ? guestOrg : org);
        await memories.add(newMemory(c));
        outcomes.push(await gateway.handleUpdate('aria', reader.update(query(c))));
        expect([c.name, reader.label, observed().includes(c.marker)]).toEqual([c.name, reader.label, false]);
      }
      // Most outsiders do get a reply composed: the canary is absent from a real prompt, not from a skipped turn.
      expect(outcomes.filter((o) => o === 'replied').length).toBeGreaterThanOrEqual(c.outsiders.length - 2);
      expect(outcomes).toContain('stranger');
    });
  }

  for (const c of CASES.filter((x) => x.sensitivity === 'normal')) {
    it(`${c.name}: positive control, an insider's reply prompt carries the record`, async () => {
      vi.stubEnv('TIREH_RETRIEVAL_V2', flag);
      const reader = c.insiders[0];
      const { gateway, memories, llm } = gatewayFor(org);
      await memories.add(newMemory(c));
      expect(await gateway.handleUpdate('aria', reader.update(query(c)))).toBe('replied');
      expect(JSON.stringify(llm.replyRequests)).toContain(c.marker);
    });
  }
});

describe('negative identity through the vector path (index ignores every filter)', () => {
  it('vectorCandidates + listActive + selectMemories return zero canary rows for every outsider', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const provider = new FakeEmbeddingProvider();
    const fake = fakeFirestore({ ignoreNearestFilters: true });
    const store = vectorStore(fake.db);
    const written = new Map<string, MemoryRecord>();
    for (const c of CASES) {
      const [embedding] = await provider.embed([content(c)]);
      written.set(c.name, await store.add(newMemory(c, { embedding, embeddingModel: provider.model, embeddingVersion: provider.version })));
    }
    // Rows a correct store would never hold or return: a personal record that
    // still has an embedding, and another persona's org record.
    for (const c of CASES.filter((x) => x.sensitivity !== 'normal')) {
      const [embedding] = await provider.embed([content(c)]);
      fake.data.set(`tireh_memories/raw-${c.marker}`, {
        ...newMemory(c), embedding, embeddingModel: provider.model, embeddingVersion: 1,
        createdAt: new Date('2026-10-15T09:00:00Z'), updatedAt: new Date('2026-10-15T09:00:00Z'), active: true, scopeKey: scopeKey(c.scope),
      });
    }
    for (const c of CASES) {
      const [embedding] = await provider.embed([content(c)]);
      fake.data.set(`tireh_memories/zeta-${c.marker}`, {
        ...newMemory(c), personaId: 'zeta', scope: { kind: 'org' }, authorizedPersonIds: ['arman', 'milad', 'negar', 'parastoo', 'reza', 'sina', 'stranger'], sensitivity: 'normal', embedding,
        createdAt: new Date('2026-10-15T09:00:00Z'), updatedAt: new Date('2026-10-15T09:00:00Z'), active: true, scopeKey: 'org',
      });
    }

    for (const c of CASES) {
      const [queryEmbedding] = await provider.embed([query(c)]);
      for (const reader of c.outsiders) {
        const candidates = await vectorCandidates(store, org, 'aria', reader.chat, queryEmbedding);
        const active = await store.listActive('aria');
        const union = [...new Map([...active, ...candidates].map((m) => [m.id, m])).values()];
        const rows = selectMemories(org, union, reader.chat, { query: query(c), now: EVAL_NOW, queryEmbedding });
        expect([c.name, reader.label, rows.filter((m) => m.content.includes(c.marker)).map((m) => m.id)]).toEqual([c.name, reader.label, []]);
        expect(candidates.every((m) => m.personaId === 'aria')).toBe(true);
      }
      for (const reader of c.insiders) {
        const candidates = await vectorCandidates(store, org, 'aria', reader.chat, queryEmbedding);
        const union = [...new Map([...(await store.listActive('aria')), ...candidates].map((m) => [m.id, m])).values()];
        const rows = selectMemories(org, union, reader.chat, { query: query(c), now: EVAL_NOW, queryEmbedding });
        expect([c.name, reader.label, rows.some((m) => m.id === written.get(c.name)!.id)]).toEqual([c.name, reader.label, true]);
      }
    }
    expect(fake.nearest.length).toBeGreaterThan(0);
  });
});
