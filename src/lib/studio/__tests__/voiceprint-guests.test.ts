import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway } from '../../tireh/gateway';
import { OrgDirectory } from '../../tireh/org/directory';
import type { VoiceService } from '../../tireh/voice';
import type { TelegramBotClient, TelegramUpdate } from '../../tireh/telegram/client';
import type { VoiceNoteVerifier, VoiceVerification } from '../../tireh/identity/voice-band';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../../tireh/memory/store';
import { FakeLLM, fakeBot, fakeVoice, GAMEEND_CHAT, privateVoice, testOrgConfig, TG } from '../../tireh/__tests__/fixtures';
import { deferred, setupVoiceprints } from './voiceprint-fixtures';

describe('verifyVoiceNote never compares for guests, groups or non-members', () => {
  it.each([
    ['a group chat', { chatKind: 'group' as const }, undefined],
    ['a guest audience', { guestAudience: true }, undefined],
    ['a non-member person', {}, 'not-member'],
    ['a pending person', {}, 'pending'],
  ])('%s gives guest_or_group with no provider, speech or store contact', async (_label, overrides, member) => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.identify.mockClear(); s.provider.voiceprint.mockClear(); s.speech.measure.mockClear(); s.selfEcho.templates.mockClear();
    if (member) s.members.set(s.telegramId, false);
    const get = vi.spyOn(s.store, 'get');
    expect(await s.service.verifyVoiceNote(s.voiceNote(overrides))).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
    expect(s.selfEcho.templates).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('mixed speakers (a bystander) gives guest_or_group', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.speech.result = { netSpeechMs: 8000, speakers: 2 };
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    s.speech.result = { netSpeechMs: 8000, speakers: 1 };
    s.provider.mode = 'mixed';
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
  });
});

const MATCH: VoiceVerification = { band: 'MATCH', netSpeechMs: 4000, modelVersion: 'fake-1' };

function harness(options: { voice?: VoiceService; verifier?: VoiceNoteVerifier | null; guests?: boolean } = {}) {
  const config = testOrgConfig();
  if (options.guests) config.groups[0].hasGuests = true;
  const org = new OrgDirectory(config);
  const llm = new FakeLLM();
  const epochs = new Map<string, number>();
  const bot = fakeBot();
  const voice = options.voice ?? fakeVoice('What is our top priority?');
  const verifier = options.verifier === null ? undefined
    : options.verifier ?? { verifyVoiceNote: vi.fn<VoiceNoteVerifier['verifyVoiceNote']>(async () => MATCH) };
  const gateway = new PersonaGateway({
    org, llm, memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice, ...(verifier ? { voiceVerifier: verifier } : {}),
    botFor: () => bot as unknown as TelegramBotClient, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { gateway, bot, llm, voice: voice as ReturnType<typeof fakeVoice>, verifier: verifier as { verifyVoiceNote: ReturnType<typeof vi.fn> } | undefined };
}

let nextId = 9000;
function groupVoice(chatId: number, from: number): TelegramUpdate {
  return { update_id: nextId++, message: { message_id: nextId++, from: { id: from, is_bot: false, first_name: 'x' },
    chat: { id: chatId, type: 'supergroup', title: 'g' }, date: 0, caption: '@hoor_aria_bot', voice: { file_id: 'file-g', duration: 4, mime_type: 'audio/ogg' } } };
}

describe('gateway.transcribe runs shadow verification beside STT', () => {
  it('a private member voice note calls the verifier once with content-free inputs; the reply uses the STT text', async () => {
    const h = harness();
    expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(h.verifier!.verifyVoiceNote).toHaveBeenCalledTimes(1);
    const [input] = h.verifier!.verifyVoiceNote.mock.calls[0];
    expect(input).toMatchObject({ personaId: 'aria', personId: 'reza', space: 'work', chatKind: 'private', guestAudience: false,
      durationSec: 3, channel: 'telegram_voice_note', mimeType: 'audio/ogg' });
    expect(input.audio).toBeInstanceOf(ArrayBuffer);
    expect(h.voice.transcribe.mock.calls[0][0]).toBe(input.audio);
    expect(h.llm.replyRequests[0].messages.at(-1)?.content).toBe('What is our top priority?');
  });

  it('starts STT and verification concurrently', async () => {
    const stt = deferred<string>(), verification = deferred<VoiceVerification>();
    const voice = fakeVoice();
    voice.transcribe.mockImplementation(() => stt.promise);
    const verifier = { verifyVoiceNote: vi.fn(() => verification.promise) };
    const h = harness({ voice, verifier });
    const pending = h.gateway.handleUpdate('aria', privateVoice(TG.reza));
    await vi.waitFor(() => { expect(voice.transcribe).toHaveBeenCalled(); expect(verifier.verifyVoiceNote).toHaveBeenCalled(); });
    stt.resolve('Ship the update on Friday');
    verification.resolve({ band: 'NO_OPINION', reason: 'timeout' });
    expect(await pending).toBe('replied');
    expect(h.llm.replyRequests[0].messages.at(-1)?.content).toBe('Ship the update on Friday');
  });

  it('an addressed group voice note runs STT but never the verifier', async () => {
    const h = harness();
    expect(await h.gateway.handleUpdate('aria', groupVoice(GAMEEND_CHAT, TG.reza))).toBe('replied');
    expect(h.voice.transcribe).toHaveBeenCalledTimes(1);
    expect(h.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
  });

  it('a hasGuests group or a stranger private chat calls neither STT nor the verifier (Step 0)', async () => {
    const guests = harness({ guests: true });
    await guests.gateway.handleUpdate('aria', groupVoice(GAMEEND_CHAT, TG.reza));
    expect(guests.voice.transcribe).not.toHaveBeenCalled();
    expect(guests.bot.downloadFile).not.toHaveBeenCalled();
    expect(guests.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
    const stranger = harness();
    await stranger.gateway.handleUpdate('aria', privateVoice(TG.stranger));
    expect(stranger.voice.transcribe).not.toHaveBeenCalled();
    expect(stranger.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
  });

  it('without a verifier the STT calls, their arguments and the reply match a verified run', async () => {
    const without = harness({ verifier: null });
    const shadow = harness();
    for (const h of [without, shadow]) expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(without.voice.transcribe).toHaveBeenCalledTimes(1);
    expect(without.voice.transcribe.mock.calls[0][1]).toBe('audio/ogg');
    expect(shadow.voice.transcribe.mock.calls.map(c => c[1])).toEqual(without.voice.transcribe.mock.calls.map(c => c[1]));
    expect(shadow.bot.sent).toEqual(without.bot.sent);
    expect(shadow.llm.replyRequests[0].messages).toEqual(without.llm.replyRequests[0].messages);
  });

  it('a rejecting verifier or a timeout result does not change the reply', async () => {
    const baseline = harness({ verifier: null });
    const failing = harness({ verifier: { verifyVoiceNote: vi.fn(async () => { throw new Error('verifier down'); }) } });
    const timeout = harness({ verifier: { verifyVoiceNote: vi.fn(async (): Promise<VoiceVerification> => ({ band: 'NO_OPINION', reason: 'timeout' })) } });
    for (const h of [baseline, failing, timeout]) expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(failing.bot.sent).toEqual(baseline.bot.sent);
    expect(timeout.bot.sent).toEqual(baseline.bot.sent);
    expect(failing.llm.replyRequests[0].messages.at(-1)?.content).toBe('What is our top priority?');
  });
});
