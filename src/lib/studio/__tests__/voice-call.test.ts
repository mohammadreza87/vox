import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../org-bridge';
import { voiceAgentBody } from '../media';
import { callToken, handleVoiceLlm, readCallToken, toTurns, voiceLlmKey } from '../voice-call';
import { hire, ID, makeStudio, SECRET, seedOrg, T0, type Harness } from './helpers';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  h.studio.deps.webhookBase = 'https://vox.example/';
});

function llmRequest(body: unknown, key = voiceLlmKey(SECRET)) {
  return new Request('https://vox.example/api/studio/voice-llm/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function sse(response: Response): Promise<{ text: string; done: boolean }> {
  const raw = await response.text();
  const events = raw.split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, ''));
  const text = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e).choices[0].delta.content ?? '').join('');
  return { text, done: events.at(-1) === '[DONE]' };
}

describe('call tokens', () => {
  it('round-trip, and reject tampering, other secrets and expiry', () => {
    const token = callToken(SECRET, 'agent-1', ID.bob, T0);
    expect(readCallToken(SECRET, token, T0)).toEqual({ agentId: 'agent-1', telegramId: ID.bob });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ a: 'agent-1', u: ID.alice, e: T0.getTime() + 1e9 })).toString('base64url');
    expect(readCallToken(SECRET, `${forged}.${sig}`, T0)).toBeNull();
    expect(readCallToken('x'.repeat(40), token, T0)).toBeNull();
    expect(readCallToken(SECRET, `${body}.`, T0)).toBeNull();
    expect(readCallToken(SECRET, token, new Date(T0.getTime() + 3 * 3600_000))).toBeNull();
    expect(readCallToken(SECRET, 42, T0)).toBeNull();
  });

  it('turns OpenAI messages into user/assistant turns, dropping system and empty ones', () => {
    expect(toTurns([
      { role: 'system', content: 'ignore me' },
      { role: 'assistant', content: 'Hey Bob' },
      { role: 'user', content: [{ type: 'text', text: 'How is ' }, { type: 'text', text: 'the launch?' }] },
      { role: 'user', content: '  ' },
      { role: 'tool', content: 'x' },
    ])).toEqual([{ role: 'assistant', content: 'Hey Bob' }, { role: 'user', content: 'How is the launch?' }]);
    expect(toTurns('nope')).toEqual([]);
  });
});

describe('live calls', () => {
  it('sets up one ElevenLabs agent pointed at this deployment, then reuses it', async () => {
    const { agent } = await hire(h, org.alice, { name: 'Nova' }, undefined, 'org');
    const call = await h.studio.startLiveCall(org.bob, agent.id);
    expect(call).toMatchObject({ live: true, signedUrl: expect.stringContaining('wss://'), voiceId: defaultVoice(agent), firstMessage: "Hey Bob, it's Nova." });
    expect(h.eleven.createSecret).toHaveBeenCalledWith(expect.stringMatching(/^vox-studio-llm-/), voiceLlmKey(SECRET));
    const config = h.eleven.createAgent.mock.calls[0][0];
    expect(config).toMatchObject({ llmUrl: 'https://vox.example/api/studio/voice-llm', llmSecretId: 'secret-1' });
    expect(voiceAgentBody(config).platform_settings.overrides).toMatchObject({ custom_llm_extra_body: true });
    expect(h.eleven.signedUrl).toHaveBeenCalledWith('agent-xi-1');

    await h.studio.startLiveCall(org.alice, agent.id);
    expect(h.eleven.createAgent).toHaveBeenCalledTimes(1);
    expect(h.eleven.createSecret).toHaveBeenCalledTimes(1);

    // A new public URL repoints the same agent instead of creating another.
    h.studio.deps.webhookBase = 'https://new.example';
    await h.studio.startLiveCall(org.alice, agent.id);
    expect(h.eleven.updateAgent).toHaveBeenCalledWith('agent-xi-1', expect.objectContaining({ llmUrl: 'https://new.example/api/studio/voice-llm' }));
    expect(h.eleven.createAgent).toHaveBeenCalledTimes(1);
  });

  it('falls back to tap-to-talk without a public URL, and refuses people who cannot use the agent', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'private');
    await expect(h.studio.startLiveCall(org.bob, agent.id)).rejects.toThrow();
    h.studio.deps.webhookBase = undefined;
    expect(await h.studio.startLiveCall(org.alice, agent.id)).toEqual({ live: false });
  });

  it('answers each turn in character, streamed, with the fast voice model and the caller\'s memories', async () => {
    const { agent } = await hire(h, org.alice, { name: 'Nova' }, undefined, 'org');
    let attempt = 0;
    const voice = {
      complete: vi.fn(),
      stream: vi.fn(async function* () {
        if (attempt++ === 0) throw new Error('overloaded');
        yield 'Launch is '; yield 'on track.';
      }),
    };
    h.studio.deps.fastLLM = voice;
    const token = callToken(SECRET, agent.id, ID.bob, new Date());
    const turns = [{ role: 'assistant', content: "Hey Bob, it's Nova." }, { role: 'user', content: 'How is the launch?' }];

    // A failed attempt is an HTTP error ElevenLabs retries; the retry doesn't store the turn twice.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await handleVoiceLlm(h.studio, llmRequest({ messages: turns, elevenlabs_extra_body: { call: token } }))).status).toBe(503);
    warn.mockRestore();

    const response = await handleVoiceLlm(h.studio, llmRequest({ model: 'vox-persona', stream: true, messages: [{ role: 'system', content: 'x' }, ...turns], elevenlabs_extra_body: { call: token } }));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await sse(response)).toEqual({ text: 'Launch is on track.', done: true });
    const request = voice.stream.mock.calls[1][0];
    expect(request.system).toContain('## Live voice call');
    expect(request.system).not.toContain('## Live information');
    // Platform-supplied assistant history cannot reintroduce revoked context.
    expect(request.messages).toEqual(turns.filter((turn) => turn.role === 'user'));

    const history = await h.memory.history.recent(agent.id, `private-${personId(ID.bob)}`, 5);
    expect(history.map((m) => [m.role, m.text])).toEqual([['user', 'How is the launch?'], ['assistant', 'Launch is on track.']]);

    await h.studio.endLiveCall(org.bob, agent.id);
  });

  it('rejects a wrong key, a missing or forged call token, and callers who lost access', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'org');
    const token = callToken(SECRET, agent.id, ID.bob, new Date());
    expect((await handleVoiceLlm(h.studio, llmRequest({ messages: [], elevenlabs_extra_body: { call: token } }, 'wrong'))).status).toBe(401);
    expect((await handleVoiceLlm(h.studio, llmRequest({ messages: [] }))).status).toBe(403);
    expect((await handleVoiceLlm(h.studio, llmRequest({ messages: [], elevenlabs_extra_body: { call: callToken('y'.repeat(40), agent.id, ID.bob, new Date()) } }))).status).toBe(403);
    await h.studio.setVisibility(org.alice, agent.id, 'private');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await handleVoiceLlm(h.studio, llmRequest({ messages: [{ role: 'user', content: 'hi' }], elevenlabs_extra_body: { call: token } }))).status).toBe(503);
    warn.mockRestore();
  });
});

const defaultVoice = (agent: { persona: { presentation?: string } }) =>
  ({ feminine: 'EXAVITQu4vr4xnSDxMaL', masculine: 'JBFqnCBsd6RMkjVDRZzb' } as Record<string, string>)[agent.persona.presentation ?? ''] ?? 'SAz9YHcvj6GT2YYXdXww';

describe('live call upkeep', () => {
  it('answers non-streaming requests as one JSON completion', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'org');
    h.studio.deps.fastLLM = { complete: vi.fn(async () => 'All good.') };
    const r = await handleVoiceLlm(h.studio, llmRequest({ stream: false, messages: [{ role: 'user', content: 'ok?' }], elevenlabs_extra_body: { call: callToken(SECRET, agent.id, ID.bob, new Date()) } }));
    expect((await r.json()).choices[0].message).toEqual({ role: 'assistant', content: 'All good.' });
  });

  it('stores a fresh ElevenLabs secret when STUDIO_SECRET is rotated', async () => {
    const { agent } = await hire(h, org.alice, {}, undefined, 'org');
    await h.studio.startLiveCall(org.bob, agent.id);
    h.studio.deps.secret = 'r'.repeat(48);
    await h.studio.startLiveCall(org.bob, agent.id);
    expect(h.eleven.createSecret).toHaveBeenCalledTimes(2);
    expect(h.eleven.createSecret).toHaveBeenLastCalledWith(expect.any(String), voiceLlmKey('r'.repeat(48)));
    expect(h.eleven.updateAgent).toHaveBeenCalledTimes(1);
  });
});
