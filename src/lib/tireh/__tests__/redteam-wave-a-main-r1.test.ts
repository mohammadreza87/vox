/**
 * Privacy red team, wave A on main, round 1: where main's features (Circles notes and
 * outsiders, the Mini App / Pet converse path) meet wave A (S03 cached prompt, S12 images).
 *
 * Passing guards pin behaviour that holds on agent-intelligence-wave-a-main. The it.fails
 * cases are known gaps found in this round (see the QA report); each flips to a failure,
 * and must become a plain `it`, once its fix lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacy } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import { auditMemoryStore, InMemoryAuditStore, InMemorySupersededNoticeStore } from '../audit';
import type { NewMemory } from '../memory/store';
import type { LLMImage, LLMRequest } from '../llm';
import type { TelegramBotClient } from '../telegram/client';
import { privateText, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, tinyJpeg, VisionFakeLLM } from './images-fixtures';

const DOC = 'DOCCANARY-4111-1111-1111-1111';
const FACE = 'FACECANARY red jacket beard';
const NOTE = 'NOTECANARY the team offsite moved to Shiraz';
const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      const shown = requestText(request);
      this.nextExtraction = shown.includes('DOCCANARY')
        ? { memories: [{ content: `Reza's card number is ${DOC}`, type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
        : shown.includes('FACECANARY')
          ? { memories: [{ content: 'Ali wears a FACECANARY red jacket and has a beard', type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
          : { memories: [] };
    }
    return super.complete(request);
  }
}

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function harness(opts: { image?: ReturnType<typeof imageAnswers>; runtimePrivacy?: RuntimePrivacy } = {}) {
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const decider = scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image: opts.image ?? imageAnswers() });
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider, memories, offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
    ...(opts.runtimePrivacy ? { runtimePrivacy: opts.runtimePrivacy } : {}),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const replies = () => [...llm.replyRequests, ...fast.replyRequests];
  const extractionText = () => [...llm.extractionRequests, ...fast.extractionRequests].map(requestText).join('\n');
  const stored = () => [...history.chats.values()].flat();
  return { gateway, llm, fast, memories, history, ladder, bot, decider, setReply, replies, extractionText, stored };
}

const miniAppImage = (): LLMImage => ({ mimeType: 'image/jpeg', data: Buffer.from(tinyJpeg(320, 240)).toString('base64') });

describe('red team wave A on main r1: Circles notes and outsiders under the S03 cached prompt', () => {
  it('a Circles note used on a turn stays in the per-turn block and never enters the cache-stable system blocks', async () => {
    vi.stubEnv('TIREH_CACHED_PROMPT', '1');
    const runtimePrivacy: RuntimePrivacy = {
      validateAudience: async () => true,
      read: async () => ({ revision: 'r1', memoryEnabled: true, historyEnabled: true }),
      readNotes: async () => ({ revision: 'n1', context: [NOTE] }),
      readNotesAuthority: async () => ({ revision: 'n1' }),
    };
    const h = harness({ runtimePrivacy });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'where is the offsite?'))).toBe('replied');
    const requests = h.replies();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(systemText(request.system)).not.toContain('NOTECANARY');
      expect(request.systemTail ?? '').not.toContain('NOTECANARY');
    }
    // Positive control: the note reached the reply model, in the per-turn block of the user turn.
    expect(requests.some((r) => r.messages.some((m) => (m.trailingText ?? []).join('\n').includes('NOTECANARY')))).toBe(true);
    // Context only: never memory, never extracted, never history.
    expect(h.extractionText()).not.toContain('NOTECANARY');
    expect(JSON.stringify(h.stored())).not.toContain('NOTECANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('NOTECANARY');
  });

  it('a Circles outsider (public-only turn) with every wave A flag on gets notes only, and no image, memory or history', async () => {
    for (const flag of ['TIREH_CACHED_PROMPT', 'TIREH_RETRIEVAL_V2', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES']) vi.stubEnv(flag, '1');
    const runtimePrivacy: RuntimePrivacy = {
      validateAudience: async () => false,
      validatePublicAudience: async () => true,
      read: async () => ({ revision: 'r1', memoryEnabled: true, historyEnabled: true, context: ['PRIVCANARY member-only context'] }),
      readNotes: async () => ({ revision: 'n1', context: [NOTE] }),
      readNotesAuthority: async () => ({ revision: 'n1' }),
    };
    const h = harness({ runtimePrivacy });
    await h.memories.add({ personaId: 'aria', content: 'MEMCANARY Reza prefers window seats', type: 'preference', scope: { kind: 'private', personId: 'reza' },
      sensitivity: 'normal', aboutPersonIds: ['reza'], source: { personId: 'reza', chatKey: 'private-reza', at: new Date('2026-10-01T00:00:00Z') }, confidence: 0.9 } as never);
    h.setReply('Shiraz it is.');
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'where is the offsite? FACECANARY'))).toBe('replied');
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.decider.decideParts).not.toHaveBeenCalled();
    const sent = h.replies().map((r) => [systemText(r.system), r.systemTail ?? '', ...r.messages.flatMap((m) => [m.content, ...(m.trailingText ?? [])])].join('\n')).join('\n');
    expect(sent).toContain('NOTECANARY'); // positive control: the public turn may use the person's own notes
    expect(sent).not.toContain('MEMCANARY');
    expect(sent).not.toContain('PRIVCANARY');
    expect(h.replies().every((r) => r.messages.every((m) => !m.images))).toBe(true);
    expect(h.llm.extractionCalls + h.fast.extractionCalls).toBe(0);
    expect(h.stored()).toEqual([]);
  });
});

describe('red team wave A on main r1: known gaps (it.fails until fixed)', () => {
  // Gap 1. conversation.ts accepts an attached image on the Mini App (and any converse caller) without
  // STUDIO_IMAGES; converse() stores the user row unmarked and the reply only inherits marks from older rows.
  // So with STUDIO_IMAGES=1 a document read out of a Mini App image is retained and extracted on the same
  // turn: S12's suppression and people rule cover Telegram images only. Pre-existing on main as well.
  it.fails('a sensitive document read out of a Mini App image never reaches history, extraction or memory', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness();
    h.setReply(`The card number reads ${DOC}.`);
    await h.gateway.converse('aria', 'reza', 'read this card for me', { images: [miniAppImage()] });
    expect(h.replies().some((r) => r.messages.some((m) => m.images?.length))).toBe(true); // positive control
    expect(JSON.stringify(h.stored())).not.toContain('DOCCANARY');
    expect(h.extractionText()).not.toContain('DOCCANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('DOCCANARY');
  });

  it.fails('a people photo described in the Mini App never becomes an appearance memory', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness();
    h.setReply(`Lovely photo, the man in the ${FACE} looks happy.`);
    await h.gateway.converse('aria', 'reza', 'this is my brother Ali', { images: [miniAppImage()] });
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  // Gap 2 (fixed, fixer r1). Image triage (decideParts) ran after the boundary but received no DeciderAuthority
  // and was not preceded by unchanged(): an audience withdrawn during the download still exported the image to
  // the decider. The gateway now hands the image seam the turn authority, as 8a7dc55 did for text triage.
  it('an image is not exported to the decider when the audience was withdrawn during its download', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    let withdrawn = false;
    const runtimePrivacy: RuntimePrivacy = {
      validateAudience: async () => !withdrawn,
      read: async () => ({ revision: withdrawn ? 'r2' : 'r1', memoryEnabled: true, historyEnabled: true }),
    };
    const h = harness({ runtimePrivacy });
    const download = h.bot.downloadImage.getMockImplementation()!;
    h.bot.downloadImage.mockImplementation(async (...args) => { withdrawn = true; return download(...args); });
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'));
    expect(h.bot.downloadImage).toHaveBeenCalled(); // positive control: the boundary passed before the withdrawal
    expect(h.decider.decideParts).not.toHaveBeenCalled();
  });

  it('image triage hands the decider the turn authority, as text triage does since 8a7dc55', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness();
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'));
    expect(h.decider.decideParts).toHaveBeenCalled();
    const call = h.decider.decideParts!.mock.calls[0] as unknown[];
    expect(typeof (call[3] as { authorize?: unknown } | undefined)?.authorize).toBe('function');
  });

  // Gap 3. S08 supersede notices (and vox_audit rows) have no delete path: once the owner forgets both the
  // shared record and its correction, memoryNoticesFor hides the notice on read, but the stored row still
  // pairs the owner with every recipient and both memory ids. Neither side has erasure for these stores (F013).
  it.fails('forgetting a corrected shared record leaves no supersede notice naming its owner and recipients', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const notices = new InMemorySupersededNoticeStore();
    const store = auditMemoryStore(new InMemoryMemoryStore(new Map()), new InMemoryAuditStore(), notices);
    const shared: NewMemory = { personaId: 'aria', content: 'The launch moved to May', type: 'decision', scope: { kind: 'people', personIds: ['reza', 'sara'] },
      authorizedPersonIds: ['reza', 'sara'], sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
      source: { personId: 'reza', chatKind: 'private', eventIds: ['e1'], at: new Date('2026-10-19T09:00:00Z') } };
    const old = await store.add(shared);
    const correction = await store.add({ ...shared, content: 'The launch moved to June', supersedes: old.id, source: { ...shared.source, eventIds: ['e2'] } });
    expect(notices.notices).toHaveLength(1); // positive control: the correction recorded a notice for sara
    await store.delete(correction.id);
    await store.delete(old.id);
    expect(JSON.stringify(notices.notices)).not.toContain(old.id);
  });
});
