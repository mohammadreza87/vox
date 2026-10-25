import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forceQuickTriage, IMAGE_PLACEHOLDER_TEXT, IMAGE_TRIAGE_QUESTIONS, IMAGE_TRIAGE_TIMEOUT_MS, ingestTelegramImage,
  MAX_REPLY_IMAGE_BYTES, type ImageIngestDeps, type ImageTurn,
} from '../images';
import { OrgDirectory } from '../org/directory';
import type { TelegramBotClient, TelegramMessage } from '../telegram/client';
import type { ChatContext } from '../types';
import { FakeLLM, GAMEEND_CHAT, TG, testOrg, testOrgConfig } from './fixtures';
import {
  containsBytes, GeminiFakeLLM, IMAGE_CANARIES, imageAnswers, imageBot, photoLadder, privateDocument, privatePhoto,
  scriptedDecider, tinyJpeg, tinyPng, VisionFakeLLM,
} from './images-fixtures';

const org = testOrg();
const persona = org.getPersona('aria')!;
const rezaChat: ChatContext = { kind: 'private', chatKey: 'private-reza', personId: 'reza' };

function harness(opts: { decider?: ImageIngestDeps['decider'] | null; llm?: FakeLLM; fastLlm?: FakeLLM | null; files?: Record<string, Uint8Array>; org?: OrgDirectory } = {}) {
  const ladder = photoLadder();
  const bot = imageBot({ ...ladder.files, ...opts.files });
  const log = { warn: vi.fn() };
  const decider = opts.decider === null ? undefined : opts.decider ?? scriptedDecider({ image: imageAnswers() });
  const deps: ImageIngestDeps = {
    org: opts.org ?? org, decider, llm: opts.llm ?? new VisionFakeLLM('claude-fable-5-1'),
    fastLlm: opts.fastLlm === null ? undefined : opts.fastLlm ?? new VisionFakeLLM(), bot: bot as unknown as TelegramBotClient, log,
  };
  const photo = (caption?: string) => privatePhoto(TG.reza, ladder.sizes, caption).message!;
  const run = (message: TelegramMessage, chat: ChatContext = rezaChat, speakerId = 'reza') =>
    ingestTelegramImage(deps, persona, chat, speakerId, message, message.text ?? message.caption ?? '');
  return { deps, bot, log, ladder, photo, run, decider: decider as ReturnType<typeof scriptedDecider> | undefined };
}

const decoded = (turn: ImageTurn | null) => Buffer.from(turn!.images[0].data, 'base64');

beforeEach(() => { vi.stubEnv('STUDIO_IMAGES', '1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('ingestTelegramImage gates', () => {
  it('returns null with no I/O when the flag is unset', async () => {
    vi.stubEnv('STUDIO_IMAGES', '');
    const h = harness();
    expect(await h.run(h.photo('hi'))).toBeNull();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.decider!.decide).not.toHaveBeenCalled();
    expect(h.decider!.decideParts).not.toHaveBeenCalled();
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it('never downloads for groups, guests or a speaker who is not the chat person', async () => {
    const config = testOrgConfig();
    config.people.push({ id: 'guest', name: 'Guest', role: 'Guest', telegramUserId: TG.stranger, companyIds: [], projectIds: [], guest: true });
    const withGuest = new OrgDirectory(config);
    const h = harness({ org: withGuest });
    const group: ChatContext = { kind: 'group', chatKey: 'group-gameend-team', group: withGuest.getGroupByChatId(GAMEEND_CHAT)! };
    expect(await h.run(h.photo(), group)).toBeNull();
    expect(await h.run(h.photo(), { kind: 'private', chatKey: 'private-guest', personId: 'guest' }, 'guest')).toBeNull();
    expect(await h.run(h.photo(), rezaChat, 'milad')).toBeNull();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['llm is gemini', { llm: new GeminiFakeLLM() }],
    ['fastLlm is gemini', { fastLlm: new GeminiFakeLLM() }],
    ['llm has no identity', { llm: new FakeLLM(), fastLlm: null }],
  ])('refuses vision before any download when %s', async (_label, opts) => {
    const h = harness(opts);
    expect(await h.run(h.photo('look'))).toBeNull();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:vision_unsupported']]);
  });

  it('accepts only JPEG/PNG documents whose bytes match and whose size fits', async () => {
    const h = harness({ files: { pdf: tinyJpeg(320, 240), jpgPng: tinyPng(320, 240), junk: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), ok: tinyPng(320, 240) } });
    expect(await h.run(privateDocument(TG.reza, { file_id: 'pdf', mime_type: 'application/pdf' }).message!)).toBeNull();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(await h.run(privateDocument(TG.reza, { file_id: 'big', mime_type: 'image/jpeg', file_size: MAX_REPLY_IMAGE_BYTES + 1 }).message!)).toBeNull();
    expect(h.bot.downloadImage).not.toHaveBeenCalled();
    expect(await h.run(privateDocument(TG.reza, { file_id: 'jpgPng', mime_type: 'image/jpeg' }).message!)).toBeNull();
    expect(await h.run(privateDocument(TG.reza, { file_id: 'junk', mime_type: 'image/jpeg' }).message!)).toBeNull();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:unsupported_type'], ['tireh_image:unsupported_type']]);
    const turn = await h.run(privateDocument(TG.reza, { file_id: 'ok', mime_type: 'image/png', file_size: 200 }).message!);
    expect(turn?.images).toHaveLength(1);
    expect(turn?.images[0].mimeType).toBe('image/png');
  });

  it('returns null and logs download_failed when the download rejects', async () => {
    const h = harness();
    h.bot.downloadImage.mockRejectedValueOnce(new Error('network down at https://api.telegram.org/file/botSECRET/x'));
    expect(await h.run(h.photo('x'))).toBeNull();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:download_failed']]);
  });
});

describe('ingestTelegramImage triage', () => {
  it('asks decideParts exactly one text part and one stripped image part', async () => {
    const h = harness();
    await h.run(h.photo('what is this?'));
    expect(h.bot.downloadImage.mock.calls[0]).toEqual(['p-320', { maxBytes: 1_048_576, signal: expect.any(AbortSignal) }]);
    const [parts, questions, timeout] = h.decider!.decideParts!.mock.calls[0];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'Image shared with Aria in a private chat.\nCaption: what is this?' });
    expect(parts[1].type).toBe('image');
    const image = (parts[1] as { type: 'image'; image: { mimeType: string; data: string } }).image;
    expect(image.mimeType).toBe('image/jpeg');
    expect(containsBytes(Buffer.from(image.data, 'base64'), IMAGE_CANARIES.exif)).toBe(false);
    expect(questions).toEqual(IMAGE_TRIAGE_QUESTIONS);
    expect(timeout).toBe(IMAGE_TRIAGE_TIMEOUT_MS);
    expect(h.decider!.decide).not.toHaveBeenCalled();
  });

  it('without decideParts: triage null, memory suppressed, people assumed, 1024 px reply image', async () => {
    const h = harness({ decider: scriptedDecider({ parts: false }) });
    const turn = await h.run(h.photo());
    expect(turn).toMatchObject({ triage: null, suppressMemory: true, containsPeople: true, forceQuick: false, text: IMAGE_PLACEHOLDER_TEXT });
    expect(turn!.images).toHaveLength(1);
    expect(h.bot.downloadImage.mock.calls.map((c) => c[0])).toEqual(['p-320', 'p-1280']);
    expect(h.bot.downloadImage.mock.calls[1][1]).toEqual({ maxBytes: MAX_REPLY_IMAGE_BYTES, signal: expect.any(AbortSignal) });
    expect(containsBytes(decoded(turn), IMAGE_CANARIES.exif)).toBe(false);
    expect(Buffer.from(decoded(turn)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('skips triage when the triage image fails the seam contract', async () => {
    const h = harness();
    const sizes = [{ file_id: 'p-800', width: 800, height: 600 }];
    const turn = await h.run(privatePhoto(TG.reza, sizes).message!);
    expect(h.decider!.decideParts).not.toHaveBeenCalled();
    expect(turn?.triage).toBeNull();
    expect(turn?.images).toHaveLength(1);
  });

  it('passing no decider (compact turns) makes no decider call', async () => {
    const h = harness({ decider: null });
    const turn = await h.run(h.photo('hello'));
    expect(turn?.triage).toBeNull();
    expect(turn?.text).toBe('hello');
  });

  it('reuses the triage bytes when the reply size is the same file', async () => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers({ kind: 'photo_of_people', task: 'react' }) }) });
    const sizes = [{ file_id: 'p-320', width: 320, height: 240 }];
    await h.run(privatePhoto(TG.reza, sizes).message!);
    expect(h.bot.downloadImage).toHaveBeenCalledTimes(1);
  });

  it('downloads a 640 px reply image for people photos and falls back to triage bytes on failure', async () => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers({ kind: 'photo_of_people', task: 'react', people: 0.9 }) }) });
    const turn = await h.run(h.photo());
    expect(h.bot.downloadImage.mock.calls.map((c) => c[0])).toEqual(['p-320', 'p-800']);
    expect(turn?.containsPeople).toBe(true);
    h.bot.downloadImage.mockClear();
    h.bot.downloadImage.mockImplementation(async (fileId: string) => {
      if (fileId === 'p-320') return h.ladder.files['p-320'].slice();
      throw new Error('boom');
    });
    const fallback = await h.run(h.photo());
    expect(fallback?.images).toHaveLength(1);
    expect(h.log.warn).toHaveBeenLastCalledWith('tireh_image:download_failed');
  });

  it('maps a low-confidence task to unclear', async () => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers({ task: 'explain', taskConfidence: 0.3 }) }) });
    const turn = await h.run(h.photo());
    expect(turn?.triage?.task).toBe('unclear');
    expect(turn?.forceQuick).toBe(false);
  });

  it.each(['explain', 'extract_text', 'decide', 'react'])('forces the fast model for %s', async (task) => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers({ task }) }) });
    expect((await h.run(h.photo()))?.forceQuick).toBe(true);
  });

  it.each(['remember', 'unclear'])('does not force the fast model for %s', async (task) => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers({ task }) }) });
    expect((await h.run(h.photo()))?.forceQuick).toBe(false);
  });

  it('logs triage_failed when decideParts rejects', async () => {
    const h = harness({ decider: scriptedDecider({ image: async () => { throw new Error(`secret ${IMAGE_CANARIES.caption}`); } }) });
    const turn = await h.run(h.photo(IMAGE_CANARIES.caption));
    expect(turn?.triage).toBeNull();
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:triage_failed']]);
  });
});

describe('ingestTelegramImage retention', () => {
  const cases: Array<[string, { task: string; sensitive: number }, string, boolean]> = [
    ['remember, not sensitive', { task: 'remember', sensitive: 0.2 }, '', false],
    ['remember, sensitive', { task: 'remember', sensitive: 0.7 }, '', true],
    ['react with "remember this"', { task: 'react', sensitive: 0.1 }, 'remember this', false],
    ["\"don't remember this\" overrides remember", { task: 'remember', sensitive: 0.1 }, "don't remember this", true],
    ['Persian remember request', { task: 'react', sensitive: 0.1 }, 'یادت باشه', false],
    ['react without a request', { task: 'react', sensitive: 0.1 }, 'nice view', true],
    ['sensitive with "remember this"', { task: 'react', sensitive: 0.9 }, 'remember this', true],
  ];
  it.each(cases)('%s', async (_label, answers, caption, suppress) => {
    const h = harness({ decider: scriptedDecider({ image: imageAnswers(answers) }) });
    const turn = await h.run(h.photo(caption));
    expect(turn?.suppressMemory).toBe(suppress);
  });

  it('uses the caption as text, or the placeholder when there is none', async () => {
    const h = harness();
    expect((await h.run(h.photo('  ')))?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
    expect((await h.run(h.photo('the receipt')))?.text).toBe('the receipt');
  });
});

describe('ingestTelegramImage slow acknowledgement', () => {
  async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

  it('sends exactly one acknowledgement when triage is still pending at 1.5 s', async () => {
    vi.useFakeTimers();
    let resolve!: (value: ReturnType<typeof imageAnswers>) => void;
    const h = harness({ decider: scriptedDecider({ image: () => new Promise((r) => { resolve = r; }) }) });
    const message = h.photo('what is this?');
    const pending = h.run(message);
    await flush();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.bot.sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.bot.sendMessage).toHaveBeenCalledWith(message.chat.id, "One moment, I'm looking at your photo.", { replyTo: message.message_id });
    resolve(imageAnswers({ task: 'explain' }));
    const turn = await pending;
    expect(turn?.triage?.task).toBe('explain');
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('acknowledges in Persian for a Persian caption', async () => {
    vi.useFakeTimers();
    const h = harness({ decider: scriptedDecider({ image: () => new Promise(() => undefined) }) });
    const pending = h.run(h.photo('این چیه؟'));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(h.bot.sendMessage.mock.calls.map((c) => c[1])).toEqual(['یک لحظه، دارم عکس را نگاه می‌کنم.']);
  });

  it('sends nothing when triage answers quickly', async () => {
    vi.useFakeTimers();
    const h = harness({ decider: scriptedDecider({ image: () => new Promise((r) => setTimeout(() => r(imageAnswers()), 100)) }) });
    const pending = h.run(h.photo('x'));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await pending)?.triage).not.toBeNull();
    expect(h.bot.sendMessage).not.toHaveBeenCalled();
  });

  it('gives up on triage at 2 s and logs triage_timeout', async () => {
    vi.useFakeTimers();
    const h = harness({ decider: scriptedDecider({ image: () => new Promise(() => undefined) }) });
    const pending = h.run(h.photo('x'));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    const turn = await pending;
    expect(turn?.triage).toBeNull();
    expect(turn?.suppressMemory).toBe(true);
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:triage_timeout']]);
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('logs ack_failed when the acknowledgement cannot be sent', async () => {
    vi.useFakeTimers();
    const h = harness({ decider: scriptedDecider({ image: () => new Promise(() => undefined) }) });
    h.bot.sendMessage.mockRejectedValueOnce(new Error('nope'));
    const pending = h.run(h.photo('x'));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(h.log.warn.mock.calls).toEqual([['tireh_image:ack_failed'], ['tireh_image:triage_timeout']]);
  });
});

describe('forceQuickTriage', () => {
  it('forces quick effort and no web, keeping skills', async () => {
    const skills = { ids: ['a'] } as never;
    const forced = await forceQuickTriage(Promise.resolve({ triage: { effort: 'thoughtful' as const, needsWeb: true, memorable: false, wantsVoice: true, skills }, skillAsked: true }));
    expect(forced).toEqual({ triage: { effort: 'quick', needsWeb: false, memorable: false, wantsVoice: true, skills }, skillAsked: true });
  });

  it('fills a missing triage with a quick default', async () => {
    expect(await forceQuickTriage(Promise.resolve({ triage: null, skillAsked: false })))
      .toEqual({ triage: { effort: 'quick', needsWeb: false, memorable: true, wantsVoice: false }, skillAsked: false });
  });
});
