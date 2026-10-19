import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStudio, startBots } = vi.hoisted(() => ({ getStudio: vi.fn(), startBots: vi.fn() }));
vi.mock('./lib/studio/runtime', () => ({ getStudio }));
vi.mock('./lib/studio/bots', () => ({ startBots }));
import { startStudioBots } from './instrumentation-node';

const state = globalThis as unknown as { __voxBots?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  delete state.__voxBots;
  vi.stubEnv('STUDIO_BOTS', '1');
  getStudio.mockResolvedValue({ name: 'studio' });
  startBots.mockReturnValue({ stop: vi.fn() });
});

afterEach(() => { vi.unstubAllEnvs(); delete state.__voxBots; });

describe('Studio startup', () => {
  it('propagates initialization failure and allows a corrected startup to retry', async () => {
    getStudio.mockRejectedValueOnce(new Error('STUDIO_SECRET is required'));
    await expect(startStudioBots()).rejects.toThrow('STUDIO_SECRET');
    expect(state.__voxBots).toBe(false);
    expect(startBots).not.toHaveBeenCalled();
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
  });

  it('propagates runner failures instead of reporting a healthy server', async () => {
    startBots.mockImplementationOnce(() => { throw new Error('runner failed'); });
    await expect(startStudioBots()).rejects.toThrow('runner failed');
    expect(state.__voxBots).toBe(false);
  });

  it('starts one runner and respects the disabled mode', async () => {
    await startStudioBots();
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
    vi.stubEnv('STUDIO_BOTS', '0');
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
  });
});
