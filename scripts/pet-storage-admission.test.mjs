// Independent protected fixtures for the approved pet FILE reader contract.
// All data is synthetic. No sanitizer is used to repair an admission fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ADAPTIVE_RELEASE_CAPABILITIES as caps, assertReleaseAdaptiveCompatibility as admit } from './studio-adaptive-compatibility.mjs';
import * as prior from './fixtures/pet-storage-admission-prior-reader/studio-adaptive-compatibility.mjs';

const PRIOR_SHA = '8cbdf815a4d1527fb105fc619132032c07117448b7b6012c3d2e91a223b6c6aa';
const refusal = 'Adaptive storage is incompatible with this release; current personalization controls must be preserved.';
const marker = '{"version":1,"kind":"assistant-delivery-control"}\n';
const uuid = 'b3c708bb-58bd-4504-93da-bc0c95f485e3';
const directories = [['play','petPlaySchema','supportedPetPlaySchemas'], ['growth','petGrowthSchema','supportedPetGrowthSchemas'], ['checkins','petCheckinSchema','supportedPetCheckinSchemas']];
const play = () => ({v:1,agentId:'agent-a',userId:7,createdAt:-1.25,updatedAt:2.5,seenAt:0,
  items:[{id:'starPin',earnedAt:0}],wearing:{head:'bowtie',hand:'glasses'},garden:{seed:'flower',plantedAt:-1,waterings:3,wateredDay:'2026-99-99',bloomedAt:1.5},
  book:[{id:'met',at:0}],games:{bop:{rounds:20,best:true,zen:false,day:'2026-10-27',today:60,lastRound:'1234abcd'}},
  tips:{T14:{shown:2,dismissed:false,lastShownAt:-1,lastDay:'2026-10-27'}},asks:{P3b:{lastAskedAt:0,declined:2,lastDeclinedAt:1,lastDay:'2026-10-27',acceptedAt:0}},
  seasons:{yalda:1301,nowruz:1699},litMine:[{id:'taught-one',litAt:-2.75,ref:'a'.repeat(16)}],visitsOpen:true});
const growth = () => ({agentId:'agent-a',lit:[{id:'first-task',kind:'task',at:-1.5,ref:'b'.repeat(64),dimmedAt:0.25}]});
const agent = () => ({enabled:false,types:{growingUp:true,seasons:false,garden:true,hellos:false,careNudges:false},week:[0,0,1,2,3,4]});
const consent = () => ({purpose:'optional.pet_checkins',state:'withdrawn',revision:1,effectiveAt:5,withdrawnAt:0,withdrawnVia:'settings',evidence:{
  eventId:'event_0001',noticeId:'perm.P1.forming',noticeVersion:'pet-checkins-v1',copyHash:'c'.repeat(64),locale:'fa',presentedAt:9,decidedAt:0,surface:'mini_app',affirmative:true}});
const sent = () => ({ref:'abcdefgh_1234567',agentId:'retired-agent',moment:'C11',occurrence:'nowruz:1405',day:'2026-99-99',personHash:'d'.repeat(16),
  at:0,state:'unknown',lang:'fa',variant:15,openedAt:0,openedVia:'app',whyAt:0,stoppedAt:0,by:'local'});
const checkin = () => ({v:1,userId:7,createdAt:0,updatedAt:0,lang:'en',sound:false,unopenedStreak:100,tz:'UTC',pausedAt:0,pausedNoteAt:0,resumedAt:0,
  agents:{'agent-a':{...agent(),enabled:true,consent:consent(),lastSentAt:0}},seasons:{yalda:1300,nowruz:1600},sent:[sent(),sent()]});

function snapshot(root) {
  const result = [];
  function visit(path, rel) {
    const info = fs.lstatSync(path);
    result.push([rel,info.mode,info.nlink, info.isSymbolicLink() ? ['link',fs.readlinkSync(path)] : info.isDirectory() ? ['dir'] : ['file',fs.readFileSync(path).toString('base64')]]);
    if(info.isDirectory()) for(const name of fs.readdirSync(path).sort()) visit(join(path,name),`${rel}/${name}`);
  }
  visit(root,''); return result;
}
function fixture(run) {
  const root = fs.mkdtempSync(join(tmpdir(),'vox-pet-reader-'));
  const env = {STUDIO_DATA_DIR:root,STUDIO_ADAPTIVE_FORMAT:'file'};
  const put = (path,value) => {const file=join(root,path);fs.mkdirSync(dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});return file;};
  const read = (expected = true, manifest = caps, reader = admit) => {
    const before=snapshot(root), oldFetch=globalThis.fetch;let calls=0;
    globalThis.fetch=()=>{calls++;throw new Error('Synthetic reader attempted network');};
    try {if(expected) return reader(env,manifest);assert.throws(()=>reader(env,manifest),error=>{assert.equal(error.message,refusal);return true;});}
    finally {globalThis.fetch=oldFetch;assert.equal(calls,0);assert.deepEqual(snapshot(root),before,'reader changed synthetic storage');}
  };
  try{return run({root,env,put,read});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
function populated(f) {f.put('pets/play/agent-a.json',{'7':play()});f.put('pets/growth/agent-a.json',growth());f.put('pets/checkins/7.json',checkin());}
function malformed(label, path, make, mutate) {
  test(`pet reader refuses ${label}`,()=>fixture(f=>{const value=make();mutate(value);f.put(path,value);f.read(false);}));
}

test('pet prior oracle is the verbatim actual ca41 helper, with a committed hash manifest',()=>{
  const bytes=fs.readFileSync(new URL('./fixtures/pet-storage-admission-prior-reader/studio-adaptive-compatibility.mjs',import.meta.url));
  const manifest=JSON.parse(fs.readFileSync(new URL('./fixtures/pet-storage-admission-prior-reader/manifest.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),PRIOR_SHA);assert.equal(manifest.sha256,PRIOR_SHA);assert.equal(manifest.sourceCommit,'ca41f0841c99a00ef769fdd227b33d4ba8736dee');
});
test('pet absent directories preserve legacy admission and declare no new requirement',()=>fixture(f=>{
  const required=f.read(true,null);for(const [,key,field]of directories){assert.equal(required[key],undefined);assert.deepEqual(caps[field],[1]);}
}));
for(const [dir,key,field]of directories) {
  test(`pet empty ${dir} directory requires its own explicit capability and actual prior reader refuses`,()=>fixture(f=>{
    fs.mkdirSync(join(f.root,'pets',dir),{recursive:true});assert.equal(f.read()[key],1);
    const without={...caps};delete without[field];f.read(false,without);f.read(false,null);f.read(false,prior.ADAPTIVE_RELEASE_CAPABILITIES,prior.assertReleaseAdaptiveCompatibility);
    for(const bad of [null,[],[2],[1,1],'1',[1,2],false])f.read(false,{...caps,[field]:bad});
  }));
}
test('pet full stores coexist with care, epochs and ARC marker; prior accepts ARC alone then refuses pet-only and combined',()=>fixture(f=>{
  f.put('adaptive/assistant-delivery-control-v1.json',marker);
  const accountId='telegram-account:123',accountKey=createHash('sha256').update(accountId).digest('hex');
  const personHash=createHash('sha256').update(JSON.stringify(accountId)).digest('hex');
  f.put(`adaptive/${accountKey}.json`,{schemaVersion:1,accountId,personId:`account-profile:${personHash.slice(0,32)}`,revision:1,createdAt:100,updatedAt:100,
    assistantDeliveryControl:{version:1,policyVersion:'arc1-control-7d-v1',revision:0,observedAt:100,noReplayBefore:100,sourceFenceSequence:0,historyEpoch:0,deletionEpoch:0,streams:[],effects:[]}});
  assert.equal(f.read(true,prior.ADAPTIVE_RELEASE_CAPABILITIES,prior.assertReleaseAdaptiveCompatibility).assistantDeliveryControlVersion,1);
  populated(f);f.put('pets/agent-a.json',{'7':{v:1,agentId:'agent-a',userId:7}});f.put('pets/.epochs/7.json',{v:1,epoch:uuid});
  const r=f.read();for(const [,key]of directories)assert.equal(r[key],1);assert.equal(r.petCareSchema,1);assert.equal(r.assistantDeliveryControlVersion,1);
  f.read(false,prior.ADAPTIVE_RELEASE_CAPABILITIES,prior.assertReleaseAdaptiveCompatibility);
  fs.rmSync(join(f.root,'adaptive'),{recursive:true});f.read(false,prior.ADAPTIVE_RELEASE_CAPABILITIES,prior.assertReleaseAdaptiveCompatibility);
}));
test('pet full metadata keeps finite fractional play/growth times and distinct year ranges without inventing authority rules',()=>fixture(f=>{populated(f);f.read();}));

for(const [label,mutate]of [
  ['play version',p=>{p.v=2;}],['play identity',p=>{p.userId=8;}],['play free text',p=>{p.note='synthetic text';}],
  ['play unknown item',p=>{p.items[0].id='other';}],['play duplicate item',p=>{p.items.push({...p.items[0]});}],
  ['play nested free text',p=>{p.games.bop.note='synthetic';}],['play count overflow',p=>{p.garden.waterings=4;}],
  ['play visitsOpen false outside stored normal form',p=>{p.visitsOpen=false;}],['play terminal newline catalogue',p=>{p.wearing.head='bowtie\n';}],
  ['play lower year boundary',p=>{p.seasons.yalda=1300;}],['play wrong container',p=>{p.tips=[];}],['play nonfinite JSON number',p=>{p.createdAt=null;}],
])malformed(label,'pets/play/agent-a.json',()=>({'7':play()}),v=>mutate(v['7']));
for(const [label,mutate]of [
  ['growth extra version',g=>{g.v=1;}],['growth identity',g=>{g.agentId='agent-b';}],['growth kind',g=>{g.lit[0].kind='unknown';}],
  ['growth duplicate ID',g=>{g.lit.push({...g.lit[0]});}],['growth slug newline',g=>{g.lit[0].id='valid\n';}],['growth extra field',g=>{g.lit[0].text='synthetic';}],
])malformed(label,'pets/growth/agent-a.json',growth,mutate);
for(const [label,mutate]of [
  ['checkin identity',c=>{c.userId=8;}],['checkin future version',c=>{c.v=2;}],['checkin fractional time',c=>{c.updatedAt=0.5;}],
  ['checkin negative time',c=>{c.createdAt=-1;}],['checkin unsafe time',c=>{c.createdAt=9007199254740992;}],['checkin unknown top field',c=>{c.note='synthetic';}],
  ['checkin seventh week counter',c=>{c.agents['agent-a'].week.push(5);}],['checkin missing type',c=>{delete c.agents['agent-a'].types.hellos;}],
  ['checkin false affirmative evidence',c=>{c.agents['agent-a'].consent.evidence.affirmative=false;}],['checkin consent revision overflow',c=>{c.agents['agent-a'].consent.revision=1000001;}],
  ['checkin timezone newline',c=>{c.tz='UTC\n';}],['checkin upper year boundary',c=>{c.seasons.yalda=1601;}],
  ['checkin sent free text',c=>{c.sent[0].text='synthetic';}],['checkin unknown sent state',c=>{c.sent[0].state='delivered';}],['checkin sent variant overflow',c=>{c.sent[0].variant=16;}],
])malformed(label,'pets/checkins/7.json',checkin,mutate);

test('pet stored array and checkin-agent limits accept exact maxima and refuse one over without truncation',()=>fixture(f=>{
  const p=play(),g=growth(),c=checkin();p.litMine=Array.from({length:64},(_,i)=>({id:`mine-${i}`,litAt:0}));
  g.lit=Array.from({length:64},(_,i)=>({id:`lit-${i}`,kind:'room',at:0}));
  c.sent=Array.from({length:60},sent);c.agents=Object.fromEntries(Array.from({length:64},(_,i)=>[`agent-${i}`,agent()]));
  const write=()=>{f.put('pets/play/agent-a.json',{'7':p});f.put('pets/growth/agent-a.json',g);f.put('pets/checkins/7.json',c);};write();f.read();
  p.litMine.push({id:'over',litAt:0});write();f.read(false);p.litMine.pop();
  g.lit.push({id:'over',kind:'room',at:0});write();f.read(false);g.lit.pop();
  c.sent.push(sent());write();f.read(false);c.sent.pop();c.agents.over=agent();write();f.read(false);
}));
test('pet user and agent names must be canonical with an absolute end',()=>fixture(f=>{
  for(const path of ['pets/play/agent-a.json\n','pets/play/agent.a.json','pets/checkins/07.json','pets/checkins/0.json','pets/checkins/9007199254740992.json','pets/checkins/7.json\n']){
    const file=f.put(path,path.includes('checkins')?checkin():{'7':play()});f.read(false);fs.rmSync(file);
  }
  for(const user of ['07','0','7\n','9007199254740992']){const file=f.put('pets/play/agent-a.json',{[user]:play()});f.read(false);fs.rmSync(file);}
}));
test('pet unknown root names, temp files, nested directories and malformed JSON refuse unchanged',()=>fixture(f=>{
  const emptyCare=f.put('pets/unrecognized.json',{});f.read();f.read(true,prior.ADAPTIVE_RELEASE_CAPABILITIES,prior.assertReleaseAdaptiveCompatibility);fs.rmSync(emptyCare);
  for(const path of ['pets/unrecognized','pets/play/agent-a.json.tmp','pets/growth/agent-a.tmp','pets/checkins/7.json.tmp']){const file=f.put(path,'{}');f.read(false);fs.rmSync(file);}
  fs.mkdirSync(join(f.root,'pets/play/nested'),{recursive:true});f.read(false);fs.rmdirSync(join(f.root,'pets/play/nested'));
  const file=f.put('pets/play/agent-a.json','{broken');f.read(false);fs.rmSync(file);f.put('pets/growth/agent-a.json',[]);f.read(false);
}));
test('pet root lock refuses before any read, even with valid known stores',()=>fixture(f=>{populated(f);fs.mkdirSync(join(f.root,'pets/.writer.lock'));f.read(false);}));
test('pet recognized roots, directories and files cannot be symbolic or hard links',()=>fixture(f=>{
  const target=f.put('outside/agent-a.json',{'7':play()});fs.mkdirSync(join(f.root,'pets/play'),{recursive:true});
  const file=join(f.root,'pets/play/agent-a.json');fs.symlinkSync(target,file);f.read(false);fs.rmSync(file);fs.linkSync(target,file);f.read(false);fs.rmSync(file);
  fs.rmdirSync(join(f.root,'pets/play'));fs.symlinkSync(join(f.root,'outside'),join(f.root,'pets/play'));f.read(false);fs.rmSync(join(f.root,'pets/play'));
  fs.rmSync(join(f.root,'pets'),{recursive:true});fs.symlinkSync(join(f.root,'outside'),join(f.root,'pets'));f.read(false);
}));

// Deterministic synthetic writer interference. Hook only the chosen inode and
// restore the builtin immediately; post-change snapshots distinguish the writer
// mutation from the reader's own required zero-write behavior.
for(const change of ['lock','directory','file'])test(`pet admission refuses ${change} change during a bounded read`,()=>fixture(f=>{
  const file=f.put('pets/play/agent-a.json',{'7':play()}),target=fs.statSync(file),original=fs.readSync,oldFetch=globalThis.fetch;let fired=false,afterWriter,fetches=0;
  globalThis.fetch=()=>{fetches++;throw new Error('Network forbidden in synthetic reader');};
  fs.readSync=function(fd,...args){const result=Reflect.apply(original,fs,[fd,...args]);const info=fs.fstatSync(fd);
    if(!fired&&info.dev===target.dev&&info.ino===target.ino){fired=true;
      if(change==='lock')fs.mkdirSync(join(f.root,'pets/.writer.lock'));
      if(change==='directory'){fs.renameSync(join(f.root,'pets/play'),join(f.root,'pets/retired'));fs.mkdirSync(join(f.root,'pets/play'));}
      if(change==='file'){fs.writeFileSync(file,'{}');fs.utimesSync(file,new Date(0),new Date(0));}
      afterWriter=snapshot(f.root);
    }return result;};syncBuiltinESMExports();
  try{assert.throws(()=>admit(f.env,caps),error=>{assert.equal(error.message,refusal);return true;});assert.equal(fired,true);assert.equal(fetches,0);assert.deepEqual(snapshot(f.root),afterWriter);}
  finally{fs.readSync=original;syncBuiltinESMExports();globalThis.fetch=oldFetch;}
}));
test('pet shared enumeration counts the directory and its children at exact 10000-entry boundary',()=>fixture(f=>{
  fs.mkdirSync(join(f.root,'pets/play'),{recursive:true});for(let i=0;i<9999;i++)f.put(`pets/play/a${i}.json`,{});f.read();
  f.put('pets/play/over.json',{});f.read(false);
}));
test('pet file and aggregate byte ceilings remain exact and shared with existing care records',()=>fixture(f=>{
  // This is an existing-care reader projection, not a claim of a full care
  // writer record. Its permitted padding isolates unchanged aggregate accounting.
  function careBytes(agentId,bytes){const r={'7':{v:1,agentId,userId:7,padding:''}};r['7'].padding='x'.repeat(bytes-Buffer.byteLength(JSON.stringify(r)));const text=JSON.stringify(r);assert.equal(Buffer.byteLength(text),bytes);return text;}
  f.put('pets/play/agent-a.json',{});f.put('pets/a0.json',careBytes('a0',700000));f.read();
  f.put('pets/a0.json',careBytes('a0',700001));f.read(false);f.put('pets/a0.json',careBytes('a0',700000));
  for(let i=1;i<95;i++)f.put(`pets/a${i}.json`,careBytes(`a${i}`,700000));
  const remaining=64*1024*1024-95*700000-2;assert.ok(remaining>0&&remaining<=700000);
  f.put('pets/final.json',careBytes('final',remaining));f.read();f.put('pets/final.json',careBytes('final',remaining+1));f.read(false);
}));
