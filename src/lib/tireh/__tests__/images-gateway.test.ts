import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacy } from '../gateway';
import { IMAGE_PLACEHOLDER_TEXT } from '../images';
import { IMAGE_PEOPLE_DESCRIPTION, IMAGE_PEOPLE_RULE } from '../memory/extraction';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { systemText } from '../llm-content';
import { OrgDirectory } from '../org/directory';
import type { LLMRequest } from '../llm';
import type { TelegramBotClient, TelegramUpdate } from '../telegram/client';
import { GAMEEND_CHAT, TG, testOrgConfig } from './fixtures';
import {
  containsBytes, IMAGE_CANARIES, imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, VisionFakeLLM,
} from './images-fixtures';

type Decider = ReturnType<typeof scriptedDecider>;

function makeImageGateway(opts: { decider?: Decider; fastLlm?: boolean; runtimePrivacy?: RuntimePrivacy; withGuest?: boolean } = {}) {
  const config = testOrgConfig();
  if (opts.withGuest) config.people.push({ id: 'guest', name: 'Guest', role: 'Guest', telegramUserId: TG.stranger, companyIds: [], projectIds: [], guest: true });
  const org = new OrgDirectory(config);
  const llm = new VisionFakeLLM('claude-fable-5-1');
  const fast = new VisionFakeLLM('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const decider = opts.decider ?? scriptedDecider({ text: textAnswers(), image: imageAnswers() });
  const gateway = new PersonaGateway({
    org, llm, ...(opts.fastLlm === false ? {} : { fastLlm: fast }), decider, memories, offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient, logger,
    now: () => new Date('2026-10-19T10:00:00Z'), ...(opts.runtimePrivacy ? { runtimePrivacy: opts.runtimePrivacy } : {}),
  });
  const rows = () => history.recent('aria', 'private-reza', 50);
  const replies = () => [...llm.replyRequests, ...fast.replyRequests];
  return { gateway, llm, fast, memories, history, bot, logger, decider, ladder, rows, replies };
}

const textUpdateLike = (update: TelegramUpdate, text: string): TelegramUpdate => {
  const message = { ...update.message!, text };
  delete message.photo;
  delete message.caption;
  return { ...update, message };
};

const base64Of = (h: ReturnType<typeof makeImageGateway>) => Object.values(h.ladder.files).map((f) => Buffer.from(f).toString('base64').slice(0, 40));
const imageData = (request: LLMRequest) => request.messages.flatMap((m) => m.images ?? []).map((i) => i.data);

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('S12 gateway: flag off is the base behaviour', () => {
  it('ignores a captionless photo with no download, model call or history', async () => {
    vi.stubEnv('STUDIO_IMAGES', '');
    const h = makeImageGateway();
    const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes));
    expect(result).toBe('ignored');
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.replies()).toHaveLength(0);
    expect(h.llm.extractionCalls + h.fast.extractionCalls).toBe(0);
    expect(h.decider.decide).not.toHaveBeenCalled();
    expect(await h.rows()).toEqual([]);
  });

  it('handles a captioned photo exactly like the same text', async () => {
    vi.stubEnv('STUDIO_IMAGES', '');
    const photo = privatePhoto(TG.reza, photoLadder().sizes, 'hello');
    const a = makeImageGateway();
    const b = makeImageGateway();
    expect(await a.gateway.handleUpdate('aria', photo)).toBe(await b.gateway.handleUpdate('aria', textUpdateLike(photo, 'hello')));
    expect(a.bot.downloadImage).not.toHaveBeenCalled();
    expect(a.replies()).toEqual(b.replies());
    expect(a.replies().every((r) => r.messages.every((m) => !('images' in m)))).toBe(true);
    expect(a.llm.extractionRequests).toEqual(b.llm.extractionRequests);
    const strip = (rows: Awaited<ReturnType<typeof a.rows>>) => rows.map(({ role, text, personId, telegramMessageId }) => ({ role, text, personId, telegramMessageId }));
    expect(strip(await a.rows())).toEqual(strip(await b.rows()));
    expect(a.decider.decide.mock.calls).toEqual(b.decider.decide.mock.calls);
  });

  it('a text turn with the flag on equals the flag-off run', async () => {
    const update: TelegramUpdate = { update_id: 990_001, message: { message_id: 99_001, from: { id: TG.reza, is_bot: false, first_name: 'x' }, chat: { id: TG.reza, type: 'private' }, date: 0, text: 'my launch moved to Friday' } };
    vi.stubEnv('STUDIO_IMAGES', '');
    const off = makeImageGateway();
    const resultOff = await off.gateway.handleUpdate('aria', update);
    vi.stubEnv('STUDIO_IMAGES', '1');
    const on = makeImageGateway();
    const resultOn = await on.gateway.handleUpdate('aria', update);
    expect(resultOn).toBe(resultOff);
    expect(on.replies()).toEqual(off.replies());
    expect(on.llm.extractionRequests).toEqual(off.llm.extractionRequests);
    expect(on.decider.decide.mock.calls).toEqual(off.decider.decide.mock.calls);
    expect(on.decider.decideParts).not.toHaveBeenCalled();
    expect(on.bot.downloadImage).not.toHaveBeenCalled();
  });
});

async function captionlessPhoto() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const h = makeImageGateway({ fastLlm: false, decider: scriptedDecider({ text: textAnswers(), image: imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.9 }) }) });
  const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes));
  return { h, result };
}

async function explainWithFast() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const h = makeImageGateway({ decider: scriptedDecider({ text: textAnswers({ effort: 'thoughtful' }), image: imageAnswers({ kind: 'chart', task: 'explain' }) }) });
  const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, `what does this show? ${IMAGE_CANARIES.caption}`));
  return { h, result };
}

async function sensitiveDocument() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const h = makeImageGateway({ decider: scriptedDecider({ text: textAnswers({ memorable: 0.95 }), image: imageAnswers({ kind: 'document', task: 'remember', sensitive: 0.9 }) }) });
  h.llm.nextExtraction = { memories: [{ content: 'Reza passport number is X1234567', type: 'fact', kind: 'personal', saidBy: 'reza', about: ['reza'] }] };
  const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, `remember this ${IMAGE_CANARIES.caption}`));
  return { h, result };
}

async function rememberNotSensitive() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const h = makeImageGateway({ decider: scriptedDecider({ text: textAnswers(), image: imageAnswers({ kind: 'receipt', task: 'remember', people: 0.1, sensitive: 0.1 }) }) });
  h.llm.nextExtraction = { memories: [{ content: 'Reza paid for the team dinner on Friday', type: 'event', kind: 'work', saidBy: 'reza', about: ['reza'] }] };
  const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, `keep this receipt for later ${IMAGE_CANARIES.caption}`));
  return { h, result };
}

async function peopleRemember() {
  vi.stubEnv('STUDIO_IMAGES', '1');
  const h = makeImageGateway({ decider: scriptedDecider({ text: textAnswers(), image: imageAnswers({ kind: 'photo_of_people', task: 'remember', people: 0.9 }) }) });
  h.llm.nextExtraction = { memories: [
    { content: 'Reza is wearing a red jacket in the photo', type: 'fact', kind: 'work', saidBy: 'reza', about: ['reza'] },
    { content: 'Reza and Milad are friends', type: 'relationship', kind: 'work', saidBy: 'reza', about: ['reza', 'milad'] },
    { content: "Reza's flight to Berlin is on Friday", type: 'event', kind: 'work', saidBy: 'reza', about: ['reza'], topic: 'berlin flight' },
  ] };
  const result = await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes, 'remember this: me and Milad before my flight to Berlin on Friday'));
  return { h, result };
}

describe('S12 gateway: flag on', () => {
  it('replies to a captionless photo with one ephemeral image', async () => {
    const { h, result } = await captionlessPhoto();
    expect(result).toBe('replied');
    expect(h.bot.downloadImage).toHaveBeenCalled();
    const request = h.replies().at(-1)!;
    const last = request.messages.at(-1)!;
    expect(last.content).toBe(IMAGE_PLACEHOLDER_TEXT);
    expect(last.images).toHaveLength(1);
    const data = last.images![0].data;
    const system = systemText(request.system);
    expect(system).not.toContain(data);
    expect(system).not.toContain(data.slice(0, 32));
    expect(system).not.toMatch(/photo_of_people|contains_people|contains_sensitive_document|image_task|image_kind/);
    expect(containsBytes(Buffer.from(data, 'base64'), IMAGE_CANARIES.exif)).toBe(false);
    const rows = await h.rows();
    expect(rows.filter((r) => r.role === 'user').map((r) => r.text)).toEqual([IMAGE_PLACEHOLDER_TEXT]);
    expect(JSON.stringify(rows)).not.toContain(data.slice(0, 32));
    expect(rows.every((r) => !('images' in r))).toBe(true);
    // Unknown memory intent: nothing is extracted.
    expect(h.llm.extractionCalls).toBe(0);
  });

  it('routes an explain request to the fast vision model only', async () => {
    const { h, result } = await explainWithFast();
    expect(result).toBe('replied');
    expect(h.fast.replyRequests).toHaveLength(1);
    expect(h.llm.replyRequests).toHaveLength(0);
    expect(h.fast.replyRequests[0].messages.at(-1)!.images).toHaveLength(1);
  });

  it('never stores a sensitive document, even when asked', async () => {
    const { h, result } = await sensitiveDocument();
    expect(result).toBe('replied');
    expect(h.llm.extractionCalls).toBe(0);
    expect(h.fast.extractionCalls).toBe(0);
    expect(await h.memories.listActive('aria')).toEqual([]);
  });

  it('runs extraction once for a requested, non-sensitive image, without image bytes', async () => {
    const { h } = await rememberNotSensitive();
    expect(h.llm.extractionCalls).toBe(1);
    const json = JSON.stringify(h.llm.extractionRequests);
    for (const prefix of base64Of(h)) expect(json).not.toContain(prefix);
    for (const request of [...h.replies()]) for (const data of imageData(request)) expect(json).not.toContain(data.slice(0, 40));
    expect(json).not.toContain(IMAGE_CANARIES.exif);
    expect(systemText(h.llm.extractionRequests[0].system)).not.toContain(IMAGE_PEOPLE_RULE);
    expect((await h.memories.listActive('aria')).map((m) => m.content)).toEqual(['Reza paid for the team dinner on Friday']);
  });

  it('never turns people in an image into identity or appearance memories', async () => {
    const { h } = await peopleRemember();
    expect(h.llm.extractionCalls).toBe(1);
    expect(systemText(h.llm.extractionRequests[0].system)).toContain(IMAGE_PEOPLE_RULE);
    const stored = await h.memories.listActive('aria');
    expect(stored.map((m) => m.content)).toEqual(["Reza's flight to Berlin is on Friday"]);
    expect(stored.some((m) => IMAGE_PEOPLE_DESCRIPTION.test(m.content))).toBe(false);
    expect(stored.some((m) => m.type === 'relationship')).toBe(false);
    for (const request of h.replies()) expect(systemText(request.system)).not.toMatch(/red jacket|photo_of_people|contains_people/);

    // A later text turn sees the kept fact but no description.
    await h.gateway.handleUpdate('aria', { update_id: 991_000, message: { message_id: 99_500, from: { id: TG.reza, is_bot: false, first_name: 'x' }, chat: { id: TG.reza, type: 'private' }, date: 0, text: 'when is my trip?' } });
    const next = systemText(h.replies().at(-1)!.system);
    expect(next).toContain('Berlin');
    expect(next).not.toMatch(/red jacket|wearing/);
    expect(h.replies().at(-1)!.messages.every((m) => !m.images)).toBe(true);
  });

  it('treats a group photo like the base: caption only, no download', async () => {
    const make = (): TelegramUpdate => ({ update_id: 992_000, message: { message_id: 99_600, from: { id: TG.reza, is_bot: false, first_name: 'x' },
      chat: { id: GAMEEND_CHAT, type: 'supergroup', title: 'g' }, date: 0, caption: '@hoor_aria_bot what do you think?', photo: photoLadder().sizes } });
    vi.stubEnv('STUDIO_IMAGES', '');
    const off = makeImageGateway();
    const resultOff = await off.gateway.handleUpdate('aria', make());
    vi.stubEnv('STUDIO_IMAGES', '1');
    const on = makeImageGateway();
    const resultOn = await on.gateway.handleUpdate('aria', make());
    expect(resultOff).toBe('replied');
    expect(resultOn).toBe(resultOff);
    expect(off.replies().at(-1)!.messages.at(-1)!.content).toContain('what do you think?');
    expect(on.bot.downloadImage).not.toHaveBeenCalled();
    expect(on.decider.decideParts).not.toHaveBeenCalled();
    expect(on.replies()).toEqual(off.replies());
    expect(on.replies().every((r) => r.messages.every((m) => !m.images))).toBe(true);
  });

  it('never downloads for a guest private chat', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = makeImageGateway({ withGuest: true });
    await h.gateway.handleUpdate('aria', privatePhoto(TG.stranger, h.ladder.sizes, 'look'));
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.decider.decideParts).not.toHaveBeenCalled();
    expect(h.replies().every((r) => r.messages.every((m) => !m.images))).toBe(true);
  });

  it('never downloads when the live audience check fails', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const validateAudience = vi.fn(async () => false);
    const runtimePrivacy: RuntimePrivacy = { validateAudience, read: async () => ({ revision: 'r1', memoryEnabled: true, historyEnabled: true }) };
    const h = makeImageGateway({ runtimePrivacy });
    expect(await h.gateway.handleUpdate('aria', privatePhoto(TG.reza, h.ladder.sizes))).toBe('ignored');
    expect(validateAudience).toHaveBeenCalled();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.decider.decideParts).not.toHaveBeenCalled();
  });

  it('puts no image bytes, captions or EXIF into any log line', async () => {
    const consoleCalls = [vi.spyOn(console, 'log').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'info').mockImplementation(() => undefined)];
    const runs = [await captionlessPhoto(), await explainWithFast(), await sensitiveDocument(), await rememberNotSensitive(), await peopleRemember()];
    // A failing download also logs only a fixed code.
    vi.stubEnv('STUDIO_IMAGES', '1');
    const failing = makeImageGateway();
    failing.bot.downloadImage.mockRejectedValue(new Error(`boom ${IMAGE_CANARIES.caption}`));
    await failing.gateway.handleUpdate('aria', privatePhoto(TG.reza, failing.ladder.sizes, `x ${IMAGE_CANARIES.caption}`));
    const harnesses = [...runs.map((r) => r.h), failing];
    const calls = [
      ...harnesses.flatMap((h) => [...h.logger.info.mock.calls, ...h.logger.warn.mock.calls, ...h.logger.error.mock.calls]),
      ...consoleCalls.flatMap((spy) => spy.mock.calls),
    ];
    const json = JSON.stringify(calls, (_key, value) => value instanceof Error ? `${value.name}: ${value.message}` : value);
    expect(json).not.toContain(IMAGE_CANARIES.caption);
    expect(json).not.toContain(IMAGE_CANARIES.exif);
    for (const h of harnesses) {
      for (const prefix of base64Of(h)) expect(json).not.toContain(prefix);
      for (const request of h.replies()) for (const data of imageData(request)) expect(json).not.toContain(data.slice(0, 40));
    }
    const imageWarns = harnesses.flatMap((h) => h.logger.warn.mock.calls).filter((args) => args.some((a: unknown) => typeof a === 'string' && a.startsWith('tireh_image:')));
    expect(imageWarns.length).toBeGreaterThan(0);
    for (const args of imageWarns) {
      expect(args).toHaveLength(1);
      expect(args[0]).toMatch(/^tireh_image:[a-z_]+$/);
    }
  });
});
