/**
 * Privacy red team, wave A on main, hardening round 1 (after the H1 to H9 merges, 718752e..da8ebd5).
 *
 * Passing guards only: each pins an invariant this round attacked and found holding. The gaps this round
 * found are described in the QA report (not pinned as it.fails, so the flag matrix keeps zero expected failures).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { explicitMemoryRequest, negatedMemoryRequest } from '../memory/requests';
import { isWithheldImageReplyText, suppressImageMemory } from '../images';
import { readImageTriage } from '../images/questions';
import { createDecisionLogSink, InMemoryDecisionLogStore } from '../decisions/log';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient } from '../telegram/client';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const DOC = 'DOCCANARY-4471 account 0042 balance';
const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      this.nextExtraction = requestText(request).includes('DOCCANARY')
        ? { memories: [{ content: `Reza's statement shows ${DOC}`, type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
        : { memories: [] };
    }
    return super.complete(request);
  }
}

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const NOW = new Date('2026-10-19T10:00:00Z');

function harness(image: ReturnType<typeof imageAnswers>, options: { decisionLog?: boolean } = {}) {
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const logStore = new InMemoryDecisionLogStore();
  const sink = createDecisionLogSink(logStore, { enabled: () => true, now: () => NOW });
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image }), memories,
    offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
    ...(options.decisionLog ? { decisionLog: sink } : {}),
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => NOW,
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const rows = () => [...history.chats.values()].flat();
  return { gateway, llm, fast, memories, ladder, setReply, rows, logStore, sink };
}

// Attack 1 (H4 fold x S12 retention). The shared fold widened explicitMemoryRequest (the only path that turns
// image memory on besides a 'remember' task). Attack: can a refusal written with Arabic presentation forms,
// tatweel, alef maksura, ZWJ/RLM or a curly apostrophe be folded into a remember request, or a sensitive document
// be kept because the person asked? Holds: any negation (raw or folded) wins, and the sensitivity threshold wins
// over every explicit request.
describe('red team harden r1: the Persian fold never opens image memory', () => {
  const NEGATED = [
    'don’t remember this',
    'Please do NOT, under any circumstances, keep this',
    'ذخیره‌اش نکن',
    'ذخيرهـاش نكن', // Arabic yeh and kaf, tatweel instead of ZWNJ
    'ذخیره‍اش نکن', // ZWJ inside
    'نمی‌خوام یادت بمونه',
    'نمىخوام یادت بمونه', // alef maksura U+0649 for yeh
    '‏نگهش ندار', // RLM in front
    'فراموشش کن',
    'remember this. actually, forget it',
  ];
  it.each(NEGATED)('%j is a refusal and never an explicit request', (text) => {
    expect(negatedMemoryRequest(text)).toBe(true);
    expect(explicitMemoryRequest(text)).toBe(false);
  });

  it.each(NEGATED)('%j suppresses image memory even when the decider says the task is remember', (text) => {
    const triage = readImageTriage(imageAnswers({ kind: 'receipt', task: 'remember', taskConfidence: 0.95, people: 0.05, sensitive: 0.05 }));
    expect(triage?.task).toBe('remember');
    expect(suppressImageMemory(triage, text)).toBe(true);
  });

  it.each(['remember this', 'please save it', 'یادت باشه', 'ذخیره‌اش کن', 'نگهش دار'])(
    'a sensitive document (>= 0.5) stays suppressed even with the explicit request %j', (text) => {
      expect(explicitMemoryRequest(text)).toBe(true); // positive control: the request is recognised
      const triage = readImageTriage(imageAnswers({ kind: 'document', task: 'remember', taskConfidence: 0.95, people: 0.05, sensitive: 0.5 }));
      expect(suppressImageMemory(triage, text)).toBe(true);
    });
});

// Attack 2 (H2 image-v1 decision-log rows x the text-triage subject, c86bb6a). Attack: does the image row or its
// text-triage sibling carry the caption, the speaker, an opaque subject or the reply? Does a sensitive document's
// reply reach history or memory while the rows are being written? Holds: rows are names, catalogue values and
// probabilities only; the document reply is withheld and nothing of it is extracted.
describe('red team harden r1: image-v1 decision-log rows on a sensitive document', () => {
  it('rows carry no caption, person, subject or reply text; the reply is withheld and forms no memory', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    vi.stubEnv('TIREH_DECISION_LOG', '1');
    const h = harness(imageAnswers({ kind: 'document', task: 'extract_text', people: 0.05, sensitive: 0.92 }), { decisionLog: true });
    h.setReply(`Your bank statement: ${DOC}.`);
    const caption = 'what does my bank statement say? keep it between us';
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, caption))).toBe('replied');
    await h.sink.flush();
    const rows = h.logStore.rows;
    expect(rows.map((r) => r.questionSetVersion)).toEqual(['v1', 'image-v1']);
    const json = JSON.stringify(rows);
    for (const needle of ['DOCCANARY', 'bank statement', 'between us', 'reza', String(TG.reza), 'tg-', 'vox_', 'subject', 'safety']) {
      expect(json, needle).not.toContain(needle);
    }
    // The verdict is stored on both rows; the reply text never is.
    const stored = h.rows();
    expect(stored.every((m) => m.imageDerived?.suppressed === true)).toBe(true);
    expect(isWithheldImageReplyText(stored.find((m) => m.role === 'assistant')!.text)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('DOCCANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('DOCCANARY');
  });
});

// Attack 3 (H2 mark union, F216, x H4 explicit request). Attack: a later image turn with an explicit "remember
// this" on a harmless image, after an earlier people photo whose reply is still in the context: does the
// explicit request clear the inherited people mark, so an appearance description becomes a memory? Holds: the
// assistant row keeps people:true, and the extractor runs under the people rule.
describe('red team harden r1: an explicit remember on a later image keeps the inherited people rule', () => {
  it('the second turn extracts with the people rule on and its reply row keeps people:true', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    let turn = 0;
    const verdicts = [
      imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.97, sensitive: 0.02 }),
      imageAnswers({ kind: 'screenshot', task: 'remember', taskConfidence: 0.95, people: 0.02, sensitive: 0.02 }),
    ];
    const llm = new VisionFakeLLM('claude-fable-5-1');
    const fast = new VisionFakeLLM('claude-haiku-5-5');
    const epochs = new Map<string, number>();
    const history = new InMemoryChatHistoryStore(epochs);
    const ladder = photoLadder();
    const bot = imageBot(ladder.files);
    const gateway = new PersonaGateway({
      org: testOrg(), llm, fastLlm: fast, decider: scriptedDecider({ text: textAnswers({ memorable: 0.9 }), image: async () => verdicts[Math.min(turn++, 1)] }),
      memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
      botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => NOW,
    });
    llm.nextReply = 'Sara is wearing a red coat and smiling.';
    fast.nextReply = llm.nextReply;
    expect(await gateway.handleUpdate('aria', privatePhoto(TG.reza, ladder.sizes, 'my sister at the station'))).toBe('replied');
    llm.nextReply = 'Saved: the train leaves at 9.';
    fast.nextReply = llm.nextReply;
    expect(await gateway.handleUpdate('aria', privatePhoto(TG.reza, ladder.sizes, 'remember this'))).toBe('replied');
    const stored = [...history.chats.values()].flat();
    const lastAssistant = stored.filter((m) => m.role === 'assistant').at(-1)!;
    expect(lastAssistant.imageDerived?.people).toBe(true);
    const extraction = [...llm.extractionRequests, ...fast.extractionRequests].at(-1);
    expect(extraction).toBeDefined();
    expect(requestText(extraction!)).toContain('Never record who appears in the image');
    expect(requestText(extraction!)).not.toContain('red coat');
  });
});
