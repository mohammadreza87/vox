/** Independent ATI1 real transport oracle. All HTTP/model data is synthetic. */
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {AssistantTextTransport} from '../telegram/assistant-text-transport';
import {classifyAssistantTextResponse, prepareAssistantText, type PreparedAssistantText} from '../delivery/assistant-text-protocol';

const NOW=Date.parse('2026-10-27T12:00:00Z'),BOT=79001,OWNER=70300,OUTBOUND=99001;
const TOKEN=`${BOT}:ATI1_SYNTHETIC_TOKEN_DO_NOT_RETAIN`;
const KEY=Uint8Array.from({length:32},(_,n)=>n+1);
const metrics:Array<{case:string;posts:number;requestBytes:number;responseBytes:number;elapsedMs:number}>=[];
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
afterAll(()=>console.info('ATI1_TRANSPORT_SYNTHETIC_METRICS',JSON.stringify(metrics)));
function prepared(text='ATI1_PRIVATE_SYNTHETIC_REPLY'):PreparedAssistantText {
  return prepareAssistantText({scope:{accountId:'qa-account',personId:'qa-person',agentId:'qa-agent',space:'work',containerId:'qa-private',kind:'private'},
    binding:{botId:BOT,destinationChatId:OWNER,endpointBindingId:'qa-endpoint',credentialBindingId:'qa-credential',bindingRevision:'qa-binding'},
    source:{messageId:11,updateId:29,revision:0,occurredAt:NOW-1000,acceptedAt:NOW},
    authority:{authorityRevision:'qa-authority',grantRevision:'qa-grant',sourceFenceRevision:'qa-fence',sourceFenceSequence:0,historyEpoch:0,deletionEpoch:0,expiresAt:NOW+60000},
    generationId:'11111111-1111-4111-8111-111111111111',attemptId:'22222222-2222-4222-8222-222222222222',
    generatedText:'ATI1_PRIVATE_SYNTHETIC_GENERATED',decoratedText:text,keyId:'qa-key',evidenceKey:KEY,now:NOW,expiresAt:NOW+60000});
}
function acceptance(p:PreparedAssistantText){return {ok:true,result:{message_id:OUTBOUND,date:Math.floor(NOW/1000),chat:{id:OWNER,type:'private'},from:{id:BOT,is_bot:true},text:p.submittedText}};}
function requestBytes(options:RequestInit){const b=options.body;return typeof b==='string'?Buffer.from(b):Buffer.from(b as Uint8Array);}
const response=(p:PreparedAssistantText)=>new Response(JSON.stringify(acceptance(p)),{status:200,headers:{'Content-Type':'application/json'}});
function certainty(p:PreparedAssistantText,result:Awaited<ReturnType<AssistantTextTransport['send']>>){
  return result.kind==='response'?classifyAssistantTextResponse(p,result.evidence,result.response,KEY):{kind:'unknown'};
}

describe('ATI1 dedicated exact-byte single-fetch transport',()=>{
  const cases=['x'.repeat(4095),'x'.repeat(4096),'x'.repeat(4097),`${'x'.repeat(4095)}😀tail`,`${'x'.repeat(4094)}😀tail`,
    '\ud800','\udc00','فارسی English ۱۲۳\nخط دوم','quote" slash\\ /\r\n\0\t',`${'x'.repeat(4080)}\nhttps://synthetic.invalid/source`];
  it.each(cases.map((text,index)=>({text,index})))('wire-$index submits exactly prepared default-option bytes once',async({text,index})=>{
    const p=prepared(text),calls:Array<{url:string;options:RequestInit}>=[],start=performance.now();
    const transport=new AssistantTextTransport(async(url,options)=>{calls.push({url:String(url),options:options??{}});return response(p);},()=>NOW);
    const gate=vi.fn(()=>true),result=await transport.send({token:TOKEN,prepared:p,authorizeNow:gate});
    expect(calls).toHaveLength(1);expect(gate).toHaveBeenCalled();
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0].options).toMatchObject({method:'POST',redirect:'error',credentials:'omit',cache:'no-store'});
    expect(new Headers(calls[0].options.headers).get('content-type')).toBe('application/json');
    const wire=requestBytes(calls[0].options),expected=JSON.stringify({chat_id:OWNER,text:text.slice(0,4096)});
    expect(wire.toString('utf8')).toBe(expected);expect(Array.from(wire)).toEqual(Array.from(p.bodyBytes));
    expect(certainty(p,result)).toMatchObject({kind:'accepted',receipt:{messageId:OUTBOUND,botId:BOT,destinationChatId:OWNER,textEvidence:'matches-submitted'}});
    metrics.push({case:`wire-${index}`,posts:calls.length,requestBytes:wire.byteLength,responseBytes:Buffer.byteLength(JSON.stringify(acceptance(p))),elapsedMs:performance.now()-start});
  });

  it('invokes the final synchronous gate inside the actual HTTP call stack and sends zero requests on denial',async()=>{
    const p=prepared(),fetchFn=vi.fn(async()=>response(p)),gate=vi.fn(()=>false);
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:gate});
    expect(gate).toHaveBeenCalled();expect(fetchFn).not.toHaveBeenCalled();expect(certainty(p,result).kind).toBe('unknown');
  });

  it.each(['connect-timeout','socket-timeout','provider-body-exception'])('%s never retries a possibly accepted POST',async mode=>{
    const p=prepared(),error=new TypeError('ATI1_PRIVATE_ERROR_TOKEN_SHOULD_NOT_ESCAPE',{cause:{code:mode==='connect-timeout'?'UND_ERR_CONNECT_TIMEOUT':'UND_ERR_SOCKET'}});
    const fetchFn=vi.fn(async()=>{throw error;});const start=performance.now();
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(certainty(p,result).kind).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain(error.message);expect(JSON.stringify(result)).not.toContain(TOKEN);
    metrics.push({case:mode,posts:fetchFn.mock.calls.length,requestBytes:p.bodyBytes.byteLength,responseBytes:0,elapsedMs:performance.now()-start});
  });

  it.each([302,400,429,500])('HTTP%s remains unknown and is never followed or retried',async status=>{
    const p=prepared(),fetchFn=vi.fn(async()=>new Response(JSON.stringify({ok:false,description:'PRIVATE_PROVIDER_BODY'}),{status,headers:{Location:'https://synthetic.invalid/redirect'}}));
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(certainty(p,result).kind).toBe('unknown');
    expect((fetchFn.mock.calls[0] as unknown as [unknown,RequestInit])[1].redirect).toBe('error');
  });

  it.each(['wrong-chat','wrong-bot','missing-outbound-id','inbound-id-is-not-fallback','malformed-json','oversize-raw-response','invalid-utf8'])('%s cannot invent accepted evidence',async mode=>{
    const p=prepared(),body=acceptance(p);
    if(mode==='wrong-chat')body.result.chat.id++;
    if(mode==='wrong-bot')body.result.from.id++;
    if(mode==='missing-outbound-id'||mode==='inbound-id-is-not-fallback')delete (body.result as Partial<typeof body.result>).message_id;
    const raw=mode==='malformed-json'?'{':mode==='oversize-raw-response'?' '.repeat(65537)+JSON.stringify(body):mode==='invalid-utf8'?new Uint8Array([0xc3,0x28]):JSON.stringify(body);
    const fetchFn=vi.fn(async()=>new Response(typeof raw==='string'?raw:Uint8Array.from(raw).buffer,{status:200}));
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(certainty(p,result).kind).toBe('unknown');
  });

  it('bounds body reading by the total deadline and never treats an aborted response as unsent/retryable',async()=>{
    vi.useFakeTimers();const p=prepared();let aborted=0;
    const fetchFn=vi.fn(async(_url:Parameters<typeof fetch>[0],options?:RequestInit)=>new Response(new ReadableStream<Uint8Array>({start(controller){options?.signal?.addEventListener('abort',()=>{aborted++;controller.error(new Error('synthetic fetch body aborted'));},{once:true});}})));
    const pending=new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    await vi.advanceTimersByTimeAsync(20001);const result=await pending;
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(certainty(p,result).kind).toBe('unknown');expect(aborted).toBe(1);
  });
});


describe('ATI1 protected hard deadline independent of transport cooperation',()=>{
  it('settles a fetch promise that never honors abort without waiting forever or retrying',async()=>{
    vi.useFakeTimers();const p=prepared(),fetchFn=vi.fn(()=>new Promise<Response>(()=>undefined));
    const pending=new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    await vi.advanceTimersByTimeAsync(20001);expect((await pending).kind).toBe('unknown');expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('settles and cancels a detached response reader that never honors the fetch abort signal',async()=>{
    vi.useFakeTimers();const p=prepared();let cancelled=0;
    const fetchFn=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}})));
    const pending=new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true});
    await vi.advanceTimersByTimeAsync(20001);expect((await pending).kind).toBe('unknown');expect(fetchFn).toHaveBeenCalledTimes(1);expect(cancelled).toBe(1);
  });
});

describe('ATI1 protected final synchronous fetch deadline',()=>{
  it('never yields a microtask between a successful final authority check and fetch',async()=>{
    const p=prepared();let yielded=false;
    const fetchFn=vi.fn(async()=>{expect(yielded).toBe(false);return response(p);});
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>{queueMicrotask(()=>{yielded=true;});return true;}});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(certainty(p,result).kind).toBe('accepted');
  });
  it('refuses when dispatch expiry passes while synchronous authority readers run',async()=>{
    const p=prepared();let clock=NOW;const fetchFn=vi.fn(async()=>response(p));
    const result=await new AssistantTextTransport(fetchFn,()=>clock).send({token:TOKEN,prepared:p,authorizeNow:()=>{clock=p.initialState.expiresAt;return true;}});
    expect(fetchFn).not.toHaveBeenCalled();expect(certainty(p,result).kind).toBe('unknown');
  });
});

describe('FRO1 protected owner cancellation without retry or extra authority IO',()=>{
  it('already-aborted owner makes zero fetch calls despite an otherwise valid prepared request',async()=>{
    const p=prepared(),owner=new AbortController(),fetchFn=vi.fn(async()=>response(p));owner.abort();
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true,ownerSignal:owner.signal,ownerActive:()=>undefined});
    expect(result.kind).toBe('unknown');expect(fetchFn).not.toHaveBeenCalled();
  });
  it('pure terminal owner latch after authorization denies without changing the exact wire payload',async()=>{
    const p=prepared(),before=Array.from(p.bodyBytes),fetchFn=vi.fn(async()=>response(p));
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true,ownerActive:()=>{throw Error('synthetic_owner_lost');}});
    expect(result.kind).toBe('unknown');expect(fetchFn).not.toHaveBeenCalled();expect(Array.from(p.bodyBytes)).toEqual(before);
  });
  it('loss after the one actual fetch aborts that request and preserves unknown without a second POST',async()=>{
    const p=prepared(),owner=new AbortController();let aborted=0;
    const fetchFn=vi.fn(async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
      expect(Array.from(requestBytes(init!))).toEqual(Array.from(p.bodyBytes));
      init?.signal?.addEventListener('abort',()=>{aborted++;},{once:true});owner.abort();return response(p);
    });
    const result=await new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true,ownerSignal:owner.signal,ownerActive:()=>undefined});
    expect(fetchFn).toHaveBeenCalledTimes(1);expect(aborted).toBe(1);expect(certainty(p,result).kind).toBe('unknown');
  });
  it('retains the hard total deadline when a detached body ignores owner abort',async()=>{
    vi.useFakeTimers();const p=prepared(),owner=new AbortController();let fetchSignal:AbortSignal|undefined,cancelled=0,entered:()=>void=()=>undefined;
    const reading=new Promise<void>(resolve=>{entered=resolve;});
    const fetchFn=vi.fn(async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{fetchSignal=init?.signal??undefined;return new Response(new ReadableStream<Uint8Array>({pull(){entered();},cancel(){cancelled++;}},{highWaterMark:0}));});
    const pending=new AssistantTextTransport(fetchFn,()=>NOW).send({token:TOKEN,prepared:p,authorizeNow:()=>true,ownerSignal:owner.signal,ownerActive:()=>undefined});
    await reading;owner.abort();expect(fetchSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20001);expect((await pending).kind).toBe('unknown');expect(fetchFn).toHaveBeenCalledTimes(1);expect(cancelled).toBe(1);
  });
});
