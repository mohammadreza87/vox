import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyDataResponse } from '@/lib/studio/my-data-contract';
import { MyDataApp } from './MyDataApp';

const DATA: MyDataResponse = {
  petCare: [{ agentId: 'ag1', userId: 1 } as MyDataResponse['petCare'][number]],
  agentChoices: [{ agentId: 'ag1', choice: 'joined' } as NonNullable<MyDataResponse['agentChoices']>[number]],
  notes: [{ copyId: '1-AAAAAAAAAAAA', noteId: 'n1', text: 'Tea with cardamom', origin: 'group', agentIds: ['ag1'], groupTitle: 'HOOR family', author: 'you', savedAt: '', expiresAt: '' }],
  agentNames: { ag1: 'Mochi' },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let bridge: { initData: string; initDataUnsafe: { user: { language_code?: string } }; ready: () => void; expand: () => void; showConfirm: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  bridge = { initData: 'SIGNED_BY_VOXXBOT', initDataUnsafe: { user: { language_code: 'en' } }, ready: vi.fn(), expand: vi.fn(), showConfirm: vi.fn((_m: string, cb: (ok: boolean) => void) => cb(true)) };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: bridge };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method ?? 'GET') === 'GET' ? json(DATA) : json({}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as { Telegram?: unknown }).Telegram; });

describe('My data page', () => {
  it('shows the person’s pets, choices and notes, sending the VoxxBot initData', async () => {
    render(<MyDataApp />);
    expect(await screen.findByText('Tea with cardamom')).toBeInTheDocument();
    expect(screen.getAllByText('Mochi').length).toBeGreaterThan(0);
    expect(screen.getByText('Joined')).toBeInTheDocument();
    expect(screen.getByText('from HOOR family')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/studio/my-data');
    expect((init.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe('SIGNED_BY_VOXXBOT');
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
  });

  it('speaks Persian, right to left', async () => {
    bridge.initDataUnsafe.user.language_code = 'fa';
    render(<MyDataApp />);
    expect(await screen.findByRole('heading', { name: 'داده‌های من' })).toBeInTheDocument();
    await screen.findByText('Tea with cardamom');
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'همه را فراموش کن' })).toBeInTheDocument();
  });

  it('erasing a note asks first, then deletes only that copy', async () => {
    bridge.showConfirm.mockImplementationOnce((_m: string, cb: (ok: boolean) => void) => cb(false));
    render(<MyDataApp />);
    await screen.findByText('Tea with cardamom');
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    await waitFor(() => expect(bridge.showConfirm).toHaveBeenCalledWith('Erase your copy of this note? Everyone else keeps theirs.', expect.any(Function)));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => i?.method === 'DELETE' && u === '/api/studio/my-data/notes/1-AAAAAAAAAAAA')).toBe(true));
  });

  it('Forget everything confirms, posts an explicit confirm and reports what was erased', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST' ? json({ erased: 2, notesErased: 1 })
      : json(url === '/api/studio/my-data' && fetchMock.mock.calls.length > 1 ? { petCare: [], agentNames: {} } : DATA));
    render(<MyDataApp />);
    await screen.findByText('Tea with cardamom');
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    expect(await screen.findByText('Done. Erased pet care for 2 agents, 1 note.')).toBeInTheDocument();
    expect(bridge.showConfirm.mock.calls[0][0]).toContain('cannot be undone');
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(post[0]).toBe('/api/studio/my-data/forget');
    expect(JSON.parse(post[1].body as string)).toEqual({ confirm: true });
  });

  it('a refused session asks to reopen from Vox; outside Telegram it never calls the server', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'authentication_required' }, 401));
    const { unmount } = render(<MyDataApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This page opens only from Vox');
    unmount();
    fetchMock.mockClear();
    bridge.initData = '';
    render(<MyDataApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This page opens only from Vox');
    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
