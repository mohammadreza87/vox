import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { VoicePartialConsumer } from './voice-client';
import { predictionHttpTransport } from './client';
import { handleExperienceRequest } from '../runtime/http';
import { AdaptiveExperienceService } from '../runtime/service';
import { DecisionService } from '../decisions';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { signInitData } from '../../studio/auth';
import { hire, ID, makeStudio, seedOrg, SECRET } from '../../studio/__tests__/helpers';
import { voiceLlmKeyId } from '../../studio/voice-call';
import { ElevenLabsStudio } from '../../studio/media';

it('ordinary signed live-call bootstrap truthfully marks provisional configuration unavailable', async () => {
  const h = makeStudio(), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  h.studio.deps.webhookBase = 'https://vox.synthetic';
  expect(await h.studio.startLiveCall(users.alice, agent.id)).toMatchObject({ live: true,
    partialPrediction: { available: false, reason: 'client_event_configuration_unverified' } });
});

it('connects tentative SDK events to authenticated real HTTP authority, file storage and bounded Decisions, then cancels without retaining text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vox-voice-partial-'));
  let voice: VoicePartialConsumer | undefined;
  const requests: Promise<Response>[] = [];
  try {
    const h = makeStudio({ adaptive: false }), users = await seedOrg(h), { agent } = await hire(h, users.alice), now = Date.now();
    const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), adaptiveOptionsFromManifest(JSON.stringify({
      schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text'],
      accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
      approvals: [{ schemaVersion: 1, id: 'core-approval', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC',
        capability: 'core_text', state: 'approved', configurationVersion: 'synthetic', effectiveAt: now, reviewExpiresAt: now + 86_400_000,
        owner: 'synthetic-owner', approvalReference: 'synthetic-only' }],
    })));
    h.studio.deps.adaptive = adaptive;
    const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
    await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'synthetic-grant' });
    const evaluate = vi.fn(async () => ({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'intent_route', choice: 'conversation', confidence: 0.9,
      probabilities: [{ value: 'conversation', probability: 0.9 }, { value: 'recall', probability: 0.04 },
        { value: 'task', probability: 0.04 }, { value: 'unknown', probability: 0.02 }] }] }));
    const experience = new AdaptiveExperienceService(adaptive, { decisionsEnabled: true, decisions: new DecisionService({ evaluate }) });
    h.studio.deps.experience = experience; h.studio.deps.webhookBase = 'https://vox.synthetic';
    await h.store.update(state => { state.voiceAgent = { id: 'synthetic-provider-agent', llmUrl: 'https://vox.synthetic/api/studio/voice-llm',
      secretId: 'synthetic-secret', keyId: voiceLlmKeyId(SECRET), version: 1 }; });
    const providerFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ agent_id: 'synthetic-provider-agent', version_id: 'synthetic-event-v1', conversation_config: {
        conversation: { client_events: ['audio', 'agent_response', 'user_transcript', 'interruption', 'tentative_user_transcript'] },
        agent: { prompt: { llm: 'custom-llm', custom_llm: { url: 'https://vox.synthetic/api/studio/voice-llm', api_key: { secret_id: 'synthetic-secret' } } } },
      } }))
      .mockResolvedValueOnce(Response.json({ signed_url: 'wss://synthetic.invalid/pinned-session' }));
    h.studio.deps.eleven = new ElevenLabsStudio('synthetic-not-a-credential', providerFetch);
    const call = await h.studio.startLiveCall(users.alice, agent.id);
    expect(call).toMatchObject({ live: true, partialPrediction: { available: true, configurationVersion: 'synthetic-event-v1' } });
    expect(providerFetch.mock.calls[1][0]).toContain('version_id=synthetic-event-v1');
    expect(providerFetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    if (!call.live) throw new Error('synthetic_call_unavailable');
    providerFetch.mockRejectedValueOnce(new Error('PRIVATE_GETTER_CANARY'))
      .mockResolvedValueOnce(Response.json({ signed_url: 'wss://synthetic.invalid/ordinary-session' }));
    const ordinary = await h.studio.startLiveCall(users.alice, agent.id);
    expect(ordinary).toMatchObject({ live: true, partialPrediction: { available: false, reason: 'client_event_configuration_unverified' } });
    expect(String(providerFetch.mock.calls[3][0])).not.toContain('version_id='); expect(JSON.stringify(ordinary)).not.toContain('PRIVATE_GETTER_CANARY');
    const token = '123:synthetic-partials', paths: string[] = [], statuses: number[] = [], predictionResponses: unknown[] = [];
    const fetcher: typeof fetch = (url, init) => {
      const pending = (async () => {
      const path = String(url).split('/').at(-1)!; paths.push(path);
      const response = await handleExperienceRequest(h.studio, experience, new Request(`https://vox.synthetic${url}`, {
        ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: 'https://vox.synthetic' },
      }), [path], token);
      if (path === 'predict') predictionResponses.push(await response.clone().json());
      statuses.push(response.status); return response;
      })();
      requests.push(pending); return pending;
    };
    voice = new VoicePartialConsumer({ ...predictionHttpTransport(() => signInitData({ id: ID.alice, first_name: 'Synthetic' }, token), fetcher),
      agentId: agent.id, space: 'work', sessionId: 'synthetic-voice-session', debounceMs: 0,
      capability: call.partialPrediction });
    const raw = { type: 'tentative_user_transcript', tentative_user_transcription_event: { event_id: 7, user_transcript: 'SYNTHETIC_EPHEMERAL_CLAUSE' },
      unrelated_raw_audio: 'MUST_NOT_EXPORT' };
    voice.onDebug(raw); expect(paths).toEqual([]);
    voice.setOptIn(true); voice.onDebug(raw);
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    expect(JSON.stringify(evaluate.mock.calls[0])).toContain('SYNTHETIC_EPHEMERAL_CLAUSE');
    expect(JSON.stringify(evaluate.mock.calls[0])).not.toContain('MUST_NOT_EXPORT');
    await vi.waitFor(() => expect(predictionResponses[0]).toMatchObject({ status: 'answered', preparedContext: expect.any(Boolean),
      policyReceipt: expect.any(String), sessionId: 'synthetic-voice-session' }));
    voice.cancel();
    await vi.waitFor(() => expect(paths).toContain('prediction-cancel'));
    await vi.waitFor(async () => expect(await adaptive.withAccountDocument(ID.alice, d => d.experience.predictionTurns[0]?.cancelled)).toBe(true));
    await vi.waitFor(() => expect(statuses.length).toBe(paths.length));
    expect(statuses.every(status => status === 200)).toBe(true);
    const files = await readdir(directory);
    const stored = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).join('');
    expect(stored).not.toContain('SYNTHETIC_EPHEMERAL_CLAUSE'); expect(stored).not.toContain('MUST_NOT_EXPORT');
    expect(await adaptive.withAccountDocument(ID.alice, d => d.agentGrants.filter(g => g.allowed).length)).toBe(1);
  } finally { voice?.dispose(); await Promise.allSettled(requests); await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
});
