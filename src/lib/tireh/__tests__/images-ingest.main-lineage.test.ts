// Main's earlier S12 lineage (d99e3a5) cases that pass against the chosen wave A image module; the rest are recorded in WAVE_A_MAIN_INTEGRATION.md (S12).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_ACK_AFTER_MS,
  MAX_REPLY_IMAGE_BYTES,
  IMAGE_PLACEHOLDER_TEXT,
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
} from './images-main-lineage-fixtures';

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

  it('rejects a document whose known size is over the cap without downloading', async () => {
    const decider = scriptedImageDecider({});
    const ctx = setup({ decider });
    expect(await ctx.run(privateImageDocument(TG.reza, { mime: 'image/jpeg', fileSize: MAX_REPLY_IMAGE_BYTES + 1 }))).toBeNull();
    expectNoIo(ctx, decider);
  });
});

describe('ingestTelegramImage: downloads', () => {

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

});

describe('ingestTelegramImage: triage', () => {

  it('re-downloads at detail resolution for text extraction', async () => {
    const decider = scriptedImageDecider(imageAnswers({ kind: 'other', task: 'extract_text', people: 0, sensitive: 0 }));
    const ctx = setup({ decider });
    const turn = await ctx.run(privatePhoto(TG.reza));
    expect(ctx.bot.downloadImage.mock.calls.map((call) => call[0])).toEqual(['photo-320', 'photo-1280']);
    expect(turn?.images).toEqual([{ mimeType: 'image/jpeg', data: base64Of(ctx.bot.files.get('photo-1280')!) }]);
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

});
