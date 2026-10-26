/**
 * The pet's voice turn end to end (design §8A.1, §8A.3): talk-voice tells the model the person spoke, a typed talk turn
 * keeps its prompt, and speech goes through deps.tts when it is wired, else through ElevenLabs exactly as before.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handlePetRequest } from '../pet-http';
import { PendingGeminiSynthesizer, type SpeechSynthesizer } from '../tts';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { PET_SURFACE_FRAME, PET_SURFACE_FRAME_VOICE } from '../../tireh/gateway';
import { SPOKEN_INPUT_LINE } from '../../tireh/conversation/prompt';
import type { PetView } from '../../pet/types';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const ORIGIN = 'https://vox.example';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });
const VOICE_SENTENCE = 'The person said this out loud and is listening for your reply; answer as speech.';

async function setup(h: Harness = makeStudio()) {
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' });
  const call = (path: string[] = [], o: { body?: unknown; raw?: FormData } = {}) => handlePetRequest(h.studio, new Request(
    `${ORIGIN}/api/studio/pet/${mochi.agent.id}${path.length ? `/${path.join('/')}` : ''}`, {
      method: o.body === undefined && o.raw === undefined ? 'GET' : 'POST',
      headers: { origin: ORIGIN, ...(o.raw ? {} : { 'content-type': 'application/json' }), 'x-pet-tz': 'UTC', 'x-telegram-init-data': agentInit(user(ID.alice), mochi.token) },
      ...(o.raw ? { body: o.raw } : o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    }), mochi.agent.id, path);
  // Core text and the agent grant, as the Mini App conversation requires (as in pet-http.test.ts).
  const now = Date.now();
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'test', enabledCapabilities: ['core_text'],
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: [{ schemaVersion: 1, id: 'approval0', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'test', effectiveAt: now, reviewExpiresAt: now + 86_400_000, owner: 'test-owner', approvalReference: 'synthetic' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), options);
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await adaptive.setAgentAccess(ID.alice, mochi.agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'grant-pet-1' });
  const giveVoice = () => h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.voice = { provider: 'elevenlabs', voiceId: 'v1', label: 'V', source: 'default' }; });
  const talkVoice = async () => {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(8)], { type: 'audio/webm' }));
    return (await call(['talk-voice'], { raw: form })).json();
  };
  return { h, mochi, call, giveVoice, talkVoice };
}

describe('the voice-mode fix on the pet surface', () => {
  it('a spoken turn says so in the prompt; a typed turn does not', async () => {
    const { h, call, giveVoice, talkVoice } = await setup();
    await call(['talk'], { body: { text: 'are you sleepy?' } });
    const typed = h.chatLLM.lastPrompt;
    expect(typed).toContain(PET_SURFACE_FRAME);
    for (const line of [VOICE_SENTENCE, SPOKEN_INPUT_LINE, 'A voice reply is requested', 'reply in text only']) expect(typed).not.toContain(line);

    // no voice of its own: heard aloud, answered in text
    expect(await talkVoice()).toMatchObject({ transcript: 'hello there', reply: 'Sure.' });
    expect(h.chatLLM.lastPrompt).toContain(PET_SURFACE_FRAME_VOICE);
    expect(h.chatLLM.lastPrompt).toContain(SPOKEN_INPUT_LINE);
    expect(h.chatLLM.lastPrompt).toContain('For this turn, reply in text only');

    await giveVoice();
    await talkVoice();
    expect(h.chatLLM.lastPrompt).toContain(SPOKEN_INPUT_LINE);
    expect(h.chatLLM.lastPrompt).toContain('A voice reply is requested for this turn.');
  });
});

describe('speech through deps.tts', () => {
  it('unset: ElevenLabs speaks exactly as before the seam', async () => {
    const { h, giveVoice, talkVoice } = await setup();
    expect(h.studio.deps.tts).toBeUndefined();
    await giveVoice();
    expect(await talkVoice()).toMatchObject({ audio: Buffer.from('spoken-mp3').toString('base64') });
    expect(h.eleven.speak).toHaveBeenCalledTimes(1);
  });

  it('wired: the chosen synthesizer speaks the reply in the agent voice, and ElevenLabs is not called directly', async () => {
    const { h, giveVoice, talkVoice } = await setup();
    const tts: SpeechSynthesizer = { provider: 'gemini', canSynthesize: true, committedTtsExportFence: true,
      speak: vi.fn(async () => ({ audio: Buffer.from('wav-bytes'), mimeType: 'audio/wav' })) };
    h.studio.deps.tts = tts;
    await giveVoice();
    expect(await talkVoice()).toMatchObject({ reply: 'Sure.', audio: Buffer.from('wav-bytes').toString('base64') });
    expect(tts.speak).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tts.speak).mock.calls[0].slice(0, 2)).toEqual(['Sure.', 'v1']);
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('a failing synthesizer leaves a text reply; Gemini before its adapter, or none, makes no speech and no voice flag', async () => {
    const { h, call, giveVoice, talkVoice } = await setup();
    await giveVoice();
    h.studio.deps.tts = { provider: 'eleven', canSynthesize: true, committedTtsExportFence: true, speak: vi.fn(async () => { throw new Error('provider down'); }) };
    const failed = await talkVoice();
    expect(failed).toMatchObject({ reply: 'Sure.' });
    expect(failed.audio).toBeUndefined();

    h.studio.deps.tts = new PendingGeminiSynthesizer();
    const pending = await talkVoice();
    expect(pending).toMatchObject({ reply: 'Sure.' });
    expect(pending.audio).toBeUndefined();
    expect(((await (await call()).json()) as PetView).voice).toBe(false);

    h.studio.deps.tts = null;
    expect((await talkVoice()).audio).toBeUndefined();
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });
});
