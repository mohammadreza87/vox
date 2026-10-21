import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_ACK_AFTER_MS,
  IMAGE_ACK_TEXT,
  IMAGE_MAX_BYTES,
  IMAGE_PLACEHOLDER_TEXT,
  IMAGE_QUESTIONS,
  IMAGE_TRIAGE_TIMEOUT_MS,
  ingestTelegramImage,
  type ImageIngestDeps,
} from '../images';
import { OrgDirectory } from '../org/directory';
import type { LLM } from '../llm';
import type { TelegramBotClient, TelegramUpdate } from '../telegram/client';
import type { ChatContext } from '../types';
import { FakeLLM, GAMEEND_CHAT, TG, testOrg, testOrgConfig } from './fixtures';
import {
  base64Of,
  GeminiFakeLLM,
  imageAnswers,
  imageBot,
  type ImageAnswers,
  type ImageBot,
  pngBytes,
  PNG_TEXT_CANARY,
  privateImageDocument,
  privatePhoto,
  scriptedImageDecider,
  VisionFakeLLM,
  jpegBytes,
  defaultImageFiles,
} from './images-fixtures';

const PRIVATE_REZA: ChatContext = { kind: 'private', chatKey: `private-reza`, personId: 'reza' };

interface Setup {
  org?: OrgDirectory;
  llm?: LLM;
  fastLlm?: LLM;
  decider?: ImageIngestDeps['decider'];
  bot?: ImageBot;
}

function setup(options: Setup = {}) {
  const org = options.org ?? testOrg();
  const bot = options.bot ?? imageBot();
  const log = { warn: vi.fn() };
  const deps: ImageIngestDeps = {
    org,
    llm: options.llm ?? new VisionFakeLLM(),
    ...(options.fastLlm ? { fastLlm: options.fastLlm } : {}),
    ...(options.decider ? { decider: options.decider } : {}),
    bot: bot as unknown as TelegramBotClient,
    log,
  };
  const persona = org.getPersona('aria')!;
  const run = (update: TelegramUpdate, chat: ChatContext = PRIVATE_REZA, speakerId = 'reza') =>
    ingestTelegramImage(deps, persona, chat, speakerId, update.message!, update.message!.caption ?? update.message!.text ?? '');
  return { org, bot, log, deps, persona, run };
}

const sentTexts = (bot: ImageBot) => bot.sendMessage.mock.calls.map((call) => call[1]);

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('ingestTelegramImage: gates before any I/O', () => {
  const expectNoIo = (ctx: ReturnType<typeof setup>, decider?: ReturnType<typeof scriptedImageDecider>) => {
    expect(ctx.bot.downloadImage).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    if (decider) expect(decider.decideParts).not.toHaveBeenCalled();
  };

  it.each([undefined, '0', 'true', ' yes '])('returns null when STUDIO_IMAGES is %s', async (value) => {
    vi.stubEnv('STUDIO_IMAGES', value);
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    const ctx = setup({ decider });
    expect(await ctx.run(privatePhoto(TG.reza, { caption: 'hi' }))).toBeNull();
    expectNoIo(ctx, decider);
  });

  it('returns null for a message without a photo or image document', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ decider });
    const update = privatePhoto(TG.reza, { caption: 'hi' });
    delete update.message!.photo;
    expect(await ctx.run(update)).toBeNull();
    update.message!.photo = [];
    expect(await ctx.run(update)).toBeNull();
    expectNoIo(ctx, decider);
  });

  it.each(['application/pdf', 'image/webp', 'image/gif', undefined])('returns null for a %s document', async (mime) => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ decider });
    const update = privateImageDocument(TG.reza, { mime: mime ?? '' });
    if (mime === undefined) delete update.message!.document!.mime_type;
    expect(await ctx.run(update)).toBeNull();
    expectNoIo(ctx, decider);
  });

  it('returns null in a group chat', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ decider });
    const chat: ChatContext = { kind: 'group', chatKey: `group-${GAMEEND_CHAT}`, group: ctx.org.getGroupByChatId(GAMEEND_CHAT)! };
    expect(await ctx.run(privatePhoto(TG.reza, { chatId: GAMEEND_CHAT, chatType: 'supergroup', caption: '@hoor_aria_bot look' }), chat)).toBeNull();
    expectNoIo(ctx, decider);
  });

  it('returns null when the chat does not belong to the speaker', async () => {
    const ctx = setup();
    expect(await ctx.run(privatePhoto(TG.reza), PRIVATE_REZA, 'parastoo')).toBeNull();
    expectNoIo(ctx);
  });

  it('returns null for a guest speaker', async () => {
    const config = testOrgConfig();
    const org = new OrgDirectory({ ...config, people: [...config.people, { ...config.people[3], id: 'visitor', name: 'Visitor', telegramUserId: 7777, guest: true }] });
    const decider = scriptedImageDecider({});
    const ctx = setup({ org, decider });
    const chat: ChatContext = { kind: 'private', chatKey: 'private-visitor', personId: 'visitor' };
    expect(await ctx.run(privatePhoto(7777), chat, 'visitor')).toBeNull();
    expectNoIo(ctx, decider);
  });

  it('refuses a model without vision identity before downloading', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ llm: new FakeLLM(), decider });
    expect(await ctx.run(privatePhoto(TG.reza))).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_vision_unsupported']]);
    expectNoIo(ctx, decider);
  });

  it('refuses Gemini as the only target before downloading', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ llm: new GeminiFakeLLM(), decider });
    expect(await ctx.run(privatePhoto(TG.reza))).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_vision_unsupported']]);
    expectNoIo(ctx, decider);
  });

  it('rejects a document whose known size is over the cap without downloading', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ decider });
    expect(await ctx.run(privateImageDocument(TG.reza, { mime: 'image/jpeg', fileSize: IMAGE_MAX_BYTES + 1 }))).toBeNull();
    expectNoIo(ctx, decider);
  });
});

describe('ingestTelegramImage: downloads', () => {
  it('logs one fixed string, never the error, when the download fails', async () => {
    const ctx = setup();
    ctx.bot.downloadImage.mockRejectedValueOnce(Object.assign(new Error('https://api.telegram.org/file/bot123:FAKE_TOKEN_S12/photos/x.jpg S12_ERROR_CANARY'), { cause: 'S12_ERROR_CANARY' }));
    expect(await ctx.run(privatePhoto(TG.reza))).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_download_failed']]);
  });

  it('rejects bytes that are not a supported image', async () => {
    const files = defaultImageFiles();
    files.set('photo-800', new Uint8Array(Buffer.from('GIF89a not an image')));
    const ctx = setup({ bot: imageBot(files) });
    expect(await ctx.run(privatePhoto(TG.reza))).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_invalid']]);
  });

  it('downloads the 800 px size once and never acknowledges without an image-capable decider', async () => {
    const decider = { decide: vi.fn(async () => ({})) };
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(turn?.triage).toBeNull();
    expect(ctx.bot.downloadImage).toHaveBeenCalledTimes(1);
    expect(ctx.bot.downloadImage.mock.calls[0][0]).toBe('photo-800');
    expect(ctx.bot.downloadImage.mock.calls[0][1].maxBytes).toBe(IMAGE_MAX_BYTES);
    expect(ctx.bot.downloadImage.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(turn?.images).toEqual([{ mimeType: 'image/jpeg', data: base64Of(ctx.bot.files.get('photo-800')!) }]);
    expect(decider.decide).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    expect(turn).toMatchObject({ suppressMemory: true, containsPeople: true, forceQuick: false });
  });

  it('uses the caption as the turn text, else the placeholder', async () => {
    const ctx = setup();
    expect((await ctx.run(privatePhoto(TG.reza, { caption: 'what is this?' })))?.text).toBe('what is this?');
    expect((await ctx.run(privatePhoto(TG.reza)))?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
    expect((await ctx.run(privatePhoto(TG.reza, { caption: '   ' })))?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
  });

  it('accepts a PNG image document and strips its text chunks', async () => {
    const files = defaultImageFiles();
    files.set('doc-1', pngBytes({ withText: true }));
    const ctx = setup({ bot: imageBot(files) });
    const turn = await ctx.run(privateImageDocument(TG.reza, { mime: 'image/png' }));
    expect(turn?.images[0].mimeType).toBe('image/png');
    const decoded = Buffer.from(turn!.images[0].data, 'base64').toString('latin1');
    expect(decoded).not.toContain('tEXt');
    expect(decoded).not.toContain(PNG_TEXT_CANARY);
  });

  it('rejects a document whose declared type does not match its bytes', async () => {
    const files = defaultImageFiles();
    files.set('doc-1', jpegBytes());
    const ctx = setup({ bot: imageBot(files) });
    expect(await ctx.run(privateImageDocument(TG.reza, { mime: 'image/png' }))).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_invalid']]);
  });
});

describe('ingestTelegramImage: triage', () => {
  it('asks the four image questions once with the caption and the small image', async () => {
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza, { caption: 'what is this?' }));
    expect(decider.decideParts).toHaveBeenCalledTimes(1);
    const [parts, questions, timeout] = decider.decideParts.mock.calls[0];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain(JSON.stringify('what is this?'));
    expect(parts[1]).toEqual({ type: 'image', image: { mimeType: 'image/jpeg', data: base64Of(ctx.bot.files.get('photo-320')!) } });
    expect(questions).toBe(IMAGE_QUESTIONS);
    expect(timeout).toBe(IMAGE_TRIAGE_TIMEOUT_MS);
    expect(decider.decide).not.toHaveBeenCalled();
    expect(turn?.triage).toEqual({ kind: 'other', task: 'explain', containsPeople: 0, containsSensitiveDocument: 0 });
    expect(turn?.forceQuick).toBe(true);
  });

  it('re-downloads at detail resolution for text extraction', async () => {
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'extract_text', people: 0, sensitive: 0 }));
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(ctx.bot.downloadImage.mock.calls.map((call) => call[0])).toEqual(['photo-320', 'photo-1280']);
    expect(turn?.images).toEqual([{ mimeType: 'image/jpeg', data: base64Of(ctx.bot.files.get('photo-1280')!) }]);
  });

  it('keeps the small image for a casual people photo', async () => {
    const decider = scriptedImageDecider(imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.95, sensitive: 0 }));
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(ctx.bot.downloadImage.mock.calls.map((call) => call[0])).toEqual(['photo-320']);
    expect(turn?.images[0].data).toBe(base64Of(ctx.bot.files.get('photo-320')!));
    expect(turn?.containsPeople).toBe(true);
  });

  it('keeps the small image when the detail download fails', async () => {
    const files = defaultImageFiles();
    files.delete('photo-1280');
    const decider = scriptedImageDecider(imageAnswers({ kind: 'receipt', task: 'explain', people: 0, sensitive: 0 }));
    const ctx = setup({ decider, bot: imageBot(files) });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(turn?.images[0].data).toBe(base64Of(files.get('photo-320')!));
    expect(ctx.log.warn.mock.calls).toEqual([['image_detail_download_failed']]);
  });

  it('treats a rejected triage as missing', async () => {
    const decider = scriptedImageDecider(async () => { throw new Error('S12_DECIDER_CANARY'); });
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(turn).not.toBeNull();
    expect(turn?.triage).toBeNull();
    expect(turn?.suppressMemory).toBe(true);
    expect(ctx.log.warn.mock.calls).toEqual([['image_triage_failed']]);
  });

  it('treats a malformed triage as missing', async () => {
    const decider = scriptedImageDecider({ image_kind: { type: 'choice', choice: 'selfie', confidence: 1 } });
    const ctx = setup({ decider });
    expect((await ctx.run(privatePhoto(TG.reza)))?.triage).toBeNull();
    expect(ctx.log.warn.mock.calls).toEqual([['image_triage_failed']]);
  });

  it('times out a triage that never answers', async () => {
    vi.useFakeTimers();
    const decider = scriptedImageDecider(() => new Promise<ImageAnswers>(() => undefined));
    const ctx = setup({ decider });
    const pending = ctx.run(privatePhoto(TG.reza));
    await vi.advanceTimersByTimeAsync(IMAGE_TRIAGE_TIMEOUT_MS + 250);
    const turn = await pending;
    expect(turn?.triage).toBeNull();
    expect(turn?.images).toHaveLength(1);
    expect(ctx.log.warn.mock.calls).toEqual([['image_triage_failed']]);
  });

  it('acknowledges a slow triage once, in reply to the photo', async () => {
    vi.useFakeTimers();
    let answer!: (answers: ImageAnswers) => void;
    const decider = scriptedImageDecider(() => new Promise<ImageAnswers>((resolve) => { answer = resolve; }));
    const ctx = setup({ decider });
    const update = privatePhoto(TG.reza, { caption: 'what is this?' });
    const pending = ctx.run(update);
    await vi.advanceTimersByTimeAsync(IMAGE_ACK_AFTER_MS - 1);
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sendMessage.mock.calls[0]).toEqual([update.message!.chat.id, IMAGE_ACK_TEXT.en, { replyTo: update.message!.message_id }]);
    answer(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    await vi.advanceTimersByTimeAsync(IMAGE_ACK_AFTER_MS * 3);
    expect((await pending)?.triage?.task).toBe('explain');
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('acknowledges in Persian for a Persian caption', async () => {
    vi.useFakeTimers();
    let answer!: (answers: ImageAnswers) => void;
    const decider = scriptedImageDecider(() => new Promise<ImageAnswers>((resolve) => { answer = resolve; }));
    const ctx = setup({ decider });
    const pending = ctx.run(privatePhoto(TG.reza, { caption: 'این چیه؟' }));
    await vi.advanceTimersByTimeAsync(IMAGE_ACK_AFTER_MS);
    answer(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    await pending;
    expect(sentTexts(ctx.bot)).toEqual([IMAGE_ACK_TEXT.fa]);
  });

  it('sends no acknowledgement for a fast triage', async () => {
    vi.useFakeTimers();
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    const ctx = setup({ decider });
    const pending = ctx.run(privatePhoto(TG.reza));
    await vi.advanceTimersByTimeAsync(IMAGE_ACK_AFTER_MS * 4);
    await pending;
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
  });

  it('logs a failed acknowledgement with a fixed string', async () => {
    vi.useFakeTimers();
    let answer!: (answers: ImageAnswers) => void;
    const decider = scriptedImageDecider(() => new Promise<ImageAnswers>((resolve) => { answer = resolve; }));
    const ctx = setup({ decider });
    ctx.bot.sendMessage.mockRejectedValueOnce(new Error('S12_ACK_CANARY'));
    const pending = ctx.run(privatePhoto(TG.reza));
    await vi.advanceTimersByTimeAsync(IMAGE_ACK_AFTER_MS);
    answer(imageAnswers({ kind: 'other', task: 'explain', people: 0, sensitive: 0 }));
    await pending;
    expect(ctx.log.warn.mock.calls).toEqual([['image_ack_failed']]);
  });

  it('forces the quick vision route when the main model is not vision-capable', async () => {
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'remember', people: 0, sensitive: 0 }));
    const ctx = setup({ llm: new GeminiFakeLLM(), fastLlm: new VisionFakeLLM(), decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(turn?.triage?.task).toBe('remember');
    expect(turn?.forceQuick).toBe(true);
    expect(turn?.suppressMemory).toBe(false);
  });
});
