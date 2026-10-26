/**
 * H5 (F179): the pyannoteAI shared upload cache no longer binds every caller to the first caller's AbortSignal.
 * The shared upload runs on its own signal (UPLOAD_TIMEOUT_MS); each caller races it against its own signal, so one
 * caller's abort rejects only that caller. A rejected upload is evicted. When every caller has gone, the upload is
 * still cancelled (a withdrawal keeps stopping the bytes). No network: the fetch is scripted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PYANNOTE_DEFAULT_BASE_URL, PyannoteVoiceprintProvider, raceSignal, UPLOAD_TIMEOUT_MS } from '../identity/pyannote';
import { VoiceprintProviderError } from '../identity/provider';
import { deferred } from './voiceprint-fixtures';

const KEY = 'fake-test-key-not-real';
const bytes = (text: string) => new TextEncoder().encode(text);

/** media/input waits on `gate` and honours the request signal like fetch does; jobs succeed on the first poll. */
function gatedPyannote(options: { failFirstMediaInput?: boolean } = {}) {
  const gate = deferred();
  const signals: AbortSignal[] = [];
  let mediaInputs = 0;
  let job = 0;
  const respond = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    if (url === `${PYANNOTE_DEFAULT_BASE_URL}/v1/media/input`) {
      mediaInputs++;
      if (signal) signals.push(signal);
      if (options.failFirstMediaInput && mediaInputs === 1) return new Response('nope', { status: 500 });
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        void gate.promise.then(resolve);
      });
      return respond({ url: `https://media-bucket.example/put/${mediaInputs}` });
    }
    if (url.startsWith('https://media-bucket.example/')) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response(null, { status: 200 });
    }
    if (/\/v1\/(voiceprint|identify|diarize)$/.test(url)) return respond({ jobId: `job-${++job}` });
    if (/\/v1\/jobs\//.test(url)) return respond({ status: 'succeeded', output: { voiceprint: 'OPAQUE_VP' } });
    return new Response('{}', { status: 404 });
  });
  const count = (pattern: RegExp) => fetchImpl.mock.calls.filter(([u]) => pattern.test(String(u))).length;
  return { fetch: fetchImpl as unknown as typeof fetch, gate, signals, count };
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('real network is not allowed in tests'); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pyannote shared upload cache (H5, F179)', () => {
  it('two callers with the same audio: the first aborts, the second resolves, with one upload', async () => {
    const api = gatedPyannote();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const first = new AbortController();
    const audio = bytes('SAME VOICE NOTE');
    const a = provider.voiceprint(audio, 'audio/ogg', first.signal).catch((e: unknown) => e);
    const b = provider.voiceprint(audio, 'audio/ogg', new AbortController().signal);
    await vi.waitFor(() => expect(api.count(/\/v1\/media\/input$/)).toBe(1));
    first.abort();
    expect(await a).toMatchObject({ code: 'aborted' });
    api.gate.resolve();
    expect(new TextDecoder().decode(await b)).toBe('OPAQUE_VP');
    expect(api.count(/\/v1\/media\/input$/)).toBe(1);
    expect(api.count(/media-bucket\.example\/put\//)).toBe(1);
    // The shared upload never ran on the first caller's signal.
    expect(api.signals[0]).not.toBe(first.signal);
    expect(api.signals[0].aborted).toBe(false);
  });

  it('runs the shared upload under AbortSignal.timeout(UPLOAD_TIMEOUT_MS) of 30 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const api = gatedPyannote();
    api.gate.resolve();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    await provider.voiceprint(bytes('X'), 'audio/ogg', new AbortController().signal);
    expect(UPLOAD_TIMEOUT_MS).toBe(30_000);
    expect(timeout).toHaveBeenCalledWith(UPLOAD_TIMEOUT_MS);
  });

  it('when the only caller aborts, the shared upload is cancelled and evicted; the next caller uploads afresh', async () => {
    const api = gatedPyannote();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const audio = bytes('WITHDRAWN NOTE');
    const only = new AbortController();
    const a = provider.voiceprint(audio, 'audio/ogg', only.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(api.count(/\/v1\/media\/input$/)).toBe(1));
    only.abort();
    expect(await a).toMatchObject({ code: 'aborted' });
    await vi.waitFor(() => expect(api.signals[0].aborted).toBe(true));
    // The bytes never reached storage.
    expect(api.count(/media-bucket\.example\/put\//)).toBe(0);
    api.gate.resolve();
    expect(new TextDecoder().decode(await provider.voiceprint(audio, 'audio/ogg', new AbortController().signal))).toBe('OPAQUE_VP');
    expect(api.count(/\/v1\/media\/input$/)).toBe(2);
  });

  it('a rejected shared upload is evicted: the next call with the same audio starts a new upload', async () => {
    const api = gatedPyannote({ failFirstMediaInput: true });
    api.gate.resolve();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const audio = bytes('RETRY NOTE');
    await expect(provider.voiceprint(audio, 'audio/ogg', new AbortController().signal)).rejects.toMatchObject({ code: 'http' });
    expect(new TextDecoder().decode(await provider.voiceprint(audio, 'audio/ogg', new AbortController().signal))).toBe('OPAQUE_VP');
    expect(api.count(/\/v1\/media\/input$/)).toBe(2);
  });

  it('a settled upload is reused for later callers (one upload for diarize-then-identify)', async () => {
    const api = gatedPyannote();
    api.gate.resolve();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const audio = bytes('REUSED NOTE');
    await provider.voiceprint(audio, 'audio/ogg', new AbortController().signal);
    await provider.voiceprint(audio, 'audio/ogg', new AbortController().signal);
    expect(api.count(/\/v1\/media\/input$/)).toBe(1);
  });

  it('an already aborted caller signal rejects without any fetch', async () => {
    const api = gatedPyannote();
    const provider = new PyannoteVoiceprintProvider({ apiKey: KEY, fetch: api.fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.voiceprint(bytes('Y'), 'audio/ogg', controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe('raceSignal (H5)', () => {
  it('rejects only the caller with VoiceprintProviderError(aborted) and leaves the shared promise alone', async () => {
    const shared = deferred<string>();
    const controller = new AbortController();
    const raced = raceSignal(shared.promise, controller.signal);
    controller.abort();
    const error = await raced.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceprintProviderError);
    expect(error).toMatchObject({ code: 'aborted' });
    shared.resolve('media://x');
    expect(await raceSignal(shared.promise, new AbortController().signal)).toBe('media://x');
  });

  it('passes the shared rejection through when the caller is still live', async () => {
    const shared = Promise.reject(new VoiceprintProviderError('http'));
    await expect(raceSignal(shared, new AbortController().signal)).rejects.toMatchObject({ code: 'http' });
  });
});
