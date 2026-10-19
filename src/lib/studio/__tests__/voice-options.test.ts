import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { ElevenLabsSpeechError } from '../media';
import { draftJson, ID, makeStudio, seedOrg, type Harness } from './helpers';

const BOT_TOKEN = '555:fixture-voice-options-token';
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let agentId: string;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  h.personaLLM.push(draftJson());
  agentId = (await h.studio.draft(org.alice, {})).agent.id;
});
afterEach(() => { rmSync(h.dir, { recursive: true, force: true }); });

async function request(method: string, path: string, body?: unknown, userId: number | null = ID.alice) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userId !== null) headers['x-telegram-init-data'] = signInitData({ id: userId, first_name: 'Fixture visitor' }, BOT_TOKEN);
  const response = await handleStudioRequest(h.studio, new Request(`https://fixture.invalid/api/studio/${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), path.split('/'), { botToken: BOT_TOKEN, devUser: null });
  return { status: response.status, body: await response.json() };
}

describe('voice catalogue and built-in selection', () => {
  it('requires authentication and membership before exposing account capabilities', async () => {
    expect((await request('GET', 'voices/options', undefined, null)).status).toBe(401);
    expect((await request('GET', 'voices/options', undefined, ID.pending)).status).toBe(403);
    expect(h.eleven.getVoiceOptions).not.toHaveBeenCalled();
    const response = await request('GET', 'voices/options');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tier: 'creator', libraryAllowed: true, ttsModel: 'eleven_v4',
      models: [{ id: 'eleven_v4', persian: true }], defaultVoices: [{ voiceId: 'fixture-sarah', name: 'Sarah' }] });
    expect(h.eleven.addLibraryVoice).not.toHaveBeenCalled();
  });

  it('persists a provider-verified built-in voice without creating a library copy', async () => {
    const response = await request('POST', `agents/${agentId}/voice`, { action: 'choose-default', voiceId: 'fixture-sarah', name: 'Forged label' });
    expect(response.status).toBe(200);
    expect(response.body.agent.voice).toEqual({ label: 'Sarah · built-in', source: 'default' });
    expect((await h.store.read()).agents[0].voice).toEqual({ provider: 'elevenlabs', voiceId: 'fixture-sarah', label: 'Sarah · built-in', source: 'default' });
    expect(h.eleven.addLibraryVoice).not.toHaveBeenCalled();
    expect(h.eleven.saveDesignedVoice).not.toHaveBeenCalled();
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('rejects arbitrary voice IDs and unrelated members before changing the selection', async () => {
    const before = (await h.store.read()).agents[0];
    expect((await request('POST', `agents/${agentId}/voice`, { action: 'choose-default', voiceId: 'foreign-library-voice' })).status).toBe(400);
    h.eleven.getVoiceOptions.mockClear();
    expect((await request('POST', `agents/${agentId}/voice`, { action: 'choose-default', voiceId: 'fixture-sarah' }, ID.bob)).status).toBe(403);
    expect(h.eleven.getVoiceOptions).not.toHaveBeenCalled();
    expect((await h.store.read()).agents[0]).toEqual(before);
  });

  it('blocks a free-plan library selection and preserves an existing chosen voice', async () => {
    await h.studio.chooseDefaultVoice(org.alice, agentId, 'fixture-sarah');
    const options = await h.eleven.getVoiceOptions();
    h.eleven.getVoiceOptions.mockResolvedValue({ ...options, tier: 'free', libraryAllowed: false });
    const before = (await h.store.read()).agents[0].voice;
    const response = await request('POST', `agents/${agentId}/voice`, { action: 'choose-library', publicOwnerId: 'owner', voiceId: 'library', name: 'Melania' });
    expect(response.status).toBe(402);
    expect(response.body.error).toContain('paid ElevenLabs plan');
    expect((await h.store.read()).agents[0].voice).toEqual(before);
    expect(h.eleven.addLibraryVoice).not.toHaveBeenCalled();
  });

  it('fails closed when account eligibility is unknown', async () => {
    const options = await h.eleven.getVoiceOptions();
    h.eleven.getVoiceOptions.mockResolvedValue({ ...options, tier: 'unknown', libraryAllowed: false });
    const response = await request('POST', `agents/${agentId}/voice`, { action: 'choose-library', publicOwnerId: 'owner', voiceId: 'library', name: 'Voice' });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain('subscription could not be checked');
    expect(h.eleven.addLibraryVoice).not.toHaveBeenCalled();
  });

  it('returns a safe actionable provider error code for speech failures', async () => {
    await h.studio.chooseDefaultVoice(org.alice, agentId, 'fixture-sarah');
    h.eleven.speak.mockRejectedValue(new ElevenLabsSpeechError(402, 'payment_required'));
    const response = await request('POST', `agents/${agentId}/speak`, { text: 'Synthetic hello' });
    expect(response.status).toBe(402);
    expect(response.body.code).toBe('payment_required');
    expect(response.body.error).toContain('ElevenLabs');
    expect(JSON.stringify(response.body)).not.toContain('xi-api-key');
  });

  it('does not confuse provider quota and permission errors with an expired Studio session', async () => {
    await h.studio.chooseDefaultVoice(org.alice, agentId, 'fixture-sarah');
    h.eleven.speak.mockRejectedValueOnce(new ElevenLabsSpeechError(401, 'quota_exceeded'));
    const quota = await request('POST', `agents/${agentId}/speak`, { text: 'Synthetic hello' });
    expect(quota.status).toBe(429);
    expect(quota.body.code).toBe('quota_exceeded');
    h.eleven.speak.mockRejectedValueOnce(new ElevenLabsSpeechError(401, 'permission_denied'));
    const permission = await request('POST', `agents/${agentId}/speak`, { text: 'Synthetic hello' });
    expect(permission.status).toBe(403);
    expect(permission.body.code).toBe('permission_denied');
  });

  it('recognizes provider errors from another server bundle while rebuilding the safe public message', async () => {
    await h.studio.chooseDefaultVoice(org.alice, agentId, 'fixture-sarah');
    h.eleven.speak.mockRejectedValue({ name: 'ElevenLabsSpeechError', status: 402, code: 'payment_required', message: 'Never forward private provider detail' });
    const response = await request('POST', `agents/${agentId}/speak`, { text: 'Synthetic hello' });
    expect(response.status).toBe(402);
    expect(response.body.code).toBe('payment_required');
    expect(response.body.error).toBe(new ElevenLabsSpeechError(402, 'payment_required').message);
    expect(JSON.stringify(response.body)).not.toContain('private provider detail');
  });
});
