/**
 * QA round 1, lens code-quality (wave A on main). Known gaps pinned as
 * `it.fails`: each case asserts the intended behaviour and is expected to fail
 * until the fix lands; when a fix lands, vitest reports the case as passing
 * unexpectedly, and `it.fails` must then become `it`.
 *
 *  - CQ1: main's S12 lineage treated "never" and "keep" as negations
 *    (images/policy.ts NEGATED_REMEMBER); wave A's IMAGE_NO_MEMORY dropped
 *    them, so a negated caption reads as an explicit remember request.
 *  - CQ2: main's S12 lineage bounded each image download with
 *    AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS = 5000); wave A's
 *    ingestTelegramImage passes no signal, so a stalled Telegram file
 *    download holds the turn open with no deadline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explicitRememberRequest, ingestTelegramImage, suppressImageMemory, type ImageIngestDeps, type ImageTriage } from '../images';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, VisionFakeLLM } from './images-fixtures';

const org = testOrg();
const persona = org.getPersona('aria')!;
const rezaChat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };

const explainTriage: ImageTriage = { kind: 'photo', task: 'explain', containsPeople: 0, containsSensitiveDocument: 0 };

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('CQ1: a negated caption is never an explicit remember request', () => {
  it('control: an explicit request and an explicit "don\'t save" still classify as before', () => {
    expect(explicitRememberRequest('please remember this')).toBe(true);
    expect(explicitRememberRequest("don't save this")).toBe(false);
  });

  for (const caption of ["don't keep this", 'never save this', 'dont save this', "please don't ever save this"]) {
    it.fails(`"${caption}" is not an explicit remember request and suppresses image memory`, () => {
      expect(explicitRememberRequest(caption)).toBe(false);
      expect(suppressImageMemory(explainTriage, caption)).toBe(true);
    });
  }
});

describe('CQ2: every image download carries a deadline', () => {
  it.fails('ingestTelegramImage passes an AbortSignal to each downloadImage call', async () => {
    const ladder = photoLadder();
    const bot = imageBot(ladder.files);
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: imageAnswers() }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
      bot: bot as unknown as TelegramBotClient, log: { warn: vi.fn() },
    };
    const message = privatePhoto(TG.reza, ladder.sizes, 'what is this?').message!;
    await ingestTelegramImage(deps, persona, rezaChat, 'reza', message, 'what is this?');
    expect(bot.downloadImage).toHaveBeenCalled();
    for (const [, options] of bot.downloadImage.mock.calls as Array<[string, { signal?: AbortSignal }]>) {
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
