import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStudio, startBots, registerStudioBotRuntime, stopStudioRuntime } = vi.hoisted(() => ({ getStudio: vi.fn(), startBots: vi.fn(), registerStudioBotRuntime:vi.fn(), stopStudioRuntime:vi.fn() }));
vi.mock('./lib/studio/runtime', () => ({ getStudio, registerStudioBotRuntime, stopStudioRuntime }));
vi.mock('./lib/studio/bots', () => ({ startBots }));
import { startStudioBots } from './instrumentation-node';

const state = globalThis as unknown as { __voxBots?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  delete state.__voxBots;
  vi.stubEnv('STUDIO_BOTS', '1');
  vi.stubEnv('STUDIO_MAINTENANCE', '0');
  getStudio.mockResolvedValue({ name: 'studio' });
  startBots.mockReturnValue({ stop: vi.fn() });
  stopStudioRuntime.mockResolvedValue({pending:0});
});

afterEach(() => { vi.unstubAllEnvs(); delete state.__voxBots; });

describe('Studio startup', () => {
  it.each([undefined, '', '0', 'true'])('fails startup for maintenance without polling before the disabled return: %s', bots => {
    vi.stubEnv('STUDIO_BOTS', bots);
    vi.stubEnv('STUDIO_MAINTENANCE', '1');
    return expect(startStudioBots()).rejects.toThrow('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1');
  });

  it('starts the supported polling runtime with maintenance enabled', async () => {
    vi.stubEnv('STUDIO_MAINTENANCE', '1');
    await startStudioBots();
    expect(getStudio).toHaveBeenCalledOnce();
    expect(startBots).toHaveBeenCalledOnce();
    expect(registerStudioBotRuntime).toHaveBeenCalledExactlyOnceWith(startBots.mock.results[0].value);
  });

  it('propagates initialization failure and allows a corrected startup to retry', async () => {
    getStudio.mockRejectedValueOnce(new Error('STUDIO_SECRET is required'));
    await expect(startStudioBots()).rejects.toThrow('STUDIO_SECRET');
    expect(state.__voxBots).toBe(false);
    expect(startBots).not.toHaveBeenCalled();
    expect(registerStudioBotRuntime).not.toHaveBeenCalled();
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
    expect(registerStudioBotRuntime).toHaveBeenCalledOnce();
  });

  it('propagates runner failures instead of reporting a healthy server', async () => {
    startBots.mockImplementationOnce(() => { throw new Error('runner failed'); });
    await expect(startStudioBots()).rejects.toThrow('runner failed');
    expect(state.__voxBots).toBe(false);
    expect(registerStudioBotRuntime).not.toHaveBeenCalled();
  });

  it('starts one runner and respects the disabled mode', async () => {
    await startStudioBots();
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
    vi.stubEnv('STUDIO_BOTS', '0');
    await startStudioBots();
    expect(startBots).toHaveBeenCalledOnce();
    expect(registerStudioBotRuntime).toHaveBeenCalledOnce();
  });
  it('build evaluation never loads Studio or starts/registers a runner',async()=>{
    vi.stubEnv('NEXT_PHASE','phase-production-build');await startStudioBots();
    expect(getStudio).not.toHaveBeenCalled();expect(startBots).not.toHaveBeenCalled();expect(registerStudioBotRuntime).not.toHaveBeenCalled();
  });
  it('fresh disabled polling never loads Studio or starts/registers a runner',async()=>{
    vi.stubEnv('STUDIO_BOTS','0');await startStudioBots();
    expect(getStudio).not.toHaveBeenCalled();expect(startBots).not.toHaveBeenCalled();expect(registerStudioBotRuntime).not.toHaveBeenCalled();
  });
});

describe('fatal cleanup consumes only its already imported runtime',()=>{
  it('cleanup before startup imports nothing and returns no pending work',async()=>{
    vi.resetModules();const fresh=await import('./instrumentation-node');
    await expect(fresh.stopStudioBotsAfterStartupFailure()).resolves.toEqual({pending:0});
    expect(stopStudioRuntime).not.toHaveBeenCalled();expect(getStudio).not.toHaveBeenCalled();expect(startBots).not.toHaveBeenCalled();
  });
  it('failed getStudio still leaves captured stop available without another startup',async()=>{
    vi.resetModules();const fresh=await import('./instrumentation-node');getStudio.mockRejectedValueOnce(new Error('synthetic configuration failure'));
    await expect(fresh.startStudioBots()).rejects.toThrow('synthetic configuration failure');
    stopStudioRuntime.mockResolvedValueOnce({pending:2});const cleanup=fresh.stopStudioBotsAfterStartupFailure();
    expect(stopStudioRuntime).toHaveBeenCalledOnce();await expect(cleanup).resolves.toEqual({pending:2});
    expect(getStudio).toHaveBeenCalledOnce();expect(startBots).not.toHaveBeenCalled();expect(registerStudioBotRuntime).not.toHaveBeenCalled();
  });
  it('runtime captured before bot import failure can stop without importing bots or calling getStudio again',async()=>{
    const importFailure=new Error('synthetic bot module load failure');
    vi.doMock('./lib/studio/bots',()=>{throw importFailure;});vi.resetModules();
    try{const fresh=await import('./instrumentation-node');const rejection=await fresh.startStudioBots().then(()=>undefined,error=>error);
      expect(rejection).toBeInstanceOf(Error);expect((rejection as Error&{cause?:unknown}).cause).toBe(importFailure);expect(state.__voxBots).toBe(false);
      await expect(fresh.stopStudioBotsAfterStartupFailure()).resolves.toEqual({pending:0});expect(stopStudioRuntime).toHaveBeenCalledOnce();
      expect(getStudio).not.toHaveBeenCalled();expect(startBots).not.toHaveBeenCalled();
    }finally{vi.doMock('./lib/studio/bots',()=>({startBots}));vi.resetModules();}
  });
});
