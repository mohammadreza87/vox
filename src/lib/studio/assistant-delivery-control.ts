/** ARC1 actual FILE adapter. Deliberately absent from runtime composition. No network API. */
import { types } from 'node:util';
import { FileAdaptiveStorage } from '../adaptive/persistence/storage';
import { accountIdFor, containerIdFor, digest, type AdaptiveDocument, type SpaceKind } from '../adaptive/persistence/repository';
import type { AdaptiveService } from '../adaptive/persistence/service';
import { advanceAssistantControl, assistantExpected, assistantFutureStateBytes, AssistantControlError, ASSISTANT_CONTROL_STATE_BYTES, ASSISTANT_CONTROL_TTL_MS,
  emptyAssistantDeliveryControl, exportAssistantDeliveryControl, invalidateAssistantDeliveryScope, invalidateAssistantDeliverySource, pruneAssistantDeliveryControl } from '../adaptive/assistant-delivery-control';
import { assertPreparedIntegrity, prepareAssistantText, reduceDelivery, type DeliveryAuthority, type DeliveryBinding, type DeliveryState, type PreparedAssistantText, type ResponseProjection, type TransportEvidence } from '../tireh/delivery/assistant-text-protocol';
export interface AssistantDeliveryIngress {botId:number;chatId:number;fromId:number;isBot:false;chatType:'private';kind:'initial-text';messageId:number;updateId:number;dateSeconds:number}
export interface AssistantDeliveryBinding {scope:{agentId:string;space:SpaceKind};binding:DeliveryBinding;stamp:string}
export interface AssistantDeliveryControlOptions {
  now:()=>number;
  /** Trusted committed Studio projection; null on busy, ambiguity, or denial. Not client/model input. */
  bindingFor:(botId:number,ownerId:number)=>AssistantDeliveryBinding|null;
  keys:{current():{keyId:string;key:Uint8Array};resolve(keyId:string):Uint8Array|undefined};
}
export interface AssistantDeliveryPrepareInput {ownerId:number;ingress:AssistantDeliveryIngress;generatedText:string;decoratedText:string;generationId:string;attemptId:string}
const MAX=Number.MAX_SAFE_INTEGER;
const equal=(a:unknown,b:unknown)=>digest(a)===digest(b);
/** Detached ordinary data only, without invoking accessors/toJSON/proxy traps. */
const byteLengthGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!;
function copyBytes(value:Uint8Array,limit:number):Uint8Array {const length=byteLengthGetter.call(value) as number;if(length>limit)throw new AssistantControlError('capacity');const result=new Uint8Array(length);Uint8Array.prototype.set.call(result,value);return result;}
function snapshot<T>(input:T):T {
  let nodes=0;const seen=new Set<object>();
  const visit=(v:unknown,depth:number):unknown=>{
    if(++nodes>2048||depth>32)throw new AssistantControlError('shape');
    if(v===null||['string','boolean'].includes(typeof v))return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(typeof v!=='object'||types.isProxy(v))throw new AssistantControlError('shape');
    if(types.isUint8Array(v))return copyBytes(v,32768);
    if(seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))throw new AssistantControlError('shape');
    seen.add(v);const descriptors=Object.getOwnPropertyDescriptors(v),out:Record<string,unknown>|unknown[]=Array.isArray(v)?[]:{};
    for(const k of Reflect.ownKeys(descriptors)){
      if(Array.isArray(v)&&k==='length')continue;
      if(typeof k!=='string'||!('value' in descriptors[k])||!descriptors[k].enumerable)throw new AssistantControlError('shape');
      Object.defineProperty(out,k,{value:visit(descriptors[k].value,depth+1),enumerable:true,writable:true,configurable:true});
    }
    seen.delete(v);return out;
  };
  return visit(input,0) as T;
}
export class AssistantDeliveryControlAdapter {
  private readonly storage:FileAdaptiveStorage;
  constructor(readonly adaptive:AdaptiveService,readonly options:AssistantDeliveryControlOptions){
    const storage=adaptive.repository.storage;
    if(storage.canonicalSchemaVersion!==undefined||storage.indexed||storage.identity||!(storage instanceof FileAdaptiveStorage)||storage.constructor!==FileAdaptiveStorage)throw new AssistantControlError('unsupported');
    this.storage=storage;
  }
  private owner(id:number):string {if(!Number.isSafeInteger(id)||id<=0)throw new AssistantControlError('scope');return accountIdFor(id);}
  private now():number {const now=this.options.now();if(!Number.isSafeInteger(now)||now<0||Object.is(now,-0))throw new AssistantControlError('clock');return now;}
  private committed(owner:number):AdaptiveDocument {
    this.storage.assertAssistantDeliveryControlMarker();
    const read=this.adaptive.repository.readCommittedForEffect(this.owner(owner),()=>this.now());
    if(read.status!=='ready')throw new AssistantControlError(read.status==='busy'?'busy':'unsupported');
    if(!read.document?.assistantDeliveryControl)throw new AssistantControlError('authority');
    if(read.document.schemaVersion!==1)throw new AssistantControlError('unsupported');return read.document;
  }
  private key(id:string):Uint8Array {const key=this.options.keys.resolve(id);if(!types.isUint8Array(key)||types.isProxy(key)||byteLengthGetter.call(key)!==32)throw new AssistantControlError('key_unavailable');return copyBytes(key,32);}
  private ingress(owner:number,i:AssistantDeliveryIngress,now:number):number {
    if(!i||i.kind!=='initial-text'||i.chatType!=='private'||i.isBot!==false||i.chatId!==owner||i.fromId!==owner||
      ![i.botId,i.chatId,i.fromId,i.messageId].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isSafeInteger(i.updateId)||i.updateId<0||Object.is(i.updateId,-0)||
      !Number.isSafeInteger(i.dateSeconds)||i.dateSeconds<0||Object.is(i.dateSeconds,-0)||!Number.isSafeInteger(i.dateSeconds*1000)||i.dateSeconds*1000>now)throw new AssistantControlError('scope');
    return i.dateSeconds*1000;
  }
  private projection(d:AdaptiveDocument,botId:number,owner:number,now:number){
    const c=d.assistantDeliveryControl;if(!c||now<c.observedAt||[d.revision,c.revision,c.sourceFenceSequence,c.historyEpoch,c.deletionEpoch].some(n=>n>=MAX-64))throw new AssistantControlError('revision');
    const projected=this.options.bindingFor(botId,owner),bound=projected?snapshot(projected):null;if(!bound||bound.binding.botId!==botId||bound.binding.destinationChatId!==owner)throw new AssistantControlError('authority');
    const {agentId,space}=bound.scope;
    if(!['work','personal'].includes(space)||!this.adaptive.isCoreAllowed(d,now)||!['optional.personalization','optional.auto_memory'].every(p=>this.adaptive.isPurposeAllowed(d,space,p as 'optional.personalization'|'optional.auto_memory',now,agentId)))throw new AssistantControlError('authority');
    const grants=d.agentGrants.filter(g=>g.agentId===agentId&&g.space===space).sort((a,b)=>a.revision-b.revision);
    if(!grants.some(g=>g.allowed))throw new AssistantControlError('authority');
    const scope={accountId:d.accountId,personId:d.personId,agentId,space,containerId:containerIdFor(d.accountId,space),kind:'private' as const};
    const stream=c.streams.find(s=>s.botId===botId&&s.destinationChatId===owner);
    if(stream&&(stream.agentId!==agentId||stream.space!==space||stream.containerId!==scope.containerId))throw new AssistantControlError('route_conflict');
    const purposes=['optional.personalization','optional.auto_memory'] as const;
    const permissions=purposes.map(p=>d.permissions.find(r=>r.purpose===p&&r.spaceId.endsWith(`:${space}`))!);
    const expiresAt=Math.min(d.binding?.expiresAt??now,this.adaptive.capabilityStatus(d,'core_text',now).validUntil??now,
      ...permissions.map(p=>p.expiresAt),...purposes.map(p=>this.adaptive.capabilityStatus(d,p==='optional.auto_memory'?'auto_memory':'personalization',now).validUntil??MAX));
    if(expiresAt<=now)throw new AssistantControlError('authority');
    const authority:DeliveryAuthority={authorityRevision:digest(['arc1-authority',d.accountId,d.personId,d.binding,this.adaptive.coreFingerprint(d,now),purposes.map(p=>this.adaptive.purposeFingerprint(d,space,p,now,agentId)),bound]),
      grantRevision:digest(['arc1-grant',grants,permissions.map(p=>[p.epoch,p.revision])]),sourceFenceRevision:digest(['arc1-source',d.accountId,c.sourceFenceSequence,c.noReplayBefore,stream?.messageFloor??0]),
      sourceFenceSequence:c.sourceFenceSequence,historyEpoch:c.historyEpoch,deletionEpoch:c.deletionEpoch,expiresAt};
    return {scope,binding:bound.binding,authority,stream};
  }
  private current(d:AdaptiveDocument,s:DeliveryState,now:number):boolean {
    try {const owner=s.binding.destinationChatId,p=this.projection(d,s.binding.botId,owner,now),c=d.assistantDeliveryControl!;
      return d.accountId===this.owner(owner)&&equal(p.scope,s.scope)&&equal(p.binding,s.binding)&&equal(p.authority,s.authority)&&s.source.revision===0&&s.source.occurredAt>c.noReplayBefore&&s.source.messageId>(p.stream?.messageFloor??0)&&s.contentEligible&&now<s.expiresAt;
    }catch{return false;}
  }
  private write<T>(owner:number,fn:(d:AdaptiveDocument,now:number)=>T):Promise<T>{
    this.storage.assertAssistantDeliveryControlMarker();
    return this.adaptive.repository.assistantDeliveryTransaction(this.owner(owner),()=>this.now(),(d,now)=>{
      if(!d.assistantDeliveryControl||d.schemaVersion!==1)throw new AssistantControlError('authority');
      const before=digest(d.assistantDeliveryControl),result=fn(d,now);
      if(digest(d.assistantDeliveryControl)!==before){if(d.revision>=MAX)throw new AssistantControlError('revision');d.revision++;d.updatedAt=now;}
      return result;
    });
  }
  async initialize(owner:number):Promise<void>{
    const account=this.owner(owner),before=this.adaptive.repository.readCommittedForEffect(account,()=>this.now());
    if(before.status!=='ready')throw new AssistantControlError(before.status==='busy'?'busy':'unsupported');
    if(!before.document||before.document.schemaVersion!==1||!this.adaptive.isProfileConfirmed(before.document,this.now()))throw new AssistantControlError('authority');
    await this.storage.ensureAssistantDeliveryControlMarker();
    await this.adaptive.repository.assistantDeliveryTransaction(this.owner(owner),()=>this.now(),(d,now)=>{
      if(d.schemaVersion!==1||!this.adaptive.isProfileConfirmed(d,now))throw new AssistantControlError('authority');
      if(d.assistantDeliveryControl)return;
      d.assistantDeliveryControl=emptyAssistantDeliveryControl(now);if(d.revision>=MAX)throw new AssistantControlError('revision');d.revision++;d.updatedAt=now;
    });
  }
  prepare(input:AssistantDeliveryPrepareInput):PreparedAssistantText {
    input=snapshot(input);
    const now=this.now(),d=this.committed(input.ownerId),occurredAt=this.ingress(input.ownerId,input.ingress,now),p=this.projection(d,input.ingress.botId,input.ownerId,now),c=d.assistantDeliveryControl!;
    if(occurredAt<=c.noReplayBefore||input.ingress.messageId<=(p.stream?.messageFloor??0))throw new AssistantControlError('replay_fenced');
    const key=this.options.keys.current();if(!types.isUint8Array(key.key)||types.isProxy(key.key)||byteLengthGetter.call(key.key)!==32)throw new AssistantControlError('key_unavailable');
    return prepareAssistantText({scope:p.scope,binding:p.binding,source:{messageId:input.ingress.messageId,updateId:input.ingress.updateId,revision:0,occurredAt,acceptedAt:now},authority:p.authority,
      generationId:input.generationId,attemptId:input.attemptId,generatedText:input.generatedText,decoratedText:input.decoratedText,keyId:key.keyId,evidenceKey:key.key,now,expiresAt:Math.min(p.authority.expiresAt,now+60000)});
  }
  async claim(prepared:PreparedAssistantText,ingress:AssistantDeliveryIngress):Promise<{status:'claimed';state:DeliveryState}|{status:'already_claimed';phase:DeliveryState['phase']}>{
    prepared=snapshot(prepared);ingress=snapshot(ingress);
    const s=prepared.initialState,key=this.key(s.evidence.keyId);assertPreparedIntegrity(prepared,key);
    return this.write(s.binding.destinationChatId,(d,now)=>{
      assertPreparedIntegrity(prepared,key);
      this.ingress(s.binding.destinationChatId,ingress,now);
      if(ingress.botId!==s.binding.botId||ingress.messageId!==s.source.messageId||ingress.updateId!==s.source.updateId||ingress.dateSeconds*1000!==s.source.occurredAt)throw new AssistantControlError('scope');
      const c=d.assistantDeliveryControl!,existing=c.effects.find(r=>r.state.effectKey===s.effectKey);
      if(existing?.retainUntil!==undefined&&existing.retainUntil<=now){pruneAssistantDeliveryControl(d,now);return {status:'expired' as const};}
      if(existing){if(!equal({...existing.state,revision:s.revision,lastTransitionAt:s.lastTransitionAt,phase:s.phase,contentEligible:s.contentEligible,invalidatedAtFenceSequence:undefined,outcome:undefined},s))throw new AssistantControlError('conflict');return {status:'already_claimed' as const,phase:existing.state.phase};}
      pruneAssistantDeliveryControl(d,now);
      if(!this.current(d,s,now))return {status:'refused' as const};
      if(c.effects.length>=32||assistantFutureStateBytes(s)>ASSISTANT_CONTROL_STATE_BYTES)throw new AssistantControlError('capacity');
      const p=this.projection(d,s.binding.botId,s.binding.destinationChatId,now);
      if(!p.stream&&c.streams.length>=4)throw new AssistantControlError('capacity');
      advanceAssistantControl(c,now);
      if(!p.stream)c.streams.push({botId:s.binding.botId,destinationChatId:s.binding.destinationChatId,agentId:s.scope.agentId,space:s.scope.space,containerId:s.scope.containerId,messageFloor:0,highMessageId:s.source.messageId,lastAcceptedAt:now});
      else{p.stream.highMessageId=Math.max(p.stream.highMessageId,s.source.messageId);p.stream.lastAcceptedAt=now;}
      if(!Number.isSafeInteger(s.createdAt+ASSISTANT_CONTROL_TTL_MS))throw new AssistantControlError('clock');
      c.effects.push({state:structuredClone(s),retainUntil:s.createdAt+ASSISTANT_CONTROL_TTL_MS});return {status:'claimed' as const,state:structuredClone(s)};
    }).then(result=>{if(result.status==='expired')throw new AssistantControlError('metadata_expired');if(result.status==='refused')throw new AssistantControlError('authority');return result;});
  }
  private row(d:AdaptiveDocument,expected:DeliveryState,now:number){
    const row=d.assistantDeliveryControl!.effects.find(r=>r.state.effectKey===expected.effectKey);
    if(!row||row.retainUntil<=now)throw new AssistantControlError('metadata_expired');
    if(!equal(row.state,expected))throw new AssistantControlError('conflict');return row;
  }
  private resultRow(d:AdaptiveDocument,expected:DeliveryState,now:number){
    const row=d.assistantDeliveryControl!.effects.find(r=>r.state.effectKey===expected.effectKey);
    if(!row||row.retainUntil<=now)throw new AssistantControlError('metadata_expired');
    const immutable=(s:DeliveryState)=>({effectKey:s.effectKey,scope:s.scope,binding:s.binding,source:s.source,authority:s.authority,generationId:s.generationId,attemptId:s.attemptId,evidence:s.evidence,createdAt:s.createdAt,expiresAt:s.expiresAt});
    if(!['sending','unknown','sent'].includes(expected.phase)||expected.revision>row.state.revision||!equal(immutable(expected),immutable(row.state)))throw new AssistantControlError('conflict');
    return row;
  }
  beginDispatch(expected:DeliveryState,prepared:PreparedAssistantText):Promise<DeliveryState>{
    expected=snapshot(expected);prepared=snapshot(prepared);
    const key=this.key(expected.evidence.keyId);assertPreparedIntegrity(prepared,key);
    return this.write(expected.binding.destinationChatId,(d,now)=>{
      const row=this.row(d,expected,now);if(!this.current(d,row.state,now))throw new AssistantControlError('authority');
      advanceAssistantControl(d.assistantDeliveryControl!,now);row.state=reduceDelivery(row.state,{type:'begin_dispatch',prepared,evidenceKey:key},assistantExpected(row.state,now));return row.state;
    });
  }
  isDispatchCurrent(expected:DeliveryState,prepared:PreparedAssistantText):boolean {
    try{const key=this.key(expected.evidence.keyId);assertPreparedIntegrity(prepared,key);const d=this.committed(expected.binding.destinationChatId),now=this.now(),row=this.row(d,expected,now);
      return row.state.phase==='sending'&&equal({...prepared.initialState,phase:row.state.phase,revision:row.state.revision,lastTransitionAt:row.state.lastTransitionAt},row.state)&&this.current(d,row.state,now);
    }catch{return false;}
  }
  recordResponse(expected:DeliveryState,prepared:PreparedAssistantText,transportEvidence:TransportEvidence,response:ResponseProjection):Promise<DeliveryState>{
    expected=snapshot(expected);prepared=snapshot(prepared);
    const key=this.key(expected.evidence.keyId);assertPreparedIntegrity(prepared,key);
    try {transportEvidence=snapshot(transportEvidence);response=snapshot(response);}catch{transportEvidence={} as TransportEvidence;response={httpStatus:200,body:null};}
    return this.write(expected.binding.destinationChatId,(d,now)=>{
      const row=this.resultRow(d,expected,now),c=d.assistantDeliveryControl!;advanceAssistantControl(c,now);
      if(!this.current(d,row.state,now)&&row.state.contentEligible)invalidateAssistantDeliveryScope(d,now);
      row.state=reduceDelivery(row.state,{type:'record_response',prepared,evidenceKey:key,transportEvidence,response},assistantExpected(row.state,now));return row.state;
    });
  }
  recordUncertainty(expected:DeliveryState,reason:'transport_error'|'invalid_response'|'receipt_commit_unconfirmed'='receipt_commit_unconfirmed'):Promise<DeliveryState>{
    expected=snapshot(expected);
    return this.write(expected.binding.destinationChatId,(d,now)=>{const row=this.resultRow(d,expected,now);if(row.state.phase==='sent'||row.state.phase==='unknown')return row.state;advanceAssistantControl(d.assistantDeliveryControl!,now);row.state=reduceDelivery(row.state,{type:'record_uncertainty',reason},assistantExpected(row.state,now));return row.state;});
  }
  async recover(owner:number):Promise<void>{await this.write(owner,(d,now)=>{
    const c=d.assistantDeliveryControl!;pruneAssistantDeliveryControl(d,now);
    for(const row of c.effects)if(row.state.phase==='sending'||row.state.phase==='generated'&&row.state.expiresAt<=now){advanceAssistantControl(c,now);row.state=reduceDelivery(row.state,{type:row.state.phase==='sending'?'recover_interrupted':'pre_dispatch_denied'},assistantExpected(row.state,now));}
  });}
  async invalidateSource(owner:number,botId:number,chatId:number,messageId:number):Promise<void>{await this.write(owner,(d,now)=>invalidateAssistantDeliverySource(d,now,botId,chatId,messageId));}
  async eraseScope(owner:number,space:SpaceKind,agentId?:string):Promise<void>{if(!['work','personal'].includes(space))throw new AssistantControlError('scope');await this.write(owner,(d,now)=>{invalidateAssistantDeliveryScope(d,now,space,agentId,true);});}
  async prune(owner:number):Promise<void>{await this.write(owner,(d,now)=>{pruneAssistantDeliveryControl(d,now);});}
  async exportOwner(owner:number,space:SpaceKind){if(!['work','personal'].includes(space))throw new AssistantControlError('scope');return this.write(owner,(d,now)=>{if(!this.adaptive.isProfileConfirmed(d,now))throw new AssistantControlError('authority');pruneAssistantDeliveryControl(d,now);return exportAssistantDeliveryControl(d,space);});}
}
