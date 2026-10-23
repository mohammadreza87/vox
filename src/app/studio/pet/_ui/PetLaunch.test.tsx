import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PetApp', () => ({ PetApp: ({ agentId }: { agentId: string }) => <p>pet {agentId}</p> }));
vi.mock('./Sleeper', () => ({ Sleeper: ({ kind }: { kind: string }) => <p>asleep {kind}</p> }));
const { PetLaunch } = await import('./PetLaunch');

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('the pet launch page (Circles S4)', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete (window as { Telegram?: unknown }).Telegram; });

  it('asks the pet API which agent the signed launch names, with the initData, then opens that pet', async () => {
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: 'signed-by-manager' } };
    const fetch = answer(200, { agentId: 'ag1' });
    vi.stubGlobal('fetch', fetch);
    render(<PetLaunch />);
    await waitFor(() => expect(screen.getByText('pet ag1')).toBeInTheDocument());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/studio/pet/launch');
    expect((init.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe('signed-by-manager');
  });

  it('unsigned is "outside", anything else "unavailable": the quiet screen, loaded lazily', async () => {
    vi.stubGlobal('fetch', answer(401, { error: 'authentication_required' }));
    const outside = render(<PetLaunch />);
    await waitFor(() => expect(screen.getByText('asleep outside')).toBeInTheDocument());
    outside.unmount();
    vi.stubGlobal('fetch', answer(404, { error: 'pet_unavailable' }));
    render(<PetLaunch />);
    await waitFor(() => expect(screen.getByText('asleep unavailable')).toBeInTheDocument());
  });
});
