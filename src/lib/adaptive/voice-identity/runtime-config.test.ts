import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localVoiceIdentityOptions, readPrivateVoiceFile } from './runtime-config';
import { LocalVoiceIdentityProvider, LOCAL_VOICE_MODEL_DIGEST, LOCAL_VOICE_PROVIDER_ID, LOCAL_VOICE_PROVIDER_VERSION } from './local-provider';
const dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
const ready={protocolVersion:1 as const,providerId:LOCAL_VOICE_PROVIDER_ID,providerVersion:LOCAL_VOICE_PROVIDER_VERSION,modelDigest:LOCAL_VOICE_MODEL_DIGEST,encoderReady:true,inspectionQualified:true,matchingQualified:true,reason:'ready' as const};
function config(approval=false){const dir=mkdtempSync(join(tmpdir(),'vox-vc-'));dirs.push(dir);chmodSync(dir,0o700);const auth=join(dir,'auth'),key=join(dir,'key'),path=join(dir,'config');
writeFileSync(auth,randomBytes(32).toString('hex')+'\n',{mode:0o600});writeFileSync(key,randomBytes(32).toString('base64')+'\n',{mode:0o600});
const value={schemaVersion:1,enabled:true,socketPath:join(dir,'voice.sock'),authKeyFile:auth,encryptionKeyFile:key,...(approval?{approval:{providerId:LOCAL_VOICE_PROVIDER_ID,providerVersion:LOCAL_VOICE_PROVIDER_VERSION,location:'server',approvalReference:'synthetic-test-only',noticeVersion:'voice-enrollment-v1',expiresAt:Date.now()+100000,templateTtlMs:10000,consentTtlMs:10000,disclosure:{en:'Synthetic test disclosure',fa:'آزمایش'}}}:{})};
writeFileSync(path,JSON.stringify(value),{mode:0o600});return{dir,auth,key,path,value,env:{STUDIO_VOICE_RECOGNITION:'1',STUDIO_VOICE_IDENTITY_CONFIG_FILE:path}};}
describe('canonical local voice runtime configuration',()=>{
 it('keeps unconfigured capture unavailable even if global flag is on',async()=>{expect(await localVoiceIdentityOptions({STUDIO_VOICE_RECOGNITION:'1'},{storage:'file'})).toMatchObject({selected:false,options:{enabled:false},readiness:'recognition_not_configured'});});
 it('requires actual inspector qualification as well as model readiness',async()=>{const c=config(true);vi.spyOn(LocalVoiceIdentityProvider.prototype,'readiness').mockResolvedValue({...ready,inspectionQualified:false,reason:'inspection_not_qualified'});expect(await localVoiceIdentityOptions(c.env,{storage:'file'})).toMatchObject({selected:true,readiness:'inspection_not_qualified',options:{enabled:false}});});
 it('does not invent an approval when model is ready',async()=>{const c=config();vi.spyOn(LocalVoiceIdentityProvider.prototype,'readiness').mockResolvedValue(ready);expect(await localVoiceIdentityOptions(c.env,{storage:'file'})).toMatchObject({readiness:'recognition_release_not_configured',options:{enabled:false}});});
 it('enables only with explicit synthetic fixture approval and every real readiness gate',async()=>{const c=config(true);vi.spyOn(LocalVoiceIdentityProvider.prototype,'readiness').mockResolvedValue(ready);expect(await localVoiceIdentityOptions(c.env,{storage:'file'})).toMatchObject({readiness:'ready',options:{enabled:true}});});
 it('retains provider/cipher for deletion when worker is unavailable',async()=>{const c=config(true);vi.spyOn(LocalVoiceIdentityProvider.prototype,'readiness').mockRejectedValue(new Error('offline'));const r=await localVoiceIdentityOptions(c.env,{storage:'file'});expect(r.readiness).toBe('local_engine_unavailable');expect(r.options.provider).toBeDefined();expect(r.options.cipher).toBeDefined();expect(r.options.enabled).toBe(false);});
 it('refuses unsupported storage and public config files',async()=>{const c=config();await expect(localVoiceIdentityOptions(c.env,{storage:'firestore'})).rejects.toThrow('local_voice_file_profile_required');chmodSync(c.path,0o644);await expect(localVoiceIdentityOptions(c.env,{storage:'file'})).rejects.toThrow('local_voice_private_file_required');});
 it('refuses symlinks and bounded-read overflow',()=>{const c=config();const link=join(c.dir,'link');symlinkSync(c.key,link);expect(()=>readPrivateVoiceFile(link,100)).toThrow();expect(()=>readPrivateVoiceFile(c.key,2)).toThrow();});
 it('rejects unknown operator inspection overrides',async()=>{const c=config(true);writeFileSync(c.path,JSON.stringify({...c.value,inspectionQualified:true}));await expect(localVoiceIdentityOptions(c.env,{storage:'file'})).rejects.toThrow();});
});
