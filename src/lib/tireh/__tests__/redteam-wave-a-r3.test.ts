/**
 * Privacy red team, Wave A round 3: image-derived text across channels and turns.
 *
 * Telegram private chats and the Mini App (converse, liveTurn, reflect) share
 * one history key, `private-<personId>`. 042059a carries the S12 people mark
 * onto a Telegram reply composed with a people row in context; round 3 carries
 * the whole mark (suppressed and people) through handleUpdate, converse and
 * liveTurn. These cases probe the paths around that fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { IMAGE_WITHHELD_REPLY_TEXT } from '../images';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient } from '../telegram/client';
import { privateText, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const FACE = 'FACECANARY red jacket beard';
const RX = 'RXCANARY insulin glargine';
const DOC = 'DOCCANARY-4111-1111-1111-1111';
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
          : shown.includes('RXCANARY')
            ? { memories: [{ content: `Reza buys ${RX} at the pharmacy`, type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
            : { memories: [] };
    }
    return super.complete(request);
  }
}

const OTHER_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of OTHER_FLAGS) vi.stubEnv(flag, ''); vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function harness(image: ReturnType<typeof imageAnswers>) {
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image }),
    memories, offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const extractionText = () => [...llm.extractionRequests, ...fast.extractionRequests].map(requestText).join('\n');
  const replyText = () => [...llm.replyRequests, ...fast.replyRequests].map(requestText).join('\n');
  const stored = () => [...history.chats.values()].flat();
  return { gateway, llm, fast, memories, history, ladder, setReply, extractionText, replyText, stored };
}

describe('red team round 3: image-derived text across channels', () => {
  it('a sensitive document read out on Telegram never reaches a later Mini App turn, its extraction or memory', async () => {
    const h = harness(imageAnswers({ kind: 'document', task: 'extract_text', sensitive: 0.95 }));
    h.setReply(`The card number reads ${DOC}.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'read this card for me'))).toBe('replied');
    expect(h.stored().map((m) => m.text)).toContain(IMAGE_WITHHELD_REPLY_TEXT);

    // The same person continues in the Mini App: same history key, different entry point.
    h.setReply('Sure.');
    for (const said of ['what was on that card?', 'ok thanks', 'talk later']) await h.gateway.converse('aria', 'reza', said);
    await h.gateway.reflect('aria', 'reza');

    expect(h.replyText()).toContain(IMAGE_WITHHELD_REPLY_TEXT); // positive control: the image turn is in context
    expect(h.replyText().split(DOC)).toHaveLength(1);
    expect(h.extractionText()).not.toContain(DOC);
    expect(JSON.stringify(h.stored())).not.toContain(DOC);
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain(DOC);
  });

  // Round 3, finding 1 (closed). converse() used to drop composeReply's image context, so a Mini App
  // reply repeating a people-photo description was stored unmarked and, once the Telegram image rows left
  // EXTRACTION_WINDOW, extraction ran without the people rule or its lexical filter. The image here was
  // asked to be remembered, so it is not suppressed and only the people rule protects it.
  it('a people-photo description repeated in the Mini App never becomes an appearance memory after the image rows leave the window', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    h.setReply(`Lovely photo, the man in the ${FACE} looks happy.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this, my brother Ali'))).toBe('replied');
    for (const said of ['he just got back from Tabriz', 'he is staying for a week', 'we will go hiking on Friday']) {
      await h.gateway.converse('aria', 'reza', said);
    }
    // Positive control: every extraction saw the repeated description.
    const requests = [...h.llm.extractionRequests, ...h.fast.extractionRequests];
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => requestText(r).includes('FACECANARY'))).toBe(true);
    // The Mini App replies inherit the people mark, so the last turn (image rows out of the window) keeps the rule.
    expect(h.stored().filter((m) => m.role === 'assistant').map((m) => m.imageDerived)).toEqual(Array(4).fill({ suppressed: false, people: true }));
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('an unrequested people photo repeated in the Mini App stays out of every extraction', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    h.setReply(`Lovely photo, the man in the ${FACE} looks happy.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'my brother Ali'))).toBe('replied');
    for (const said of ['he just got back from Tabriz', 'he is staying for a week', 'we will go hiking on Friday']) {
      await h.gateway.converse('aria', 'reza', said);
    }
    expect(h.replyText()).toContain('FACECANARY'); // positive control: the description is in the reply context
    const requests = [...h.llm.extractionRequests, ...h.fast.extractionRequests];
    expect(requests).toHaveLength(3);
    expect(h.extractionText()).toContain('we will go hiking on Friday'); // the member's own words still form memory
    expect(h.extractionText()).not.toContain('FACECANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('a live-call reply composed with an image-marked row in context inherits its mark, so reflect never extracts it', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    h.setReply(`Lovely photo, the man in the ${FACE} looks happy.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'my brother Ali'))).toBe('replied');
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const said of ['tell me about him', 'he just got back from Tabriz', 'we will go hiking on Friday']) {
      turns.push({ role: 'user', content: said });
      let reply = '';
      for await (const part of h.gateway.liveTurn('aria', 'reza', turns)) reply += part;
      turns.push({ role: 'assistant', content: reply });
    }
    await h.gateway.reflect('aria', 'reza');
    const live = h.stored().filter((m) => m.role === 'assistant').slice(1);
    expect(live).toHaveLength(3);
    expect(live.map((m) => m.imageDerived)).toEqual(Array(3).fill({ suppressed: true, people: true }));
    expect(h.extractionText()).toContain('we will go hiking on Friday'); // positive control
    expect(h.extractionText()).not.toContain('FACECANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('a Mini App or live turn with no image-marked row in context stores no image mark', async () => {
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }));
    h.setReply('Sure.');
    await h.gateway.converse('aria', 'reza', 'my flight to Berlin is on Friday');
    for await (const part of h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'and back on Monday' }])) void part;
    expect(h.stored()).toHaveLength(4);
    expect(h.stored().every((m) => m.imageDerived === undefined)).toBe(true);
  });

  // Round 3, finding 2 (closed). The `suppressed` verdict used to cover only the image turn's own two rows;
  // a later reply composed with that row in context could repeat what the image showed and reach extraction.
  // That reply now inherits the whole mark (inheritedImageMark).
  it('text read out of a non-remember image and repeated on the next Telegram turn never reaches extraction or memory', async () => {
    const h = harness(imageAnswers({ kind: 'receipt', task: 'explain', people: 0, sensitive: 0.1 }));
    h.setReply(`This receipt is for ${RX}, 3 pens.`);
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this receipt for?'))).toBe('replied');
    expect(h.stored().map((m) => m.imageDerived)).toEqual([{ suppressed: true, people: false }, { suppressed: true, people: false }]);
    expect(h.llm.extractionCalls + h.fast.extractionCalls).toBe(0);

    // The model can read its own earlier reply in history and repeats it.
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'and how much was it?'))).toBe('replied');
    expect(h.replyText()).toContain('RXCANARY'); // positive control: the earlier reply was in context
    expect(h.stored().map((m) => m.imageDerived)).toEqual([{ suppressed: true, people: false }, { suppressed: true, people: false }, undefined, { suppressed: true, people: false }]);
    expect(h.extractionText()).toContain('and how much was it?'); // the member's own words are still extracted
    expect(h.extractionText()).not.toContain('RXCANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('RXCANARY');
  });
});
