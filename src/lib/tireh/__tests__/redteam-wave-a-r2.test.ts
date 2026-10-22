/**
 * Privacy red team, Wave A round 2 (agent-intelligence-wave-a).
 *
 * Round 1 covered the reply and extraction requests. Round 2 attacks the new
 * side channels Wave A added around them:
 *
 * 1. Paired-conversation invariance through the decider, the image triage
 *    parts and the decision log: two runtimes that differ only in records the
 *    audience may not see and in other chats' history send identical decider
 *    inputs (text, structured parts with the image), write identical
 *    decision-log rows and send identical provider requests and Telegram
 *    output, with every text and image flag on.
 * 2. Image of a sensitive document never stored: a passport scan sent as a
 *    JPEG document with an explicit "remember this" request, with every
 *    Wave A flag on, never reaches history, memory, extraction, the decision
 *    log, vox_audit, the supersede notices or a log line, on that turn or any
 *    later one, and its EXIF and comment segments never reach a provider.
 * 3. Negative identity through successor inheritance and the admin
 *    re-snapshot: for every reader, chat and retrieval mode, a successor's
 *    inherited records never show anyone more than the predecessor's did, and
 *    a re-snapshot for one named member changes nothing for any chat that
 *    member is not in and only adds normal records of that group.
 *
 * Offline: fake models, a scripted decider, in-memory or $TMPDIR file stores.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { auditMemoryStore, auditShareOfferStore, createFileAuditStore, createFileSupersededNoticeStore } from '../audit';
import { createDecisionLogSink, createFileDecisionLogStore, InMemoryDecisionLogStore } from '../decisions/log';
import { IMAGE_WITHHELD_REPLY_TEXT } from '../images';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { isSuccessorTransferable, resnapshotPatch, successorCopy } from '../memory/sharing';
import { selectMemories } from '../memory/retrieval';
import { audienceOf } from '../memory/visibility';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { DecideDetail, DecisionAnswer, DecisionQuestion, DeciderPart } from '../triage';
import type { TelegramBotClient, TelegramUpdate } from '../telegram/client';
import type { ChatContext, ChatMessage, MemoryRecord } from '../types';
import { GAMEEND_CHAT, groupText, memory, privateText, TG, testOrg } from './fixtures';
import { imageBot, photoLadder, privateDocument, privatePhoto, tinyJpeg, VisionFakeLLM } from './images-fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const AT = new Date('2026-10-12T09:00:00Z');
const NOW = new Date('2026-10-19T10:00:00Z');

/** Every Wave A server flag this file touches, pinned so an exported value cannot leak into a case. */
const ALL_FLAGS = ['STUDIO_IMAGES', 'TIREH_DECISION_LOG', 'TRIAGE_QUESTION_SET', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_CACHED_PROMPT',
  'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_AUDIT_LOG', 'TIREH_SHARING_V2', 'STUDIO_DECIDER', 'STUDIO_VOICE_RECOGNITION'] as const;
function setFlags(on: Record<string, string>) {
  for (const flag of ALL_FLAGS) vi.stubEnv(flag, '');
  for (const [key, value] of Object.entries(on)) vi.stubEnv(key, value);
}

type Answers = Record<string, DecisionAnswer>;

/** Deterministic answers for any catalogue question; image questions get a non-sensitive "explain" unless overridden. */
function scripted(questions: readonly DecisionQuestion[], image: Answers = {}): Answers {
  return Object.fromEntries(questions.map((q): [string, DecisionAnswer] => {
    if (image[q.name]) return [q.name, image[q.name]];
    if (q.type === 'predicate') return [q.name, { type: 'predicate', probability: q.name === 'memorable' ? 0.95 : 0.2 }];
    if (q.type === 'choice') {
      const choice = q.name === 'effort' ? 'thoughtful' : q.choices[0].value;
      return [q.name, { type: 'choice', choice, confidence: 0.8, probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === choice ? 0.8 : 0.2 / (q.choices.length - 1) })) }];
    }
    return [q.name, { type: 'score', score: 1, confidence: 0.8 }];
  }));
}

/** Records every decider call (method, input, questions, timeout) exactly as the provider seam would receive it. */
function recordingDecider(image: Answers = {}) {
  const calls: Array<[string, unknown, DecisionQuestion[], number | undefined]> = [];
  return {
    calls,
    decide: vi.fn(async (input: string, questions: DecisionQuestion[], timeoutMs?: number) => {
      calls.push(['decide', input, structuredClone(questions), timeoutMs]);
      return scripted(questions, image);
    }),
    decideDetailed: vi.fn(async (input: string, questions: DecisionQuestion[], timeoutMs?: number): Promise<DecideDetail> => {
      calls.push(['decideDetailed', input, structuredClone(questions), timeoutMs]);
      return { answers: scripted(questions, image), elapsedMs: 12, inputTokens: 345, outcome: 'answered' };
    }),
    decideParts: vi.fn(async (input: readonly DeciderPart[], questions: DecisionQuestion[], timeoutMs?: number) => {
      calls.push(['decideParts', structuredClone(input), structuredClone(questions), timeoutMs]);
      return scripted(questions, image);
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. Paired invariance through the decider, image triage and decision log
// ---------------------------------------------------------------------------

const visible = (): MemoryRecord[] => [
  memory({ id: 'vis-reza', content: 'Reza prefers short written updates about the launch review', scope: { kind: 'private', personId: 'reza' }, aboutPersonIds: ['reza'], updatedAt: AT, createdAt: AT }),
  memory({ id: 'vis-group', content: 'GameEnd launch review is on Friday', scope: { kind: 'group', groupId: 'gameend-team' },
    source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', at: AT }, updatedAt: AT, createdAt: AT }),
];

/** Worded like the query; each aims at one fence. In Reza's private chat the first three are hidden, in GameEnd all five. */
function hidden(kind: 'private' | 'group'): MemoryRecord[] {
  const secret = (id: string, content: string, partial: Partial<MemoryRecord> & Pick<MemoryRecord, 'scope'>) =>
    memory({ id, content, updatedAt: AT, createdAt: AT, embedding: [1, 0, 0], embeddingModel: 'test', embeddingVersion: 1, ...partial });
  return [
    secret('r2-sina', 'R2SINACANARY Sina private plan for the launch review photo', { scope: { kind: 'private', personId: 'sina' }, source: { personId: 'sina', chatKind: 'private', at: AT } }),
    secret('r2-about-reza', 'R2ABOUTREZACANARY launch review photo: consider replacing Reza', { scope: { kind: 'people', personIds: ['milad', 'parastoo'] },
      source: { personId: 'parastoo', chatKind: 'private', at: AT }, aboutPersonIds: ['reza'], type: 'decision' }),
    secret('r2-personal', 'R2PERSONALCANARY Parastoo medical scan before the launch review', { scope: { kind: 'private', personId: 'parastoo' },
      source: { personId: 'parastoo', chatKind: 'private', at: AT }, sensitivity: 'personal', embedding: undefined, embeddingModel: undefined, embeddingVersion: undefined }),
    secret('r2-leads', 'R2LEADSCANARY Leads launch review budget cut photo', { scope: { kind: 'group', groupId: 'leads' },
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'leads', at: AT } }),
    secret('r2-snapshot', 'R2SNAPCANARY GameEnd launch review salary numbers', { scope: { kind: 'group', groupId: 'gameend-team' },
      source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', at: AT }, authorizedPersonIds: ['parastoo', 'reza'] }),
  ].slice(0, kind === 'private' ? 3 : 5);
}

/** Other chats' retained turns: never part of this chat's triage window, prompt or log row. */
const HIDDEN_HISTORY: Record<string, ChatMessage[]> = {
  'aria:private-sina': [
    { role: 'user', personId: 'sina', text: 'R2HISTCANARY Sina: my visa interview photo is attached', at: AT },
    { role: 'assistant', text: 'R2HISTCANARY noted your visa interview', at: AT },
  ],
  'aria:group-leads': [
    { role: 'user', personId: 'parastoo', text: 'R2LEADSHISTCANARY Leads: the launch review budget is cut', at: AT, groupPolicyVersion: 1, telegramMessageId: 1 },
  ],
};

const CANARIES = ['R2SINACANARY', 'R2ABOUTREZACANARY', 'R2PERSONALCANARY', 'R2LEADSCANARY', 'R2SNAPCANARY', 'R2HISTCANARY', 'R2LEADSHISTCANARY'];
const QUERY = 'What do you remember about the launch review photo, Reza, Sina, Parastoo, Leads, salary, visa, budget and replacing anyone?';

type Send = 'private-text' | 'private-photo' | 'group-text';

async function pairedRun(withHidden: boolean, send: Send) {
  const llm = new VisionFakeLLM('claude-fable-5-1');
  const fast = new VisionFakeLLM('claude-haiku-5-5');
  llm.nextReply = 'PAIRED_REPLY';
  fast.nextReply = 'PAIRED_REPLY';
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const secrets = withHidden ? hidden(send === 'group-text' ? 'group' : 'private') : [];
  // Interleave hidden rows so store order differs as little as possible.
  for (const record of [secrets[0], visible()[0], ...secrets.slice(1, 3), visible()[1], ...secrets.slice(3)].filter(Boolean)) memories.records.set(record.id, record);
  if (withHidden) for (const [key, rows] of Object.entries(HIDDEN_HISTORY)) history.chats.set(key, rows.map((m) => ({ ...m })));
  const ladder = photoLadder('r2p', undefined);
  const bot = imageBot(ladder.files);
  const decider = recordingDecider();
  const logStore = new InMemoryDecisionLogStore();
  const sink = createDecisionLogSink(logStore, { enabled: () => true, now: () => NOW });
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider, decisionLog: sink, memories, offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => NOW,
  });
  let update: TelegramUpdate;
  if (send === 'private-text') update = privateText(TG.reza, QUERY);
  else if (send === 'private-photo') update = privatePhoto(TG.reza, ladder.sizes, QUERY);
  else update = groupText(GAMEEND_CHAT, TG.milad, `@hoor_aria_bot ${QUERY}`);
  update = { ...update, update_id: 990_001, message: { ...update.message!, message_id: 99_001 } };
  const result = await gateway.handleUpdate('aria', update);
  await sink.flush();
  // Row ids are random UUIDs; everything else must match across the pair.
  const rows = logStore.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && key !== 'at')));
  return { result, llm, fast, bot, decider, rows };
}

const PAIRED_FLAGS: Array<[string, Record<string, string>]> = [
  ['images + decision log v2 + retrieval v2 + cached prompt', { STUDIO_IMAGES: '1', TIREH_DECISION_LOG: '1', TRIAGE_QUESTION_SET: 'v2', TIREH_RETRIEVAL_V2: '1', TIREH_CACHED_PROMPT: '1' }],
  ['images + decision log v2-live + system tail + sharing v2 + audit', { STUDIO_IMAGES: '1', TIREH_DECISION_LOG: '1', TRIAGE_QUESTION_SET: 'v2-live', TIREH_RETRIEVAL_V2: '1',
    TIREH_CACHED_PROMPT: '1', TIREH_PROMPT_SYSTEM_TAIL: '1', TIREH_SHARING_V2: '1', TIREH_AUDIT_LOG: '1' }],
];

describe('red team r2: paired invariance through the decider, image triage and decision log', () => {
  for (const [label, flags] of PAIRED_FLAGS) {
    for (const send of ['private-text', 'private-photo', 'group-text'] as const) {
      it(`${send}, ${label}: hidden records and other chats' history change nothing the decider, the log, a provider or Telegram sees`, async () => {
        setFlags(flags);
        const without = await pairedRun(false, send);
        const withHidden = await pairedRun(true, send);
        expect(withHidden.result).toBe('replied');
        expect(withHidden.result).toBe(without.result);
        expect(withHidden.decider.calls).toEqual(without.decider.calls);
        expect(withHidden.rows).toEqual(without.rows);
        expect(withHidden.llm.replyRequests).toEqual(without.llm.replyRequests);
        expect(withHidden.fast.replyRequests).toEqual(without.fast.replyRequests);
        expect(withHidden.llm.extractionRequests).toEqual(without.llm.extractionRequests);
        expect(withHidden.fast.extractionRequests).toEqual(without.fast.extractionRequests);
        expect(withHidden.bot.sent).toEqual(without.bot.sent);

        const outbound = JSON.stringify([withHidden.decider.calls, withHidden.rows, withHidden.llm.replyRequests, withHidden.fast.replyRequests,
          withHidden.llm.extractionRequests, withHidden.fast.extractionRequests, withHidden.bot.sent]);
        for (const canary of CANARIES) expect(outbound, `${canary} left the process`).not.toContain(canary);

        // Non-vacuous: the decider ran (with the image on a photo turn), rows were logged, visible memory reached the model.
        expect(withHidden.decider.calls.some(([method]) => method === 'decideDetailed')).toBe(true);
        expect(withHidden.decider.calls.some(([method]) => method === 'decideParts')).toBe(send === 'private-photo');
        expect(withHidden.rows.length).toBeGreaterThan(0);
        expect(withHidden.rows[0].questionSetVersion).toBe(flags.TRIAGE_QUESTION_SET);
        const replies = JSON.stringify([withHidden.llm.replyRequests, withHidden.fast.replyRequests]);
        expect(replies).toContain(send === 'group-text' ? 'GameEnd launch review is on Friday' : 'Reza prefers short written updates');
        if (send === 'private-photo') expect(replies).toContain('"images"');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. A sensitive document image is never stored, with every Wave A flag on
// ---------------------------------------------------------------------------

const DOC = 'R2DOCCANARY-P12345678';
const EXIF = 'R2EXIFCANARY-GPS-35.6892N-51.3890E';
const COMMENT = 'R2COMMENTCANARY-scanner-serial';
const FILE_NAME = 'passport-R2FILECANARY.jpg';
const CAPTION = 'remember this please, it is my passport R2CAPTIONCANARY';

const requestText = (r: Pick<LLMRequest, 'system' | 'messages'> & { systemTail?: string }) =>
  [systemText(r.system), ...r.messages.flatMap((m) => [m.content, ...(m.trailingText ?? [])]), r.systemTail ?? ''].join('\n');

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      const seen = requestText(request);
      this.nextExtraction = seen.includes(DOC)
        ? { memories: [{ content: `Reza's passport number is ${DOC}`, type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.95 }] }
        : { memories: [{ content: 'Reza is renewing travel documents this month', type: 'fact', kind: 'work', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] };
    }
    return super.complete(request);
  }
}

describe('red team r2: an image of a sensitive document is never stored', () => {
  it('a passport scan sent as a JPEG document with "remember this" leaves nothing in any Wave A store, log or later prompt', async () => {
    setFlags({ STUDIO_IMAGES: '1', TIREH_DECISION_LOG: '1', TRIAGE_QUESTION_SET: 'v2', TIREH_RETRIEVAL_V2: '1', TIREH_CACHED_PROMPT: '1',
      TIREH_AUDIT_LOG: '1', TIREH_SHARING_V2: '1' });
    const dir = mkdtempSync(join(tmpdir(), 'vox-redteam-r2-'));
    try {
      const paths = { decisions: join(dir, 'decision-log.jsonl'), audit: join(dir, 'vox-audit.jsonl'), notices: join(dir, 'notices.json') };
      const sink = createDecisionLogSink(createFileDecisionLogStore(paths.decisions), { enabled: () => true, now: () => NOW });
      const audit = createFileAuditStore(paths.audit);
      const notices = createFileSupersededNoticeStore(paths.notices);
      const epochs = new Map<string, number>();
      const inner = new InMemoryMemoryStore(epochs);
      const memories = auditMemoryStore(inner, audit, notices);
      const offers = auditShareOfferStore(new InMemoryShareOfferStore(), audit);
      const history = new InMemoryChatHistoryStore(epochs);
      // At most 512 px so the triage seam accepts it (larger documents are never triaged and fail closed).
      const scan = tinyJpeg(480, 320, { exifCanary: EXIF, comment: COMMENT });
      const bot = imageBot({ 'doc-passport': scan });
      // The model is sure it is a passport the person wants kept, and that a face is on it.
      const decider = recordingDecider({
        image_kind: { type: 'choice', choice: 'document', confidence: 0.95 },
        image_task: { type: 'choice', choice: 'remember', confidence: 0.95 },
        contains_people: { type: 'predicate', probability: 0.7 },
        contains_sensitive_document: { type: 'predicate', probability: 0.92 },
      });
      const llm = new EchoingExtractor('claude-fable-5-1');
      const fast = new EchoingExtractor('claude-haiku-5-5');
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
      const gateway = new PersonaGateway({
        org: testOrg(), llm, fastLlm: fast, decider, decisionLog: sink, memories, offers, history, deduper: new InMemoryUpdateDeduper(), voice: null,
        botFor: () => bot as unknown as TelegramBotClient, logger, now: () => NOW,
      });
      const say = (text: string) => { llm.nextReply = text; fast.nextReply = text; };

      say(`Your passport number is ${DOC}. I will keep that in mind.`);
      expect(await gateway.handleUpdate('aria', privateDocument(TG.reza, { file_id: 'doc-passport', file_name: FILE_NAME, mime_type: 'image/jpeg', file_size: scan.byteLength }, CAPTION))).toBe('replied');
      say('Done.');
      expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'please remember everything from my last message, I am renewing travel documents this month'))).toBe('replied');
      say('I did not keep the details of that image.');
      expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'what is my passport number?'))).toBe('replied');
      await sink.flush();

      const replyRequests = [...llm.replyRequests, ...fast.replyRequests];
      const extractionRequests = [...llm.extractionRequests, ...fast.extractionRequests];
      // Exactly one image left the process, on the image turn, for the reply model, without its metadata.
      const sentImages = replyRequests.flatMap((r) => r.messages.flatMap((m) => m.images ?? []));
      expect(sentImages).toHaveLength(1);
      const imageBytes = Buffer.from(sentImages[0].data, 'base64');
      expect(imageBytes.includes(Buffer.from(EXIF, 'latin1'))).toBe(false);
      expect(imageBytes.includes(Buffer.from(COMMENT, 'latin1'))).toBe(false);
      const triageImages = decider.calls.filter(([method]) => method === 'decideParts')
        .flatMap(([, parts]) => (parts as DeciderPart[]).flatMap((p) => (p.type === 'image' ? [p.image] : [])));
      expect(triageImages).toHaveLength(1);
      for (const image of triageImages) {
        const bytes = Buffer.from(image.data, 'base64');
        expect(bytes.includes(Buffer.from(EXIF, 'latin1'))).toBe(false);
        expect(bytes.includes(Buffer.from(COMMENT, 'latin1'))).toBe(false);
      }

      // No later prompt, extraction or memory sees the document text; extraction ran on the text turn only.
      expect(replyRequests.slice(1).map(requestText).join('\n')).not.toContain(DOC);
      expect(extractionRequests.length).toBeGreaterThanOrEqual(1);
      const extractionSeen = extractionRequests.map(requestText).join('\n');
      expect(extractionSeen).not.toContain(DOC);
      expect(extractionSeen).not.toContain('R2CAPTIONCANARY');
      expect(JSON.stringify(extractionRequests)).not.toContain('"images"');
      const remembered = await inner.listActive('aria');
      expect(remembered.some((m) => m.content.includes('renewing travel documents')), 'the text turn still formed memory, so the check is not vacuous').toBe(true);

      // History keeps the content-free verdict and the fixed placeholder for the image turn.
      const rows = [...history.chats.values()].flat();
      const imageRows = rows.filter((m) => m.imageDerived?.suppressed);
      expect(imageRows.map((m) => [m.role, m.imageDerived])).toEqual([['user', { suppressed: true, people: true }], ['assistant', { suppressed: true, people: true }]]);
      // Later replies composed with the people-marked rows in context inherit only the people mark.
      expect(rows.filter((m) => m.imageDerived && !m.imageDerived.suppressed).map((m) => [m.role, m.imageDerived]))
        .toEqual([['assistant', { suppressed: false, people: true }], ['assistant', { suppressed: false, people: true }]]);
      expect(imageRows[1].text).toBe(IMAGE_WITHHELD_REPLY_TEXT);

      // Every store, every row file and every log line: no document text, image bytes, metadata or file name.
      await expect(audit.list({ personaId: 'aria' })).resolves.not.toHaveLength(0);
      const files = Object.values(paths).map((path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')).join('\n');
      const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls, ...consoleSpies.map((s) => s.mock.calls)]);
      const storedText = JSON.stringify([rows, remembered, [...inner.records.values()]]);
      const imageSample = sentImages[0].data.slice(40, 120);
      const forbidden = [DOC, EXIF, COMMENT, 'R2FILECANARY', 'R2CAPTIONCANARY', 'data:image', imageSample];
      for (const [label, bytes] of [['history and memory', storedText], ['decision log, audit and notices', files], ['logs', logged]] as const) {
        for (const needle of forbidden) {
          // The caption is the person's own words and stays in history; it must never reach a row file or a log.
          if (label === 'history and memory' && needle === 'R2CAPTIONCANARY') continue;
          expect(bytes, `${label} contains ${needle.slice(0, 24)}`).not.toContain(needle);
        }
      }
      expect(readFileSync(paths.decisions, 'utf8')).toContain('"questionSetVersion":"v2"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Negative identity through successor inheritance and the admin re-snapshot
// ---------------------------------------------------------------------------

describe('red team r2: successor inheritance and re-snapshot never widen any reader', () => {
  const org = testOrg();
  const at = (id: string) => ({ updatedAt: AT, createdAt: AT, id });
  const records = (): MemoryRecord[] => [
    memory({ ...at('s-reza-private'), content: 'S1 Reza private launch note', scope: { kind: 'private', personId: 'reza' }, aboutPersonIds: ['reza'] }),
    memory({ ...at('s-reza-personal'), content: 'S2 Reza personal health note', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal' }),
    memory({ ...at('s-about-reza'), content: 'S3 replacing Reza on the launch review', scope: { kind: 'people', personIds: ['milad', 'parastoo'] }, aboutPersonIds: ['reza'],
      source: { personId: 'parastoo', chatKind: 'private', at: AT } }),
    memory({ ...at('s-people-confidential'), content: 'S4 confidential salary bands', scope: { kind: 'people', personIds: ['reza', 'parastoo'] }, sensitivity: 'confidential' }),
    memory({ ...at('s-gameend'), content: 'S5 GameEnd launch review is Friday', scope: { kind: 'group', groupId: 'gameend-team' } }),
    memory({ ...at('s-gameend-snap'), content: 'S6 GameEnd launch review budget numbers', scope: { kind: 'group', groupId: 'gameend-team' }, authorizedPersonIds: ['parastoo', 'reza'] }),
    memory({ ...at('s-gameend-personal'), content: 'S7 GameEnd member personal leave', scope: { kind: 'group', groupId: 'gameend-team' }, sensitivity: 'personal', authorizedPersonIds: ['parastoo', 'reza'] }),
    memory({ ...at('s-leads'), content: 'S8 Leads launch review cut', scope: { kind: 'group', groupId: 'leads' } }),
    memory({ ...at('s-leads-legacy'), content: 'S9 Leads legacy row without a snapshot', scope: { kind: 'group', groupId: 'leads' }, authorizedPersonIds: undefined }),
    memory({ ...at('s-project'), content: 'S10 GameEnd project launch review plan', scope: { kind: 'project', projectId: 'gameend' } }),
    memory({ ...at('s-company'), content: 'S11 Joyixir company launch review', scope: { kind: 'company', companyId: 'joyixir' } }),
    memory({ ...at('s-org'), content: 'S12 HOOR org launch review policy', scope: { kind: 'org' } }),
    memory({ ...at('s-superseded'), content: 'S13 GameEnd old launch date', scope: { kind: 'group', groupId: 'gameend-team' }, supersededBy: 's-gameend' }),
  ];
  const chats = (): ChatContext[] => [
    ...['reza', 'parastoo', 'milad', 'sina'].map((personId): ChatContext => ({ kind: 'private', chatKey: `private-${personId}`, personId })),
    ...org.config.groups.map((group): ChatContext => ({ kind: 'group', chatKey: `group-${group.id}`, group })),
  ];
  const ids = (all: MemoryRecord[], chat: ChatContext, mode: 'v1' | 'v2') =>
    selectMemories(org, all, chat, { query: 'launch review', mode, limit: 100, now: NOW }).map((m) => m.id).sort();

  it('a successor (TIREH_SHARING_V2 filter) shows no reader in any chat more than the predecessor did, in v1 and v2', () => {
    setFlags({ TIREH_SHARING_V2: '1' });
    const predecessor = records();
    const successor = predecessor.filter(isSuccessorTransferable).map((m) => ({ ...successorCopy(m, 'aria-successor'), id: m.id, createdAt: m.createdAt, updatedAt: m.updatedAt }));
    // Never a private, personal, confidential or superseded record; the authorization snapshot travels unchanged.
    expect(successor.map((m) => m.id).sort()).toEqual(['s-about-reza', 's-gameend', 's-gameend-snap', 's-leads', 's-leads-legacy', 's-project'].sort());
    for (const m of successor) {
      const source = predecessor.find((p) => p.id === m.id)!;
      expect(m.authorizedPersonIds).toEqual(source.authorizedPersonIds);
      expect(m.scope).toEqual(source.scope);
      expect(m.sensitivity).toBe('normal');
    }
    let compared = 0;
    for (const chat of chats()) {
      for (const mode of ['v1', 'v2'] as const) {
        const before = new Set(ids(predecessor, chat, mode));
        for (const id of ids(successor, chat, mode)) expect(before.has(id), `${id} widened into ${chat.chatKey} (${mode})`).toBe(true);
        compared++;
      }
    }
    expect(compared).toBe(12);
    // The exact-recipient record about Reza never reaches Reza through the successor.
    for (const mode of ['v1', 'v2'] as const) expect(ids(successor, chats()[0], mode)).not.toContain('s-about-reza');
  });

  it('a re-snapshot for one named group member changes nothing for chats without them and adds only normal records of that group', () => {
    setFlags({ TIREH_SHARING_V2: '1' });
    const before = records();
    let widenedSomething = false;
    for (const group of org.config.groups) {
      for (const personId of group.memberIds) {
        const after = before.map((m) => {
          const patch = resnapshotPatch(m, group.id, personId);
          return patch ? { ...m, ...patch } : m;
        });
        // Only normal, current, snapshotted records of this group are ever patched.
        for (const [i, m] of after.entries()) {
          if (m === before[i]) continue;
          expect(before[i].scope).toEqual({ kind: 'group', groupId: group.id });
          expect(before[i].sensitivity).toBe('normal');
          expect(before[i].supersededBy).toBeUndefined();
          expect(before[i].authorizedPersonIds).toBeDefined();
          expect(m.authorizedPersonIds).toEqual([...new Set([...before[i].authorizedPersonIds!, personId])].sort());
        }
        for (const chat of chats()) {
          for (const mode of ['v1', 'v2'] as const) {
            const was = ids(before, chat, mode);
            const now = ids(after, chat, mode);
            if (!audienceOf(chat).includes(personId)) {
              expect(now, `${chat.chatKey} changed by a re-snapshot for ${personId} in ${group.id}`).toEqual(was);
              continue;
            }
            for (const id of now.filter((x) => !was.includes(x))) {
              const record = before.find((m) => m.id === id)!;
              widenedSomething = true;
              expect(record.scope, `${id} newly visible in ${chat.chatKey}`).toEqual({ kind: 'group', groupId: group.id });
              expect(record.sensitivity).toBe('normal');
            }
          }
        }
      }
    }
    // Non-vacuous: Milad gains the GameEnd snapshot record he was excluded from.
    expect(widenedSomething).toBe(true);
  });
});
