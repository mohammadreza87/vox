/** Protected independent FRO1 integration. Real FILE; every external model/HTTP is synthetic. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {acquireFileRuntimeOwner,commitFileRuntimeRename,fileRuntimeFs,fileRuntimePromises,openFileRuntimeDescriptor,installFileRuntimeOwnerMarker,ensureStudioFileRuntimeOwner,type FileRuntimeOwner} from '../file-runtime-owner';
import {StudioStore} from '../store';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {AdaptiveRepository,accountIdFor} from '../../adaptive/persistence/repository';
import {RightsFileStorage} from '../../adaptive/rights-intake/storage';
import {RightsRepository} from '../../adaptive/rights-intake/repository';
import {RightsIntakeService} from '../../adaptive/rights-intake/service';
import {syntheticRightsPolicy} from '../../adaptive/rights-intake/fixtures';
import {FileExperimentStorage} from '../../adaptive/experiments/storage';
import {FileConnectionsStorage,type RawConnectionsRecords} from '../../connections/storage';
import {auditSchema,type ConnectionsRecords} from '../../connections/contracts';
import {FilePetStore} from '../pet-store';
import {FilePetPlayStore} from '../pet-play-store';
import {FilePetGrowthStore} from '../pet-growth-store';
import {FilePetCheckinStore} from '../pet-checkins/store';
import {newCare} from '../../pet/care';
import {newPlay} from '../../pet/play';
import {newCheckinRecord} from '../../pet/checkins';
import {FileAgentChoiceStore} from '../../circles/choice-store';
import {FileRelationshipStore} from '../../relationships/file-store';
import {FileObservationStore} from '../../relationships/observer';
import {createFileStores} from '../../tireh/memory/file-store';
import {createFileAuditStore,createFileSupersededNoticeStore} from '../../tireh/audit';
import {createFileDecisionLogStore} from '../../tireh/decisions/log';
import {FileVoiceprintStore} from '../identity/store';
import {RoutineFileStore} from '../routines/store';
import {TelegramBotClient} from '../../tireh/telegram/client';
import {atiFixture,ATI_NOW,ATI_GENERATED} from './assistant-text-integration-fixture';
import {startBots} from '../bots';

// Real descriptor reads are preserved. Only the synthetic clock is advanced at
// a precisely identified owner-record read; no authority/storage value is forged.
const ownerRead=vi.hoisted(()=>({hook:undefined as (()=>void)|undefined,armAfterFsync:undefined as (()=>void)|undefined,count:0}));
const asyncOpen=vi.hoisted(()=>({hook:undefined as (()=>void)|undefined,writableCalls:0,readonlyCalls:0}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return {...actual,async open(...args:Parameters<typeof actual.open>){
    if(typeof args[1]==='string'&&/^[ras]+$/.test(args[1]))asyncOpen.readonlyCalls++;else asyncOpen.writableCalls++;
    const hook=asyncOpen.hook;asyncOpen.hook=undefined;hook?.();
    return actual.open(...args);
  }};
});
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>();
  return {...actual,fsyncSync(fd:number){actual.fsyncSync(fd);const arm=ownerRead.armAfterFsync;ownerRead.armAfterFsync=undefined;arm?.();},readSync(...args:unknown[]){
    const count=Reflect.apply(actual.readSync,actual,args) as number,buffer=args[1];
    if(Buffer.isBuffer(buffer)&&count>0){const offset=typeof args[2]==='number'?args[2]:0;
      if(buffer.toString('utf8',offset,offset+count).includes('"kind":"studio-file-runtime-owner"')){
        ownerRead.count++;const hook=ownerRead.hook;ownerRead.hook=undefined;hook?.();
      }}
    return count;
  }};
});

const NOW=ATI_NOW;
const RELEASE={revision:'f895ba59fc43fe9677e08fa602cc48c08ccdf3f8',sourceTree:'9dddab6c6d5ed02ced0ac7f011cfb64f83f3cd44',buildId:'synthetic-file-writer-owner'};
const key={personaId:'qa-agent',chatKey:'private-70300',audience:{kind:'private' as const,personId:'qa-person'}};
afterEach(()=>{ownerRead.hook=undefined;ownerRead.armAfterFsync=undefined;asyncOpen.hook=undefined;asyncOpen.writableCalls=0;asyncOpen.readonlyCalls=0;vi.restoreAllMocks();vi.useRealTimers();});

function snapshot(root:string):unknown[]{
  const rows:unknown[]=[];
  const walk=(path:string,relative:string)=>{const stat=lstatSync(path);
    rows.push([relative,stat.mode&0o777,stat.nlink,stat.isSymbolicLink()?['link',readlinkSync(path)]:stat.isDirectory()?['directory']:['file',createHash('sha256').update(readFileSync(path)).digest('hex')]]);
    if(stat.isDirectory())for(const name of readdirSync(path).sort())walk(join(path,name),relative?`${relative}/${name}`:name);
  };walk(root,'');return rows;
}
async function fixture(run:(f:{root:string;owner:FileRuntimeOwner})=>Promise<void>){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'vox-fro1-writer-')));
  const owner=acquireFileRuntimeOwner({dataRoot:root,release:RELEASE});installFileRuntimeOwnerMarker(owner);
  try{await run({root,owner});}finally{ownerRead.hook=undefined;ownerRead.armAfterFsync=undefined;rmSync(root,{recursive:true,force:true});}
}
interface WriterCase{name:string;create(root:string):{write():unknown;read?():unknown;file:string}}
const writers:WriterCase[]=[
  {name:'Studio state',create(root){const store=new StudioStore(root);return{file:join(root,'studio.json'),write:()=>store.update(s=>{s.audit.push({at:new Date(NOW).toISOString(),actor:'qa',action:'protected-owner-fixture'});}),read:()=>store.readCommittedForEffect()};}},
  ...['adaptive','circles/ledger','circles/notes','circles/channel-drafts','shared-memory','voice-identity','adaptive-maintenance','connection-budgets'].map(directory=>({name:`FileAdaptiveStorage ${directory}`,create(root:string){
    const storage=new FileAdaptiveStorage(join(root,directory)),repository=new AdaptiveRepository(storage),id=accountIdFor(70300);
    return{file:join(root,directory,`${createHash('sha256').update(id).digest('hex')}.json`),
      write:()=>repository.transaction(id,()=>NOW,d=>{d.revision++;}),read:()=>storage.readCommittedForEffect(id)};
  }})),
  {name:'pet care',create(root){const store=new FilePetStore(join(root,'pets'));return{file:join(root,'pets/qa-agent.json'),write:()=>store.update('qa-agent',70300,()=>({care:newCare('qa-agent',70300,NOW,'UTC',1),result:null}))};}},
  {name:'pet play',create(root){const store=new FilePetPlayStore(join(root,'pets'));return{file:join(root,'pets/play/qa-agent.json'),write:()=>store.update('qa-agent',70300,()=>({play:newPlay('qa-agent',70300,NOW),result:null}))};}},
  {name:'pet growth',create(root){const store=new FilePetGrowthStore(join(root,'pets'));return{file:join(root,'pets/growth/qa-agent.json'),write:()=>store.update('qa-agent',()=>({lit:[{id:'room-first',kind:'room',at:NOW}],result:null}))};}},
  {name:'pet check-ins',create(root){const store=new FilePetCheckinStore(join(root,'pets'));return{file:join(root,'pets/checkins/70300.json'),write:()=>store.update(70300,()=>({record:newCheckinRecord(70300,NOW),result:null}))};}},
  {name:'Circle choice',create(root){const store=new FileAgentChoiceStore(join(root,'circles'));return{file:join(root,'circles/qa-agent.json'),write:()=>store.update('qa-agent',70300,()=>({record:{v:1,agentId:'qa-agent',telegramId:70300,receipts:[]},result:null}))};}},
  {name:'legacy memory/revision/history wrapper',create(root){const store=createFileStores(join(root,'memory.json'));return{file:join(root,'memory.json'),write:()=>store.memories.invalidate('qa-agent'),read:()=>store.memories.listActive('qa-agent')};}},
  {name:'relationship state',create(root){const store=new FileRelationshipStore(join(root,'scoped-relationships-v1.json'));return{file:join(root,'scoped-relationships-v1.json'),write:()=>store.update(key,s=>{s.revision++;}),read:()=>store.read(key)};}},
  {name:'relationship observation',create(root){const store=new FileObservationStore(join(root,'scoped-relationship-observations-v1.json'));return{file:join(root,'scoped-relationship-observations-v1.json'),write:()=>store.append({id:'qa-observation',at:new Date(NOW).toISOString(),schemaVersion:1,feature:'relationships',mode:'shadow',type:'turn',scope:'private',scopeHash:'a'.repeat(64)}),read:()=>store.recent()};}},
  {name:'audit append',create(root){const store=createFileAuditStore(join(root,'vox-audit.jsonl'));return{file:join(root,'vox-audit.jsonl'),write:()=>store.append({kind:'write',personaId:'qa-agent',audiencePersonIds:['qa-person'],memoryIds:['qa-memory'],policyKey:'tireh.visibility.v1:private:normal',outcome:'applied',at:new Date(NOW)})};}},
  {name:'superseded notice',create(root){const store=createFileSupersededNoticeStore(join(root,'supersede-notices.json'));return{file:join(root,'supersede-notices.json'),write:()=>store.record({personaId:'qa-agent',oldMemoryId:'old',newMemoryId:'new',ownerPersonId:'qa-person',recipientPersonIds:['qa-recipient'],at:new Date(NOW)})};}},
  {name:'Decisions append',create(root){const store=createFileDecisionLogStore(join(root,'decision-log-v1.jsonl'));return{file:join(root,'decision-log-v1.jsonl'),write:()=>store.append({questionSetVersion:'v1',names:[],answers:[],outcome:'unknown',unknownReason:'disabled',elapsedMs:0,routeTaken:'untriaged',personaId:'qa-agent',chatKind:'private',language:'en',at:new Date(NOW)})};}},
  {name:'requested routine ledger',create(root){const store=new RoutineFileStore(join(root,'requested-routines-v1.json'));return{file:join(root,'requested-routines-v1.json'),write:()=>store.transaction(ledger=>{ledger.inbound.push({key:createHash('sha256').update(String(ledger.inbound.length)).digest('hex'),createdAt:new Date(NOW).toISOString()});})};}},
  {name:'voiceprint sealed-row store',create(root){const store=new FileVoiceprintStore(join(root,'voiceprints-v1.json'));return{file:join(root,'voiceprints-v1.json'),write:()=>store.put({personId:'qa-person',space:'work',provider:'synthetic',modelVersion:'v1',channel:'mini_app',consentEventId:'qa-only',createdAt:new Date(NOW),template:'vpk1.SYNTHETIC_NOT_A_REAL_TEMPLATE'}),read:()=>store.get('qa-person','work')};}},
  {name:'controlled experiment ledger',create(root){const store=new FileExperimentStorage(join(root,'controlled-experiments/v1'));return{file:join(root,'controlled-experiments/v1/ledger.json'),write:()=>store.transaction(()=>null),read:()=>store.read()};}},
  {name:'rights ledger',create(root){const store=new RightsFileStorage(join(root,'rights-intake/v1')),id=accountIdFor(70300);return{file:join(root,'rights-intake/v1',`${createHash('sha256').update(id).digest('hex')}.json`),write:()=>store.transact(id,()=>({document:{version:1,syntheticStorageWitness:true},result:null})),read:()=>store.readCommittedForEffect(id)};}},
  {name:'guest rights delegated ledger',create(root){const store=new RightsFileStorage(join(root,'guest-rights/v1')),id=accountIdFor(70300);return{file:join(root,'guest-rights/v1',`${createHash('sha256').update(id).digest('hex')}.json`),write:()=>store.transact(id,()=>({document:{version:1,syntheticStorageWitness:true},result:null}))};}},
  {name:'Connections generation pointer',create(root){const store=new FileConnectionsStorage(join(root,'connections'));return{file:join(root,'connections',createHash('sha256').update('qa-partition').digest('hex'),'current.json'),write:()=>store.transact('qa-partition',(records:RawConnectionsRecords)=>({records:{...records,audits:[...records.audits,auditSchema.parse({schemaVersion:1,id:randomUUID(),partitionId:'qa-partition',revision:1,createdAt:NOW,updatedAt:NOW,retentionUntil:NOW+60000,ownerAccountId:'qa-account',ownerPersonId:'qa-person',scope:{tenantId:'qa-tenant',spaceId:'qa-space',spaceKind:'work',containerId:'qa-container',audiencePersonIds:['qa-person'],audienceRevision:'qa-revision'},event:'qa-owner-write',subjectId:'qa-subject',operationId:null})]} as ConnectionsRecords,result:null})),read:()=>store.peek('qa-partition')};}},
];

describe('FRO1 actual FILE writer graph',()=>{
  it('source development admits only an unmarked legacy root; production, selected qualification and partial guards never bypass',()=>{
    const root=realpathSync(mkdtempSync(join(tmpdir(),'vox-fro1-dev-')));
    try{
      vi.stubEnv('NODE_ENV','development');expect(ensureStudioFileRuntimeOwner(root)).toBeUndefined();expect(readdirSync(root)).toEqual([]);
      expect(()=>ensureStudioFileRuntimeOwner(root,{requireQualified:true})).toThrow();expect(readdirSync(root)).toEqual([]);
      vi.stubEnv('NODE_ENV','production');expect(()=>ensureStudioFileRuntimeOwner(root)).toThrow();expect(readdirSync(root)).toEqual([]);
      vi.stubEnv('NODE_ENV','development');writeFileSync(join(root,'.studio-runtime-owner-v1.lock'),'{',{mode:0o600});const before=snapshot(root);
      expect(()=>ensureStudioFileRuntimeOwner(root)).toThrow();expect(snapshot(root)).toEqual(before);
    }finally{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
  });
  it('writable open has no raw asynchronous create or truncation boundary and queued loss performs zero native open',async()=>fixture(async({root,owner})=>{
    const existing=join(root,'open-existing.json'),fresh=join(root,'open-fresh.json');writeFileSync(existing,'SYNTHETIC_ORIGINAL');
    // If the implementation regresses to raw async open, this hook drains just
    // before the native effect and catches the original create/truncate gap.
    asyncOpen.hook=()=>owner.beginDrain();
    const handle=await fileRuntimePromises.open(existing,'r+');await handle.close();
    expect(asyncOpen.writableCalls).toBe(0);expect(readFileSync(existing,'utf8')).toBe('SYNTHETIC_ORIGINAL');
    const pending=Promise.resolve().then(()=>fileRuntimePromises.open(fresh,'wx',0o600));owner.beginDrain();
    await expect(pending).rejects.toThrow();expect(existsSync(fresh)).toBe(false);expect(asyncOpen.writableCalls).toBe(0);
  }));
  it('readonly native open revalidates loss after its actual await before returning a handle',async()=>fixture(async({root,owner})=>{
    const path=join(root,'readonly.json');writeFileSync(path,'SYNTHETIC_READ');const before=readFileSync(path);
    asyncOpen.hook=()=>owner.beginDrain();await expect(fileRuntimePromises.open(path,'r')).rejects.toThrow();
    expect(asyncOpen.readonlyCalls).toBe(1);expect(readFileSync(path)).toEqual(before);
  }));
  it('opaque sync descriptor refuses closed or replaced pathname, preserves successor bytes and permits own close',async()=>fixture(async({root})=>{
    const path=join(root,'descriptor.json'),descriptor=openFileRuntimeDescriptor(path,'wx',0o600);
    descriptor.writeFile('ORIGINAL');descriptor.close();expect(()=>descriptor.writeFile('FORBIDDEN')).toThrow();
    const next=join(root,'descriptor-next.json'),held=openFileRuntimeDescriptor(next,'wx',0o600);held.writeFile('HELD');
    fileRuntimeFs.renameSync(next,join(root,'descriptor-old.json'));writeFileSync(next,'SUCCESSOR');
    expect(()=>held.writeFile('FORBIDDEN')).toThrow();expect(readFileSync(next,'utf8')).toBe('SUCCESSOR');held.close();
  }));
  for(const row of writers)it(`${row.name}: valid positive write then terminal loss refuses without changing persisted bytes`,async()=>fixture(async({root,owner})=>{
    const writer=row.create(root);await writer.write();expect(existsSync(writer.file)).toBe(true);
    const before=snapshot(root);owner.beginDrain();
    await expect(Promise.resolve().then(()=>writer.write())).rejects.toThrow();expect(snapshot(root)).toEqual(before);
    if(writer.read)await expect(Promise.resolve().then(()=>writer.read!())).rejects.toThrow();
    expect(snapshot(root)).toEqual(before);
  }));

  it('Studio queued callback is never invoked after stop, and cached authority cannot escape',async()=>fixture(async({root,owner})=>{
    const store=new StudioStore(root);await store.update(()=>undefined);const before=readFileSync(join(root,'studio.json'));
    const mutate=vi.fn();const pending=store.update(mutate);owner.beginDrain();
    await expect(pending).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();expect(readFileSync(join(root,'studio.json'))).toEqual(before);
    expect(()=>store.readCommittedForEffect()).toThrow();
  }));
  it('actual canonical mutator losing ownership in flight publishes no draft or replacement and removes only own staging',async()=>fixture(async({root,owner})=>{
    const storage=new FileAdaptiveStorage(join(root,'adaptive')),id=accountIdFor(70300);
    await storage.transact(id,()=>({document:{schemaVersion:1,synthetic:'ORIGINAL'},result:null}));const before=snapshot(root);
    let called=false;
    await expect(storage.transact(id,current=>{called=true;owner.beginDrain();return{document:{...(current as object),synthetic:'FORBIDDEN'},result:null};})).rejects.toThrow();
    expect(called).toBe(true);expect(snapshot(root)).toEqual(before);
  }));

  it('canonical commit rejects deadline crossed inside actual owner descriptor validation',async()=>fixture(async({root})=>{
    const storage=new FileAdaptiveStorage(join(root,'adaptive')),id=accountIdFor(70300);
    await storage.transact(id,()=>({document:{schemaVersion:1},result:null}));
    const file=join(root,'adaptive',`${createHash('sha256').update(id).digest('hex')}.json`),before=readFileSync(file);
    let now=NOW;const deadline=NOW+1;let observed=false;
    await expect(storage.transact(id,()=>{
      // Arm only after the staged file is fsynced, so an earlier admission check
      // cannot accidentally satisfy the final publication-deadline assertion.
      ownerRead.armAfterFsync=()=>{ownerRead.hook=()=>{now=deadline;observed=true;};};
      return{document:{schemaVersion:1,changed:true},result:null};
    },()=>{if(now>=deadline)throw Error('synthetic_deadline_expired');})).rejects.toThrow('synthetic_deadline_expired');
    expect(observed).toBe(true);expect(readFileSync(file)).toEqual(before);
  }));

  it('thenable final commit fences never publish after an apparent synchronous return',async()=>fixture(async({root})=>{
    const source=join(root,'value.tmp'),target=join(root,'value.json');writeFileSync(source,'new');writeFileSync(target,'old');
    expect(()=>commitFileRuntimeRename(source,target,(()=>Promise.resolve()) as ()=>void)).toThrow();
    expect(readFileSync(target,'utf8')).toBe('old');
  }));

  it('canonical media with a .tmp suffix is not a lost-owner cleanup capability',async()=>fixture(async({root,owner})=>{
    const store=new StudioStore(root);await store.saveMedia('private.tmp',Buffer.from('SYNTHETIC_CANONICAL_MEDIA'));
    const path=join(root,'media/private.tmp'),before=readFileSync(path);owner.beginDrain();
    expect(()=>fileRuntimeFs.unlinkSync(path)).toThrow();expect(readFileSync(path)).toEqual(before);
  }));

  it('rights export policy expiring inside final owner validation makes zero ledger commit',async()=>fixture(async({root,owner})=>{
    let now=NOW,revalidations=0,expiryObserved=false;
    const policy={...syntheticRightsPolicy(),effectiveAt:NOW-1000,expiresAt:NOW+100000};
    const storage=new RightsFileStorage(join(root,'rights-intake/v1')),repository=new RightsRepository(storage);
    const service=new RightsIntakeService(repository,{key:Buffer.alloc(32,91),policy:()=>policy,clock:()=>now,
      assertAccountNow:()=>owner.assertCurrent(),assertOperatorNow:()=>owner.assertCurrent(),
      prepareExport:async()=>({data:{revision:1,memories:[]},revalidate:()=>{
        revalidations++;
        if(revalidations===2){ownerRead.hook=()=>{now=policy.expiresAt;expiryObserved=true;};owner.assertCurrent();}
      }})});
    const row=(await service.create(70300,{version:1,eventId:randomUUID(),space:'work',kind:'access_export',locale:'en',expectedIntakePolicyRevision:1})).request;
    const path=join(root,'rights-intake/v1',`${createHash('sha256').update(accountIdFor(70300)).digest('hex')}.json`),before=readFileSync(path);
    await expect(service.requesterAction(70300,'work',row.requestId,{version:1,eventId:randomUUID(),expectedRevision:row.revision,action:'prepare_local_export'})).rejects.toMatchObject({code:'reviewed_policy_unavailable'});
    expect(expiryObserved).toBe(true);expect(revalidations).toBe(2);expect(readFileSync(path)).toEqual(before);
  }));
});

describe('FRO1 actual shared Telegram final boundaries',()=>{
  it('known pre-connect retry repeats owner I/O before caller deadline and refuses the retry POST on expiry',async()=>fixture(async({owner})=>{
    let now=NOW,checks=0;const deadline=NOW+1;
    const wire=vi.fn(async()=>{throw new TypeError('synthetic preconnect',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});});
    const client=new TelegramBotClient('77001:SYNTHETIC_ONLY',wire,{beforeAuthorize(){owner.assertCurrent();if(++checks===2)now=deadline;},assertActive:()=>owner.assertActive(),signal:owner.signal});
    await expect(client.sendMessage(70300,'synthetic',{authorizeNow:()=>now<deadline})).rejects.toThrow();
    expect(checks).toBe(2);expect(wire).toHaveBeenCalledTimes(1);
  }));
  it('archive metadata cannot authorize a later document download after owner I/O crosses its deadline',async()=>fixture(async({owner})=>{
    let now=NOW,checks=0;const deadline=NOW+1;
    const wire=vi.fn(async()=>Response.json({ok:true,result:{file_path:'documents/synthetic.json',file_size:1}}));
    const client=new TelegramBotClient('77001:SYNTHETIC_ONLY',wire,{beforeAuthorize(){owner.assertCurrent();if(++checks===2)now=deadline;},assertActive:()=>owner.assertActive(),signal:owner.signal});
    await expect(client.downloadDocument('SYNTHETIC',{maxBytes:1024,authorizeNow:()=>now<deadline})).rejects.toThrow();
    expect(checks).toBe(2);expect(wire).toHaveBeenCalledTimes(1);
  }));
  it('owner filesystem work precedes the caller final deadline and prevents the actual POST',async()=>fixture(async({owner})=>{
    let now=NOW;const deadline=NOW+1,events:string[]=[];
    const wire=vi.fn(async()=>Response.json({ok:true,result:{message_id:1}}));
    const client=new TelegramBotClient('77001:SYNTHETIC_ONLY',wire,{beforeAuthorize(){owner.assertCurrent();events.push('owner');now=deadline;},assertActive(){events.push('latch');owner.assertActive();},signal:owner.signal});
    await expect(client.sendMessage(70300,'synthetic',{authorizeNow:()=>{events.push('deadline');return now<deadline;}})).rejects.toThrow();
    expect(events).toEqual(['owner','deadline']);expect(wire).not.toHaveBeenCalled();
  }));

  it('successful final clock is followed only by a pure latch and one unchanged wire body',async()=>fixture(async({owner})=>{
    const events:string[]=[];
    const wire=vi.fn(async(_url:unknown,init?:RequestInit)=>{events.push('fetch');expect(JSON.parse(String(init?.body))).toMatchObject({chat_id:70300,text:'synthetic'});return Response.json({ok:true,result:{message_id:1}});});
    const client=new TelegramBotClient('77001:SYNTHETIC_ONLY',wire,{beforeAuthorize(){events.push('owner');owner.assertCurrent();},assertActive(){events.push('latch');owner.assertActive();},signal:owner.signal});
    await client.sendMessage(70300,'synthetic',{authorizeNow:()=>{events.push('deadline');return true;}});
    expect(events).toEqual(['owner','deadline','latch','fetch']);expect(wire).toHaveBeenCalledTimes(1);
  }));
});

describe('FRO1 actual ATI owner-bound composition',()=>{
  it('actual bot stop is idempotent, drains immediately and honestly reports the retained stalled poll task at five seconds',async()=>{
    const f=await atiFixture(true,true);let runner:ReturnType<typeof startBots>|undefined;
    try{
      runner=startBots(f.h.studio);
      for(let i=0;i<200&&!f.pollOffsets.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
      expect(f.pollOffsets.length).toBeGreaterThan(0);vi.useFakeTimers();
      const done=runner.stop();expect(runner.stop()).toBe(done);expect(f.fileOwner!.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);const result=await done;expect(result.pending).toBeGreaterThan(0);
      f.push(f.update());await Promise.resolve();expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(0);
      expect(runner.stop()).toBe(done);
    }finally{vi.useRealTimers();if(runner)await runner.stop();await f.closeOwned();}
  });
  it('acquires before StudioStore and sends one exact tracked reply without assistant archive payload',async()=>{
    const f=await atiFixture(true,true);
    try{expect(f.fileOwner?.state).toBe('active');await f.handle(f.update());
      expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(1);
      expect(f.calls.find(c=>c.method==='sendMessage')?.body.text).toBe(ATI_GENERATED);
      expect(JSON.stringify(f.document())).not.toContain(ATI_GENERATED);
    }finally{await f.closeOwned();}
  });
  it('loss during reply generation prevents transport and keeps another independent data root usable',async()=>{
    const f=await atiFixture(true,true),other=await atiFixture(false,true);
    try{const complete=f.h.chatLLM.complete.bind(f.h.chatLLM);
      vi.spyOn(f.h.chatLLM,'complete').mockImplementation(async request=>{const result=await complete(request);if(!String(request.system).startsWith('You extract long-term memories'))f.fileOwner!.beginDrain();return result;});
      await f.handle(f.update());expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(0);
      await other.handle(other.update());expect(other.calls.filter(c=>c.method==='sendMessage')).toHaveLength(1);
    }finally{await f.closeOwned();await other.closeOwned();}
  });
  it('actual owner loss after one selected POST leaves durable sending and cannot commit sent or resend',async()=>{
    const f=await atiFixture(true,true);const update=f.update();
    try{
      let claimed=false;
      f.replyHook(async call=>{claimed=true;expect(call.body.text).toBe(ATI_GENERATED);f.fileOwner!.beginDrain();return Response.json({ok:true,result:{message_id:91000,date:Math.floor(NOW/1000),chat:{id:call.body.chat_id,type:'private'},text:call.body.text}});});
      await f.handle(update).catch(error=>{expect(String(error)).toMatch(/ownership|authority|current|unavailable/i);});expect(claimed).toBe(true);expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(1);
      const document=f.document(),text=JSON.stringify(document);expect(text).not.toContain(ATI_GENERATED);
      expect(document.assistantDeliveryControl?.effects.some(effect=>effect.state.phase==='sending')).toBe(true);
      expect(document.assistantDeliveryControl?.effects.some(effect=>effect.state.phase==='sent')).toBe(false);
      await f.handle(update).catch(error=>{expect(String(error)).toMatch(/ownership|authority|current|unavailable/i);});expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(1);
      expect(f.document()).toEqual(document);
    }finally{await f.closeOwned();}
  });
});
