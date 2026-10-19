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
