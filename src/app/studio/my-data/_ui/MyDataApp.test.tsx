import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
beforeEach(() => {
  bridge = { initData: 'SIGNED_BY_VOXXBOT', initDataUnsafe: { user: { language_code: 'en' } }, ready: vi.fn(), expand: vi.fn(), showConfirm: vi.fn((_m: string, cb: (ok: boolean) => void) => cb(true)) };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: bridge };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method ?? 'GET') === 'GET' ? json(DATA) : json({}));
  // Keep existing endpoint assertions scoped to the existing My data API.
  // The independent ER1 card's default-off availability read has its own response.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/studio/memory-account' && (init?.method ?? 'GET') === 'GET') return Promise.resolve(json({ error: 'memory_account_unavailable' }, 503));
    if (url === '/api/studio/my-data' || url.startsWith('/api/studio/my-data/')) return fetchMock(url, init);
    throw new Error('Unexpected My data fixture route');
  });
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
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected authenticated My data request options');
    expect((init.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe('SIGNED_BY_VOXXBOT');
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
  });

  it('speaks Persian, right to left', async () => {
    bridge.initDataUnsafe.user.language_code = 'fa';
    render(<MyDataApp />);
    expect(await screen.findByRole('heading', { name: 'داده‌های من' })).toBeInTheDocument();
    await screen.findByText('Tea with cardamom');
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'پاک کردن مراقبت حیوانک‌ها، یادداشت‌های گروه و برنامه‌های وصل‌شده' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Erase pet care, group notes and connected apps' }));
    expect(await screen.findByText('Done. Erased pet care for 2 agents, 1 note.')).toBeInTheDocument();
    expect(bridge.showConfirm.mock.calls[0][0]).toContain('cannot be undone');
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(post[0]).toBe('/api/studio/my-data/forget');
    expect(post[1]).toBeDefined();
    if (!post[1]) throw new Error('Expected explicit erase POST request options');
    expect(JSON.parse(post[1].body as string)).toEqual({ confirm: true });
  });

  it('lists their connected apps with the agent and space, and reports connections erased and pending', async () => {
    const apps = { ...DATA, connections: [{ space: 'work', connections: [{ id: 'c1', providerId: 'remote_mcp', agentId: 'ag1', displayLabel: 'My server', lifecycle: 'connected', health: 'healthy', createdAt: 1, updatedAt: 1 }],
      providerAccounts: [], grants: [], operations: [], approvals: [], payloads: [], workflows: [], occurrences: [], subscriptions: [], audits: [] }] } as MyDataResponse;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ erased: 1, connectionsErased: 1, connectionsPending: 2 }) : json(apps));
    render(<MyDataApp />);
    expect(await screen.findByText('My server')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Connected apps' })).toHaveTextContent('Mochi · Work');
    expect(bridge.showConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Erase pet care, group notes and connected apps' }));
    expect(bridge.showConfirm.mock.calls[0][0]).toContain('connected apps');
    expect(await screen.findByText('Done. Erased pet care for 1 agent, 1 connected app. 2 more connected apps are stopped and will be gone shortly.')).toBeInTheDocument();
  });

  it('never lists a stopped or just-erased (revoked) app as connected; it stays in the JSON export', async () => {
    const row = (id: string, displayLabel: string, lifecycle: string) => ({ id, providerId: 'gmail', agentId: 'ag1', displayLabel, lifecycle, health: 'healthy', createdAt: 1, updatedAt: 1 });
    const rest = { providerAccounts: [], grants: [], operations: [], approvals: [], payloads: [], workflows: [], occurrences: [], subscriptions: [], audits: [] };
    const before = { ...DATA, connections: [{ space: 'personal', connections: [row('c1', 'Live Gmail', 'connected'), row('c2', 'Stopped Gmail', 'revoked')], ...rest }] } as MyDataResponse;
    // after Forget: the broker could not confirm, so the row is revoked and waiting to be purged
    const after = { ...DATA, connections: [{ space: 'personal', connections: [row('c1', 'Live Gmail', 'revoked')], ...rest }] } as MyDataResponse;
    let forgotten = false;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { forgotten = true; return json({ erased: 1, connectionsPending: 1 }); }
      return json(forgotten ? after : before);
    });
    const { container } = render(<MyDataApp />);
    expect(await screen.findByText('Live Gmail')).toBeInTheDocument();
    const apps = screen.getByRole('region', { name: 'Connected apps' });
    expect(apps).not.toHaveTextContent('Stopped Gmail');
    expect(container.querySelector('pre')!.textContent).toContain('Stopped Gmail');
    fireEvent.click(screen.getByRole('button', { name: 'Erase pet care, group notes and connected apps' }));
    expect(await screen.findByText(/1 more connected app is stopped and will be gone shortly/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Connected apps' })).toBeNull());
  });

  it('says when connected apps could not be read, and shows no section when there are none', async () => {
    fetchMock.mockImplementation(async () => json({ ...DATA, connectionsUnavailable: true }));
    const { unmount } = render(<MyDataApp />);
    expect(await screen.findByText('Your connected apps can’t be shown right now. Try again later.')).toBeInTheDocument();
    unmount();
    fetchMock.mockImplementation(async () => json(DATA));
    render(<MyDataApp />);
    await screen.findByText('Tea with cardamom');
    expect(screen.queryByRole('region', { name: 'Connected apps' })).toBeNull();
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
