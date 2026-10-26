/**
 * Privacy red team, wave A on main, round 2: what is left where S12 images meet the person's
 * own words and main's consent model, after fixer r1.
 *
 * Passing guards pin behaviour that holds on agent-intelligence-wave-a-main. The gaps found in
 * this round were pinned as it.fails and closed by fixer r2, so every case here is a plain `it`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { explicitMemoryRequest, negatedMemoryRequest } from '../memory/requests';
import { IMAGE_PEOPLE_THRESHOLD, imageShowsPeople, suppressImageMemory } from '../images';
import { IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { systemText } from '../llm-content';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient, TelegramUpdate } from '../telegram/client';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM } from './images-fixtures';
import { hire, ID, makeStudio, seedOrg } from '../../studio/__tests__/helpers';
import { handleAgentUpdate } from '../../studio/updates';

const PLAN = 'PLANCANARY whiteboard: launch moves to May 3';
const FACE = 'FACECANARY red jacket beard';
const requestText = (r: Pick<LLMRequest, 'system' | 'messages'>) => `${systemText(r.system)}\n${r.messages.map((m) => m.content).join('\n')}`;

/** An extractor that, like a real one, can only propose what it was shown. */
class EchoingExtractor extends VisionFakeLLM {
  override async complete(request: LLMRequest): Promise<string> {
    if (systemText(request.system).startsWith('You extract long-term memories')) {
      const shown = requestText(request);
      this.nextExtraction = shown.includes('PLANCANARY')
        ? { memories: [{ content: 'Reza said the launch moves to May 3 (PLANCANARY)', type: 'decision', kind: 'work', saidBy: 'reza', about: ['reza'], confidence: 0.9 }] }
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

function harness(image: ReturnType<typeof imageAnswers>) {
  const llm = new EchoingExtractor('claude-fable-5-1');
  const fast = new EchoingExtractor('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const decider = scriptedDecider({ text: textAnswers({ effort: 'thoughtful', memorable: 0.9 }), image });
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider, memories, offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const extractions = () => [...llm.extractionRequests, ...fast.extractionRequests];
  return { gateway, llm, fast, memories, ladder, bot, decider, setReply, extractions };
}

// Gap 1 (high). memory/requests.ts (fixer r1, b142d00) allows at most two words between the negation and the
// verb. "I don't want you to remember this" has three ("want you to"), so NEGATED_MEMORY_REQUEST misses it while
// MEMORY_REQUEST matches "remember this": explicitMemoryRequest() is true, suppressImageMemory() turns extraction
// ON for the image turn, and what the reply read off the image becomes a memory. The person said the opposite.
// The same rule is the gateway's group NO_MEMORY, so a Circles group line phrased this way is remembered too.
// Closed by fixer r2 (modal and desire negations, a wider gap, Persian "لازم نیست" / "نمی‌خوام"): plain `it` now.
describe('red team wave A on main r2: a negated memory request is read as a request to remember', () => {
  const NEGATED = [
    "I don't want you to remember this",
    'i do not want you to save this',
    'Please do NOT, under any circumstances, keep this',
    'لازم نیست یادت بمونه',
    'نمی‌خوام یادت بمونه',
  ];

  it('guard: the phrasings fixer r1 covered are still negations', () => {
    for (const text of ["don't keep this", 'never save this', 'dont save this', "please don't ever save this", "don't you dare remember this", 'یادت نمونه'])
      expect(negatedMemoryRequest(text), text).toBe(true);
  });

  it('every natural negation of "remember this" is a negation, never an explicit request', () => {
    for (const text of NEGATED) expect(explicitMemoryRequest(text), text).toBe(false);
  });

  it('an image turn whose caption says not to keep it is never extracted, whatever triage says', () => {
    const triage = { kind: 'other' as const, task: 'react' as const, containsPeople: 0.1, containsSensitiveDocument: 0.1 };
    for (const text of NEGATED) expect(suppressImageMemory(triage, text), text).toBe(true);
  });

  it('end to end: "I don\'t want you to remember this" on a Telegram photo forms no memory of what the photo showed', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'react', people: 0.1, sensitive: 0.1 }));
    h.setReply(`The ${PLAN}.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, "I don't want you to remember this"));
    expect(h.llm.replyRequests.length + h.fast.replyRequests.length).toBeGreaterThan(0); // positive control: the image was answered
    expect(h.extractions().map(requestText).join('\n')).not.toContain('PLANCANARY');
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('PLANCANARY');
  });

  it('control: "please don\'t remember this" on the same photo forms no memory', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'react', people: 0.1, sensitive: 0.1 }));
    h.setReply(`The ${PLAN}.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, "please don't remember this"));
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('PLANCANARY');
  });
});

// Gap 2 (medium). The merge chose wave A's S12 retention rule, which turns the extraction people rule on only for
// contains_people >= 0.5. Main's dropped images/policy.ts turned it on for kind 'photo_of_people' or
// contains_people >= 0.3 ("leans protective"). A photo the decider itself classifies as a photo of people, with an
// uncertain people probability, is extracted without IMAGE_PEOPLE_RULE and without the appearance filter.
// Closed by fixer r2 (imageShowsPeople: kind photo_of_people or contains_people >= 0.3, main's rule): plain `it` now.
describe('red team wave A on main r2: the people rule is weaker than the main lineage it replaced', () => {
  it('a photo triaged as photo_of_people turns the people rule on, whatever its people probability', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'remember', people: 0.4, sensitive: 0.05 }));
    h.setReply(`Nice, the man in the ${FACE} looks happy.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this, my brother Ali'));
    const shown = h.extractions().map((r) => systemText(r.system)).join('\n');
    expect(h.extractions().length).toBeGreaterThan(0); // positive control: an explicit remember request is extracted
    expect(shown).toContain(IMAGE_PEOPLE_RULE);
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('main\'s threshold: an uncertain 0.3 people probability on any image kind turns the people rule on', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'remember', people: 0.3, sensitive: 0.05 }));
    h.setReply(`Nice, the man in the ${FACE} looks happy.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this, my brother Ali'));
    expect(h.extractions().length).toBeGreaterThan(0);
    expect(h.extractions().map((r) => systemText(r.system)).join('\n')).toContain(IMAGE_PEOPLE_RULE);
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });

  it('control: an image with no people (kind other, 0.1) is extracted without the people rule', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'other', task: 'remember', people: 0.1, sensitive: 0.05 }));
    h.setReply(`The ${PLAN}.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this'));
    expect(h.extractions().length).toBeGreaterThan(0);
    expect(h.extractions().map((r) => systemText(r.system)).join('\n')).not.toContain(IMAGE_PEOPLE_RULE);
  });

  it('imageShowsPeople: unknown triage, kind photo_of_people or contains_people >= 0.3', () => {
    const triage = (kind: 'other' | 'photo_of_people', containsPeople: number) => ({ kind, task: 'react' as const, containsPeople, containsSensitiveDocument: 0 });
    expect(IMAGE_PEOPLE_THRESHOLD).toBe(0.3);
    expect(imageShowsPeople(null)).toBe(true);
    expect(imageShowsPeople(triage('photo_of_people', 0))).toBe(true);
    expect(imageShowsPeople(triage('other', 0.3))).toBe(true);
    expect(imageShowsPeople(triage('other', 0.29))).toBe(false);
  });

  it('guard: at contains_people 0.5 the people rule and its filter keep the appearance out', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = harness(imageAnswers({ kind: 'photo_of_people', task: 'remember', people: 0.5, sensitive: 0.05 }));
    h.setReply(`Nice, the man in the ${FACE} looks happy.`);
    await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this, my brother Ali'));
    expect(JSON.stringify(await h.memories.listActive('aria'))).not.toContain('FACECANARY');
  });
});

// Gap 3 (high). Main gates every image export on the adaptive 'single_party_image' capability (adult confirmed,
// known jurisdiction, an approved, unexpired approval): conversation.ts refuses a Mini App image without it
// ('denies image export without its own capability, even with core text permission'), and so does the adaptive
// runtime (requiresImage). The S12 Telegram path checks core text consent only: with STUDIO_IMAGES=1 a member's
// photo is downloaded, sent to the decider and to the reply model while the same person's Mini App image is refused.
// Closed by fixer r2 (GatewayDeps.imageAllowed, wired by Studio to single_party_image): plain `it` now.
describe('red team wave A on main r2: Telegram photos skip the single_party_image capability', () => {
  async function studioHarness() {
    const h = makeStudio();
    const org = await seedOrg(h);
    const hired = await hire(h, org.alice, { name: 'Cookie' });
    const vision = new VisionFakeLLM('claude-test');
    h.studio.deps.chatLLM = vision;
    const decideParts = vi.fn(async () => imageAnswers({ task: 'explain' }));
    h.studio.deps.decider = { decide: vi.fn(async () => ({})), decideParts } as unknown as NonNullable<typeof h.studio.deps.decider>;
    const ladder = photoLadder();
    const downloadImage = vi.fn(async (fileId: string) => ladder.files[fileId]?.slice() ?? new Uint8Array());
    Object.assign(hired.bot(), { downloadImage });
    let id = 990_000;
    const photo = (from: number): TelegramUpdate => ({ update_id: ++id, message: { message_id: id, date: 0, caption: 'what is this?', photo: ladder.sizes,
      from: { id: from, is_bot: false, first_name: 'Alice' }, chat: { id: from, type: 'private' } } });
    const send = (u: TelegramUpdate) => handleAgentUpdate(h.studio, hired.agent.id, u);
    return { h, hired, vision, decideParts, downloadImage, photo, send };
  }

  it('control: the person has no single_party_image capability, so the Mini App would refuse their image', async () => {
    const { h } = await studioHarness();
    const status = await h.adaptive!.withAccountDocument(ID.alice, (d, now) => h.adaptive!.capabilityStatus(d, 'single_party_image', now));
    expect(status.eligible).toBe(false);
  });

  it('with STUDIO_IMAGES=1 their Telegram photo is not downloaded or exported either', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const { h, vision, decideParts, downloadImage, photo, send } = await studioHarness();
    const status = await h.adaptive!.withAccountDocument(ID.alice, (d, now) => h.adaptive!.capabilityStatus(d, 'single_party_image', now));
    expect(status.eligible).toBe(false);
    await send(photo(ID.alice));
    expect(downloadImage).not.toHaveBeenCalled();
    expect(decideParts).not.toHaveBeenCalled();
    expect(vision.replyRequests.some((r) => r.messages.some((m) => m.images?.length))).toBe(false);
  });

  /** Grants single_party_image while `granted()` holds; every other capability is evaluated as before. */
  function grantImage(h: Awaited<ReturnType<typeof studioHarness>>['h'], granted: () => boolean) {
    const adaptive = h.adaptive!;
    const original = adaptive.capabilityStatus.bind(adaptive);
    vi.spyOn(adaptive, 'capabilityStatus').mockImplementation((d, capability, now) =>
      capability === 'single_party_image' && granted() ? { eligible: true } : original(d, capability, now));
  }

  it('positive control: with the capability eligible the same photo is downloaded, triaged and answered with the image', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const { h, vision, decideParts, downloadImage, photo, send } = await studioHarness();
    grantImage(h, () => true);
    await send(photo(ID.alice));
    expect(downloadImage).toHaveBeenCalled();
    expect(decideParts).toHaveBeenCalledTimes(1);
    expect(vision.replyRequests.some((r) => r.messages.some((m) => m.images?.length))).toBe(true);
  });

  it('a capability withdrawn during the download drops the image before triage and the reply', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const { h, vision, decideParts, downloadImage, photo, send } = await studioHarness();
    let granted = true;
    grantImage(h, () => granted);
    const download = downloadImage.getMockImplementation()!;
    downloadImage.mockImplementation(async (...args: Parameters<typeof download>) => { granted = false; return download(...args); });
    await send(photo(ID.alice));
    expect(downloadImage).toHaveBeenCalledTimes(1);
    expect(decideParts).not.toHaveBeenCalled();
    expect(vision.replyRequests.some((r) => r.messages.some((m) => m.images?.length))).toBe(false);
  });
});

describe('red team wave A on main r2: the gateway image capability seam fails closed', () => {
  it('a runtime privacy adapter without imageAllowed never downloads a photo; one that allows it does', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const run = async (imageAllowed?: () => Promise<boolean>) => {
      const h = harness(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
      const deps = (h.gateway as unknown as { deps: Record<string, unknown> }).deps;
      // A permissive adapter: every text gate passes, so only the image capability can refuse the image.
      deps.runtimePrivacy = { read: async () => ({ revision: 'r1', memoryEnabled: true, historyEnabled: true }) };
      if (imageAllowed) deps.imageAllowed = imageAllowed;
      h.setReply('A whiteboard.');
      await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'));
      return h.bot.downloadImage.mock.calls.length;
    };
    expect(await run()).toBe(0);
    expect(await run(async () => false)).toBe(0);
    expect(await run(async () => { throw new Error('unavailable'); })).toBe(0);
    expect(await run(async () => true)).toBeGreaterThan(0);
  });
});
