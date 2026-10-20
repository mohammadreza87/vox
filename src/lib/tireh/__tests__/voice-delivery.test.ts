import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { explicitReplyFormat, type DecisionAnswer } from '../triage';
import type { TelegramBotClient } from '../telegram/client';
import type { ChatMessage, Persona } from '../types';
import type { VoiceService } from '../voice';
import { fakeVoice, GAMEEND_CHAT, groupText, makeGateway, privateText, privateVoice, TG } from './fixtures';

type VoiceDecision = 'yes' | 'no' | 'missing' | 'error' | 'none';

function setup(options: {
  voice?: VoiceService | null;
  decision?: VoiceDecision;
  mode?: Persona['replyWithVoice'];
  groupAllowed?: GatewayDeps['groupAllowed'];
  runtimePrivacy?: GatewayDeps['runtimePrivacy'];
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
    runtimePrivacy: options.runtimePrivacy,
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

describe('group voice request followed by a separate mention', () => {
  it.each([false, true])('carries format only with current history permission (historyEnabled=%s)', async (historyEnabled) => {
    const ctx = setup({ decision: 'no', runtimePrivacy: {
      read: async () => ({ revision: '1', memoryEnabled: false, historyEnabled }),
      validateAudience: async () => true,
    } });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please send a voice message.'));
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(historyEnabled ? 1 : 0);
    if (!historyEnabled) expect(await ctx.history.recent('aria', 'group-gameend-team', 20)).toEqual([]);
  });

  it('does not carry a format from history recorded under a previous permission revision', async () => {
    let revision = '1';
    const ctx = setup({ decision: 'no', runtimePrivacy: {
      read: async () => ({ revision, memoryEnabled: false, historyEnabled: true }),
      validateAudience: async () => true,
    } });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please send a voice message.'));
    expect(await ctx.history.recent('aria', 'group-gameend-team', 20)).toHaveLength(1);
    revision = '2';
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
  });

  it.each(['@hoor_aria_bot', 'Aria?'])('carries an unanswered voice request to %s in the same group', async (mention) => {
    const ctx = setup({ decision: 'no' });
    expect(await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'can you send it by voice then i can hear the accent as well'))).toBe('ignored');
    const followup = groupText(GAMEEND_CHAT, TG.reza, mention);
    expect(await ctx.gateway.handleUpdate('aria', followup)).toBe('replied');
    expect(ctx.bot.sendVoice).toHaveBeenCalledExactlyOnceWith(GAMEEND_CHAT, expect.any(ArrayBuffer), expect.objectContaining({ replyTo: followup.message!.message_id }));
    expect(ctx.bot.sent.map((item) => item.method)).toEqual(['sendVoice', 'sendMessage']);
  });

  it('carries an unanswered text preference despite a voice-positive classifier', async () => {
    const ctx = setup({ decision: 'yes' });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please answer in text.'));
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('lets a new explicit text preference override the earlier voice request', async () => {
    const ctx = setup({ decision: 'yes' });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please send a voice message.'));
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot, reply in text instead.'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  async function setupWithPrior(patch: Partial<ChatMessage> = {}, chatKey = 'group-gameend-team') {
    const source = setup({ decision: 'no' });
    expect(await source.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please send a voice message.', {
      message_id: 1, date: Math.floor(new Date('2026-10-19T09:59:45Z').getTime() / 1000),
    }))).toBe('ignored');
    const retained = await source.history.recent('aria', 'group-gameend-team', 20);
    expect(retained).toHaveLength(1);
    expect(retained[0].privacy).toEqual(expect.objectContaining({ policyKey: expect.any(String), memoryRevision: expect.any(Number) }));
    expect(retained[0].audiencePersonIds?.sort()).toEqual(['milad', 'parastoo', 'reza']);
    expect(source.bot.sent).toEqual([]);

    // An equivalent fresh gateway has the same authority boundary. Copy through
    // the public store API so only the varied record exists: no older valid
    // request can mask a rejection by becoming the next carryover candidate.
    const ctx = setup({ decision: 'no' });
    const prior = { ...retained[0], ...patch };
    await ctx.history.append('aria', chatKey, prior);
    expect(await ctx.history.recent('aria', chatKey, 20)).toEqual([prior]);
    return { ...ctx, prior };
  }

  it('carries voice format from the otherwise valid stamped fixture', async () => {
    const ctx = await setupWithPrior();
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sent.map((item) => item.method)).toEqual(['sendVoice', 'sendMessage']);
  });

  it.each([
    ['another speaker', { personId: 'parastoo' }, 'group-gameend-team', '@hoor_aria_bot'],
    ['an old request', { at: new Date('2026-10-19T09:57:00Z') }, 'group-gameend-team', '@hoor_aria_bot'],
    ['future history', { telegramMessageId: 999999 }, 'group-gameend-team', '@hoor_aria_bot'],
    ['missing audience snapshot', { audiencePersonIds: undefined }, 'group-gameend-team', '@hoor_aria_bot'],
    ['legacy group history', { groupPolicyVersion: undefined }, 'group-gameend-team', '@hoor_aria_bot'],
    ['another group', {}, 'group-leads', '@hoor_aria_bot'],
    ['a private chat', {}, 'private-reza', '@hoor_aria_bot'],
    ['unknown target provenance', { groupOtherTarget: undefined }, 'group-gameend-team', '@hoor_aria_bot'],
    ['another bot target', { text: '@another_bot, send a voice message.', groupOtherTarget: true }, 'group-gameend-team', '@hoor_aria_bot'],
    ['an unrelated new question', {}, 'group-gameend-team', '@hoor_aria_bot, what time is the meeting?'],
  ] as const)('does not inherit voice format from %s', async (_label, message, chatKey, followup) => {
    const ctx = await setupWithPrior(message, chatKey);
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, followup));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['expanded', 'unknown', 'reset'] as const)('does not inherit a request after audience or privacy changes: %s', async (change) => {
    const ctx = await setupWithPrior();
    if (change === 'expanded') ctx.org.getGroupByChatId(GAMEEND_CHAT)!.memberIds.push('sina');
    if (change === 'unknown') ctx.org.getGroupByChatId(GAMEEND_CHAT)!.hasGuests = true;
    if (change === 'reset') await ctx.history.clearPersona('aria');
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a delayed request age when Telegram delivers it later', async () => {
    const ctx = setup({ decision: 'no' });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Please send a voice message.', {
      date: Math.floor(new Date('2026-10-19T09:57:00Z').getTime() / 1000),
    }));
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a voice request that already received an answer', async () => {
    const ctx = await setupWithPrior();
    await ctx.history.append('aria', 'group-gameend-team', { ...ctx.prior, role: 'assistant', text: 'Already answered.', telegramMessageId: 1 });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
  });

  it.each(['reply', 'linked mention'] as const)('keeps authoritative targeting when a prior request uses a %s to another bot', async (kind) => {
    const ctx = setup({ decision: 'no' });
    const other = { id: 9000, is_bot: true, first_name: 'Another', username: 'another_bot' };
    const text = kind === 'reply' ? 'Send a voice message.' : 'Another, send a voice message.';
    const request = groupText(GAMEEND_CHAT, TG.reza, text, kind === 'reply'
      ? { reply_to_message: { message_id: 1, date: 0, chat: { id: GAMEEND_CHAT, type: 'supergroup' }, from: other } }
      : { entities: [{ type: 'text_mention', offset: 0, length: 7, user: other }] });
    expect(await ctx.gateway.handleUpdate('aria', request)).toBe('ignored');
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not reach back across another participant’s intervening message', async () => {
    const ctx = await setupWithPrior();
    await ctx.history.append('aria', 'group-gameend-team', { ...ctx.prior, personId: 'parastoo', text: 'A different topic.', telegramMessageId: 2 });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, '@hoor_aria_bot'));
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
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

describe('combined voice delivery and privacy epoch fences', () => {
  it.each(['resolve', 'reject'] as const)('suppresses audio and fallback after an authorized reset during TTS: %s', async (finish) => {
    const voice = fakeVoice();
    let started!: () => void;
    const atTTS = new Promise<void>((done) => { started = done; });
    let resolve!: (audio: { audio: ArrayBuffer; mimeType: string; filename: string }) => void;
    let reject!: (error: Error) => void;
    voice.synthesize.mockImplementationOnce(async () => {
      started();
      return new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
    });
    const ctx = setup({ voice });
    const handling = ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'Please send a voice message.'));
    await atTTS;
    await ctx.history.clearPersona('aria');
    if (finish === 'resolve') resolve({ audio: new ArrayBuffer(4), mimeType: 'audio/mpeg', filename: 'voice.mp3' });
    else reject(new Error('synthetic TTS failure after reset'));
    expect(await handling).toBe('ignored');
    expect(ctx.bot.sendVoice).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    expect(await ctx.history.recent('aria', 'private-reza', 20)).toEqual([]);
  });

  it('suppresses the transcript and retained history if privacy changes after audio delivery', async () => {
    const ctx = setup();
    const sendVoice = ctx.bot.sendVoice.getMockImplementation()!;
    ctx.bot.sendVoice.mockImplementationOnce(async (...args) => {
      const result = await sendVoice(...args);
      await ctx.history.clearPersona('aria');
      return result;
    });
    expect(await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'Please send a voice message.'))).toBe('ignored');
    // Audio already sent cannot be recalled; no transcript or history may follow.
    expect(ctx.bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(ctx.bot.sendMessage).not.toHaveBeenCalled();
    expect(ctx.bot.sent.map((item) => item.method)).toEqual(['sendVoice']);
    expect(await ctx.history.recent('aria', 'private-reza', 20)).toEqual([]);
    expect(ctx.llm.extractionCalls).toBe(0);
  });
});

describe('guest audiences never reach speech-to-text (PRIV-023)', () => {
  const voice = { file_id: 'synthetic-voice-file', duration: 3, mime_type: 'audio/ogg' };
  const addressedGroupVoice = (extra: Record<string, unknown> = {}) => groupText(GAMEEND_CHAT, TG.milad, '', {
    text: undefined, voice,
    reply_to_message: { message_id: 1, date: 0, chat: { id: GAMEEND_CHAT, type: 'supergroup' }, from: { id: 42, is_bot: true, first_name: 'Aria', username: 'hoor_aria_bot' } },
    ...extra,
  });

  it('transcribes an addressed group voice note when every reader is a known member (control)', async () => {
    const ctx = setup();
    expect(await ctx.gateway.handleUpdate('aria', addressedGroupVoice())).toBe('replied');
    expect(ctx.bot.downloadFile).toHaveBeenCalledTimes(1);
    expect(ctx.voice.transcribe).toHaveBeenCalledTimes(1);
  });

  it('never downloads or transcribes an addressed voice note in a group flagged hasGuests', async () => {
    const ctx = setup();
    ctx.org.getGroupByChatId(GAMEEND_CHAT)!.hasGuests = true;
    const update = addressedGroupVoice();
    expect(await ctx.gateway.handleUpdate('aria', update)).toBe('replied');
    expect(ctx.bot.downloadFile).not.toHaveBeenCalled();
    expect(ctx.voice.transcribe).not.toHaveBeenCalled();
    expect(ctx.llm.replyPrompts).toEqual([]);
    expect(ctx.bot.sendMessage).toHaveBeenCalledExactlyOnceWith(GAMEEND_CHAT, expect.stringContaining('Could you type it instead?'), { replyTo: update.message!.message_id });
  });

  it('answers a typed caption in a hasGuests group from the caption alone', async () => {
    const ctx = setup();
    ctx.org.getGroupByChatId(GAMEEND_CHAT)!.hasGuests = true;
    expect(await ctx.gateway.handleUpdate('aria', addressedGroupVoice({ caption: 'Aria, when is the meeting?' }))).toBe('replied');
    expect(ctx.bot.downloadFile).not.toHaveBeenCalled();
    expect(ctx.voice.transcribe).not.toHaveBeenCalled();
    expect(ctx.llm.replyRequests.at(-1)?.messages.at(-1)).toEqual({ role: 'user', content: 'Milad: Aria, when is the meeting?' });
  });

  it('never downloads or transcribes a private voice note from a guest speaker', async () => {
    const ctx = setup();
    ctx.org.getPerson('sina')!.guest = true;
    expect(await ctx.gateway.handleUpdate('aria', privateVoice(TG.sina))).toBe('replied');
    expect(ctx.bot.downloadFile).not.toHaveBeenCalled();
    expect(ctx.voice.transcribe).not.toHaveBeenCalled();
    expect(ctx.bot.sendMessage).toHaveBeenCalledExactlyOnceWith(TG.sina, expect.stringContaining('Could you type it instead?'), expect.anything());
  });
});
