import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterLook } from '@/lib/studio/types';
import { ApiError, type AgentView } from '../../_lib/client';
import { LOOK_DEBOUNCE_MS, useLookDraft } from './useLookDraft';

const state = vi.hoisted(() => ({ setLook: vi.fn(), syncProfile: vi.fn() }));

vi.mock('../../_lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/client')>();
  return { ...actual, api: { ...actual.api, setLook: state.setLook, syncProfile: state.syncProfile } };
});

const LOOK: CharacterLook = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } };

function agent(look: Partial<CharacterLook> = {}, extra: Partial<AgentView> = {}): AgentView {
  return { id: 'fixture-agent', status: 'active', stage: 4, persona: { name: 'Nova', role: 'Designer' }, look: { ...LOOK, ...look }, ...extra } as AgentView;
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.useFakeTimers(); state.setLook.mockReset(); state.syncProfile.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const setup = (live = true, a = agent()) => {
  const onUpdate = vi.fn();
  const hook = renderHook(({ ag }) => useLookDraft(ag, onUpdate, { live }), { initialProps: { ag: a } });
  return { ...hook, onUpdate };
};

describe('useLookDraft', () => {
  it('coalesces five quick taps into one save carrying the last look, without a Telegram push', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    const { result, onUpdate } = setup();
    const hues = ['rose', 'butter', 'matcha', 'lagoon', 'lilac'] as const;
    for (const hue of hues) {
      act(() => result.current.set({ ...result.current.look, hue }));
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(state.setLook).not.toHaveBeenCalled();
    expect(result.current.look.hue).toBe('lilac');
    expect(result.current.status).toBe('saving');
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.setLook).toHaveBeenCalledWith('fixture-agent', expect.objectContaining({ hue: 'lilac', family: 'drift', species: 'cloud' }), { sync: false });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('one save at a time: a change made while a save is in flight goes next, so the server applies them in order', async () => {
    const first = deferred<{ agent: AgentView }>(), second = deferred<{ agent: AgentView }>();
    state.setLook.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, onUpdate } = setup();
    act(() => result.current.set({ ...result.current.look, species: 'cat' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    act(() => result.current.set({ ...result.current.look, species: 'owl' }));
    act(() => result.current.set({ ...result.current.look, species: 'bunny' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS * 4); });
    expect(state.setLook).toHaveBeenCalledTimes(1); // the second waits for the first
    await act(async () => { first.resolve({ agent: agent({ species: 'cat' }) }); });
    expect(state.setLook).toHaveBeenCalledTimes(2);
    expect(state.setLook).toHaveBeenLastCalledWith('fixture-agent', expect.objectContaining({ species: 'bunny' }), { sync: false });
    expect(result.current.look.species).toBe('bunny');
    expect(onUpdate).not.toHaveBeenCalled(); // no flash of the older look
    await act(async () => { second.resolve({ agent: agent({ species: 'bunny' }) }); });
    expect(result.current.look.species).toBe('bunny');
    expect(result.current.status).toBe('saved');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].look.species).toBe('bunny');
  });

  it('when the latest save fails after an earlier one landed, rolls back to that server answer and tells the parent', async () => {
    const first = deferred<{ agent: AgentView }>();
    state.setLook.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('Network down'));
    const { result, onUpdate } = setup();
    act(() => result.current.set({ ...result.current.look, species: 'cat' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    act(() => result.current.set({ ...result.current.look, species: 'owl' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    await act(async () => { first.resolve({ agent: agent({ species: 'cat' }) }); });
    expect(result.current.look.species).toBe('cat');
    expect(result.current.status).toBe('error');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].look.species).toBe('cat');
  });

  it('a rate-limited save keeps the choice and resends the latest look after retryAfter', async () => {
    state.setLook.mockRejectedValueOnce(new ApiError(429, 'Too many requests.', 4))
      .mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    const onError = vi.fn();
    const { result } = renderHook(() => useLookDraft(agent(), vi.fn(), { live: false, onError }));
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(result.current.look.hue).toBe('rose');
    expect(result.current.status).toBe('saving');
    expect(result.current.failures).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    // A tap during the hold rides along with the resend
    act(() => result.current.set({ ...result.current.look, hue: 'butter' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(state.setLook).toHaveBeenCalledTimes(2);
    expect(state.setLook).toHaveBeenLastCalledWith('fixture-agent', expect.objectContaining({ hue: 'butter' }), { sync: false });
    expect(result.current.status).toBe('saved');
  });

  it('a failed save rolls back to the server look and Retry sends the change again', async () => {
    state.setLook.mockRejectedValueOnce(new Error('Network down'));
    const onError = vi.fn();
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useLookDraft(agent(), onUpdate, { live: false, onError }));
    act(() => result.current.set({ ...result.current.look, accessory: 'beanie' }));
    expect(result.current.look.accessory).toBe('beanie');
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    expect(result.current.look.accessory).toBe('none');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network down');
    expect(result.current.failures).toBe(1);
    expect(onError).toHaveBeenCalledWith('Network down');

    state.setLook.mockImplementationOnce(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    act(() => result.current.retry());
    expect(result.current.look.accessory).toBe('beanie');
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    expect(state.setLook).toHaveBeenLastCalledWith('fixture-agent', expect.objectContaining({ accessory: 'beanie' }), { sync: false });
    expect(result.current.status).toBe('saved');
  });

  it('a live editor leaving with edits sends what is waiting, then pushes to Telegram once', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    state.syncProfile.mockResolvedValue({ agent: agent({ hue: 'rose' }, { profileSync: { status: 'pending', failed: [] } }), failed: [] });
    const { result, unmount, onUpdate } = setup(true);
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    await act(async () => { await result.current.commit(); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledWith('fixture-agent', { force: false });
    unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ profileSync: { status: 'pending', failed: [] } }));
  });

  it('unmounting mid-debounce still saves, then pushes once; no edits means no push', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    state.syncProfile.mockResolvedValue({ agent: agent(), failed: [] });
    const quiet = setup(true);
    quiet.unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(state.syncProfile).not.toHaveBeenCalled();

    const { result, unmount } = setup(true);
    act(() => result.current.set({ ...result.current.look, hair: 'curls' }));
    unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
  });

  it('a failed Telegram push is reported with Retry and stays owed to the next close', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    state.syncProfile.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue({ agent: agent({ hue: 'rose' }), failed: [] });
    const onPushError = vi.fn();
    const { result } = renderHook(() => useLookDraft(agent(), vi.fn(), { live: true, onPushError }));
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    await act(async () => { await result.current.commit(); });
    expect(state.syncProfile).toHaveBeenCalledTimes(1);
    expect(onPushError).toHaveBeenCalledWith('Network down', expect.any(Function));
    await act(async () => { await result.current.commit(); });
    expect(state.syncProfile).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.commit(); });
    expect(state.syncProfile).toHaveBeenCalledTimes(2); // nothing owed any more
  });

  it('the push error Retry works after the editor is gone', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look) }));
    state.syncProfile.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue({ agent: agent({ hue: 'rose' }), failed: [] });
    const onPushError = vi.fn();
    const onUpdate = vi.fn();
    const { result, unmount } = renderHook(() => useLookDraft(agent(), onUpdate, { live: true, onPushError }));
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onPushError).toHaveBeenCalledTimes(1);
    await act(async () => { onPushError.mock.calls[0][1](); await vi.runAllTimersAsync(); });
    expect(state.syncProfile).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ look: expect.objectContaining({ hue: 'rose' }) }));
  });

  it('drafts never push to Telegram', async () => {
    state.setLook.mockImplementation(async (_id: string, look: CharacterLook) => ({ agent: agent(look, { status: 'draft' }) }));
    const { result, unmount } = setup(false, agent({}, { status: 'draft' }));
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(state.setLook).toHaveBeenCalledTimes(1);
    expect(state.syncProfile).not.toHaveBeenCalled();
  });

  it('takes over a look changed elsewhere only while nothing is pending', async () => {
    const pending = deferred<{ agent: AgentView }>();
    state.setLook.mockReturnValueOnce(pending.promise);
    const { result, rerender } = setup();
    rerender({ ag: agent({ hue: 'butter' }) });
    expect(result.current.look.hue).toBe('butter');
    act(() => result.current.set({ ...result.current.look, hue: 'rose' }));
    rerender({ ag: agent({ hue: 'matcha' }) });
    expect(result.current.look.hue).toBe('rose');
    await act(async () => { await vi.advanceTimersByTimeAsync(LOOK_DEBOUNCE_MS); });
    await act(async () => { pending.resolve({ agent: agent({ hue: 'rose' }) }); });
    expect(result.current.look.hue).toBe('rose');
  });
});
