import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from './client';
import { nextProfileRead, useProfileSync } from './useProfileSync';

const state = vi.hoisted(() => ({ agent: vi.fn() }));
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, api: { ...actual.api, agent: state.agent } };
});

function agent(sync?: AgentView['profileSync'], overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'fixture-agent', status: 'active', stage: 4,
    persona: { name: 'Nova' },
    look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
    profileSync: sync,
    ...overrides,
  } as AgentView;
}

const pending = { status: 'pending' as const, failed: [] };
const synced = { status: 'synced' as const, failed: [] };
const failedName = { status: 'error' as const, failed: ['name'] };

/** Drives the hook like a screen would: every update re-renders with the new agent. */
function mount(initial: AgentView) {
  const updates: AgentView[] = [];
  const view = renderHook(({ a }) => useProfileSync(a, (next) => { updates.push(next); view.rerender({ a: next }); }), { initialProps: { a: initial } });
  return { updates, view };
}

beforeEach(() => { vi.useFakeTimers(); state.agent.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('useProfileSync', () => {
  it('polls every 3 s while pending and stops once synced', async () => {
    state.agent.mockResolvedValueOnce({ agent: agent(pending) }).mockResolvedValueOnce({ agent: agent(synced) });
    const { updates, view } = mount(agent(pending));
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(state.agent).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.profileSync?.status).toBe('synced');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('waits for retryAt after an error, then backs off when the server gives no time', async () => {
    const retryAt = new Date(Date.now() + 20_000).toISOString();
    state.agent.mockResolvedValue({ agent: agent(failedName) });
    const { view } = mount(agent({ ...failedName, retryAt }));
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
    expect(state.agent).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    // No retryAt now: 12 s (one error seen), then 24 s
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(23_000); });
    expect(state.agent).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(state.agent).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it('never polls a synced, draft or receipt-less agent', async () => {
    const a = mount(agent(synced));
    const b = mount(agent(pending, { status: 'draft' }));
    const c = mount(agent(undefined));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state.agent).not.toHaveBeenCalled();
    a.view.unmount(); b.view.unmount(); c.view.unmount();
  });

  it('drops a read that started before the agent changed locally', async () => {
    let land!: (v: { agent: AgentView }) => void;
    state.agent.mockReturnValueOnce(new Promise((r) => { land = r; })).mockResolvedValue({ agent: agent(synced) });
    const { updates, view } = mount(agent(pending));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    const chosen = agent(pending, { look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true }, avatar: 'av-new.jpg' } });
    view.rerender({ a: chosen });
    await act(async () => { land({ agent: agent(pending) }); });
    expect(updates).toHaveLength(0);
    view.unmount();
  });

  it('shares one read between two screens watching the same agent', async () => {
    state.agent.mockResolvedValue({ agent: agent(pending) });
    const a = mount(agent(pending));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const b = mount(agent(pending));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // b's tick reuses a's 1 s-old read
    expect(state.agent).toHaveBeenCalledTimes(1);
    expect(b.updates).toHaveLength(1);
    a.view.unmount(); b.view.unmount();
  });

  it('rereads when the Mini App comes back to the foreground', async () => {
    const handlers: Record<string, () => void> = {};
    vi.stubGlobal('Telegram', { WebApp: { onEvent: (e: string, cb: () => void) => { handlers[e] = cb; }, offEvent: vi.fn() } });
    state.agent.mockResolvedValue({ agent: agent(synced) });
    const { updates, view } = mount(agent({ ...failedName, retryAt: new Date(Date.now() + 600_000).toISOString() }));
    await act(async () => { handlers.activated(); });
    expect(state.agent).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.profileSync?.status).toBe('synced');
    view.unmount();
    vi.unstubAllGlobals();
  });
});

describe('nextProfileRead', () => {
  it('maps status to a wait', () => {
    const now = Date.parse('2026-10-20T10:00:00Z');
    expect(nextProfileRead(undefined, 0, now)).toBeNull();
    expect(nextProfileRead(synced, 0, now)).toBeNull();
    expect(nextProfileRead(pending, 0, now)).toBe(3000);
    expect(nextProfileRead({ ...failedName, retryAt: '2026-10-20T10:01:00Z' }, 0, now)).toBe(60_000);
    expect(nextProfileRead({ ...failedName, retryAt: '2026-10-20T09:00:00Z' }, 0, now)).toBe(3000);
    expect(nextProfileRead(failedName, 0, now)).toBe(6000);
    expect(nextProfileRead(failedName, 9, now)).toBe(60_000);
  });
});
