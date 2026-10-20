import { createHash } from 'node:crypto';
import type { AdaptiveDocument } from '../persistence/repository';
import { rightsUseControlsSchema, rightsUseEffectDescriptorSchema, rightsUseHoldsSchema, RIGHTS_USE_SCOPES,
  type RightsUseControls, type RightsUseHolds, type RightsUseEffect, type RightsUseEffectDescriptor, type RightsUseScope } from './contracts';
function canonical(value:unknown):string {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;}
export const rightsUseDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const sameRightsUseScope=(a:RightsUseScope,b:RightsUseScope)=>a.space===b.space&&a.purpose===b.purpose;
export function emptyRightsUseHolds():RightsUseHolds{return {version:1,scopes:RIGHTS_USE_SCOPES.map(s=>({...s,useEpoch:0})),effects:[]};}
export function rightsUseEffectDescriptor(effect:RightsUseEffect):RightsUseEffectDescriptor {
  return rightsUseEffectDescriptorSchema.parse({effectId:effect.effectId,requestId:effect.requestId,space:effect.space,purpose:effect.purpose,state:effect.state,
    revision:effect.revision,appliedAt:effect.appliedAt,applyIntentDigest:effect.applyIntentDigest,effectDigest:rightsUseDigest(effect),
    ...(effect.release?{releasedAt:effect.release.releasedAt,releaseIntentDigest:effect.release.releaseIntentDigest}:{})});
}
const activeDigest=(effects:RightsUseEffectDescriptor[],scope:RightsUseScope)=>rightsUseDigest(effects.filter(e=>sameRightsUseScope(e,scope)&&e.state==='active').sort((a,b)=>a.effectId<b.effectId?-1:a.effectId>b.effectId?1:0));
export function compactRightsUseHolds(raw:RightsUseHolds):RightsUseControls {
  const d=rightsUseHoldsSchema.parse(raw),effects=d.effects.map(rightsUseEffectDescriptor);
  return {version:1,scopes:d.scopes.map(s=>({...s,effectiveBlocked:effects.some(e=>sameRightsUseScope(e,s)&&e.state==='active'),activeEffectsDigest:activeDigest(effects,s)})),effects};
}
export function parseRightsUseControls(raw:unknown):RightsUseControls {
  const c=rightsUseControlsSchema.parse(raw);
  if(c.scopes.some(s=>s.effectiveBlocked!==c.effects.some(e=>sameRightsUseScope(e,s)&&e.state==='active')||s.activeEffectsDigest!==activeDigest(c.effects,s)||
    s.useEpoch<c.effects.filter(e=>sameRightsUseScope(e,s)).reduce((n,e)=>n+(e.state==='released'?2:1),0)))throw Error('Invalid rights use controls');
  return c;
}
type Authority={schemaVersion:number;rightsUseHolds?:RightsUseHolds;rightsUseControls?:RightsUseControls};
export function rightsUseControlState(d:Authority,scope:RightsUseScope):{effectiveBlocked:boolean;useEpoch:number}|undefined {
  if(d.schemaVersion===1||d.schemaVersion===2)return {effectiveBlocked:false,useEpoch:0};
  if(d.schemaVersion!==3)return undefined;
  try {const c=d.rightsUseControls?parseRightsUseControls(d.rightsUseControls):compactRightsUseHolds(d.rightsUseHolds!);return c.scopes.find(s=>sameRightsUseScope(s,scope));}catch{return undefined;}
}
export function rightsUseAllowed(d:Authority,space:RightsUseScope['space'],purpose:string):boolean {
  if(!['optional.personalization','optional.product_analytics'].includes(purpose))return true;
  return rightsUseControlState(d,{space,purpose:purpose as RightsUseScope['purpose']})?.effectiveBlocked===false;
}
export function rightsUseStamp(d:Authority,space:RightsUseScope['space'],purpose:RightsUseScope['purpose']):string {
  return rightsUseDigest(['vox.rights-use.v1',space,purpose,rightsUseControlState(d,{space,purpose})??null]);
}
/** Max JSON UTF8 for any bounded JS string is six escaped bytes per code unit.
 * Data witnesses are serializable strict-schema values, not runtime durations. */
const maxString=(n:number)=>'\u0000'.repeat(n),MAX=Number.MAX_SAFE_INTEGER;
const maxPolicy=()=>({id:maxString(100),revision:MAX,digest:'f'.repeat(64),approvalReference:maxString(200),decisionReference:maxString(200)});
const maxNotice=()=>({version:maxString(100),digest:'f'.repeat(64)});
export function requireRightsUseHoldCapacity(document:AdaptiveDocument):void {
  if(document.schemaVersion!==3)return;
  const holds=rightsUseHoldsSchema.parse(document.rightsUseHolds),active=holds.effects.filter(e=>e.state==='active');
  if(document.revision>MAX-active.length||holds.scopes.some(s=>s.useEpoch>MAX-active.filter(e=>sameRightsUseScope(e,s)).length)||active.some(e=>e.revision===MAX))throw Error('Rights use hold counter capacity exceeded');
  const future=structuredClone(document),futureHolds=future.rightsUseHolds!;
  future.revision=MAX;future.updatedAt=MAX;
  futureHolds.scopes.forEach(s=>{s.useEpoch=MAX;});
  futureHolds.effects=futureHolds.effects.map(e=>e.state==='released'?e:{...e,state:'released',revision:MAX,metadataRetainUntil:MAX,replayRetainUntil:MAX,
    release:{releasedAt:MAX,releaseIntentDigest:'f'.repeat(64),policy:maxPolicy(),notice:maxNotice()}});
  rightsUseHoldsSchema.parse(futureHolds);
  const payload={...future} as Partial<AdaptiveDocument>;delete payload.productPause;
  if(Buffer.byteLength(JSON.stringify(payload))+2048>700000||Buffer.byteLength(JSON.stringify(document))>700000)throw Error('Rights use hold reserved capacity exceeded');
}
/** Every canonical writer preserves the append-only effect proof and scope ABA
 * barriers. A stale schema-3 snapshot cannot erase a more recent restriction. */
export function validateRightsUseHoldTransition(before:AdaptiveDocument|null,after:AdaptiveDocument):void {
  if(!before||before.schemaVersion!==3)return;
  if(after.schemaVersion!==3)throw Error('Rights use schema downgrade');
  if(before.retentionStoreIdentity!==after.retentionStoreIdentity)throw Error('Retention namespace replacement');
  const old=rightsUseHoldsSchema.parse(before.rightsUseHolds),next=rightsUseHoldsSchema.parse(after.rightsUseHolds);
  if(rightsUseDigest(old)!==rightsUseDigest(next)&&after.revision<=before.revision)throw Error('Rights use account revision did not advance');
  const deltas=new Map(RIGHTS_USE_SCOPES.map(s=>[`${s.space}:${s.purpose}`,0]));
  for(const prior of old.effects){
    const effect=next.effects.find(e=>e.effectId===prior.effectId);
    if(!effect)throw Error('Rights use effect removal');
    if(rightsUseDigest(prior)===rightsUseDigest(effect))continue;
    const unchanged={...effect,state:prior.state,revision:prior.revision,metadataRetainUntil:prior.metadataRetainUntil,replayRetainUntil:prior.replayRetainUntil};delete unchanged.release;
    if(prior.state!=='active'||effect.state!=='released'||effect.revision!==prior.revision+1 ||
      effect.metadataRetainUntil<prior.metadataRetainUntil||effect.replayRetainUntil<prior.replayRetainUntil ||
      rightsUseDigest(unchanged)!==rightsUseDigest(prior))throw Error('Rights use effect replacement');
    const key=`${effect.space}:${effect.purpose}`;deltas.set(key,deltas.get(key)!+1);
  }
  for(const effect of next.effects.filter(e=>!old.effects.some(p=>p.effectId===e.effectId))){
    if(effect.state!=='active'||effect.revision!==1)throw Error('Invalid initial rights use effect');
    const key=`${effect.space}:${effect.purpose}`;deltas.set(key,deltas.get(key)!+1);
  }
  if(next.scopes.some((s,i)=>s.useEpoch!==old.scopes[i].useEpoch+deltas.get(`${s.space}:${s.purpose}`)!))throw Error('Rights use epoch replacement');
}
