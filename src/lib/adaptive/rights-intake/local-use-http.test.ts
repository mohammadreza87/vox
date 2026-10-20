import {afterEach,expect,it,vi} from 'vitest';
import {rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {handleRightsRequest,assertRightsAccountNow} from '../../studio/rights-http';
import {signInitData} from '../../studio/auth';
import {makeStudio,seedOrg,ID} from '../../studio/__tests__/helpers';
import {RightsIntakeService} from './service';
import {localUseFixture,syntheticLocalUsePolicy} from './local-use-fixtures';
import {accountIdFor} from '../persistence/repository';
const TOKEN='synthetic:RF1-HTTP';const closes:Array<()=>Promise<unknown>>=[];afterEach(async()=>{vi.restoreAllMocks();for(const c of closes.splice(0))await c();});
async function fixture(format:'sqlite'|'file'){
 const f=await localUseFixture(format),h=makeStudio();await seedOrg(h);closes.push(f.close,()=>rm(h.dir,{recursive:true,force:true}));
 await h.store.update(s=>{for(const id of [101,102])s.members.push({...s.members.find(m=>m.telegramId===ID.alice)!,telegramId:id});});
 const p=syntheticLocalUsePolicy();p.privacyOperatorIds=[ID.superadmin];f.setPolicy(p);
 h.studio.deps.rights=new RightsIntakeService(f.repository,{...f.serviceOptions,assertAccountNow:id=>assertRightsAccountNow(h.studio,id),assertOperatorNow:id=>assertRightsAccountNow(h.studio,id,'operator')});
 const request=(path:string,method='GET',body?:unknown,id=101,origin='https://vox.synthetic')=>handleRightsRequest(h.studio,new Request('https://vox.synthetic/api/studio/rights/'+path,{method,headers:{origin,'content-type':'application/json','x-telegram-init-data':signInitData({id,first_name:'TEST ONLY'},TOKEN)},...(body?{body:JSON.stringify(body)}:{})}),path.split('?')[0].split('/'),TOKEN);
 const made=await request('requests','POST',{version:1,eventId:randomUUID(),space:'work',kind:'restriction',locale:'en',expectedIntakePolicyRevision:1});expect(made.status).toBe(201);const row=(await made.json()).request;
 return{...f,h,row,request};
}
for(const format of ['sqlite','file'] as const)it(`${format}: signed HTTP current proof, one confirmation, dedicated release and current account boundaries`,async()=>{
 const f=await fixture(format),base=`requests/${f.row.requestId}/local-use`;
 const unsupported=await f.request(base+'?space=work&purpose=optional.personalization');expect(unsupported.status).toBe(200);expect(await unsupported.json()).toMatchObject({status:{technical:{current:'unknown'},reason:'storage_unsupported'}});
 await f.prepare();const before=f.repository.read(accountIdFor(101))!;f.storage.io.canonicalImageReads=0;
 expect((await f.request(base+'?space=work&purpose=optional.personalization')).status).toBe(200);expect(f.repository.read(accountIdFor(101))).toEqual(before);expect(f.storage.io.canonicalImageReads).toBe(0);
 expect((await f.request(base+'/plan?space=work','POST',{version:1,action:'apply',purpose:'optional.personalization',locale:'en',accountId:accountIdFor(102)})).status).toBe(400);
 expect((await f.request(base+'/plan?space=work','POST',{version:1,action:'apply',purpose:'optional.personalization',locale:'en'},101,'https://attacker.invalid')).status).toBe(403);
 expect((await f.request(base+'?space=work&purpose=optional.personalization','GET',undefined,102)).status).toBe(404);
 const plan=await f.request(base+'/plan?space=work','POST',{version:1,action:'apply',purpose:'optional.personalization',locale:'en'});expect(plan.status).toBe(200);const planned=await plan.json();
 expect(f.repository.read(accountIdFor(101))).toEqual(before);
 const confirmed=await f.request(base+'/actions?space=work','POST',{version:1,eventId:randomUUID(),action:'apply',planHandle:planned.planHandle});expect(confirmed.status).toBe(200);expect(confirmed.headers.get('cache-control')).toBe('no-store');expect(await confirmed.json()).toMatchObject({status:{technical:{current:'active',reconciliation:'recorded'},effectiveBlocked:true,useEpoch:1}});
 const release=await f.request(base+'/plan?space=work','POST',{version:1,action:'release',purpose:'optional.personalization',locale:'fa'});expect(release.status).toBe(200);const releasePlan=await release.json();
 const ended=await f.request(base+'/actions?space=work','POST',{version:1,eventId:randomUUID(),action:'release',planHandle:releasePlan.planHandle});expect(ended.status).toBe(200);expect(await ended.json()).toMatchObject({status:{technical:{current:'released'},useEpoch:2}});
});
it('denies a planned action after committed requester access removal and never exposes private exception text',async()=>{
 const f=await fixture('file');await f.prepare();const base=`requests/${f.row.requestId}/local-use`,plan=await f.request(base+'/plan?space=work','POST',{version:1,action:'apply',purpose:'optional.product_analytics',locale:'en'}),value=await plan.json();
 await f.h.store.update(s=>{s.members=s.members.filter(m=>m.telegramId!==101);});
 const response=await f.request(base+'/actions?space=work','POST',{version:1,eventId:randomUUID(),action:'apply',planHandle:value.planHandle});expect(response.status).toBe(403);
 expect(f.backend.inspectNow(101,{space:'work',purpose:'optional.product_analytics'},()=>{})).toMatchObject({status:'ready',value:{useEpoch:0,effectiveBlocked:false}});
 expect((await response.text())).not.toContain('telegram-account');
});
