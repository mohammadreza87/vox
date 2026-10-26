/**
 * F219: the fixed, content-free texts of an image turn follow the conversation's language. Before the
 * boundary nothing from history is read: a caption decides by its script, else the sender's Telegram
 * language_code. The withheld-reply text follows the delivered reply (Mini App: the message). English stays
 * byte-identical, and with STUDIO_IMAGES unset none of these paths run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import {
  IMAGE_PLACEHOLDER_TEXT, IMAGE_PLACEHOLDER_TEXT_FA, IMAGE_WITHHELD_REPLY_TEXT, IMAGE_WITHHELD_REPLY_TEXT_FA, imageAckText,
  imagePlaceholderText, imageTurnLanguage, ingestTelegramImage, isImagePlaceholderText, isWithheldImageReplyText,
  withheldImageReplyText, type ImageIngestDeps,
} from '../images';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { LLMImage } from '../llm';
import type { TelegramBotClient, TelegramMessage, TelegramUpdate } from '../telegram/client';
import type { ChatContext } from '../types';
import { TG, testOrg } from './fixtures';
import { imageAnswers, imageBot, photoLadder, privatePhoto, scriptedDecider, textAnswers, tinyJpeg, VisionFakeLLM } from './images-fixtures';

const FA_ACK = 'یک لحظه، دارم عکس را نگاه می‌کنم.';
const EN_ACK = "One moment, I'm looking at your photo.";
const FA_REPLY = 'این یک کارت شناسایی است و شماره‌اش خوانده شد.';

const WAVE_A_FLAGS = ['TIREH_CACHED_PROMPT', 'TIREH_PROMPT_SYSTEM_TAIL', 'TIREH_RETRIEVAL_V2', 'TIREH_VECTOR_RETRIEVAL', 'TIREH_SHARING_V2', 'TIREH_AUDIT_LOG',
  'STUDIO_DECIDER', 'TRIAGE_QUESTION_SET', 'TIREH_DECISION_LOG', 'STUDIO_IMAGES', 'STUDIO_VOICE_RECOGNITION', 'STUDIO_VOICE_SHADOW'];
beforeEach(() => { for (const flag of WAVE_A_FLAGS) vi.stubEnv(flag, ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

function withLanguage(update: TelegramUpdate, languageCode: string | undefined): TelegramUpdate {
  const message = update.message!;
  return { ...update, message: { ...message, from: { ...message.from!, ...(languageCode ? { language_code: languageCode } : {}) } } };
}

function gatewayHarness(image = imageAnswers()) {
  const llm = new VisionFakeLLM('claude-fable-5-1');
  const fast = new VisionFakeLLM('claude-haiku-5-5');
  const epochs = new Map<string, number>();
  const history = new InMemoryChatHistoryStore(epochs);
  const ladder = photoLadder();
  const bot = imageBot(ladder.files);
  const decider = scriptedDecider({ text: textAnswers(), image });
  const gateway = new PersonaGateway({
    org: testOrg(), llm, fastLlm: fast, decider, memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  const setReply = (text: string) => { llm.nextReply = text; fast.nextReply = text; };
  const stored = () => [...history.chats.values()].flat();
  const replies = () => [...llm.replyRequests, ...fast.replyRequests];
  return { gateway, bot, ladder, decider, setReply, stored, replies };
}

describe('F219: the fixed texts and their helpers', () => {
  it('keeps the English constants byte-identical and adds the Persian ones', () => {
    expect(IMAGE_PLACEHOLDER_TEXT).toBe('(shared a photo)');
    expect(IMAGE_WITHHELD_REPLY_TEXT).toBe('(replied about a shared image; the details were not kept)');
    expect(IMAGE_PLACEHOLDER_TEXT_FA).toBe('(یک عکس فرستاد)');
    expect(IMAGE_WITHHELD_REPLY_TEXT_FA).toBe('(دربارهٔ یک عکس پاسخ داده شد؛ جزئیات نگه داشته نشد)');
    expect(imagePlaceholderText('en')).toBe(IMAGE_PLACEHOLDER_TEXT);
    expect(imagePlaceholderText('fa')).toBe(IMAGE_PLACEHOLDER_TEXT_FA);
    expect(withheldImageReplyText('en')).toBe(IMAGE_WITHHELD_REPLY_TEXT);
    expect(withheldImageReplyText('fa')).toBe(IMAGE_WITHHELD_REPLY_TEXT_FA);
    for (const text of [IMAGE_PLACEHOLDER_TEXT, IMAGE_PLACEHOLDER_TEXT_FA]) expect(isImagePlaceholderText(text)).toBe(true);
    for (const text of [IMAGE_WITHHELD_REPLY_TEXT, IMAGE_WITHHELD_REPLY_TEXT_FA]) expect(isWithheldImageReplyText(text)).toBe(true);
    expect(isImagePlaceholderText('a photo')).toBe(false);
    expect(isWithheldImageReplyText(IMAGE_PLACEHOLDER_TEXT)).toBe(false);
  });

  it('picks the language from the caption first, then the Telegram language_code', () => {
    expect(imageTurnLanguage('این چیه؟', 'en')).toBe('fa');
    expect(imageTurnLanguage('what is this?', 'fa')).toBe('en');
    expect(imageTurnLanguage('', 'fa')).toBe('fa');
    expect(imageTurnLanguage('   ', 'fa-IR')).toBe('fa');
    expect(imageTurnLanguage('', 'en')).toBe('en');
    expect(imageTurnLanguage('', undefined)).toBe('en');
    expect(imageAckText('', 'fa')).toBe(FA_ACK);
    expect(imageAckText('what is this?', 'fa')).toBe(EN_ACK);
  });
});

describe('F219: acknowledgement before triage settles', () => {
  async function slowAck(caption: string, languageCode?: string) {
    vi.stubEnv('STUDIO_IMAGES', '1');
    vi.useFakeTimers();
    const org = testOrg();
    const ladder = photoLadder();
    const bot = imageBot(ladder.files);
    const deps: ImageIngestDeps = {
      org, decider: scriptedDecider({ image: () => new Promise(() => undefined) }), llm: new VisionFakeLLM('claude-fable-5-1'),
      fastLlm: new VisionFakeLLM(), bot: bot as unknown as TelegramBotClient, log: { warn: vi.fn() },
    };
    const message: TelegramMessage = withLanguage(privatePhoto(TG.reza, ladder.sizes, caption || undefined), languageCode).message!;
    const chat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };
    const pending = ingestTelegramImage(deps, org.getPersona('aria')!, chat, 'reza', message, caption);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    const turn = await pending;
    return { acks: bot.sendMessage.mock.calls.map((c) => c[1]), turn };
  }

  it('a Persian caption gets the Persian acknowledgement whatever the language_code', async () => {
    expect((await slowAck('این رسید را ببین', 'en')).acks).toEqual([FA_ACK]);
  });

  it('a captionless photo from a fa language_code gets the Persian acknowledgement and placeholder', async () => {
    const { acks, turn } = await slowAck('', 'fa');
    expect(acks).toEqual([FA_ACK]);
    expect(turn?.text).toBe(IMAGE_PLACEHOLDER_TEXT_FA);
  });

  it('English stays as it was', async () => {
    expect((await slowAck('what is this?', 'fa')).acks).toEqual([EN_ACK]);
    const { acks, turn } = await slowAck('', 'en');
    expect(acks).toEqual([EN_ACK]);
    expect(turn?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
  });
});

describe('F219: history rows of a Telegram image turn', () => {
  it('a captionless photo from a fa language_code is stored and answered with the Persian placeholder', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = gatewayHarness();
    expect(await h.gateway.handleUpdate('aria', withLanguage(privatePhoto(TG.reza, h.ladder.sizes), 'fa'))).toBe('replied');
    expect(h.stored().filter((m) => m.role === 'user').map((m) => m.text)).toEqual([IMAGE_PLACEHOLDER_TEXT_FA]);
    expect(JSON.stringify(h.replies())).toContain(IMAGE_PLACEHOLDER_TEXT_FA);
  });

  it('a Persian reply to a sensitive document keeps the Persian withheld text', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = gatewayHarness(imageAnswers({ kind: 'document', task: 'explain', sensitive: 0.9 }));
    h.setReply(FA_REPLY);
    expect(await h.gateway.handleUpdate('aria', withLanguage(privatePhoto(TG.reza, h.ladder.sizes, 'این چیه؟'), 'fa'))).toBe('replied');
    const assistant = h.stored().filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => m.text)).toEqual([IMAGE_WITHHELD_REPLY_TEXT_FA]);
    expect(JSON.stringify(h.stored())).not.toContain('شماره‌اش');
  });

  it('an English reply to the same document keeps the English text, byte for byte', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const h = gatewayHarness(imageAnswers({ kind: 'document', task: 'explain', sensitive: 0.9 }));
    h.setReply('This is an ID card; the number was read.');
    await h.gateway.handleUpdate('aria', withLanguage(privatePhoto(TG.reza, h.ladder.sizes, 'what is this?'), 'fa'));
    expect(h.stored().filter((m) => m.role === 'assistant').map((m) => m.text)).toEqual(['(replied about a shared image; the details were not kept)']);
  });

  it('with STUDIO_IMAGES unset a captionless Persian photo is ignored and nothing is stored', async () => {
    const h = gatewayHarness();
    expect(await h.gateway.handleUpdate('aria', withLanguage(privatePhoto(TG.reza, h.ladder.sizes), 'fa'))).toBe('ignored');
    expect(h.stored()).toEqual([]);
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.bot.sendMessage).not.toHaveBeenCalled();
  });
});

describe('F219: Mini App image turns', () => {
  const miniAppImage = (): LLMImage => ({ mimeType: 'image/jpeg', data: Buffer.from(tinyJpeg(320, 240)).toString('base64') });

  it('a Persian message with an image keeps the Persian withheld text; English keeps the English one', async () => {
    vi.stubEnv('STUDIO_IMAGES', '1');
    const fa = gatewayHarness();
    fa.setReply(FA_REPLY);
    expect(await fa.gateway.converse('aria', 'reza', 'این کارت را بخوان', { images: [miniAppImage()] })).toBe(FA_REPLY);
    expect(fa.stored().map((m) => m.text)).toEqual(['این کارت را بخوان', IMAGE_WITHHELD_REPLY_TEXT_FA]);
    for (const row of fa.stored()) expect(row.imageDerived).toEqual({ suppressed: true, people: true });
    const en = gatewayHarness();
    en.setReply('The card reads 1234.');
    await en.gateway.converse('aria', 'reza', 'read this card', { images: [miniAppImage()] });
    expect(en.stored().map((m) => m.text)).toEqual(['read this card', IMAGE_WITHHELD_REPLY_TEXT]);
  });

  it('with STUDIO_IMAGES unset the reply is stored unchanged and unmarked (main)', async () => {
    const h = gatewayHarness();
    h.setReply(FA_REPLY);
    await h.gateway.converse('aria', 'reza', 'این کارت را بخوان', { images: [miniAppImage()] });
    expect(h.stored().map((m) => m.text)).toEqual(['این کارت را بخوان', FA_REPLY]);
    for (const row of h.stored()) expect(row.imageDerived).toBeUndefined();
  });
});
