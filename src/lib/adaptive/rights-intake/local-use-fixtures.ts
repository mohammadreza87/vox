/** Synthetic RF1 test input only. No production policy/defaults. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage } from '../persistence/indexed/managed-storage';
import { RightsUseHoldService } from '../rights-use-holds/service';
import { syntheticRightsPolicy } from './fixtures';
import { localUseNotice, LOCAL_USE_NOTICE_VERSION } from './local-use-notice';
import { RightsRepository, fail } from './repository';
import { RightsFileStorage } from './storage';
import { RightsIntakeService } from './service';
import { prepareRightsLocalUseLedger } from './conversion';
import type { RightsPolicy } from './policy';
export const RF1_NOW = 1800000000000;
export function syntheticLocalUsePolicy(): Extract<RightsPolicy,{version:2}> {
  return {...syntheticRightsPolicy(),version:2,effectiveAt:RF1_NOW,expiresAt:RF1_NOW+3600000,localFulfillment:{version:1,approvalReference:'TEST ONLY approved synthetic capability',decisionReference:'TEST ONLY scope decision',assurance:'signed_account_own_scope',topology:'single_persistent_process',purposes:['optional.personalization','optional.product_analytics'],allowedActions:['apply_local_use_hold','release_local_use_hold','reconcile_recorded_effect'],controlRetentionAuthority:'TEST ONLY retain suppression until explicit release',retainActiveControlsUntilAuthorizedRelease:true,noticeVersion:LOCAL_USE_NOTICE_VERSION,noticeHashes:{en:createHash('sha256').update(JSON.stringify(localUseNotice.en)).digest('hex'),fa:createHash('sha256').update(JSON.stringify(localUseNotice.fa)).digest('hex')},handleLifetimeMs:30000,reviewAfterMs:60000,metadataRetentionMs:86400000,receiptRetentionMs:86400000,replayRetentionMs:172800000,ledgerConversion:{version:1,approvalReference:'TEST ONLY conversion approval',decisionReference:'TEST ONLY quiesced conversion'}}};
}
export async function localUseFixture(format:'sqlite'|'file'='file') {
  const directory=await mkdtemp(join(tmpdir(),'vox-rf1-author-'));let now=RF1_NOW,policy:unknown=syntheticLocalUsePolicy(),allowed=true;
  const storage=format==='sqlite'?new SqliteAdaptiveStorage(join(directory,'canonical.sqlite'),{now:()=>now,newStoreSeed:{generation:1,lifecycleWatermark:0,schemaVersion:3}}):new ManagedFileV2Storage(join(directory,'canonical'),{now:()=>now,newStoreSeed:{generation:1,lifecycleWatermark:0,schemaVersion:3}});
  const options=adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'TEST ONLY RF1',enabledCapabilities:['core_text','personalization','product_analytics'],accounts:[101,102].map(id=>({accountId:accountIdFor(id),jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true})),approvals:['core_text','personalization','product_analytics'].map(capability=>({schemaVersion:1,id:capability,revision:1,createdAt:RF1_NOW,updatedAt:RF1_NOW,jurisdiction:'SYNTHETIC',capability,state:'approved',configurationVersion:'TEST ONLY RF1',effectiveAt:RF1_NOW,reviewExpiresAt:RF1_NOW+3600000,owner:'TEST ONLY',approvalReference:'TEST ONLY'}))}));
  const adaptive=new AdaptiveService(new AdaptiveRepository(storage),{...options,now:()=>now});await adaptive.confirm(101,{confirm:true,adultConfirmed:true});await adaptive.confirm(102,{confirm:true,adultConfirmed:true});
  const rightsStorage=new RightsFileStorage(join(directory,'rights-intake','v1')),repository=new RightsRepository(rightsStorage),backend=new RightsUseHoldService(adaptive);
  const serviceOptions={key:Buffer.alloc(32,7),policy:()=>policy,clock:()=>now,localUse:backend,assertAccountNow:()=>{if(!allowed)fail(403,'account_intake_unavailable');},assertOperatorNow:(id:number)=>{if(id!==999)fail(403,'privacy_operator_required');}};
  const service=new RightsIntakeService(repository,serviceOptions);
  const create=async()=>{const r=await service.create(101,{version:1,eventId:crypto.randomUUID(),space:'work',kind:'restriction',locale:'en',expectedIntakePolicyRevision:1});return r.request;};
  const prepare=()=>prepareRightsLocalUseLedger({repository,accountId:accountIdFor(101),policy:()=>policy,clock:()=>now,assertLocalAdministrationNow:()=>{},assertQuiescedNow:()=>{}});
  return{directory,storage,adaptive,backend,repository,rightsStorage,service,serviceOptions,create,prepare,setNow:(v:number)=>{now=v;},setPolicy:(v:unknown)=>{policy=v;},deny:()=>{allowed=false;},close:async()=>{storage.close();await rm(directory,{recursive:true,force:true});}};
}
