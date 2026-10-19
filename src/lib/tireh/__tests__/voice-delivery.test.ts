import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { explicitReplyFormat, type DecisionAnswer } from '../triage';
import type { TelegramBotClient } from '../telegram/client';
import type { Persona } from '../types';
import type { VoiceService } from '../voice';
import { fakeVoice, GAMEEND_CHAT, groupText, makeGateway, privateText, privateVoice, TG } from './fixtures';

type VoiceDecision = 'yes' | 'no' | 'missing' | 'error' | 'none';

function setup(options: {
  voice?: VoiceService | null;
  decision?: VoiceDecision;
  mode?: Persona['replyWithVoice'];
  groupAllowed?: GatewayDeps['groupAllowed'];
} = {}) {
  const voice = options.voice === undefined ? fakeVoice() : options.voice;
  const ctx = makeGateway({ voice });
  ctx.org.getPersona('aria')!.replyWithVoice = options.mode ?? 'mirror';
  const answers: Record<string, DecisionAnswer> = {
    effort: { type: 'choice', choice: 'thoughtful', confidence: 1 },
    live_info: { type: 'predicate', probability: 0 },
    memorable: { type: 'predicate', probability: 0 },
    ...(options.decision === 'missing' ? {} : {
      wants_voice: { type: 'predicate' as const, probability: options.decision === 'yes' ? 1 : 0 },
    }),
  };
  const decide = vi.fn(async () => {
    if (options.decision === 'error') throw new Error('synthetic triage outage');
    return answers;
  });
  const gateway = new PersonaGateway({
    org: ctx.org, llm: ctx.llm, memories: ctx.memories, offers: ctx.offers,
    history: ctx.history, deduper: { firstSeen: async () => true }, voice,
    botFor: () => ctx.bot as unknown as TelegramBotClient,
    ...(options.decision === 'none' ? {} : { decider: { decide } }),
    groupAllowed: options.groupAllowed,
    logger: ctx.logger,
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  ctx.llm.nextReply = 'The meeting starts at ten.';
  return { ...ctx, gateway, voice, decide };
}

async function privateReplies(ctx: ReturnType<typeof setup>) {
  return (await ctx.history.recent('aria', 'private-reza', 20)).filter((message) => message.role === 'assistant');
}

describe('explicit reply format', () => {
  it.each([
    'can you send voice message',
    'Please send me a voice note.',
    'Can I hear your voice?',
    'با ویس جواب بده',
    'برام یه ویس بفرست',
    'می‌تونی صوتی جواب بدی؟',
    'لطفاً voice بفرست',
    "Don't text me; send a voice message instead.",
  ])('recognizes a request to hear the reply: %s', (text) => {
    expect(explicitReplyFormat(text)).toBe('voice');
  });

  it.each([
    "Don't send voice, only text.",
    "I don't want a voice message.",
    "Please don't answer with audio.",
    'No audio please.',
    'Please answer in text.',
    'ویس نفرست، فقط متن',
    'صوتی جواب نده',
    'بدون ویس جواب بده',
    'نمی‌خوام ویس بفرستی',
    'با text جواب بده، نه voice',
  ])('recognizes a text preference or audio opt-out: %s', (text) => {
    expect(explicitReplyFormat(text)).toBe('text');
  });

  it.each([
    'How does voice recognition work?',
    'Can you explain audio compression?',
    'درباره پیام صوتی توضیح بده',
    'صدای باران آرامش‌بخش است',
    'Talk to me about our plans.',
  ])('does not turn a topic mention into an audio request: %s', (text) => {
    expect(explicitReplyFormat(text)).toBeUndefined();
  });
});

describe('voice delivery routing', () => {
  it.each([
    ['can you send voice message', 'no'],
    ['با ویس جواب بده', 'no'],
    ['لطفاً voice بفرست', 'missing'],
    ['Please send me a voice note.', 'missing'],
    ['برام یه ویس بفرست', 'error'],
    ['can you send voice message', 'none'],
  ] as const)('honors %s despite triage %s', async (text, decision) => {
    const voice = fakeVoice();
    const ctx = setup({ voice, decision });
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, text))).toBe('replied');
    expect(voice.synthesize).toHaveBeenCalledWith('The meeting starts at ten.', 'voice-aria');
    expect(ctx.bot.sent.map((message) => message.method)).toEqual(['sendVoice', 'sendMessage']);
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual(['The meeting starts at ten.']);
  });

  it.each([
    ['mirror', "Don't send voice, only text."],
    ['always', 'ویس نفرست، فقط متن'],
    ['mirror', 'با text جواب بده، نه voice'],
    ['always', 'No audio please.'],
  ] as const)('honors text opt-out in %s mode even when triage asks for audio', async (mode, text) => {
    const voice = fakeVoice();
    const ctx = setup({ voice, mode, decision: 'yes' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, text));
    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sent.map((message) => message.text)).toEqual(['The meeting starts at ten.']);
  });

  it('honors a text opt-out inside a voice transcript instead of mirroring the input', async () => {
    const voice = fakeVoice('صوتی جواب نده، فقط متن بنویس');
    const ctx = setup({ voice, decision: 'yes' });
    await ctx.gateway.handleUpdate('aria', privateVoice(TG.reza));
    expect(voice.transcribe).toHaveBeenCalledTimes(1);
    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['How does voice recognition work?', 'درباره پیام صوتی توضیح بده'])('keeps topic-only text as text when triage is unavailable: %s', async (text) => {
    const voice = fakeVoice();
    const ctx = setup({ voice, decision: 'error' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, text));
    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
  });

  it('still uses classifier voice intent for an indirect request', async () => {
    const ctx = setup({ decision: 'yes' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'I would love to hear that.'));
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(1);
  });

  it('keeps listening capability separate from speech synthesis capability', async () => {
    const voice = { ...fakeVoice(), canSynthesize: false };
    const ctx = setup({ voice, decision: 'no' });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'can you send voice message'));
    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    const delivered = ctx.bot.sent[0].text!;
    expect(delivered).toMatch(/voice|audio/i);
    expect(delivered).toMatch(/couldn.t|can.t|cannot|unavailable|unable|failed/i);
    expect(delivered).toContain('The meeting starts at ten.');
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual([delivered]);
    expect(ctx.llm.lastPrompt).not.toContain('Your reply is sent as a voice message');
    expect(ctx.llm.lastPrompt).not.toContain('it will be spoken');
  });
});

describe('truthful voice failures and delivery history', () => {
  it.each([
    ['can you send voice message', 'The meeting starts at ten.', /voice|audio/i, /couldn.t|can.t|cannot|unavailable|unable|failed/i],
    ['با ویس جواب بده', 'جلسه ساعت ده شروع می‌شود.', /ویس|صوت|صدا/, /نشد|نتوان|نمی.توان|ناموفق|نمی.تون|نتون/],
  ] as const)('explains failed synthesis in the request language and stores delivered text: %s', async (text, reply, audioWords, failureWords) => {
    const voice = fakeVoice();
    voice.synthesize.mockRejectedValueOnce(new Error('synthetic provider 402'));
    const ctx = setup({ voice });
    ctx.llm.nextReply = reply;
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, text))).toBe('replied');
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
    const delivered = ctx.bot.sent[0].text!;
    expect(delivered).toMatch(audioWords);
    expect(delivered).toMatch(failureWords);
    expect(delivered).toContain(reply);
    expect(delivered).not.toContain('synthetic provider');
    expect(delivered).not.toContain('402');
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual([delivered]);
    expect(ctx.llm.lastPrompt).not.toContain('it will be spoken');
    expect(ctx.llm.lastPrompt).not.toContain("Never say you can't send voice messages");
  });

  it('explains a failed Telegram audio upload without pretending voice was delivered', async () => {
    const ctx = setup();
    ctx.bot.sendVoice.mockRejectedValueOnce(new Error('synthetic upload failure'));
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'Please send me a voice note.'));
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
    const delivered = ctx.bot.sent[0].text!;
    expect(delivered).toMatch(/voice|audio/i);
    expect(delivered).toMatch(/couldn.t|can.t|cannot|unavailable|unable|failed/i);
    expect(delivered).toContain('The meeting starts at ten.');
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual([delivered]);
  });

  it('treats empty synthesized audio as a failure instead of sending a false voice success', async () => {
    const voice = fakeVoice();
    voice.synthesize.mockResolvedValueOnce({ audio: new ArrayBuffer(0), mimeType: 'audio/mpeg', filename: 'voice.mp3' });
    const ctx = setup({ voice });
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'can you send voice message'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    const delivered = ctx.bot.sent[0].text!;
    expect(delivered).toMatch(/couldn.t|can.t|cannot|unavailable|unable|failed/i);
    expect(delivered).toContain('The meeting starts at ten.');
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual([delivered]);
  });

  it('does not resend audio or report an audio failure when only its transcript failed', async () => {
    const ctx = setup();
    ctx.bot.sendMessage.mockRejectedValueOnce(new Error('synthetic transcript failure'));
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'can you send voice message'))).toBe('replied');
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sent.map((message) => message.method)).toEqual(['sendVoice']);
    expect((await privateReplies(ctx)).map((message) => message.text)).toEqual(['The meeting starts at ten.']);
  });

  it.each(['resolve', 'reject'] as const)('does not deliver audio or fallback when group access is revoked during TTS (%s)', async (finish) => {
    let allowed = true;
    let resolve!: (audio: { audio: ArrayBuffer; mimeType: string; filename: string }) => void;
    let reject!: (error: Error) => void;
    let started!: () => void;
    const synthesisStarted = new Promise<void>((done) => { started = done; });
    const voice = fakeVoice();
    voice.synthesize.mockImplementationOnce(async () => {
      started();
      return new Promise((done, fail) => { resolve = done; reject = fail; });
    });
    const ctx = setup({ voice, groupAllowed: async () => allowed });
    const handling = ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, send me a voice message.'));
    await synthesisStarted;
    allowed = false;
    if (finish === 'resolve') resolve({ audio: new ArrayBuffer(4), mimeType: 'audio/mpeg', filename: 'voice.mp3' });
    else reject(new Error('synthetic provider failure after revocation'));
    expect(await handling).toBe('ignored');
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    const history = await ctx.history.recent('aria', 'group-gameend-team', 20);
    expect(history.filter((message) => message.role === 'assistant')).toEqual([]);
    expect(ctx.llm.extractionCalls).toBe(0);
  });
});
