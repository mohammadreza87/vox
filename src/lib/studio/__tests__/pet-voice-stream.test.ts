/**
 * Sentence-level streaming on talk-voice (design §8A.3) and the hands-free frame (§8A.2): `?stream=1` answers NDJSON
 * in order (transcript, reply, one sentence per piece, done), the authority fence runs before every sentence, the
 * media type follows the provider, and an agent without a voice gets no audio at all. Without `stream`, nothing changes.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handlePetRequest } from '../pet-http';
import { splitSentences, type SpeechSynthesizer } from '../tts';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { PET_SURFACE_FRAME_HANDS_FREE, PET_SURFACE_FRAME_VOICE } from '../../tireh/gateway';
import type { TalkVoiceStreamEvent } from '../../pet/types';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const ORIGIN = 'https://vox.example';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });
const REPLY = 'Hello there, my friend. I am a little cloud who likes to talk. What shall we do together today?';

async function setup() {
  const h = makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' });
  const now = Date.now();
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'test', enabledCapabilities: ['core_text'],
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: [{ schemaVersion: 1, id: 'approval0', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'test', effectiveAt: now, reviewExpiresAt: now + 86_400_000, owner: 'test-owner', approvalReference: 'synthetic' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), options);
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const granted = await adaptive.setAgentAccess(ID.alice, mochi.agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'grant-stream-1' });
  const revoke = () => adaptive.setAgentAccess(ID.alice, mochi.agent.id, { space: 'work', allowed: false, expectedRevision: granted.revision, eventId: 'revoke-stream-1' });
  const giveVoice = () => h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.voice = { provider: 'elevenlabs', voiceId: 'v1', label: 'V', source: 'default' }; });
  const post = (query = '', fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(8)], { type: 'audio/webm' }));
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${mochi.agent.id}/talk-voice${query}`, {
      method: 'POST', headers: { origin: ORIGIN, 'x-pet-tz': 'UTC', 'x-telegram-init-data': agentInit(user(ID.alice), mochi.token) }, body: form,
    }), mochi.agent.id, ['talk-voice']);
  };
  const stream = async (fields: Record<string, string> = {}) => {
    const res = await post('?stream=1', fields);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/x-ndjson/);
    const text = await res.text();
    expect(text.endsWith('\n')).toBe(true);
    return text.trim().split('\n').map((line) => JSON.parse(line) as TalkVoiceStreamEvent);
  };
  return { h, mochi, giveVoice, post, stream, revoke };
}

const fakeTts = (provider: 'eleven' | 'gemini', o: { onCall?: (n: number) => Promise<void> | void; fail?: (n: number) => boolean } = {}): SpeechSynthesizer => {
  let n = 0;
  return { provider, canSynthesize: true, committedTtsExportFence: true,
    speak: vi.fn(async (text: string) => {
      const call = n++;
      await o.onCall?.(call);
      if (o.fail?.(call)) throw new Error('provider down');
      return { audio: Buffer.from(`audio:${text}`), mimeType: provider === 'gemini' ? 'audio/wav' : 'audio/mpeg' };
    }) };
};

describe('talk-voice?stream=1', () => {
  it('emits transcript, reply, every sentence in order with its audio, then done with the care and turn id', async () => {
    const { h, giveVoice, stream } = await setup();
    h.chatLLM.nextReply = REPLY;
    h.studio.deps.tts = fakeTts('gemini');
    await giveVoice();
    const events = await stream();
    const pieces = splitSentences(REPLY, 'en');
    expect(pieces.length).toBeGreaterThan(1);
    expect(events.map((e) => e.type)).toEqual(['transcript', 'reply', ...pieces.map(() => 'sentence'), 'done']);
    expect(events[0]).toEqual({ type: 'transcript', text: 'hello there' });
    expect(events[1]).toEqual({ type: 'reply', text: REPLY });
    events.slice(2, -1).forEach((e, i) => expect(e).toEqual({ type: 'sentence', i, text: pieces[i], audio: Buffer.from(`audio:${pieces[i]}`).toString('base64'), mimeType: 'audio/wav' }));
    const done = events[events.length - 1] as Extract<TalkVoiceStreamEvent, { type: 'done' }>;
    expect(done.care).toMatchObject({ agentId: expect.any(String), userId: ID.alice });
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('keeps sentence order when a later sentence finishes first (two in flight)', async () => {
    const { h, giveVoice, stream } = await setup();
    h.chatLLM.nextReply = REPLY;
    const tts = fakeTts('eleven', { onCall: (n) => n === 0 ? new Promise((r) => setTimeout(r, 30)) : undefined });
    h.studio.deps.tts = tts;
    await giveVoice();
    const sentences = (await stream()).filter((e) => e.type === 'sentence') as Array<Extract<TalkVoiceStreamEvent, { type: 'sentence' }>>;
    expect(sentences.map((e) => e.i)).toEqual(sentences.map((_, i) => i));
    expect(sentences.every((e) => e.mimeType === 'audio/mpeg')).toBe(true);
    expect(tts.speak).toHaveBeenCalledTimes(sentences.length);
  });

  it('ElevenLabs without the seam streams MP3 sentences through the same client', async () => {
    const { h, giveVoice, stream } = await setup();
    h.chatLLM.nextReply = REPLY;
    await giveVoice();
    const sentences = (await stream()).filter((e) => e.type === 'sentence') as Array<Extract<TalkVoiceStreamEvent, { type: 'sentence' }>>;
    expect(sentences.length).toBe(splitSentences(REPLY, 'en').length);
    expect(sentences.every((e) => e.mimeType === 'audio/mpeg' && e.audio === Buffer.from('spoken-mp3').toString('base64'))).toBe(true);
  });

  it('stops with an error event when authority changes mid-reply, and nothing further is spoken', async () => {
    const { h, giveVoice, stream, revoke } = await setup();
    h.chatLLM.nextReply = REPLY;
    // The grant is revoked while the second sentence is being synthesized.
    const tts = fakeTts('eleven', { onCall: async (n) => { if (n === 1) await revoke(); } });
    h.studio.deps.tts = tts;
    await giveVoice();
    const events = await stream();
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'settings_changed' });
    const sentences = events.filter((e) => e.type === 'sentence');
    expect(sentences.length).toBeLessThan(splitSentences(REPLY, 'en').length);
    expect(sentences.length).toBeLessThanOrEqual(1);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    // no synthesis starts after the fence failed
    expect(vi.mocked(tts.speak).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('a failed synthesis leaves that sentence and the rest as text-only sentences, then done', async () => {
    const { h, giveVoice, stream } = await setup();
    h.chatLLM.nextReply = REPLY;
    const tts = fakeTts('gemini', { fail: (n) => n === 0 });
    h.studio.deps.tts = tts;
    await giveVoice();
    const events = await stream();
    const sentences = events.filter((e) => e.type === 'sentence') as Array<Extract<TalkVoiceStreamEvent, { type: 'sentence' }>>;
    expect(sentences[0]).toEqual({ type: 'sentence', i: 0, text: splitSentences(REPLY, 'en')[0] });
    expect(sentences.length).toBe(splitSentences(REPLY, 'en').length);
    expect(sentences.slice(2).every((e) => e.audio === undefined)).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('an agent without a voice gets transcript, reply and done: no sentence and no audio, and no speech is paid for', async () => {
    const { h, stream } = await setup();
    h.chatLLM.nextReply = REPLY;
    const tts = fakeTts('gemini');
    h.studio.deps.tts = tts;
    const events = await stream();
    expect(events.map((e) => e.type)).toEqual(['transcript', 'reply', 'done']);
    expect(tts.speak).not.toHaveBeenCalled();
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('an empty transcript is transcript "" then done', async () => {
    const { h, stream } = await setup();
    h.openai.transcribe.mockResolvedValueOnce('');
    expect(await stream()).toEqual([{ type: 'transcript', text: '' }, { type: 'done' }]);
  });

  it('a refusal before the first line is the ordinary JSON error', async () => {
    const { post, revoke } = await setup();
    await revoke();
    const res = await post('?stream=1');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(await res.json()).toMatchObject({ error: 'conversation_failed' });
  });

  it('without ?stream=1 the answer is the one JSON body it always was', async () => {
    const { h, giveVoice, post } = await setup();
    h.chatLLM.nextReply = REPLY;
    h.studio.deps.tts = fakeTts('eleven');
    await giveVoice();
    const body = await (await post()).json();
    expect(body).toMatchObject({ transcript: 'hello there', reply: REPLY, audio: Buffer.from(`audio:${REPLY}`).toString('base64') });
  });
});

describe('hands-free frame (§8A.2)', () => {
  it('handsFree=true uses the hands-free frame; without it the spoken frame', async () => {
    const { h, post } = await setup();
    await post('', { handsFree: 'true' });
    expect(h.chatLLM.lastPrompt).toContain(PET_SURFACE_FRAME_HANDS_FREE);
    await post();
    expect(h.chatLLM.lastPrompt).toContain(PET_SURFACE_FRAME_VOICE);
    expect(h.chatLLM.lastPrompt).not.toContain(PET_SURFACE_FRAME_HANDS_FREE);
  });
});
