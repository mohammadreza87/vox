import { describe, expect, it, vi } from 'vitest';
import { avatarPrompt, ElevenLabsStudio, OpenAIMedia, StudioVoiceService } from '../media';
import { personaSpec } from './helpers';

function fakeFetch(...responses: Array<{ status?: number; json?: unknown; body?: ArrayBuffer }>) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const r = responses.shift() ?? { json: {} };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
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
    expect(JSON.parse(init!.body as string)).toEqual({ voice_description: 'warm voice', model_id: 'eleven_multilingual_ttv_v2', auto_generate_text: true });

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
    await expect(xi.speak('hi', 'v')).rejects.toThrow('HTTP 401');
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
