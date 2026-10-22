import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg } from './helpers';
import { setupVoiceprints } from './voiceprint-fixtures';

async function setup() {
  const h = makeStudio();
  const org = await seedOrg(h);
  const hired = await hire(h, org.alice);
  const s = await setupVoiceprints({ telegramId: ID.alice });
  const verify = vi.spyOn(s.service, 'verifyVoiceNote');
  h.studio.deps.voiceprints = s.service;
  return { h, org, ...hired, s, verify };
}

/** The source of one class member, from its signature to the next member at the same indentation. */
function memberSource(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(0);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n {2}(?:private |protected |public |static |async |get |set )*\*?[A-Za-z_][\w]*\s*[(<]/);
  return signature + (next > 0 ? rest.slice(0, next) : rest);
}

describe('liveTurn and Mini App calls never run voiceprint verification', { timeout: 30_000 }, () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('callTurn, liveTurn and converse complete with no verifyVoiceNote, provider or speech call', async () => {
    const { h, org, agent, s, verify } = await setup();
    // Shadow verification on, so a verifier wired into the call paths would actually run and fail this test.
    vi.stubEnv('STUDIO_VOICE_SHADOW', '1');
    expect(process.env.STUDIO_VOICE_RECOGNITION).toBe('1');
    h.openai.transcribe.mockResolvedValueOnce('hello from the call');
    expect((await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm')).transcript).toBe('hello from the call');
    h.studio.deps.fastLLM = { complete: vi.fn(), stream: vi.fn(async function* () { yield 'part one, '; yield 'part two.'; }) };
    let text = '';
    for await (const part of await h.studio.liveTurn(agent.id, ID.alice, [{ role: 'user', content: 'hi' }])) text += part;
    expect(text).toBe('part one, part two.');
    expect(verify).not.toHaveBeenCalled();
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
  });

  it('positive control: with STUDIO_VOICE_SHADOW=1 a private Telegram voice note reaches the wired verifier once', async () => {
    const { h, agent, verify } = await setup();
    vi.stubEnv('STUDIO_VOICE_SHADOW', '1');
    h.openai.transcribe.mockResolvedValueOnce('a voice note');
    const update: TelegramUpdate = { update_id: 940_001, message: { message_id: 940_001, date: 0, from: { id: ID.alice, is_bot: false, first_name: 'Alice' },
      chat: { id: ID.alice, type: 'private' }, voice: { file_id: 'voice-1', duration: 6, mime_type: 'audio/ogg' } } };
    await handleAgentUpdate(h.studio, agent.id, update);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][0]).toMatchObject({ personId: `tg-${ID.alice}`, chatKind: 'private', guestAudience: false, space: 'work', channel: 'telegram_voice_note' });
  });

  it('transcribe is the only gateway method that references voiceVerifier; voice-call.ts never does', () => {
    const gateway = readFileSync(resolve(process.cwd(), 'src/lib/tireh/gateway.ts'), 'utf8');
    expect(memberSource(gateway, 'async *liveTurn(')).not.toMatch(/voiceVerifier|verifyVoiceNote/);
    expect(memberSource(gateway, 'async converse(')).not.toMatch(/voiceVerifier|verifyVoiceNote/);
    expect(memberSource(gateway, 'private async transcribe(')).toMatch(/voiceVerifier/);
    const references = gateway.split('\n').filter(line => /voiceVerifier/.test(line));
    // The GatewayDeps field and the transcribe() read.
    expect(references).toHaveLength(2);
    const voiceCall = readFileSync(resolve(process.cwd(), 'src/lib/studio/voice-call.ts'), 'utf8');
    expect(voiceCall).not.toMatch(/voiceVerifier|verifyVoiceNote|identity\/voice/);
  });
});
