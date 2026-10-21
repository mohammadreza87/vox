import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PersonaGateway } from '../../tireh/gateway';
import { OrgDirectory } from '../../tireh/org/directory';
import type { VoiceService } from '../../tireh/voice';
import type { TelegramBotClient, TelegramUpdate } from '../../tireh/telegram/client';
import type { VoiceNoteVerifier, VoiceVerification } from '../../tireh/identity/voice-band';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../../tireh/memory/store';
import { FakeLLM, fakeBot, fakeVoice, GAMEEND_CHAT, privateVoice, testOrgConfig, TG } from '../../tireh/__tests__/fixtures';

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('gateway.transcribe shadow voice verification', () => {
  it('verifies a private member voice note once, with content-free inputs', async () => {
    const h = harness();
    expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(h.verifier!.verifyVoiceNote).toHaveBeenCalledTimes(1);
    const [input] = h.verifier!.verifyVoiceNote.mock.calls[0];
    expect(input).toMatchObject({ personaId: 'aria', personId: 'reza', space: 'work', chatKind: 'private', guestAudience: false,
      durationSec: 3, channel: 'telegram_voice_note', mimeType: 'audio/ogg' });
    expect(input.audio).toBeInstanceOf(ArrayBuffer);
    expect(h.voice.transcribe.mock.calls[0][0]).toBe(input.audio);
  });

  it('starts STT and verification concurrently and replies with the transcript unchanged', async () => {
    const stt = deferred<string>(), verification = deferred<VoiceVerification>();
    const voice = fakeVoice();
    voice.transcribe.mockImplementation(() => stt.promise);
    const verifier = { verifyVoiceNote: vi.fn(() => verification.promise) };
    const h = harness({ voice, verifier });
    const pending = h.gateway.handleUpdate('aria', privateVoice(TG.reza));
    await vi.waitFor(() => { expect(voice.transcribe).toHaveBeenCalled(); expect(verifier.verifyVoiceNote).toHaveBeenCalled(); });
    stt.resolve('Ship the update on Friday');
    verification.resolve({ band: 'NO_MATCH', netSpeechMs: 3500, modelVersion: 'fake-1' });
    expect(await pending).toBe('replied');
    expect(h.llm.replyRequests[0].messages.at(-1)?.content).toBe('Ship the update on Friday');
  });

  it('a rejecting verifier produces the same reply as no verifier', async () => {
    const failing = harness({ verifier: { verifyVoiceNote: vi.fn(async () => { throw new Error('verifier down'); }) } });
    const baseline = harness({ verifier: null });
    expect(await failing.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(await baseline.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(failing.bot.sent).toEqual(baseline.bot.sent);
    expect(failing.llm.replyRequests[0].messages.at(-1)?.content).toBe('What is our top priority?');
  });

  it('an addressed group voice note runs STT but never the verifier; a hasGuests group runs neither', async () => {
    const group = harness();
    expect(await group.gateway.handleUpdate('aria', groupVoice(GAMEEND_CHAT, TG.reza))).toBe('replied');
    expect(group.voice.transcribe).toHaveBeenCalledTimes(1);
    expect(group.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
    const guests = harness({ guests: true });
    await guests.gateway.handleUpdate('aria', groupVoice(GAMEEND_CHAT, TG.reza));
    expect(guests.voice.transcribe).not.toHaveBeenCalled();
    expect(guests.bot.downloadFile).not.toHaveBeenCalled();
    expect(guests.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
  });

  it('without a verifier dependency the bot calls match a run without the field', async () => {
    const without = harness({ verifier: null });
    const explicit = harness({ verifier: null });
    const shadow = harness();
    for (const h of [without, explicit, shadow]) expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(explicit.bot.sent).toEqual(without.bot.sent);
    expect(shadow.bot.sent).toEqual(without.bot.sent);
    expect(shadow.llm.replyRequests[0].messages).toEqual(without.llm.replyRequests[0].messages);
  });
});

describe('liveTurn stays untouched', () => {
  it('liveTurn and converse never call the verifier', async () => {
    const h = harness();
    const chunks: string[] = [];
    for await (const part of h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'help' }])) chunks.push(part);
    await h.gateway.converse('aria', 'reza', 'hello');
    expect(h.verifier!.verifyVoiceNote).not.toHaveBeenCalled();
  });

  it('the liveTurn source and voice-call.ts contain no voiceprint verification', () => {
    const gateway = readFileSync(resolve(process.cwd(), 'src/lib/tireh/gateway.ts'), 'utf8');
    const start = gateway.indexOf('async *liveTurn(');
    expect(start).toBeGreaterThan(0);
    const rest = gateway.slice(start + 1);
    const next = rest.search(/\n {2}(?:private |async |protected |public |static |get )*[A-Za-z_*][\w]*\s*[(<]/);
    const body = next > 0 ? rest.slice(0, next) : rest;
    expect(body).not.toMatch(/voiceVerifier|identity\/voice/);
    const voiceCall = readFileSync(resolve(process.cwd(), 'src/lib/studio/voice-call.ts'), 'utf8');
    expect(voiceCall).not.toMatch(/voiceVerifier|identity\/voice/);
  });
});
