/**
 * QA wave A round 2 (tests-types): the S12 people rule ends with the image rows' extraction window.
 *
 * redteam-image-followup.test.ts checks one turn after a people photo. The reply to a
 * non-sensitive people photo is kept in history, so the model can repeat the appearance
 * description on a later turn. That later assistant row carries no imageDerived mark, so
 * once the image turn's two rows leave EXTRACTION_WINDOW (6 rows) the people rule and its
 * lexical filter switch off while the repeated description is still in the window.
 *
 * KNOWN GAP: this is written as `it.fails` so the suite stays green and documents the leak.
 * When the gateway propagates the people mark (or keeps the rule while any row derived
 * from a people-photo context is in the window), this test will start failing: turn it
 * into a plain `it`.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient } from '../telegram/client';
import { privateText, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';

const FACE = 'FACECANARY red jacket beard';
const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, proposes an appearance memory only when it was shown one. */
class AppearanceExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      this.nextExtraction = requestText(request).includes('FACECANARY')
        ? { memories: [{ content: 'Ali wears a FACECANARY red jacket and has a beard', type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
        : { memories: [] };
    }
    return super.complete(request);
  }
}

const OTHER_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_VOICE_RECOGNITION'];
beforeEach(() => { for (const flag of OTHER_FLAGS) vi.stubEnv(flag, ''); vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.fails('KNOWN GAP: a people-photo description repeated on a later turn never becomes an appearance memory, even after the image rows leave the window', async () => {
  const llm = new AppearanceExtractor('claude-fable-5-1');
  const fast = new AppearanceExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast,
    decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image: imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95 }) }),
    memories, offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs), deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const reply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };

  reply(`Lovely photo, the man in the ${FACE} looks happy.`);
  expect(await gateway.handleUpdate('aria', privatePhoto(TG.reza, ladder.sizes, 'my brother Ali'))).toBe('replied');
  // Turn 2: the model repeats the description it can read in history.
  expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'yes he just got back from Tabriz'))).toBe('replied');
  reply('Nice.');
  expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'he is staying for a week'))).toBe('replied');
  expect(await gateway.handleUpdate('aria', privateText(TG.reza, 'we will go hiking on Friday'))).toBe('replied');

  const requests = [...llm.extractionRequests, ...fast.extractionRequests];
  expect(requests).toHaveLength(3); // the image turn itself is suppressed
  // Positive control: the repeated description reached every later extraction.
  expect(requests.every((r) => requestText(r).includes('FACECANARY'))).toBe(true);
  // The rule must hold while that description is in the window (fails on the 4th turn today).
  expect(requests.map((r) => systemText(r.system).includes(IMAGE_PEOPLE_RULE))).toEqual([true, true, true]);
  expect(JSON.stringify(await memories.listActive('aria'))).not.toContain('FACECANARY');
});
