import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { systemText } from '../llm-content';
import { InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import { fakeVoice, groupText, LEADS_CHAT, makeGateway, privateText, privateVoice, TG } from './fixtures';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

function setup(overrides: Partial<GatewayDeps> = {}) {
  const voice = fakeVoice();
  const h = makeGateway({ voice });
  const gateway = new PersonaGateway({
    org: h.org, llm: h.llm, memories: h.memories, offers: h.offers,
    history: h.history, deduper: new InMemoryUpdateDeduper(), voice,
    botFor: () => h.bot as unknown as TelegramBotClient,
    logger: h.logger, ...overrides,
  });
  return { ...h, gateway, voice };
}

function verify(h: ReturnType<typeof setup>) {
  expectContentFreeTelegramLogs([...h.logger.info.mock.calls, ...h.logger.warn.mock.calls, ...h.logger.error.mock.calls], ['aria', TG.reza, TG.stranger, LEADS_CHAT]);
}

describe('real persona gateway diagnostic boundaries', () => {
  it.each(['reply', 'extraction'] as const)('keeps %s exceptions private without changing the handled outcome', async (stage) => {
    const h = setup();
    const original = h.llm.complete.bind(h.llm);
    vi.spyOn(h.llm, 'complete').mockImplementation(async (request) => {
      const extracting = systemText(request.system).startsWith('You extract long-term memories');
      if ((stage === 'extraction') === extracting) throw telegramCanaryError();
      return original(request);
    });
    const incoming = privateText(TG.reza, telegramCanary.transcript);
    expect(await h.gateway.handleUpdate('aria', incoming)).toBe(stage === 'reply' ? 'ignored' : 'replied');
    expect(await h.gateway.handleUpdate('aria', incoming)).toBe('duplicate');
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(stage === 'reply' ? 0 : 1);
    expect(h.logger.error).toHaveBeenCalledWith(expect.objectContaining({ stage: stage === 'reply' ? 'reply_generation' : 'memory_extraction' }));
    verify(h);
  });

  it('keeps STT exceptions private and preserves the voice clarification reply', async () => {
    const h = setup();
    h.voice.transcribe.mockRejectedValueOnce(telegramCanaryError());
    expect(await h.gateway.handleUpdate('aria', privateVoice(TG.reza))).toBe('replied');
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.bot.sendVoice).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledWith(expect.objectContaining({ stage: 'transcription', outcome: 'unavailable' }));
    verify(h);
  });

  it.each(['private_canary_secret', 'getter', 'quota_exceeded'])('keeps a %s provider error private and still sends fallback text', async (code) => {
    const h = setup();
    const error = telegramCanaryError();
    if (code === 'getter') Object.defineProperty(error, 'code', { get: () => { throw telegramCanaryError(); } });
    else Object.defineProperty(error, 'code', { value: code });
    h.voice.synthesize.mockRejectedValueOnce(error);
    const incoming = privateText(TG.reza, `Please send a voice message. ${telegramCanary.transcript}`);
    expect(await h.gateway.handleUpdate('aria', incoming)).toBe('replied');
    expect(h.bot.sendVoice).not.toHaveBeenCalled();
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'voice_delivery', reason: code === 'quota_exceeded' ? code : 'delivery_failed', outcome: 'text_fallback' });
    verify(h);
    expectContentFreeTelegramLogs(h.logger.error.mock.calls, ['private_canary_secret']);
  });

  it('keeps failed voice transcripts private without resending already delivered audio', async () => {
    const h = setup();
    h.bot.sendMessage.mockRejectedValueOnce(telegramCanaryError());
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'Please send a voice message.'))).toBe('replied');
    expect(h.bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'voice_transcript', reason: 'operation_failed', outcome: 'audio_already_delivered' });
    verify(h);
  });

  it('keeps triage errors private and continues through the full reply path', async () => {
    const h = setup({ decider: { decide: vi.fn().mockRejectedValue(telegramCanaryError()) } });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, telegramCanary.transcript))).toBe('replied');
    expect(h.bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'triage', reason: 'operation_failed', outcome: 'full_reply_path' });
    verify(h);
  });

  it('refuses unknown accounts/groups and nonmembers without logging their IDs', async () => {
    const h = setup();
    expect(await h.gateway.handleUpdate('aria', privateText(TG.stranger, telegramCanary.transcript))).toBe('stranger');
    expect(await h.gateway.handleUpdate('aria', groupText(telegramCanary.chat, TG.reza, telegramCanary.transcript))).toBe('unregistered-group');
    expect(await h.gateway.handleUpdate('aria', groupText(LEADS_CHAT, TG.sina, telegramCanary.transcript))).toBe('ignored');
    expect(h.logger.warn.mock.calls.map(([event]) => event.reason)).toEqual(['unknown_account', 'unknown_group', 'group_nonmember']);
    verify(h);
  });
});
