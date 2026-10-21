import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic, HAPTIC_THROTTLE_MS } from './haptics';

const feedback = { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() };
let now = 10_000;

beforeEach(() => {
  vi.stubGlobal('Telegram', { WebApp: { HapticFeedback: feedback } });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Object.values(feedback).forEach((f) => f.mockClear());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); now += 10_000; });

describe('haptic', () => {
  it('maps each moment to Telegram feedback', () => {
    haptic.select(); now += 200;
    haptic.success(); now += 200;
    haptic.warn(); now += 200;
    haptic.rigid(); now += 200;
    haptic.tap();
    expect(feedback.selectionChanged).toHaveBeenCalledTimes(1);
    expect(feedback.notificationOccurred.mock.calls).toEqual([['success'], ['warning']]);
    expect(feedback.impactOccurred.mock.calls).toEqual([['rigid'], ['light']]);
  });

  it(`never fires twice within ${HAPTIC_THROTTLE_MS} ms`, () => {
    haptic.tap();
    now += HAPTIC_THROTTLE_MS - 1;
    haptic.success();
    haptic.select();
    expect(feedback.impactOccurred).toHaveBeenCalledTimes(1);
    expect(feedback.notificationOccurred).not.toHaveBeenCalled();
    now += 1;
    haptic.heavy();
    expect(feedback.impactOccurred).toHaveBeenLastCalledWith('heavy');
  });

  it('is a no-op outside Telegram', () => {
    vi.unstubAllGlobals();
    expect(() => haptic.error()).not.toThrow();
  });
});
