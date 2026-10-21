/**
 * S15: pins the raw-fetch OpenAI wire formats used by OpenAIMedia (avatars,
 * transcription, Studio triage decisions). OpenAIMedia does not use the openai
 * SDK, so an SDK upgrade cannot change these requests; this file proves it.
 * Every request goes to an injected fetch: no network, no real credentials.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIMedia } from '../media';
import type { DecisionQuestion } from '../../tireh/triage';

const CANARY = 'S15_OPENAI_COMPAT_PRIVATE_CANARY_7c1';
type Call = [RequestInfo | URL, RequestInit];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fetchReturning(response: () => Response) {
  return vi.fn<typeof fetch>(async () => response());
}
const firstCall = (fetchFn: ReturnType<typeof fetchReturning>) => fetchFn.mock.calls[0] as unknown as Call;

beforeEach(() => {
  // Constructor defaults read these at construction time; start from the defaults.
  vi.stubEnv('OPENAI_IMAGE_MODEL', undefined);
  vi.stubEnv('OPENAI_STT_MODEL', undefined);
  vi.stubEnv('OPENAI_DECISION_MODEL', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('media.ts transport', () => {
  it('has no openai SDK import, so SDK upgrades cannot change its wire format', () => {
    const source = readFileSync(path.resolve(__dirname, '../media.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]openai['"]/);
    expect(source).not.toMatch(/require\(['"]openai['"]\)/);
  });
});

describe('OpenAIMedia.generateAvatar', () => {
  const b64 = Buffer.from('SYNTHETIC_JPEG_BYTES').toString('base64');

  it('posts the gpt-image request and returns the decoded image', async () => {
    const fetchFn = fetchReturning(() => json({ data: [{ b64_json: b64 }] }));
    const image = await new OpenAIMedia('k', fetchFn).generateAvatar('A synthetic avatar prompt');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = firstCall(fetchFn);
    expect(String(url)).toBe('https://api.openai.com/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'gpt-image-1', prompt: 'A synthetic avatar prompt', size: '1024x1024', n: 1, output_format: 'jpeg', quality: 'medium' });
    expect(image).toEqual(Buffer.from(b64, 'base64'));
  });

  it('uses OPENAI_IMAGE_MODEL when set before construction', async () => {
    vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-x');
    const fetchFn = fetchReturning(() => json({ data: [{ b64_json: b64 }] }));
    await new OpenAIMedia('k', fetchFn).generateAvatar('prompt');
    expect(JSON.parse(String(firstCall(fetchFn)[1].body))).toMatchObject({ model: 'gpt-image-x' });
  });

  it('throws the provider message on a non-ok response', async () => {
    const fetchFn = fetchReturning(() => json({ error: { message: 'synthetic quota message' } }, 400));
    await expect(new OpenAIMedia('k', fetchFn).generateAvatar('prompt')).rejects.toThrow('OpenAI image generation failed: synthetic quota message');
  });

  it('throws when an ok response has no b64_json', async () => {
    const fetchFn = fetchReturning(() => json({ data: [{}] }));
    await expect(new OpenAIMedia('k', fetchFn).generateAvatar('prompt')).rejects.toThrow('OpenAI image generation failed: HTTP 200');
  });
});

describe('OpenAIMedia.transcribe', () => {
  const audio = new Uint8Array([1, 2, 3, 4]).buffer;

  it('posts multipart form data with exactly file and model, and trims the text', async () => {
    const fetchFn = fetchReturning(() => json({ text: '  synthetic transcript \n' }));
    expect(await new OpenAIMedia('k', fetchFn).transcribe(audio)).toBe('synthetic transcript');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = firstCall(fetchFn);
    expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    // The runtime sets the multipart boundary; a manual Content-Type would break it.
    expect(init.headers).toEqual({ Authorization: 'Bearer k' });
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(['file', 'model']);
    const file = form.get('file') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('audio/ogg');
    expect(file.name).toBe('voice.ogg');
    expect(file.size).toBe(4);
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
  });

  it('uses OPENAI_STT_MODEL when set before construction', async () => {
    vi.stubEnv('OPENAI_STT_MODEL', 'gpt-stt-x');
    const fetchFn = fetchReturning(() => json({ text: 'ok' }));
    await new OpenAIMedia('k', fetchFn).transcribe(audio);
    expect((firstCall(fetchFn)[1].body as FormData).get('model')).toBe('gpt-stt-x');
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = fetchReturning(() => json({ error: { message: 'synthetic bad audio' } }, 400));
    await expect(new OpenAIMedia('k', fetchFn).transcribe(audio)).rejects.toThrow('OpenAI transcription failed: synthetic bad audio');
  });
});

describe('OpenAIMedia.decide', () => {
  const questions: DecisionQuestion[] = [
    { type: 'predicate', name: 'addressed', instructions: 'Is the agent addressed?' },
    { type: 'choice', name: 'route', instructions: 'Which route?', choices: [{ value: 'quick' }, { value: 'thoughtful' }] },
    { type: 'score', name: 'urgency', instructions: 'How urgent?', levels: [{ label: 'low' }, { label: 'high' }] },
    { type: 'predicate', name: 'refused', instructions: 'Synthetic refused question?' },
    { type: 'predicate', name: 'broken', instructions: 'Synthetic malformed question?' },
  ];

  it('posts {model, input, questions} without prompt_cache_options (base divergence from the seam)', async () => {
    const fetchFn = fetchReturning(() => json({ answers: [] }));
    await new OpenAIMedia('k', fetchFn).decide('Synthetic chat lines', questions);
    const [url, init] = firstCall(fetchFn);
    expect(String(url)).toBe('https://api.openai.com/v1/decisions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'gpt-6-luna', input: 'Synthetic chat lines', questions });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('drops refusal and malformed answers and keeps choice probabilities', async () => {
    const fetchFn = fetchReturning(() => json({ usage: { input_tokens: 12 }, answers: [
      { name: 'addressed', type: 'predicate', probability: 0.9 },
      { name: 'route', type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'quick', probability: 0.8 }, { value: 'thoughtful', probability: 0.2 }] },
      { name: 'urgency', type: 'score', score: 0.4, confidence: 0.6 },
      { name: 'refused', type: 'refusal' },
      { name: 'broken', type: 'predicate', probability: 'high' },
    ] }));
    expect(await new OpenAIMedia('k', fetchFn).decide('Synthetic chat lines', questions)).toEqual({
      addressed: { type: 'predicate', probability: 0.9 },
      route: { type: 'choice', choice: 'quick', confidence: 0.8, probabilities: [{ value: 'quick', probability: 0.8 }, { value: 'thoughtful', probability: 0.2 }] },
      urgency: { type: 'score', score: 0.4, confidence: 0.6 },
    });
  });
});

describe('OpenAIMedia error content', () => {
  it('never puts input, prompt or audio content into errors or console output', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const fetchFn = fetchReturning(() => json({}, 500));
    const media = new OpenAIMedia('k', fetchFn);
    const audio = new TextEncoder().encode(`audio ${CANARY}`).buffer as ArrayBuffer;
    const messages: string[] = [];
    for (const run of [
      () => media.decide(`chat lines ${CANARY}`, [{ type: 'predicate', name: 'addressed', instructions: `about ${CANARY}` }]),
      () => media.generateAvatar(`avatar prompt ${CANARY}`),
      () => media.transcribe(audio),
    ]) {
      const error = await run().then(() => null, (reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      messages.push(String((error as Error).message), String((error as Error).stack));
    }
    expect(messages.filter(message => message.startsWith('OpenAI '))).toEqual([
      'OpenAI decision failed: HTTP 500', 'OpenAI image generation failed: HTTP 500', 'OpenAI transcription failed: HTTP 500',
    ]);
    expect(messages.join('\n')).not.toContain(CANARY);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(CANARY);
  });
});
