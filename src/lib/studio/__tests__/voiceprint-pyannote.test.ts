import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PYANNOTE_DEFAULT_BASE_URL, PyannoteVoiceprintProvider } from '../identity/pyannote';
import { VoiceprintProviderError } from '../identity/provider';

const KEY = 'fake-test-key-not-real';
const SECRET_BODY = 'PROVIDER_BODY_CANARY';

interface Call { method: string; url: string; auth?: string; contentType?: string; body?: unknown }

/** Scripted pyannoteAI: jobs succeed after one 'running' poll; outputs per job path. */
function fakePyannote(outputs: { voiceprint?: unknown; identify?: unknown; diarize?: unknown }, opts: { failStatus?: number; jobStatus?: string } = {}) {
  const calls: Call[] = [];
  const polls = new Map<string, number>();
  let job = 0;
  const jobs = new Map<string, keyof typeof outputs>();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    calls.push({ method: init?.method ?? 'GET', url, auth: headers.Authorization, contentType: headers['Content-Type'], body });
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (opts.failStatus && url.endsWith('/v1/media/input')) return new Response(SECRET_BODY, { status: opts.failStatus });
    if (url === `${PYANNOTE_DEFAULT_BASE_URL}/v1/media/input`) return respond({ url: `https://media-bucket.example/put/${calls.length}` });
    if (url.startsWith('https://media-bucket.example/')) return new Response(null, { status: 200 });
    const post = /\/v1\/(voiceprint|identify|diarize)$/.exec(url);
    if (post) { const id = `job-${++job}`; jobs.set(id, post[1] as keyof typeof outputs); return respond({ jobId: id }); }
    const poll = /\/v1\/jobs\/(.+)$/.exec(url);
    if (poll) {
      const n = (polls.get(poll[1]) ?? 0) + 1;
      polls.set(poll[1], n);
      if (n === 1) return respond({ status: 'running' });
      if (opts.jobStatus) return respond({ status: opts.jobStatus, error: SECRET_BODY });
      return respond({ status: 'succeeded', output: outputs[jobs.get(poll[1])!] });
    }
    return respond({ error: SECRET_BODY }, 404);
  });
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

const signal = () => new AbortController().signal;
const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('real network is not allowed in tests'); })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('PyannoteVoiceprintProvider', () => {
  it('voiceprint: media/input, PUT, POST voiceprint, then job polling; Bearer on API calls only and model precision-2', async () => {
    const api = fakePyannote({ voiceprint: { voiceprint: 'OPAQUE_VOICEPRINT_STRING' } });
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    expect(provider.id).toBe('pyannoteai');
    expect(provider.modelVersion).toBe('pyannoteai:precision-2');
    const template = await provider.voiceprint(bytes('AUDIO'), 'audio/webm', signal());
    expect(new TextDecoder().decode(template)).toBe('OPAQUE_VOICEPRINT_STRING');
    expect(api.calls.map(c => `${c.method} ${c.url.replace(/\/put\/\d+$/, '/put/*')}`)).toEqual([
      `POST ${PYANNOTE_DEFAULT_BASE_URL}/v1/media/input`, 'PUT https://media-bucket.example/put/*', `POST ${PYANNOTE_DEFAULT_BASE_URL}/v1/voiceprint`,
      `GET ${PYANNOTE_DEFAULT_BASE_URL}/v1/jobs/job-1`, `GET ${PYANNOTE_DEFAULT_BASE_URL}/v1/jobs/job-1`,
    ]);
    for (const c of api.calls.filter(c => c.url.startsWith(PYANNOTE_DEFAULT_BASE_URL))) expect(c.auth).toBe(`Bearer ${KEY}`);
    const put = api.calls.find(c => c.method === 'PUT')!;
    expect(put.auth).toBeUndefined();
    expect(put.contentType).toBe('application/octet-stream');
    expect((api.calls[0].body as { url: string }).url).toMatch(/^media:\/\/vox-vp\/[0-9a-f-]{36}$/);
    expect(api.calls[2].body).toEqual({ url: (api.calls[0].body as { url: string }).url, model: 'precision-2' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('identify and diarize on the same bytes share one upload; labels are the opaque ids with exclusive matching', async () => {
    const api = fakePyannote({
      identify: { voiceprints: [{ speaker: 'SPEAKER_00', match: 'owner', confidence: { owner: 87, 'echo-0': 12 } }] },
      diarize: { diarization: [{ speaker: 'SPEAKER_00', start: 0, end: 2 }, { speaker: 'SPEAKER_00', start: 1.5, end: 4.25 }] },
    });
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const audio = bytes('VOICE NOTE');
    const [identified, measured] = await Promise.all([
      provider.identify(audio, [{ id: 'owner', template: bytes('VP_OWNER') }, { id: 'echo-0', template: bytes('VP_ECHO') }], signal()),
      provider.speechActivity().measure(audio, 'audio/ogg', signal()),
    ]);
    expect(identified).toEqual({ candidateId: 'owner', score: 0.87 });
    expect(measured).toEqual({ netSpeechMs: 4250, speakers: 1 });
    expect(api.calls.filter(c => c.url.endsWith('/v1/media/input'))).toHaveLength(1);
    expect(api.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    const body = api.calls.find(c => c.url.endsWith('/v1/identify'))!.body as Record<string, unknown>;
    expect(body).toEqual({ url: expect.stringMatching(/^media:\/\/vox-vp\//), model: 'precision-2',
      voiceprints: [{ label: 'owner', voiceprint: 'VP_OWNER' }, { label: 'echo-0', voiceprint: 'VP_ECHO' }], matching: { exclusive: true, threshold: 0 } });
    expect((api.calls.find(c => c.url.endsWith('/v1/diarize'))!.body as Record<string, unknown>).model).toBe('precision-2');
  });

  it('normalises confidence 0..100 to [0,1] and returns score 0 without speakers', async () => {
    const high = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({ identify: { voiceprints: [{ speaker: 'S', confidence: { owner: 140 } }] } }).fetch });
    expect(await high.identify(bytes('a'), [{ id: 'owner', template: bytes('t') }], signal())).toEqual({ candidateId: 'owner', score: 1 });
    const none = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({ identify: { voiceprints: [] } }).fetch });
    expect(await none.identify(bytes('b'), [{ id: 'owner', template: bytes('t') }], signal())).toEqual({ score: 0 });
  });

  it('two diarized speakers throw mixed_speakers; candidate counts outside 1..50 throw bad_response', async () => {
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({ identify: { voiceprints: [
      { speaker: 'SPEAKER_00', confidence: { owner: 90 } }, { speaker: 'SPEAKER_01', confidence: { owner: 20 } }] } }).fetch });
    await expect(provider.identify(bytes('c'), [{ id: 'owner', template: bytes('t') }], signal())).rejects.toMatchObject({ code: 'mixed_speakers' });
    await expect(provider.identify(bytes('c'), [], signal())).rejects.toMatchObject({ code: 'bad_response' });
    const many = Array.from({ length: 51 }, (_, n) => ({ id: `echo-${n}`, template: bytes('t') }));
    await expect(provider.identify(bytes('c'), many, signal())).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('rejects a non-https or non-pyannote base URL at construction and accepts an EU-style subdomain', () => {
    for (const baseUrl of ['http://api.pyannote.ai', 'https://api.pyannote.ai.evil.example', 'https://evil.example', 'https://pyannote.ai.example', 'not a url']) {
      expect(() => new PyannoteVoiceprintProvider({ apiKey: KEY, baseUrl, fetch: vi.fn() as unknown as typeof fetch })).toThrow('PYANNOTE_BASE_URL');
    }
    expect(() => new PyannoteVoiceprintProvider({ apiKey: KEY, baseUrl: 'https://eu.api.pyannote.ai', fetch: vi.fn() as unknown as typeof fetch })).not.toThrow();
    expect(() => new PyannoteVoiceprintProvider({ apiKey: ' ', fetch: vi.fn() as unknown as typeof fetch })).toThrow();
  });

  it('error messages are codes only and never contain a response body', async () => {
    const http = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({}, { failStatus: 500 }).fetch });
    const error = await http.voiceprint(bytes('d'), 'audio/webm', signal()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceprintProviderError);
    expect(error).toMatchObject({ code: 'http', message: 'http' });
    const failed = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({}, { jobStatus: 'failed' }).fetch });
    const jobError = await failed.voiceprint(bytes('e'), 'audio/webm', signal()).catch((e: unknown) => e);
    expect(jobError).toMatchObject({ code: 'job_failed', message: 'job_failed' });
    const bad = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: fakePyannote({ voiceprint: { voiceprint: 'x'.repeat(20_001) } }).fetch });
    expect(await bad.voiceprint(bytes('f'), 'audio/webm', signal()).catch((e: unknown) => e)).toMatchObject({ code: 'bad_response' });
    for (const e of [error, jobError]) expect(String((e as Error).message) + String((e as Error).stack)).not.toContain(SECRET_BODY);
    const controller = new AbortController();
    controller.abort();
    expect(await http.voiceprint(bytes('g'), 'audio/webm', controller.signal).catch((e: unknown) => e)).toMatchObject({ code: 'aborted' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
