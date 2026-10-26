/**
 * QA hardening r1 (tests-types): H2 (F258, F220) made suppressImageMemory call negatedMemoryRequest, which also
 * reads the H4 Persian fold. No test covered that: replacing the call with the raw NEGATED_MEMORY_REQUEST.test left
 * every src/lib/tireh test green under STUDIO_IMAGES=1. These cases fail without the fold: a refusal written with
 * tatweel, U+0649 or presentation forms suppresses image memory even when triage says 'remember'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestTelegramImage, suppressImageMemory, type ImageIngestDeps, type ImageTriage } from '../images';
import { NEGATED_MEMORY_REQUEST } from '../memory/requests';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, VisionFakeLLM } from './images-fixtures';

const REMEMBER: ImageTriage = { kind: 'receipt', task: 'remember', containsPeople: 0.05, containsSensitiveDocument: 0.05 };
const FOLDED_REFUSALS: Array<[string, string]> = [
  ['tatweel', 'ذخیــره نکن'],
  ['alef maksura U+0649', 'ذخىره نکن'],
  ['presentation forms', 'ﺫﺧﻴﺮﻩ ﻧﻜﻦ'],
];

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('suppressImageMemory reads the folded refusal (F258, F220)', () => {
  it.each(FOLDED_REFUSALS)('%s: a refusal only the fold recognises suppresses a remember verdict', (_label, caption) => {
    // Control: the raw regex misses it, so only the fold can catch it.
    expect(NEGATED_MEMORY_REQUEST.test(caption)).toBe(false);
    expect(suppressImageMemory(REMEMBER, caption)).toBe(true);
  });

  it('positive control: the same remember verdict with a neutral caption keeps memory', () => {
    expect(suppressImageMemory(REMEMBER, 'رسید خرید')).toBe(false);
  });

  it.each(FOLDED_REFUSALS)('%s: ingestTelegramImage marks the turn suppressed', async (_label, caption) => {
    const ladder = photoLadder();
    const org = testOrg();
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: imageAnswers({ kind: 'receipt', task: 'remember', people: 0.05, sensitive: 0.05 }) }),
      llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(), bot: imageBot(ladder.files) as unknown as TelegramBotClient, log: { warn: vi.fn() },
    };
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const turn = await ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', privatePhoto(TG.reza, ladder.sizes, caption).message!, caption);
    expect(turn).toMatchObject({ triage: { task: 'remember' }, suppressMemory: true });
  });
});
