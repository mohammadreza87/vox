import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe('Studio API response contracts', () => {
  it('rejects an intermediary HTML success page instead of returning a draft without an agent', async () => {
    const page = '<html>Fixture intermediary page</html>';
    fetchMock.mockResolvedValue(new Response(page, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

    await expect(api.draft({ description: 'A helpful teammate' })).rejects.toMatchObject({
      status: 200, message: expect.stringMatching(/unexpected page.*reopen the Mini App/),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/studio/agents', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Accept: 'application/json' }),
    }));
  });

  it('wraps malformed successful JSON as a useful ApiError', async () => {
    fetchMock.mockResolvedValue(new Response('{"agent":', { status: 201, headers: { 'Content-Type': 'application/json' } }));

    try {
      await api.draft({});
      expect.fail('Malformed JSON must not be accepted as a draft');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 201, message: expect.stringMatching(/unreadable data/) });
    }
  });

  it('preserves the JSON draft response and serializes the BriefStep payload', async () => {
    const brief = { description: 'A helpful teammate', traits: { warmDirect: 50, playfulSerious: 50, conciseExpansive: 40 } };
    const draft = { agent: { id: 'fixture-agent', status: 'draft' }, names: ['Fixture'] };
    fetchMock.mockResolvedValue(Response.json(draft, { status: 201 }));

    expect(await api.draft(brief)).toEqual(draft);
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ body: JSON.stringify({ brief }) });
  });

  it('requires a JSON content type even when the body happens to contain JSON', async () => {
    fetchMock.mockResolvedValue(new Response('{"agents":[]}', { headers: { 'Content-Type': 'text/plain' } }));
    await expect(api.agents()).rejects.toBeInstanceOf(ApiError);
  });

  it('returns an explicit audio Blob for speech previews', async () => {
    fetchMock.mockResolvedValue(new Response('fixture audio', { headers: { 'Content-Type': 'audio/mpeg' } }));

    const audio = await api.speak('fixture-agent', 'Hello');
    expect(audio.type).toBe('audio/mpeg');
    expect(await audio.text()).toBe('fixture audio');
    expect(fetchMock).toHaveBeenCalledWith('/api/studio/agents/fixture-agent/speak', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'audio/*' }),
    }));
  });

  it('keeps multipart call turns as JSON responses rather than opting them into audio Blob handling', async () => {
    const turn = { transcript: 'Hello', reply: 'Hi', audio: 'fixture.mp3' };
    fetchMock.mockResolvedValue(Response.json(turn));

    expect(await api.callTurn('fixture-agent', new Blob(['fixture audio'], { type: 'audio/ogg' }))).toEqual(turn);
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      body: expect.any(FormData), headers: expect.objectContaining({ Accept: 'application/json' }),
    });
  });

  it('preserves server error details for audio requests instead of returning an error Blob', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Voice previews are temporarily unavailable.' }, { status: 503 }));
    await expect(api.speak('fixture-agent', 'Hello')).rejects.toMatchObject({
      status: 503, message: 'Voice previews are temporarily unavailable.',
    });
  });

  it('handles malformed error bodies without exposing intermediary HTML or throwing a parser error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Fixture gateway failure</html>', { status: 502 }));
    await expect(api.draft({})).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });
});

describe('look and photo calls', () => {
  const agent = { agent: { id: 'fixture-agent' } };
  const sent = () => {
    const [url, init] = fetchMock.mock.lastCall!;
    return { url, method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body };
  };
  beforeEach(() => { fetchMock.mockImplementation(async () => Response.json(agent)); });

  it('sends the documented bodies, leaving server defaults to the server', async () => {
    await api.setLook('a 1', { hue: 'rose' }, { sync: false });
    expect(sent()).toEqual({ url: '/api/studio/agents/a%201/look', method: 'POST', body: { look: { hue: 'rose' }, sync: false } });
    await api.setLook('a', 'random');
    expect(sent().body).toEqual({ random: true });
    await api.generateAvatars('a', 1, { select: false });
    expect(sent()).toEqual({ url: '/api/studio/agents/a/avatars', method: 'POST', body: { count: 1, select: false } });
    await api.generateAvatars('a');
    expect(sent().body).toEqual({ count: 2 });
    await api.chooseAvatar('a', null);
    expect(sent()).toEqual({ url: '/api/studio/agents/a/avatar', method: 'PUT', body: { file: null } });
    await api.syncProfile('a', { force: false });
    expect(sent()).toEqual({ url: '/api/studio/agents/a/profile-sync', method: 'POST', body: { force: false } });
    // Retry sends no body, which the server reads as force.
    await api.syncProfile('a');
    expect(sent().body).toBeUndefined();
    await api.uploadAvatar('a', new File(['x'], 'me.png', { type: 'image/png' }));
    expect(sent().body).toBeInstanceOf(FormData);
    expect((fetchMock.mock.lastCall![1]!.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('exposes the 429 wait as ApiError.retryAfter, from the body first and the header otherwise', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Too many requests. Please try again shortly.', retryAfter: 252 }, { status: 429, headers: { 'Retry-After': '9' } }));
    await expect(api.generateAvatars('a', 1)).rejects.toMatchObject({ status: 429, retryAfter: 252, message: /Too many requests/ });
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': '9' } }));
    await expect(api.generateAvatars('a', 1)).rejects.toMatchObject({ status: 429, retryAfter: 9 });
    fetchMock.mockResolvedValueOnce(new Response('<html>busy</html>', { status: 429 }));
    const bare = await api.generateAvatars('a', 1).catch((e: ApiError) => e);
    expect(bare).toBeInstanceOf(ApiError);
    expect(bare).not.toHaveProperty('retryAfter');
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Only the creator or an admin can change the look.', retryAfter: 5 }, { status: 403 }));
    expect(await api.chooseAvatar('a', 'f.jpg').catch((e: ApiError) => e)).not.toHaveProperty('retryAfter');
  });
});
