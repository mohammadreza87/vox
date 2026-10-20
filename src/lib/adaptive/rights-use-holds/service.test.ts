import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor, digest, validateAdaptiveDocument, type AdaptiveDocument } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage, openManagedAdaptiveStorage, readMarker, type ManagedAdaptiveStorage } from '../persistence/indexed/managed-storage';
import { prepareRightsUseHoldsAdaptiveStorage, prepareProductPauseAdaptiveStorage, transitionAdaptiveStorage } from '../persistence/indexed/migration';
import { RightsUseHoldService } from './service';
import { compactRightsUseHolds, parseRightsUseControls, requireRightsUseHoldCapacity } from './state';
import type { ApplyRightsUseHoldCommand } from './contracts';
import { AdaptiveObserverService } from '../observation/service';
import { learningAuthority, learningStudioFingerprint } from '../personalization/learning/state';
import { emptyLearning, LEARNING_VERSION } from '../personalization/learning/contracts';
import { AdaptiveRelationshipService } from '../relationships/service';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { StudioStore } from '../../studio/store';
import type { Agent } from '../../studio/types';
import { StudioExperimentRuntime } from '../experiments/runtime';
import { ControlledExperimentService } from '../experiments/service';
import { MemoryExperimentStorage } from '../experiments/storage';
import { config as syntheticExperimentConfig } from '../experiments/test-fixtures';
const paths:string[]=[],stores:ManagedAdaptiveStorage[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const s of stores.splice(0))s.close();for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
const NOW=1800000000000,accountId=accountIdFor(123),guard=()=>{};
const scope={space:'work',purpose:'optional.personalization'} as const;
const binding={id:'synthetic',revision:1,digest:'a'.repeat(64),approvalReference:'synthetic-reviewed',decisionReference:'synthetic-decision'};
const notice={version:'synthetic',digest:'b'.repeat(64)};
function policy(relationships=false){const capabilities=['core_text','personalization','product_analytics',...(relationships?['auto_memory','proactive_suggestions']:[])];return adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'synthetic',enabledCapabilities:capabilities,accounts:[{accountId,jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true}],approvals:capabilities.map(capability=>({schemaVersion:1,id:`synthetic-${capability}`,revision:1,createdAt:NOW,updatedAt:NOW,jurisdiction:'SYNTHETIC',capability,state:'approved',configurationVersion:'synthetic',effectiveAt:NOW,reviewExpiresAt:NOW+3600000,owner:'synthetic',approvalReference:'synthetic'}))}));}
async function fixture(format:'sqlite'|'file'){
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'vox-rf1-'));paths.push(dir);let now=NOW;
 const storage=format==='sqlite'?new SqliteAdaptiveStorage(join(dir,'state.sqlite'),{now:()=>now,newStoreSeed:{generation:1,lifecycleWatermark:0,schemaVersion:3}}):new ManagedFileV2Storage(join(dir,'state'),{now:()=>now,newStoreSeed:{generation:1,lifecycleWatermark:0,schemaVersion:3}});stores.push(storage);
 const repository=new AdaptiveRepository(storage),adaptive=new AdaptiveService(repository,{...policy(),now:()=>now}),holds=new RightsUseHoldService(adaptive);
 await adaptive.confirm(123,{confirm:true,adultConfirmed:true});
 await repository.transaction(accountId,()=>now,d=>{d.agentGrants.push({agentId:'agent',space:'work',allowed:true,revision:1,updatedAt:NOW});for(const p of d.permissions.filter(p=>['optional.personalization','optional.product_analytics'].includes(p.purpose))){p.state='granted';p.expiresAt=NOW+100000;}
 d.memories.push({id:'note',revision:1,space:'work',text:'synthetic retained note',status:'active',createdAt:NOW,updatedAt:NOW,expiresAt:NOW+100000,revocationEpoch:0});});
 const read=()=>{const r=storage.readCommittedForEffect(accountId);if(r.status!=='ready'||!r.document)throw Error('missing');return r.document as AdaptiveDocument;};
 const command=():ApplyRightsUseHoldCommand=>{const r=holds.inspectNow(123,scope,guard);if(r.status!=='ready')throw Error('missing');return {version:1,scope,effectId:randomUUID(),requestId:randomUUID(),expectedCanonicalRevision:r.value.accountRevision,expectedUseEpoch:r.value.useEpoch,applyIntentDigest:'c'.repeat(64),policy:binding,notice,reviewAt:NOW+60000,metadataRetainUntil:NOW+86400000,replayRetainUntil:NOW+172800000};};
 return {dir,storage,repository,adaptive,holds,read,command,setNow:(v:number)=>{now=v;}};
}
for(const format of ['sqlite','file'] as const){
 it(`${format}: exact replay is current, overlapping effects OR, release does not grant consent or revive old receipt`,async()=>{
  const f=await fixture(format),permissions=digest(f.read().permissions),a=f.command();
  const first=await f.holds.apply(123,a,guard);expect(first).toMatchObject({effectiveBlocked:true,useEpoch:1,replayed:false});
  const afterFirst=f.read();expect(f.adaptive.isPurposeAllowed(afterFirst,'work','optional.personalization',NOW,'agent')).toBe(false);
  expect(f.adaptive.isPurposeRetentionAllowed(afterFirst,'work','optional.personalization',NOW,'agent')).toBe(true);
  expect(f.adaptive.isStoredPersonalizationUseAllowed(afterFirst,'work')).toBe(true);
  expect((await f.adaptive.readPrivateContext(123,'work','agent','note')).memories).toEqual([]);
  const b=f.command();await f.holds.apply(123,b,guard);
  const release={...a,expectedCanonicalRevision:f.read().revision,expectedUseEpoch:2,expectedEffectRevision:1,expectedEffectDigest:first.effect.effectDigest,releaseIntentDigest:'d'.repeat(64)};delete (release as Partial<ApplyRightsUseHoldCommand>).applyIntentDigest;
  const released=await f.holds.release(123,release,guard);expect(released).toMatchObject({effectiveBlocked:true,useEpoch:3,effect:{state:'released'}});
  const replay=await f.holds.apply(123,a,guard);expect(replay).toMatchObject({replayed:true,useEpoch:3,effect:{state:'released'}});
  expect(f.read().rightsUseHolds!.effects).toHaveLength(2);expect(digest(f.read().permissions)).toBe(permissions);expect(f.read().memories[0].text).toBe('synthetic retained note');
  await expect(f.repository.transaction(accountId,NOW,d=>{d.rightsUseHolds=afterFirst.rightsUseHolds;})).rejects.toThrow();
 });
 it(`${format}: synchronous current guard denies publication, no missing-account creation or legacy fallback`,async()=>{
  const f=await fixture(format),before=digest(f.read()),c=f.command();let calls=0;
  await expect(f.holds.apply(123,c,()=>{if(++calls===3)throw Error('current authority denied');})).rejects.toThrow('current authority denied');
  expect(digest(f.read())).toBe(before);expect(f.holds.inspectNow(456,scope,guard)).toEqual({status:'missing'});
  await expect(f.holds.apply(456,c,guard)).rejects.toThrow();expect(f.storage.readCommittedForEffect(accountIdFor(456))).toEqual({status:'ready',document:null});
 });
 it(`${format}: dynamic maximum release reservation is enforced on every ordinary write`,async()=>{
  const f=await fixture(format);await f.holds.apply(123,f.command(),guard);const before=digest(f.read());
  await expect(f.repository.transaction(accountId,NOW,d=>{const size=Buffer.byteLength(JSON.stringify(d));d.consentEvents=['x'.repeat(700000-size-2200)] as unknown as AdaptiveDocument['consentEvents'];})).rejects.toThrow();
  expect(digest(f.read())).toBe(before);const c=compactRightsUseHolds(f.read().rightsUseHolds!);c.scopes[0].effectiveBlocked=false;expect(()=>parseRightsUseControls(c)).toThrow();
  const counter=f.read();counter.revision=Number.MAX_SAFE_INTEGER;expect(()=>requireRightsUseHoldCapacity(counter)).toThrow();
 });
 it(`${format}: full reserved envelope still releases with maximum UTF8 metadata and safe integer floors`,async()=>{
  const f=await fixture(format),c=f.command(),applied=await f.holds.apply(123,c,guard),base=validateAdaptiveDocument(f.read(),accountId,NOW);
  let low=0,high=700000;
  while(low<high){const mid=Math.ceil((low+high)/2),draft=structuredClone(base);draft.consentEvents=['x'.repeat(mid)] as unknown as AdaptiveDocument['consentEvents'];try{requireRightsUseHoldCapacity(draft);low=mid;}catch{high=mid-1;}}
  await f.repository.transaction(accountId,NOW,d=>{d.consentEvents=['x'.repeat(low)] as unknown as AdaptiveDocument['consentEvents'];});
  const before=f.read();const release={version:1 as const,scope,effectId:c.effectId,requestId:c.requestId,expectedCanonicalRevision:before.revision,expectedUseEpoch:1,expectedEffectRevision:1,expectedEffectDigest:applied.effect.effectDigest,
   releaseIntentDigest:'f'.repeat(64),policy:{id:'\u0000'.repeat(100),revision:Number.MAX_SAFE_INTEGER,digest:'f'.repeat(64),approvalReference:'\u0000'.repeat(200),decisionReference:'\u0000'.repeat(200)},notice:{version:'\u0000'.repeat(100),digest:'f'.repeat(64)},reviewAt:Number.MAX_SAFE_INTEGER,metadataRetainUntil:Number.MAX_SAFE_INTEGER,replayRetainUntil:Number.MAX_SAFE_INTEGER};
  expect(await f.holds.release(123,release,guard)).toMatchObject({effectiveBlocked:false,useEpoch:2,effect:{state:'released'}});expect(f.read().rightsUseHolds!.effects[0].reviewAt).toBe(c.reviewAt);
 });
 it(`${format}: guard must be synchronous and metadata-only inspection does not read canonical bodies`,async()=>{
  const f=await fixture(format),c=f.command();await expect(f.holds.apply(123,c,async()=>{})).rejects.toThrow('Invalid synchronous authority evaluation');
  if(f.storage instanceof SqliteAdaptiveStorage)f.storage.io.canonicalImageReads=0;else f.storage.io.canonicalImageReads=0;
  expect(f.holds.inspectNow(123,scope,guard).status).toBe('ready');expect(f.storage.io.canonicalImageReads).toBe(0);
  const before=digest(f.read());await expect(f.repository.transaction(accountId,NOW,d=>{d.retentionStoreIdentity='f'.repeat(64);})).rejects.toThrow('Retention namespace replacement');expect(digest(f.read())).toBe(before);
 });
}
it('prepared FILE3 automatic-context entry refuses before body under a hold or unknown direct controls, own export stays available',async()=>{
 const f=await fixture('file');expect((await f.adaptive.readPrivateContext(123,'work','agent','note')).memories).toHaveLength(1);
 await f.holds.apply(123,f.command(),guard);
 const transact=vi.spyOn(f.storage,'transact'),read=vi.spyOn(f.storage,'readCommittedForEffect');
 const context=await f.adaptive.readPrivateContext(123,'work','agent','note'),authority=await f.adaptive.readPrivateContextAuthority(123,'work','agent'),sync=f.adaptive.readPrivateContextAuthorityNow(123,'work','agent');
 expect(context.memories).toEqual([]);expect(authority.revision).toBe(context.revision);expect(sync.revision).toBe(context.revision);expect(transact).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 const direct=vi.spyOn(f.storage as ManagedFileV2Storage,'readDirectAuthorityForEffect').mockReturnValue({status:'busy'});
 await expect(f.adaptive.readPrivateContext(123,'work','agent')).rejects.toMatchObject({code:'adaptive_context_unavailable'});
 await expect(f.adaptive.readPrivateContextAuthority(123,'work','agent')).rejects.toMatchObject({code:'adaptive_context_unavailable'});
 expect(()=>f.adaptive.readPrivateContextAuthorityNow(123,'work','agent')).toThrow();expect(transact).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();direct.mockRestore();
 expect((await new AdaptiveLifecycleService(f.adaptive).exportAccount(123,'work')).memories).toHaveLength(1);
});
for(const format of ['sqlite-v1','file-v2'] as const)it(`${format}: real explicit conversion and current-state opposite-format migration preserve schema3 controls`,async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'vox-rf1-conversion-'));paths.push(dir);const root=join(dir,'legacy');mkdirSync(root);
 const repo=new AdaptiveRepository(new FileAdaptiveStorage(root));await repo.transaction(accountId,NOW,d=>{d.memories.push({id:'retained',revision:1,space:'work',text:'synthetic',status:'deleted',createdAt:NOW,updatedAt:NOW,expiresAt:NOW+10000,revocationEpoch:3});});
 await prepareRightsUseHoldsAdaptiveStorage(root,format,{quiesced:true,now:()=>NOW});expect(readMarker(root)).toMatchObject({version:3,canonicalSchemaVersion:3,rightsUseHoldEnforcementVersion:1});
 let storage=openManagedAdaptiveStorage(root,{format,now:()=>NOW});stores.push(storage);const before=storage.readCommittedForEffect(accountId);expect(before).toMatchObject({status:'ready',document:{schemaVersion:3,rightsUseHolds:{version:1},memories:[{status:'deleted',revocationEpoch:3}]}});storage.close();
 const opposite=format==='sqlite-v1'?'file-v2':'sqlite-v1';await transitionAdaptiveStorage(root,opposite,{quiesced:true,now:()=>NOW});storage=openManagedAdaptiveStorage(root,{format:opposite,now:()=>NOW});stores.push(storage);expect(storage.readCommittedForEffect(accountId)).toEqual(before);
});
for(const format of ['sqlite-v1','file-v2'] as const)it(`${format}: explicit source namespace preserves retained observer/learning through sweeps, never resumes old work, withdrawal still purges`,async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'vox-rf1-retention-'));paths.push(dir);const root=join(dir,'legacy');mkdirSync(root);
 let legacy=new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(root)),{...policy(true),scopedRelationshipsEnabled:true,inboxEnabled:true,now:()=>NOW});
 await legacy.confirm(123,{confirm:true,adultConfirmed:true});
 await legacy.repository.transaction(accountId,NOW,d=>{for(const p of d.permissions.filter(p=>['optional.personalization','optional.product_analytics','optional.auto_memory','optional.proactive_suggestions'].includes(p.purpose))){p.state='granted';p.expiresAt=NOW+100000;}d.agentGrants.push({agentId:'agent',space:'work',allowed:true,revision:1,updatedAt:NOW});d.relationships.bindings.push({id:'relationship',revision:1,accountId,personId:d.personId,space:'work',status:'active',confirmedAt:NOW,expiresAt:NOW+100000,originBindingId:d.binding!.id});});
 await prepareProductPauseAdaptiveStorage(root,format,{quiesced:true,now:()=>NOW});
 const source2=openManagedAdaptiveStorage(root,{format,now:()=>NOW});stores.push(source2);legacy=new AdaptiveService(new AdaptiveRepository(source2),{...policy(true),scopedRelationshipsEnabled:true,inboxEnabled:true,now:()=>NOW});const sourceIdentity=legacy.storeIdentity;
 const relationshipService=new AdaptiveRelationshipService(legacy),relationshipPermit=(await relationshipService.resolve(123,'agent','work'))!;expect(relationshipPermit).not.toBeNull();
 const relationshipSource=(await relationshipService.acceptSource(relationshipPermit,{id:'synthetic-source',at:NOW,channel:'telegram'}))!;expect(relationshipSource).not.toBeNull();
 await legacy.repository.transaction(accountId,NOW,d=>{d.relationships.inbox.push({id:'synthetic-inbox',key:relationshipPermit.key as NonNullable<typeof d.relationships.inbox[number]['key']>,sourceIds:[relationshipSource.id],fingerprint:relationshipPermit.fingerprint,sourceFence:relationshipPermit.sourceFence,text:'retained synthetic check-in',createdAt:NOW,expiresAt:NOW+100000,status:'unread'});});
 const observer=new AdaptiveObserverService(legacy),receipt=(await observer.authorize(123,'work','agent'))!;
 await observer.recordServer(123,{kind:'response',eventId:'retained',space:'work',agentId:'agent',turnId:'turn',channel:'text',outcome:'responded',policyReceipt:receipt});
 const studio='e'.repeat(64);
 const studioStore=new StudioStore(join(dir,'studio'));
 await studioStore.update(d=>{d.members.push({telegramId:123,name:'Synthetic',role:'member',joinedAt:new Date(NOW).toISOString()});d.agents.push({id:'agent',status:'active',createdBy:123,access:[123],visibility:'private',blocked:[]} as unknown as Agent);});
 const experimentStorage=new MemoryExperimentStorage(),controller=new ControlledExperimentService(experimentStorage);
 const experiment=syntheticExperimentConfig({startsAt:NOW,expiresAt:NOW+100000,review:{owner:'synthetic',reviewer:'synthetic-reviewer',reference:'synthetic-review',reviewedAt:NOW,offlineEvidence:'synthetic-offline',shadowEvidence:'synthetic-shadow'},retention:{policyVersion:'synthetic-only',approvalReference:'synthetic-only',retainUntil:NOW+200000}});
 controller.install(experiment,NOW);for(const [i,phase] of ['offline','shadow','pilot'].entries())controller.transition(experiment.id,i+1,phase as 'offline'|'shadow'|'pilot',NOW);
 const oldExperiments=new StudioExperimentRuntime(controller,legacy,studioStore,()=>NOW),oldPresentation=await oldExperiments.prepare(123,'agent','work','old-turn');expect(oldPresentation).toBeDefined();
 const retainedExperiment=oldExperiments.exportScope(123,'work');expect(retainedExperiment.derived).toHaveLength(1);
 await legacy.repository.transaction(accountId,NOW,d=>{const authority=learningAuthority(legacy,d,{space:'work',agentId:'agent'},NOW)!;const learning=d.experience.preferenceLearning=emptyLearning();
  learning.intents.push({version:LEARNING_VERSION,id:'legacy-intent',revision:1,space:'work',agentId:'agent',studioFingerprint:learningStudioFingerprint(legacy,studio)!,personId:authority.personId,bindingId:authority.bindingId,permissionRevision:authority.permissionRevision,consentEpoch:authority.consentEpoch,grantRevision:authority.grantRevision,createdAt:NOW,expiresAt:NOW+60000});});
 source2.close();await prepareRightsUseHoldsAdaptiveStorage(root,format,{quiesced:true,now:()=>NOW});
 let storage=openManagedAdaptiveStorage(root,{format,now:()=>NOW});stores.push(storage);
 const inspect=()=>{const r=storage.readCommittedForEffect(accountId);if(r.status!=='ready')throw Error('busy');return r.document as AdaptiveDocument;};
 const first=inspect();expect(first.retentionStoreIdentity).toBe(sourceIdentity);expect(first.observer.events[0].retentionStoreIdentity).toBe(sourceIdentity);expect(first.experience.preferenceLearning!.intents[0].retentionStoreIdentity).toBe(sourceIdentity);
 storage.close();const opposite=format==='sqlite-v1'?'file-v2':'sqlite-v1';await transitionAdaptiveStorage(root,opposite,{quiesced:true,now:()=>NOW});storage=openManagedAdaptiveStorage(root,{format:opposite,now:()=>NOW});stores.push(storage);
 const adaptive=new AdaptiveService(new AdaptiveRepository(storage),{...policy(true),scopedRelationshipsEnabled:true,inboxEnabled:true,now:()=>NOW});adaptive.setPreferenceLearningAuthority(()=>studio);
 const experiments=new StudioExperimentRuntime(controller,adaptive,studioStore,()=>NOW);experiments.reconcileAccount(123);
 expect(experiments.exportScope(123,'work')).toEqual(retainedExperiment);expect(experiments.current(123,'agent','work',oldPresentation!)).toBe(false);
 const currentRelationships=new AdaptiveRelationshipService(adaptive);expect(await currentRelationships.synchronize(relationshipPermit.key,[relationshipSource.id])).toBe('suspended_use');expect(currentRelationships.authorizeNow(relationshipPermit.key,[relationshipSource.id],'context')).not.toBeNull();
 const currentObserver=new AdaptiveObserverService(adaptive);await adaptive.read(123,'work');
 expect(inspect().observer.events).toHaveLength(1);expect(inspect().experience.preferenceLearning!.intents).toHaveLength(1);
 expect(await currentObserver.process(123)).toEqual({processed:0,failed:0});
 const holds=new RightsUseHoldService(adaptive),status=holds.inspectNow(123,scope,guard);if(status.status!=='ready')throw Error('missing');
 await holds.apply(123,{version:1,scope,effectId:randomUUID(),requestId:randomUUID(),expectedCanonicalRevision:status.value.accountRevision,expectedUseEpoch:0,applyIntentDigest:'c'.repeat(64),policy:binding,notice,reviewAt:NOW+60000,metadataRetainUntil:NOW+86400000,replayRetainUntil:NOW+172800000},guard);
 const exported=await new AdaptiveLifecycleService(adaptive).exportAccount(123,'work');expect(exported.preferenceLearning!.intents).toHaveLength(1);expect(exported.observerEvents).toHaveLength(1);expect(exported.checkIns).toHaveLength(1);expect(currentRelationships.resolveNow(123,'agent','work')).toBeNull();expect(await currentRelationships.synchronize(relationshipPermit.key,[relationshipSource.id])).toBe('suspended_use');
 experiments.reconcileAccount(123);expect(experiments.exportScope(123,'work')).toEqual(retainedExperiment);expect(await experiments.prepare(123,'agent','work','held-turn')).toBeUndefined();
 for(const purpose of ['optional.product_analytics','optional.personalization'] as const){const state=await adaptive.read(123,'work');await adaptive.changeConsent(123,{space:'work',purpose,state:'withdrawn',expectedRevision:state.purposes.find(p=>p.purpose===purpose)!.revision,eventId:randomUUID()});}
 expect(inspect().observer?.events??[]).toHaveLength(0);expect(inspect().experience.preferenceLearning?.intents??[]).toHaveLength(0);expect(inspect().rightsUseHolds!.effects[0].state).toBe('active');
 experiments.reconcileAccount(123);expect(experiments.exportScope(123,'work').derived).toHaveLength(0);expect(await currentRelationships.synchronize(relationshipPermit.key,[relationshipSource.id])).toBe('invalid_source');expect(inspect().relationships.inbox[0].text).toBe('');
});
