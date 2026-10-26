/**
 * Privacy red team, Wave A round 1 (agent-intelligence-wave-a).
 *
 * 1. Paired-conversation invariance: two runtimes that differ only in records
 *    the audience may not see send byte-identical provider requests and
 *    Telegram output, under the base and under TIREH_RETRIEVAL_V2 plus
 *    TIREH_CACHED_PROMPT.
 * 2. Negative-identity retrieval through the v2 path: a record about the
 *    reader, worded like the query and carrying the query's own embedding,
 *    never ranks into a chat whose audience it does not authorize, even
 *    when a vector store returns it as a candidate.
 * 3. Content-free rows: with TIREH_DECISION_LOG, TRIAGE_QUESTION_SET=v2,
 *    TIREH_AUDIT_LOG and TIREH_SHARING_V2 on, the bytes written by the
 *    decision log, the audit log and the supersede notices carry no message
 *    text, memory content, topic or name, across write, supersede, share and
 *    forget.
 *
 * Offline: fake models, fake decider, in-memory or $TMPDIR file stores.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { auditMemoryStore, auditShareOfferStore, createFileAuditStore, createFileSupersededNoticeStore } from '../audit';
import { createDecisionLogSink, createFileDecisionLogStore } from '../decisions/log';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper, type MemoryStore } from '../memory/store';
import { ownerSharePatch } from '../memory/sharing';
import { audienceScopeKeys, selectMemories, vectorCandidates } from '../memory/retrieval';
import { scopeKey } from '../memory/visibility';
import type { DecideDetail, DecisionAnswer, DecisionQuestion } from '../triage';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext, MemoryRecord } from '../types';
import { FakeLLM, fakeBot, GAMEEND_CHAT, groupText, memory, privateText, TG, testOrg } from './fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const AT = new Date('2026-10-12T09:00:00Z');

/** Records every reader of the paired runs may see. Same ids and times in both runtimes. */
function visibleRecords(): MemoryRecord[] {
  return [
    memory({ id: 'vis-reza', content: 'Reza prefers short written updates about the launch review', scope: { kind: 'private', personId: 'reza' }, aboutPersonIds: ['reza'], updatedAt: AT, createdAt: AT }),
    memory({ id: 'vis-group', content: 'GameEnd launch review is on Friday', scope: { kind: 'group', groupId: 'gameend-team' },
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', at: AT }, updatedAt: AT, createdAt: AT }),
  ];
}

/**
 * Records worded to match the query, each aimed at one fence: private scope,
 * an exact-recipient record about the reader, personal sensitivity, another
 * group, and a group record whose authorization snapshot predates a current
 * member (Milad). Reza belongs to Leads and to the snapshot, so in his
 * private chat only the first three are hidden; in the GameEnd group, where
 * Milad is a reader, all five are.
 */
function hiddenRecords(chat: 'private' | 'group' = 'group'): MemoryRecord[] {
  const secret = (id: string, content: string, partial: Partial<MemoryRecord> & Pick<MemoryRecord, 'scope'>): MemoryRecord =>
    memory({ id, content, updatedAt: AT, createdAt: AT, embedding: [1, 0, 0], embeddingModel: 'test', embeddingVersion: 1, ...partial });
  return [
    secret('hid-sina', 'SINACANARY Sina private plan for the launch review', { scope: { kind: 'private', personId: 'sina' }, source: { personId: 'sina', chatKind: 'private', at: AT } }),
    secret('hid-about-reza', 'REZACANARY Reza launch review went badly, consider replacing Reza', { scope: { kind: 'people', personIds: ['milad', 'parastoo'] },
      source: { personId: 'parastoo', chatKind: 'private', at: AT }, aboutPersonIds: ['reza'], type: 'decision' }),
    secret('hid-personal', 'PERSONALCANARY Parastoo health appointment before the launch review', { scope: { kind: 'private', personId: 'parastoo' },
      source: { personId: 'parastoo', chatKind: 'private', at: AT }, sensitivity: 'personal', embedding: undefined, embeddingModel: undefined, embeddingVersion: undefined }),
    secret('hid-leads', 'LEADSCANARY Leads group launch review budget cut', { scope: { kind: 'group', groupId: 'leads' },
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'leads', at: AT } }),
    secret('hid-snapshot', 'SNAPCANARY GameEnd launch review salary numbers', { scope: { kind: 'group', groupId: 'gameend-team' },
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', at: AT }, authorizedPersonIds: ['parastoo', 'reza'] }),
  ].slice(0, chat === 'private' ? 3 : 5);
}

const CANARIES = ['SINACANARY', 'REZACANARY', 'PERSONALCANARY', 'LEADSCANARY', 'SNAPCANARY'];

async function pairedRun(withHidden: boolean, send: 'private' | 'group') {
  const llm = new FakeLLM();
  llm.nextReply = 'PAIRED_REPLY';
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  // Interleave hidden rows so store order differs as little as possible.
  const hidden = withHidden ? hiddenRecords(send) : [];
  for (const record of [hidden[0], ...visibleRecords().slice(0, 1), ...hidden.slice(1, 3), ...visibleRecords().slice(1), ...hidden.slice(3)].filter(Boolean)) {
    memories.records.set(record.id, record);
  }
  const bot = fakeBot();
  const gateway = new PersonaGateway({
    org: testOrg(), llm, memories, offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const query = 'What do you remember about the launch review, Reza, Sina, Parastoo, Leads, salary, budget and replacing anyone?';
  const update = send === 'private'
    ? { ...privateText(TG.reza, query), update_id: 880_001 }
    : { ...groupText(GAMEEND_CHAT, TG.milad, `@hoor_aria_bot ${query}`), update_id: 880_002 };
  update.message!.message_id = 88_001;
  const result = await gateway.handleUpdate('aria', update);
  return { result, llm, bot };
}

const FLAG_SETS: Array<[string, Record<string, string>]> = [
  ['flags unset', {}],
  ['TIREH_RETRIEVAL_V2 + TIREH_CACHED_PROMPT', { TIREH_RETRIEVAL_V2: '1', TIREH_CACHED_PROMPT: '1' }],
  ['TIREH_RETRIEVAL_V2 + TIREH_CACHED_PROMPT + TIREH_PROMPT_SYSTEM_TAIL', { TIREH_RETRIEVAL_V2: '1', TIREH_CACHED_PROMPT: '1', TIREH_PROMPT_SYSTEM_TAIL: '1' }],
];

describe('red team: paired-conversation invariance', () => {
  for (const [label, env] of FLAG_SETS) {
    for (const send of ['private', 'group'] as const) {
      it(`${send} chat, ${label}: hidden records change nothing a provider or Telegram receives`, async () => {
        vi.stubEnv('TIREH_RETRIEVAL_V2', '');
        vi.stubEnv('TIREH_CACHED_PROMPT', '');
        vi.stubEnv('TIREH_PROMPT_SYSTEM_TAIL', '');
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
        const without = await pairedRun(false, send);
        const withHidden = await pairedRun(true, send);
        expect(withHidden.result).toBe('replied');
        expect(withHidden.result).toBe(without.result);
        expect(withHidden.llm.replyRequests).toEqual(without.llm.replyRequests);
        expect(withHidden.llm.extractionRequests).toEqual(without.llm.extractionRequests);
        expect(withHidden.bot.sent).toEqual(without.bot.sent);
        const outbound = JSON.stringify([withHidden.llm.replyRequests, withHidden.llm.extractionRequests, withHidden.bot.sent]);
        for (const canary of CANARIES.slice(0, send === 'private' ? 3 : 5)) expect(outbound).not.toContain(canary);
        // The visible records did reach the model, so the comparison is not vacuous.
        expect(JSON.stringify(withHidden.llm.replyRequests)).toContain(send === 'private' ? 'Reza prefers short written updates' : 'GameEnd launch review is on Friday');
      });
    }
  }
});

describe('red team: negative-identity retrieval through the v2 path', () => {
  const org = testOrg();
  const reza: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
  const group = (): ChatContext => {
    const g = org.getGroupByChatId(GAMEEND_CHAT)!;
    return { kind: 'group', chatKey: `group-${g.id}`, group: g };
  };
  const query = 'Reza launch review replacing Reza Sina plan salary Leads budget Parastoo health';

  const hiddenFor = (chat: ChatContext) => new Set(hiddenRecords(chat.kind === 'group' ? 'group' : 'private').map((m) => m.id));

  it('a hidden record about the reader, with the query embedding and the query words, never ranks in', () => {
    const all = [...visibleRecords(), ...hiddenRecords()];
    for (const chat of [reza, group()]) {
      const hidden = hiddenFor(chat);
      const picked = selectMemories(org, all, chat, { query, mode: 'v2', queryEmbedding: [1, 0, 0], limit: 50, now: new Date('2026-10-19T10:00:00Z') });
      for (const m of picked) expect(hidden.has(m.id), `${m.id} leaked into ${chat.chatKey}`).toBe(false);
      expect(picked.length).toBeGreaterThan(0);
    }
  });

  it('v2 never admits a record v1 would refuse, for any reader or chat', () => {
    const all = [...visibleRecords(), ...hiddenRecords()];
    const chats: ChatContext[] = [reza, group(), ...['parastoo', 'milad', 'sina'].map((id) => ({ kind: 'private' as const, chatKey: `private-${id}`, personId: id }))];
    for (const chat of chats) {
      const ids = (mode: 'v1' | 'v2') => selectMemories(org, all, chat, { query, mode, limit: 50, ...(mode === 'v2' ? { queryEmbedding: [1, 0, 0] } : {}) }).map((m) => m.id).sort();
      // v2 may drop near-duplicates (cosine > 0.92), so it is a subset of v1, never a superset.
      const v1 = new Set(ids('v1'));
      for (const id of ids('v2')) expect(v1.has(id), `${id} admitted by v2 only in ${chat.chatKey}`).toBe(true);
    }
  });

  it('a vector store that ignores its scope pre-filter cannot widen the audience', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const all = [...visibleRecords(), ...hiddenRecords()];
    const askedKeys: string[][] = [];
    // A broken index: returns every active row, whatever keys it was given.
    const broken: Pick<MemoryStore, 'findNearest'> = { findNearest: async (_persona, keys) => { askedKeys.push(keys); return all; } };
    for (const chat of [reza, group()]) {
      const hidden = hiddenFor(chat);
      const candidates = await vectorCandidates(broken, org, 'aria', chat, [1, 0, 0]);
      const union = [...new Map([...all, ...candidates].map((m) => [m.id, m])).values()];
      const picked = selectMemories(org, union, chat, { query, queryEmbedding: [1, 0, 0], limit: 50 });
      for (const m of picked) expect(hidden.has(m.id), `${m.id} leaked into ${chat.chatKey}`).toBe(false);
      expect(candidates.length).toBeGreaterThan(0);
    }
    // The pre-filter itself never names another person's private scope.
    const flat = askedKeys.flat();
    expect(flat).not.toContain(scopeKey({ kind: 'private', personId: 'sina' }));
    expect(flat).not.toContain(scopeKey({ kind: 'private', personId: 'parastoo' }));
    expect(audienceScopeKeys(org, reza)).toContain(scopeKey({ kind: 'private', personId: 'reza' }));
  });
});

describe('red team: decision log, audit rows and notices carry no content', () => {
  const MESSAGE = 'MSGCANARY remember that the Q3 budget for Kestrel is 4.2M تومان';
  const CORRECTION = 'MSGCANARY2 correction: the Kestrel budget is now 5.1M';
  const CONTENT = 'CONTENTCANARY Kestrel Q3 budget is 4.2M';
  const CONTENT2 = 'CONTENTCANARY2 Kestrel Q3 budget is 5.1M';
  const TOPIC = 'topiccanary kestrel budget';
  const FORBIDDEN = ['MSGCANARY', 'CONTENTCANARY', 'topiccanary', 'Kestrel', 'kestrel', 'budget', '4.2M', '5.1M', 'تومان', 'Reza', 'Parastoo', 'Aria', String(TG.reza), String(TG.parastoo)];

  it('write, supersede, share, supersede-notice and forget leave only ids, codes and numbers on disk', async () => {
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const dir = mkdtempSync(join(tmpdir(), 'vox-redteam-'));
    try {
      const paths = { decisions: join(dir, 'decision-log.jsonl'), audit: join(dir, 'vox-audit.jsonl'), notices: join(dir, 'notices.json') };
      const sink = createDecisionLogSink(createFileDecisionLogStore(paths.decisions), { enabled: () => true });
      const audit = createFileAuditStore(paths.audit);
      const notices = createFileSupersededNoticeStore(paths.notices);
      const epochs = new Map<string, number>();
      const memories = auditMemoryStore(new InMemoryMemoryStore(epochs), audit, notices);
      const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
      const answers = (questions: DecisionQuestion[]): Record<string, DecisionAnswer> => Object.fromEntries(questions.map((q): [string, DecisionAnswer] =>
        [q.name, q.type === 'predicate' ? { type: 'predicate', probability: q.name === 'memorable' ? 0.95 : 0.2 }
          : q.type === 'choice' ? { type: 'choice', choice: q.choices[0].value, confidence: 0.8, probabilities: q.choices.map((c, i) => ({ value: c.value, probability: i === 0 ? 0.8 : 0.2 / (q.choices.length - 1) })) }
            : { type: 'score', score: 1, confidence: 0.8 }]));
      const decider = {
        decide: vi.fn(async (_input: string, questions: DecisionQuestion[]) => answers(questions)),
        decideDetailed: vi.fn(async (_input: string, questions: DecisionQuestion[]): Promise<DecideDetail> => ({ answers: answers(questions), elapsedMs: 12, inputTokens: 345, outcome: 'answered' })),
      };
      const llm = new FakeLLM();
      llm.nextReply = 'REPLYCANARY noted the Kestrel budget';
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const org = testOrg();
      const gateway = new PersonaGateway({
        org, llm, memories, offers, history: new InMemoryChatHistoryStore(epochs), deduper: new InMemoryUpdateDeduper(), voice: null,
        botFor: () => fakeBot() as unknown as TelegramBotClient, logger, decider, decisionLog: sink, now: () => new Date('2026-10-19T10:00:00Z'),
      });

      llm.nextExtraction = { memories: [{ content: CONTENT, type: 'fact', kind: 'work', topic: TOPIC, saidBy: 'reza', about: ['reza'], confidence: 0.9 }] };
      expect(await gateway.handleUpdate('aria', privateText(TG.reza, MESSAGE))).toBe('replied');
      const first = (await memories.listActive('aria')).find((m) => m.content === CONTENT);
      expect(first, 'the extraction wrote the record').toBeTruthy();

      // The owner shares it with Parastoo (people scope), then corrects it: a supersede plus a notice for Parastoo.
      expect(await memories.updateIfShareVersion(first!.id, first!.shareVersion ?? 0, ownerSharePatch(org, first!, 'reza', ['parastoo']))).toBe(true);
      const shared = (await memories.get(first!.id))!;
      await memories.add({ ...shared, content: CONTENT2, supersedes: shared.id, supersededBy: undefined } as Parameters<MemoryStore['add']>[0]);

      llm.nextExtraction = { memories: [{ content: CONTENT2, type: 'fact', kind: 'work', topic: TOPIC, saidBy: 'reza', about: ['reza'], confidence: 0.9 }] };
      expect(await gateway.handleUpdate('aria', privateText(TG.reza, CORRECTION))).toBe('replied');

      // The notice as recorded, before the forget erases it (fixer r1: a deleted memory leaves no notice naming it).
      const recordedNoticeBytes = existsSync(paths.notices) ? readFileSync(paths.notices, 'utf8') : '';
      for (const m of await memories.listActive('aria')) await gateway.forgetMemory('aria', m.id);
      await sink.flush();

      const decisionBytes = readFileSync(paths.decisions, 'utf8');
      const auditBytes = readFileSync(paths.audit, 'utf8');
      const noticeBytes = existsSync(paths.notices) ? readFileSync(paths.notices, 'utf8') : '';
      // Non-vacuous: rows of every expected kind were written.
      expect(decisionBytes.trim().split('\n').length).toBeGreaterThanOrEqual(2);
      expect(decisionBytes).toContain('"questionSetVersion":"v2"');
      expect(decisionBytes).toContain('personal_life');
      for (const kind of ['"write"', '"share_approve"', '"supersede"', '"delete"']) expect(auditBytes).toContain(kind);
      expect(recordedNoticeBytes).toContain('parastoo');
      expect(noticeBytes, 'the forget erased the notice').not.toContain('parastoo');

      const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
      for (const [label, bytes] of [['decision log', decisionBytes], ['audit', auditBytes], ['notices', recordedNoticeBytes], ['logger', logged]] as const) {
        for (const forbidden of FORBIDDEN) expect(bytes, `${label} contains ${forbidden}`).not.toContain(forbidden);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
