/** Protected actual register boundary; real process exit remains a built-Next gate. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const node=vi.hoisted(()=>({start:vi.fn(),stop:vi.fn(),imports:0,importFailure:undefined as Error|undefined}));
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();node.imports=0;node.importFailure=undefined;
  node.start.mockReset().mockResolvedValue(undefined);node.stop.mockReset().mockResolvedValue({pending:0});
  vi.stubEnv('NEXT_RUNTIME','nodejs');vi.stubEnv('NEXT_PHASE',undefined);vi.stubEnv('NODE_ENV','production');vi.stubEnv('STUDIO_BOTS','1');
  vi.doMock('./instrumentation-node',()=>{node.imports++;if(node.importFailure)throw node.importFailure;return{startStudioBots:node.start,stopStudioBotsAfterStartupFailure:node.stop};});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const load=()=>import('./instrumentation');

function terminalProbe(){
  const events:string[]=[],sentinel=new Error('TEST_ONLY_PROCESS_EXIT_SENTINEL');
  let fire:(()=>void)|undefined;
  const timer={unref:vi.fn(),hasRef:()=>true};
  const originalSet=globalThis.setTimeout.bind(globalThis),originalClear=globalThis.clearTimeout.bind(globalThis);
  vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:TimerHandler,delay?:number,...args:unknown[])=>{
    if(delay!==5000)return originalSet(handler,delay,...args);
    if(typeof handler!=='function')throw Error('deadline_callback_required');
    events.push('timer:5000');fire=()=>handler();return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout);
  vi.spyOn(globalThis,'clearTimeout').mockImplementation(((value:ReturnType<typeof setTimeout>)=>{
    if(value===timer as unknown as ReturnType<typeof setTimeout>){events.push('clear');return;}originalClear(value);
  }) as typeof globalThis.clearTimeout);
  const exit=vi.spyOn(process,'exit').mockImplementation((code)=>{events.push(`exit:${code}`);throw sentinel;});
  const diagnostic=vi.spyOn(console,'error').mockImplementation(()=>{events.push('diagnostic');});
  return{events,sentinel,timer,exit,diagnostic,fire:()=>{if(!fire)throw Error('deadline_not_armed');fire();}};
}
function expectTerminal(probe:ReturnType<typeof terminalProbe>){
  expect(probe.events[0]).toBe('timer:5000');expect(probe.timer.unref).not.toHaveBeenCalled();
  expect(probe.events.slice(-2)).toEqual(['clear','exit:1']);expect(probe.exit).toHaveBeenCalledWith(1);
  expect(probe.diagnostic).toHaveBeenCalledExactlyOnceWith('[studio] fatal production polling startup failure');
}

describe('actual production polling startup terminal boundary',()=>{
  it.each(['configuration','ownership','runner'])('%s failure drains only the loaded helper then explicitly exits nonzero',async category=>{
    const probe=terminalProbe(),secret=new Error(`SYNTHETIC_${category}_CREDENTIAL_MUST_NOT_BE_LOGGED`);
    node.start.mockRejectedValueOnce(secret);node.stop.mockImplementationOnce(()=>{probe.events.push('cleanup');return Promise.resolve({pending:2});});
    const {register}=await load();await expect(register()).rejects.toBe(probe.sentinel);
    expect(probe.events).toEqual(['timer:5000','diagnostic','cleanup','clear','exit:1']);expectTerminal(probe);
    expect(node.stop).toHaveBeenCalledOnce();expect(JSON.stringify(probe.diagnostic.mock.calls)).not.toContain(secret.message);
  });
  it('helper import failure still arms the deadline and exits without attempting a fresh cleanup/bootstrap import',async()=>{
    const probe=terminalProbe();node.importFailure=new Error('SYNTHETIC_IMPORT_FAILURE_MUST_NOT_BE_LOGGED');
    const {register}=await load();await expect(register()).rejects.toBe(probe.sentinel);
    expect(node.imports).toBe(1);expect(node.start).not.toHaveBeenCalled();expect(node.stop).not.toHaveBeenCalled();expectTerminal(probe);
  });
  it.each(['reject','throw'])('cleanup %s cannot bypass explicit terminal exit',async kind=>{
    const probe=terminalProbe();node.start.mockRejectedValueOnce(new Error('SYNTHETIC_BOOTSTRAP_FAILURE'));
    node.stop.mockImplementationOnce(()=>{probe.events.push('cleanup');if(kind==='throw')throw Error('SYNTHETIC_CLEANUP_SECRET');return Promise.reject(Error('SYNTHETIC_CLEANUP_SECRET'));});
    const {register}=await load();await expect(register()).rejects.toBe(probe.sentinel);expectTerminal(probe);expect(node.stop).toHaveBeenCalledOnce();
    expect(JSON.stringify(probe.diagnostic.mock.calls)).not.toContain('SYNTHETIC_CLEANUP_SECRET');
  });
  it('a throwing diagnostic cannot skip cleanup or terminal exit',async()=>{
    const probe=terminalProbe();node.start.mockRejectedValueOnce(new Error('SYNTHETIC_START_FAILURE'));
    probe.diagnostic.mockImplementationOnce(()=>{probe.events.push('diagnostic');throw Error('SYNTHETIC_LOGGER_FAILURE');});
    node.stop.mockImplementationOnce(()=>{probe.events.push('cleanup');return Promise.resolve({pending:0});});
    const {register}=await load();await expect(register()).rejects.toBe(probe.sentinel);
    expect(probe.events).toEqual(['timer:5000','diagnostic','cleanup','clear','exit:1']);expectTerminal(probe);expect(node.stop).toHaveBeenCalledOnce();
  });
  it('a never-settling cleanup remains under the referenced five-second exit backstop',async()=>{
    const probe=terminalProbe();let enter:()=>void=()=>undefined,release:(value:{pending:number})=>void=()=>undefined;
    const entered=new Promise<void>(resolve=>{enter=resolve;}),held=new Promise<{pending:number}>(resolve=>{release=resolve;});
    node.start.mockRejectedValueOnce(new Error('SYNTHETIC_START_FAILURE'));node.stop.mockImplementationOnce(()=>{probe.events.push('cleanup');enter();return held;});
    const {register}=await load();
    // Register the rejection handler before firing the mocked terminating call.
    const done=register().then(()=>({returned:true,error:undefined}),error=>({returned:false,error}));
    await entered;expect(probe.events).toEqual(['timer:5000','diagnostic','cleanup']);expect(probe.timer.unref).not.toHaveBeenCalled();
    expect(()=>probe.fire()).toThrow(probe.sentinel);expect(probe.exit).toHaveBeenCalledExactlyOnceWith(1);
    // The real process is now gone. Release only to dispose this test's mock
    // continuation; finally must also terminate if cleanup ever settles.
    release({pending:1});const result=await done;expect(result.returned).toBe(false);expect(result.error).toBe(probe.sentinel);
    expect(probe.events.slice(-2)).toEqual(['clear','exit:1']);expect(node.stop).toHaveBeenCalledOnce();
  });
  it('fatal scope is captured before helper startup mutates environment flags',async()=>{
    const probe=terminalProbe();node.start.mockImplementationOnce(async()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('STUDIO_BOTS','0');throw Error('SYNTHETIC_START_FAILURE');});
    const {register}=await load();await expect(register()).rejects.toBe(probe.sentinel);expectTerminal(probe);
  });
  it('successful production startup does not schedule cleanup, log failure or terminate',async()=>{
    const probe=terminalProbe(),{register}=await load();await register();
    expect(node.start).toHaveBeenCalledOnce();expect(node.stop).not.toHaveBeenCalled();expect(probe.events).toEqual([]);expect(probe.exit).not.toHaveBeenCalled();
  });
});

describe('unchanged build and direct nonfatal startup scope',()=>{
  it.each(['edge',''])('non-Node runtime %s never imports the Node helper or installs a fatal timer',async runtime=>{
    const probe=terminalProbe();vi.stubEnv('NEXT_RUNTIME',runtime);node.importFailure=Error('unexpected Node helper import');
    const {register}=await load();await register();expect(node.imports).toBe(0);expect(probe.events).toEqual([]);expect(node.start).not.toHaveBeenCalled();
  });
  it('build phase never imports a helper, constructs resources or terminates',async()=>{
    const probe=terminalProbe();vi.stubEnv('NEXT_PHASE','phase-production-build');node.importFailure=Error('unexpected build import');
    const {register}=await load();await register();expect(node.imports).toBe(0);expect(probe.events).toEqual([]);expect(node.start).not.toHaveBeenCalled();
  });
  it('disabled polling keeps the helper validation/no-op without a fatal exit',async()=>{
    const probe=terminalProbe();vi.stubEnv('STUDIO_BOTS','0');const {register}=await load();await register();
    expect(node.start).toHaveBeenCalledOnce();expect(node.stop).not.toHaveBeenCalled();expect(probe.events).toEqual([]);
  });
  it('disabled invalid-maintenance rejection propagates unchanged without broadening fatal scope',async()=>{
    const probe=terminalProbe(),original=Error('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1');vi.stubEnv('STUDIO_BOTS','0');node.start.mockRejectedValueOnce(original);
    const {register}=await load();await expect(register()).rejects.toBe(original);expect(node.stop).not.toHaveBeenCalled();expect(probe.events).toEqual([]);
  });
  it('nonproduction direct startup failure remains a rejection/retry contract',async()=>{
    const probe=terminalProbe(),original=Error('SYNTHETIC_DEVELOPMENT_FAILURE');vi.stubEnv('NODE_ENV','development');node.start.mockRejectedValueOnce(original);
    const {register}=await load();await expect(register()).rejects.toBe(original);expect(node.stop).not.toHaveBeenCalled();expect(probe.events).toEqual([]);
  });
});
