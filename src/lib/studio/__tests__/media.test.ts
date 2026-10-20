import { TurnTrace } from '../../adaptive/observation/trace';
import { describe, expect, it, vi } from 'vitest';
import { avatarPrompt, ElevenLabsSpeechError, ElevenLabsStudio, OpenAIMedia, StudioVoiceService } from '../media';
import { personaSpec } from './helpers';

function fakeFetch(...responses: Array<{ status?: number; json?: unknown; body?: ArrayBuffer }>) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const r = responses.shift() ?? { json: {} };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': r.body ? 'audio/mpeg' : 'application/json' }),
      json: async () => r.json ?? {},
      arrayBuffer: async () => r.body ?? new ArrayBuffer(0),
    } as unknown as Response;
  });
  return fn;
}

const look = { hue: 'lagoon' as const, family: 'tower' as const, features: { cheeks: false, lashes: false, brows: true } };

describe('avatarPrompt', () => {
  it('describes the cloud in the agent\'s colour and shape, with a varied expression and safe guidance', () => {
    const p0 = avatarPrompt(personaSpec({ presentation: 'masculine' }), look, 0);
    const p1 = avatarPrompt(personaSpec({ presentation: 'masculine' }), look, 1);
    expect(p0).toContain('Lagoon #6FE0D0');
    expect(p0).toContain('Tower');
    expect(p0).toContain('brow strokes');
    expect(p0).toContain('a small notebook');
    expect(p0).toContain('religious or national symbols');
    expect(p0).not.toBe(p1);
  });
});

describe('OpenAIMedia', () => {
  it('requests a 1024px JPEG with the bearer key and decodes base64', async () => {
    const fetchFn = fakeFetch({ json: { data: [{ b64_json: Buffer.from('JPEGDATA').toString('base64') }] } });
    const media = new OpenAIMedia('sk-test', fetchFn, 'gpt-image-1', 'stt');
    const out = await media.generateAvatar('a cloud');
    expect(out.toString()).toBe('JPEGDATA');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'gpt-image-1', prompt: 'a cloud', size: '1024x1024', n: 1, output_format: 'jpeg' });
  });

  it('surfaces API errors', async () => {
    const media = new OpenAIMedia('k', fakeFetch({ status: 400, json: { error: { message: 'content policy' } } }));
    await expect(media.generateAvatar('x')).rejects.toThrow('content policy');
    const media2 = new OpenAIMedia('k', fakeFetch({ status: 200, json: {} }));
    await expect(media2.generateAvatar('x')).rejects.toThrow('HTTP 200');
  });

  it('transcribes with multipart form data and trims the text', async () => {
    const fetchFn = fakeFetch({ json: { text: '  salam  ' } });
    const media = new OpenAIMedia('k', fetchFn, 'img', 'gpt-4o-mini-transcribe');
    expect(await media.transcribe(new ArrayBuffer(4), 'audio/webm', 'turn.webm')).toBe('salam');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = init!.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('file')).toBeTruthy();
    await expect(new OpenAIMedia('k', fakeFetch({ status: 500, json: {} })).transcribe(new ArrayBuffer(1))).rejects.toThrow('HTTP 500');
  });
});

describe('ElevenLabsStudio', () => {
  it('designs voices: auto-generated text for short samples, real text for long ones', async () => {
    const preview = { generated_voice_id: 'g1', audio_base_64: Buffer.from('mp3').toString('base64') };
    const fetchFn = fakeFetch({ json: { previews: [preview] } }, { json: { previews: [preview] } });
    const xi = new ElevenLabsStudio('xi-key', fetchFn);
    const [p] = await xi.designVoices('warm voice');
    expect(p).toEqual({ generatedVoiceId: 'g1', audio: Buffer.from('mp3'), mediaType: 'audio/mpeg' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('/v1/text-to-voice/design');
    expect((init!.headers as Record<string, string>)['xi-api-key']).toBe('xi-key');
    expect(JSON.parse(init!.body as string)).toEqual({ voice_description: 'warm voice', model_id: 'eleven_ttv_v3', auto_generate_text: true });

    await xi.designVoices('warm', 'x'.repeat(150));
    expect(JSON.parse(fetchFn.mock.calls[1][1]!.body as string).text).toHaveLength(150);
  });

  it('saves a designed voice and adds a library voice (ids URL-encoded)', async () => {
    const fetchFn = fakeFetch({ json: { voice_id: 'v-saved' } }, { json: { voice_id: 'v-lib' } });
    const xi = new ElevenLabsStudio('k', fetchFn);
    expect(await xi.saveDesignedVoice('g1', 'HOOR Nova', 'desc')).toBe('v-saved');
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string)).toEqual({ voice_name: 'HOOR Nova', voice_description: 'desc', generated_voice_id: 'g1' });
    expect(await xi.addLibraryVoice('owner/1', 'voice 2', 'HOOR Sam')).toBe('v-lib');
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.elevenlabs.io/v1/voices/add/owner%2F1/voice%202');
  });

  it('searches the library with only the given filters and maps fields', async () => {
    const fetchFn = fakeFetch({ json: { voices: [{ voice_id: 'v', public_owner_id: 'o', name: 'Sam', accent: 'british', gender: 'male', age: 'young', descriptive: 'calm', preview_url: 'u' }] } });
    const xi = new ElevenLabsStudio('k', fetchFn);
    const voices = await xi.searchLibrary({ gender: 'male', accent: undefined, search: 'calm' });
    expect(voices[0]).toMatchObject({ voiceId: 'v', publicOwnerId: 'o', name: 'Sam', previewUrl: 'u' });
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.searchParams.get('gender')).toBe('male');
    expect(url.searchParams.get('search')).toBe('calm');
    expect(url.searchParams.has('accent')).toBe(false);
  });

  it('speaks with the chosen voice, capping text length; errors surface', async () => {
    const audio = new TextEncoder().encode('MP3').buffer as ArrayBuffer;
    const fetchFn = fakeFetch({ body: audio }, { status: 401 });
    const xi = new ElevenLabsStudio('k', fetchFn, 'eleven_multilingual_v2');
    expect((await xi.speak('x'.repeat(3000), 'voice/1')).toString()).toBe('MP3');
    expect(fetchFn.mock.calls[0][0]).toContain('/text-to-speech/voice%2F1');
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string).text).toHaveLength(2500);
    await expect(xi.speak('hi', 'v')).rejects.toMatchObject({ name: 'ElevenLabsSpeechError', status: 401, code: 'permission_denied' });
  });
});

describe('StudioVoiceService', () => {
  it('hears with OpenAI and speaks with ElevenLabs, returning an exact ArrayBuffer', async () => {
    const openai = { transcribe: vi.fn(async () => 'hi') } as unknown as OpenAIMedia;
    const eleven = { speak: vi.fn(async () => Buffer.from('abc')) } as unknown as ElevenLabsStudio;
    const voice = new StudioVoiceService(openai, eleven);
    expect(await voice.transcribe(new ArrayBuffer(1), 'audio/ogg')).toBe('hi');
    const out = await voice.synthesize('hello', 'v1');
    expect(out.mimeType).toBe('audio/mpeg');
    expect(Buffer.from(out.audio).toString()).toBe('abc');
  });

  it('explains which key is missing', async () => {
    const voice = new StudioVoiceService(null, null);
    await expect(voice.transcribe(new ArrayBuffer(1))).rejects.toThrow('OPENAI_API_KEY');
    await expect(voice.synthesize('x', 'v')).rejects.toThrow('ELEVENLABS_API_KEY');
  });
});

describe('OpenAI Decisions', () => {
  it('asks all questions in one request and keeps only well-formed answers', async () => {
    const fetchFn = fakeFetch({ json: { answers: [
      { type: 'choice', name: 'effort', choice: 'quick', confidence: 0.8, probabilities: [] },
      { type: 'predicate', name: 'live_info', probability: 0.1 },
      { type: 'refusal', name: 'memorable' },
    ] } });
    const media = new OpenAIMedia('sk-test', fetchFn, 'gpt-image-1', 'stt', 'decider-model');
    const out = await media.decide('Bob: thanks!', [{ type: 'predicate', name: 'live_info', instructions: 'x' }], 1500);
    expect(out).toEqual({ effort: { type: 'choice', choice: 'quick', confidence: 0.8 }, live_info: { type: 'predicate', probability: 0.1 } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'decider-model', input: 'Bob: thanks!', questions: [{ type: 'predicate', name: 'live_info', instructions: 'x' }] });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    await expect(new OpenAIMedia('sk', fakeFetch({ status: 403 })).decide('x', [])).rejects.toThrow('HTTP 403');
  });
});

describe('ElevenLabs speech-to-text and live-call agents', () => {
  it('transcribes with Scribe', async () => {
    const fetchFn = fakeFetch({ json: { text: ' salam ', language_code: 'fas' } });
    expect(await new ElevenLabsStudio('xi', fetchFn).transcribe(new ArrayBuffer(8), 'audio/ogg')).toBe('salam');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    const form = init?.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v1');
    expect((form.get('file') as File).name).toBe('voice.ogg');
  });

  it('voice messages fall back to ElevenLabs when OpenAI is missing or fails', async () => {
    const eleven = { transcribe: vi.fn(async () => 'from scribe') } as unknown as ElevenLabsStudio;
    expect(await new StudioVoiceService(null, eleven).transcribe(new ArrayBuffer(1))).toBe('from scribe');
    const broken = { transcribe: vi.fn(async () => { throw new Error('quota'); }) } as unknown as OpenAIMedia;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await new StudioVoiceService(broken, eleven).transcribe(new ArrayBuffer(1))).toBe('from scribe');
    warn.mockRestore();
    await expect(new StudioVoiceService(null, null).transcribe(new ArrayBuffer(1))).rejects.toThrow('ELEVENLABS_API_KEY');
  });

  it('creates the call agent with our LLM, Flash voices and per-call overrides, and explains refusals', async () => {
    const fetchFn = fakeFetch({ json: { secret_id: 's1' } }, { json: { agent_id: 'a1' } }, { json: { signed_url: 'wss://x' } }, { status: 401, json: { detail: { status: 'missing_permissions', message: 'convai_write' } } });
    const xi = new ElevenLabsStudio('xi', fetchFn);
    expect(await xi.createSecret('n', 'v')).toBe('s1');
    expect(await xi.createAgent({ name: 'HOOR calls', llmUrl: 'https://vox.example/api/studio/voice-llm', llmSecretId: 's1', maxCallSeconds: 900 })).toBe('a1');
    const body = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(body.conversation_config.agent.prompt).toMatchObject({ llm: 'custom-llm', custom_llm: { url: 'https://vox.example/api/studio/voice-llm', api_key: { secret_id: 's1' } } });
    expect(body.conversation_config.tts.model_id).toBe('eleven_flash_v2_5');
    expect(body.platform_settings.overrides.conversation_config_override).toEqual({ agent: { first_message: true, language: true }, tts: { voice_id: true } });
    expect(await xi.signedUrl('a1')).toBe('wss://x');
    expect(fetchFn.mock.calls[2][0]).toBe('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=a1');
    await expect(xi.updateAgent('a1', { name: 'n', llmUrl: 'u', llmSecretId: 's', maxCallSeconds: 1 })).rejects.toBeInstanceOf(ElevenLabsSpeechError);
  });
});


it('records returned STT/Decisions tokens and leaves audio-provider usage unavailable without estimating cost', async () => {
  const trace = new TurnTrace(true);
  const openai = new OpenAIMedia('test', fakeFetch({ json: { text: 'PRIVATE_TRANSCRIPT_CANARY', usage: { type: 'tokens', input_tokens: 9, output_tokens: 3 } } },
    { json: { answers: [{ name: 'route', type: 'predicate', probability: 0.8 }], usage: { input_tokens: 7 } } }));
  await trace.run(() => openai.transcribe(new ArrayBuffer(4)));
  await trace.run(() => openai.decide('PRIVATE_DRAFT_CANARY', [{ type: 'predicate', name: 'route', instructions: 'synthetic' }]));
  const eleven = new ElevenLabsStudio('test', fakeFetch({ body: new Uint8Array([1, 2]).buffer }));
  await trace.run(() => eleven.speak('PRIVATE_SPEECH_CANARY', 'synthetic-voice'));
  expect(trace.snapshot()?.stages.map(stage => stage.stage)).toEqual(['stt', 'decisions', 'tts']);
  expect(trace.snapshot()?.usage).toMatchObject([{ provider: 'openai', inputTokens: 9, outputTokens: 3 }, { provider: 'openai', inputTokens: 7, outputTokens: null },
    { provider: 'elevenlabs', inputTokens: null, outputTokens: null, status: 'unavailable' }]);
  for (const canary of ['PRIVATE_TRANSCRIPT_CANARY', 'PRIVATE_DRAFT_CANARY', 'PRIVATE_SPEECH_CANARY']) expect(JSON.stringify(trace.snapshot())).not.toContain(canary);
});
it('StudioVoiceService preserves the request fence through the actual speech adapter and rejects a newly stale audio buffer', async () => {
  let current = true;
  const fetcher = vi.fn<typeof fetch>(async () => ({ok:true,status:200,headers:new Headers({'content-type':'audio/mpeg'}),arrayBuffer:async () => {current = false;return new Uint8Array([1,2,3]).buffer;}} as Response));
  const service = new StudioVoiceService(null,new ElevenLabsStudio('synthetic-key',fetcher));
  await expect(service.synthesize('CURRENT_ALLOWED_TEXT','synthetic-voice',{authorizeNow:() => current})).rejects.toMatchObject({name:'ExportAuthorityError'});
  expect(fetcher).toHaveBeenCalledOnce(); expect(String(fetcher.mock.calls[0][1]?.body)).toContain('CURRENT_ALLOWED_TEXT');
  expect(String(fetcher.mock.calls[0][1]?.body)).not.toMatch(/authorizeNow|signal/);
});
