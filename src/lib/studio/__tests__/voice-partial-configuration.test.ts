import { afterEach, expect, it, vi } from 'vitest';
import { ElevenLabsStudio } from '../media';
const expected = { llmUrl: 'https://vox.synthetic/api/studio/voice-llm', secretId: 'synthetic-secret-id' };
function config() { return { agent_id: 'synthetic-agent', version_id: 'synthetic-version', conversation_config: {
  conversation: { client_events: ['audio', 'agent_response', 'user_transcript', 'interruption', 'tentative_user_transcript'] },
  agent: { prompt: { llm: 'custom-llm', custom_llm: { url: expected.llmUrl, api_key: { secret_id: expected.secretId } } } },
} }; }
afterEach(() => vi.useRealTimers());
it('reads the exact provider config without mutation and pins the signed session to its qualified version', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(config())).mockResolvedValueOnce(Response.json({ signed_url: 'wss://synthetic.invalid' }));
  const media = new ElevenLabsStudio('synthetic-not-a-credential', fetcher);
  const version = await media.partialTranscriptVersion('synthetic-agent', expected);
  expect(version).toBe('synthetic-version');
  expect(await media.signedUrl('synthetic-agent', version!)).toBe('wss://synthetic.invalid');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/convai/agents/synthetic-agent');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET' }); expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  expect(fetcher.mock.calls[1][0]).toContain('agent_id=synthetic-agent&version_id=synthetic-version');
});
it.each(['missing_event', 'wrong_agent', 'missing_version', 'wrong_url', 'wrong_secret', 'wrong_llm'])('fails closed for %s', async reason => {
  const raw = config();
  if (reason === 'missing_event') raw.conversation_config.conversation.client_events.pop();
  if (reason === 'wrong_agent') raw.agent_id = 'other-agent';
  if (reason === 'missing_version') raw.version_id = '';
  if (reason === 'wrong_url') raw.conversation_config.agent.prompt.custom_llm.url = 'https://other.invalid';
  if (reason === 'wrong_secret') raw.conversation_config.agent.prompt.custom_llm.api_key.secret_id = 'other-secret';
  if (reason === 'wrong_llm') raw.conversation_config.agent.prompt.llm = 'provider-llm';
  const media = new ElevenLabsStudio('synthetic', vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw)));
  expect(await media.partialTranscriptVersion('synthetic-agent', expected)).toBeNull();
});
it('bounds an ignored-abort getter and discards late configuration', async () => {
  vi.useFakeTimers(); let release!: (value: Response) => void;
  const media = new ElevenLabsStudio('synthetic', vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve; })));
  const result = media.partialTranscriptVersion('synthetic-agent', expected);
  await vi.advanceTimersByTimeAsync(400); expect(await result).toBeNull();
  release(Response.json(config())); await vi.advanceTimersByTimeAsync(1);
});
