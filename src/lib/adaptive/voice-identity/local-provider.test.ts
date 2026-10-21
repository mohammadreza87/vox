import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalVoiceIdentityProvider, LOCAL_VOICE_MODEL_DIGEST, LOCAL_VOICE_PROVIDER_ID, LOCAL_VOICE_PROVIDER_VERSION } from './local-provider';
import { AdaptiveError } from '../persistence/service';
const dirs:string[]=[];const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))));dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
const ready={protocolVersion:1,providerId:LOCAL_VOICE_PROVIDER_ID,providerVersion:LOCAL_VOICE_PROVIDER_VERSION,modelDigest:LOCAL_VOICE_MODEL_DIGEST,encoderReady:true,inspectionQualified:true,matchingQualified:true,reason:'ready'};
async function worker(handle:(path:string,body:unknown)=>unknown){
  const dir=mkdtempSync(join(tmpdir(),'vox-v-'));dirs.push(dir);chmodSync(dir,0o700);const path=join(dir,'v.sock');
  const bodies:{path:string;body:unknown}[]=[];
  const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const value=JSON.parse(body);bodies.push({path:req.url!,body:value});
    expect(req.headers.authorization).toBe(`Bearer ${'a'.repeat(64)}`);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(handle(req.url!,value)));});
  servers.push(server);await new Promise<void>(resolve=>server.listen(path,resolve));chmodSync(path,0o600);
  return {provider:new LocalVoiceIdentityProvider({socketPath:path,authKey:'a'.repeat(64)}),bodies,path};
}
const fence=()=>{};const input=()=>({audio:new Uint8Array([1,2,3]),mimeType:'audio/wav',challenge:'123456',maxDurationMs:1000,signal:new AbortController().signal,authorize:fence,captureContext:'11111111-1111-4111-8111-111111111111'});
describe('private local voice transport',()=>{
  it('does not export audio when the real inspector is unqualified',async()=>{
    const w=await worker(()=>({...ready,inspectionQualified:false,reason:'inspection_not_qualified'}));
    await expect(w.provider.inspect(input())).resolves.toBe('unknown');expect(w.bodies.map(b=>b.path)).toEqual(['/ready']);
  });
  it('requires a current fence and scoped capture for every biometric operation',async()=>{
    const w=await worker(()=>ready);const data=input();delete (data as {authorize?:unknown}).authorize;
    await expect(w.provider.inspect(data)).rejects.toThrow('local_voice_unavailable');expect(w.bodies).toEqual([]);
  });
  it('consumes an audio-bound lease exactly once and purges without template export',async()=>{
    const w=await worker(path=>path==='/ready'?ready:path==='/inspect'?{outcome:'eligible_single_live',inspectionLease:'b'.repeat(64)}:path==='/extract'?{template:Buffer.from('opaque').toString('base64')}:{purged:true});
    const data=input();await expect(w.provider.inspect(data)).resolves.toBe('eligible_single_live');
    await expect(w.provider.extract(data)).resolves.toEqual(Buffer.from('opaque'));
    await expect(w.provider.extract(data)).rejects.toThrow();
    const template=new Uint8Array([99]);await w.provider.purge({template,signal:data.signal});expect(template).toEqual(new Uint8Array([0]));
    expect(w.bodies.find(b=>b.path==='/purge')?.body).toEqual({});
  });
  it('rejects changed audio after inspection',async()=>{
    const w=await worker(path=>path==='/ready'?ready:{outcome:'eligible_single_live',inspectionLease:'b'.repeat(64)});
    const data=input();await w.provider.inspect(data);await expect(w.provider.extract({...data,audio:new Uint8Array([4])})).rejects.toThrow();
    expect(w.bodies.some(b=>b.path==='/extract')).toBe(false);
  });
  it('fences after readiness response and before exporting the sample',async()=>{
    let revoked=false;const w=await worker(()=>{revoked=true;return ready;});const data={...input(),authorize:()=>{if(revoked)throw new AdaptiveError(409,'capture_cancelled');}};
    await expect(w.provider.inspect(data)).rejects.toMatchObject({status:409,code:'capture_cancelled'});
    expect(w.bodies.map(b=>b.path)).toEqual(['/ready']);
  });
  it('refuses world-readable sockets before any request',async()=>{
    const w=await worker(()=>ready);chmodSync(w.path,0o666);await expect(w.provider.readiness()).rejects.toThrow();expect(w.bodies).toEqual([]);
  });
  it('rejects mismatched model readiness',async()=>{
    const w=await worker(()=>({...ready,modelDigest:'0'.repeat(64)}));await expect(w.provider.inspect(input())).rejects.toThrow();expect(w.bodies).toHaveLength(1);
  });
});
