/**
 * F232: a missing, non-choice or unknown image_kind answer is unknown triage (main's fail-closed rule), so
 * the image turn is suppressed with the people rule on, never read as kind 'other'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageShowsPeople, ingestTelegramImage, readImageTriage, type ImageIngestDeps } from '../images';
import type { DecisionAnswer } from '../triage';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, VisionFakeLLM } from './images-fixtures';

type Answers = Record<string, DecisionAnswer>;
const answered = (kind?: DecisionAnswer): Answers => {
  const { image_kind: _kind, ...rest } = imageAnswers({ kind: 'receipt', task: 'remember', people: 0.25, sensitive: 0.1 });
  void _kind;
  return kind ? { ...rest, image_kind: kind } : rest;
};

const MISSING_OR_UNKNOWN: Array<[string, Answers]> = [
  ['missing', answered()],
  ['an unknown choice', answered({ type: 'choice', choice: 'selfie', confidence: 0.9 })],
  ['not a choice', answered({ type: 'predicate', probability: 0.9 } as DecisionAnswer)],
  ['an empty choice', answered({ type: 'choice', choice: '', confidence: 0.9 })],
];

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('F232: readImageTriage fails closed on image_kind', () => {
  for (const [label, answers] of MISSING_OR_UNKNOWN) {
    it(`returns null when image_kind is ${label}`, () => {
      expect(readImageTriage(answers)).toBeNull();
    });
  }

  it('positive control: a catalogue kind is read', () => {
    expect(readImageTriage(answered({ type: 'choice', choice: 'receipt', confidence: 0.9 }))).toMatchObject({ kind: 'receipt', task: 'remember', containsPeople: 0.25 });
  });
});

describe('F232: the image turn is suppressed with the people rule on', () => {
  async function turn(answers: Answers) {
    const ladder = photoLadder();
    const bot = imageBot(ladder.files);
    const org = testOrg();
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: answers }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
      bot: bot as unknown as TelegramBotClient, log: { warn: vi.fn() },
    };
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const message = privatePhoto(TG.reza, ladder.sizes, 'remember this receipt').message!;
    return ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', message, 'remember this receipt');
  }

  for (const [label, answers] of MISSING_OR_UNKNOWN) {
    it(`image_kind ${label}: triage null, memory suppressed (an explicit request included), people rule on`, async () => {
      const result = await turn(answers);
      expect(result).toMatchObject({ triage: null, suppressMemory: true, containsPeople: true, forceQuick: false });
      expect(imageShowsPeople(result!.triage)).toBe(true);
    });
  }

  it('positive control: with a catalogue kind below the people threshold the turn is kept and the people rule is off', async () => {
    const result = await turn(answered({ type: 'choice', choice: 'receipt', confidence: 0.9 }));
    expect(result).toMatchObject({ triage: { kind: 'receipt' }, suppressMemory: false, containsPeople: false });
  });
});
