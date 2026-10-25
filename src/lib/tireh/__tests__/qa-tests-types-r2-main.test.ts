/**
 * QA round 2 on main, lens tests-types: pins two fixer r1 changes that no
 * existing test could tell apart from their absence (mutation runs in a
 * scratch copy left every suite green).
 *
 *  - b142d00 (gateway half): gateway.ts NO_MEMORY reads the shared
 *    memory/requests.ts rule. Replacing it with main's earlier regex
 *    (`do not|don't` + verb only) kept all 2141 tireh tests green, because
 *    memory-requests.test.ts checks the module and proactive-groups.test.ts
 *    only checks phrasings both rules accept. These group lines are opt-outs
 *    only under the shared rule.
 *  - 4d17ecf (deadline): every image download carries
 *    AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS). qa-code-quality-r1 CQ2
 *    accepts any AbortSignal and images-authority fakes the TimeoutError, so a
 *    signal that never fires kept both green.
 *
 * Fakes only: no provider, no network, no filesystem.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { IMAGE_DOWNLOAD_TIMEOUT_MS, ingestTelegramImage, type ImageIngestDeps } from '../images';
import { InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatContext } from '../types';
import { GAMEEND_CHAT, groupText, makeGateway, TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, VisionFakeLLM } from './images-fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function groupSetup() {
  const h = makeGateway();
  const persona = h.org.getPersona('aria')!;
  persona.groupParticipation = 'balanced';
  persona.groupRemember = true;
  h.org.getGroupByChatId(GAMEEND_CHAT)!.agentIds = ['aria'];
  const result = {
    effort: { type: 'choice' as const, choice: 'thoughtful', confidence: 1 },
    live_info: { type: 'predicate' as const, probability: 0 },
    memorable: { type: 'predicate' as const, probability: 0.9 },
    addressed: { type: 'predicate' as const, probability: 0 },
    proactive: { type: 'predicate' as const, probability: 0 },
  };
  const claimGroupMemory = vi.fn(async () => true);
  const gateway = new PersonaGateway({
    ...h, deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => h.bot as unknown as TelegramBotClient,
    decider: { decide: vi.fn(async () => result) },
    groupAllowed: vi.fn<NonNullable<GatewayDeps['groupAllowed']>>(async () => true),
    claimGroupReply: vi.fn(async () => true), claimGroupMemory,
  });
  return { ...h, gateway, claimGroupMemory };
}

describe('QA tests-types r2: the gateway reads the shared negation rule (b142d00)', () => {
  it('positive control: a memorable group fact is claimed and extracted', async () => {
    const h = groupSetup();
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    expect(h.claimGroupMemory).toHaveBeenCalledTimes(1);
    expect(h.llm.extractionCalls).toBe(1);
  });

  it.each([
    'never save this: the demo is Friday',
    'dont save this: the demo is Friday',
    "please don't ever save this: the demo is Friday",
    'no need to store it: the demo is Friday',
    'ذخیره‌اش نکن: جلسه جمعه است',
    'ذخيره نکن: جلسه جمعه است',
  ])('a group opt-out that only the shared rule recognises is never remembered: %s', async (text) => {
    const h = groupSetup();
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, text));
    expect(h.claimGroupMemory).not.toHaveBeenCalled();
    expect(h.llm.extractionCalls).toBe(0);
  });
});

describe('QA tests-types r2: each image download carries the 5 s deadline (4d17ecf)', () => {
  it('every downloadImage call receives the signal AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) returned', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const org = testOrg();
    const ladder = photoLadder();
    const bot = imageBot(ladder.files);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: imageAnswers() }), llm: new VisionFakeLLM('claude-fable-5-1'), fastLlm: new VisionFakeLLM(),
      bot: bot as unknown as TelegramBotClient, log: { warn: vi.fn() },
    };
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const turn = await ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', privatePhoto(TG.reza, ladder.sizes, 'what is this?').message!, 'what is this?');
    expect(turn).not.toBeNull();
    const calls = bot.downloadImage.mock.calls as Array<[string, { signal?: AbortSignal }]>;
    expect(calls.length).toBeGreaterThan(0);
    const deadlines = timeout.mock.calls.filter(([ms]) => ms === IMAGE_DOWNLOAD_TIMEOUT_MS);
    expect(deadlines).toHaveLength(calls.length);
    const issued = new Set(timeout.mock.results.map((r) => r.value as AbortSignal));
    for (const [, options] of calls) expect(issued.has(options.signal!)).toBe(true);
    expect(IMAGE_DOWNLOAD_TIMEOUT_MS).toBe(5_000);
  });
});
