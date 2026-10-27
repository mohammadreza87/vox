/** ATI1 actual polling composition. Enrollment is a trusted server operation,
 * deliberately not exposed by a public command/HTTP route in this slice. */
import {createHmac,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';
import {AssistantControlError,type AssistantDeliveryEnrollment} from '../adaptive/assistant-delivery-control';
import {accountIdFor,digest} from '../adaptive/persistence/repository';
import {AssistantDeliveryControlAdapter,type AssistantDeliveryBinding,type AssistantDeliveryIngress,type AssistantDeliveryControlOptions} from './assistant-delivery-control';
import {StudioStore} from './store';
import {canUseAgent} from './permissions';
import type {Studio} from './service';
import type {TelegramMessage,TelegramUpdate} from '../tireh/telegram/client';
import type {AssistantTextGatewayHook,AssistantTextDeliveryInput,AssistantTextDeliveryResult} from '../tireh/gateway';
import {AssistantTextTransport} from '../tireh/telegram/assistant-text-transport';
import {parseExplicitControl} from '../relationships/policy';

export class SourceFencePendingError extends Error {constructor(){super('source_fence_pending');this.name='SourceFencePendingError';}}
const id=z.string().regex(/^[A-Za-z0-9:_-]{1,128}(?![\s\S])/);
const intrinsicByteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!;
const keySchema=z.object({currentKeyId:id,keys:z.array(z.object({keyId:id,keyBase64:z.string(),notAfter:z.number().int().nonnegative().safe().optional()}).strict()).min(1).max(8)}).strict();
export function parseAssistantTextKeys(raw:string|undefined,now:number,clock:()=>number=Date.now):AssistantDeliveryControlOptions['keys']|undefined {
  if(!raw)return;
  try {
    if(Buffer.byteLength(raw)>8192||!Number.isSafeInteger(now)||now<0)throw Error();
    const parsed=keySchema.parse(JSON.parse(raw)),entries=new Map<string,{key:Uint8Array;notAfter?:number}>();
    for(const row of parsed.keys){
      if(entries.has(row.keyId)||!/^[A-Za-z0-9+/]{43}=(?![\s\S])/.test(row.keyBase64)||Object.is(row.notAfter,-0))throw Error();
      const key=Buffer.from(row.keyBase64,'base64');if(key.byteLength!==32||key.toString('base64')!==row.keyBase64)throw Error();
      if(row.keyId===parsed.currentKeyId?row.notAfter!==undefined:row.notAfter===undefined||row.notAfter>now+7*86400000)throw Error();
      entries.set(row.keyId,{key:new Uint8Array(key),notAfter:row.notAfter});
    }
    if(!entries.has(parsed.currentKeyId))throw Error();
    return {current(){const row=entries.get(parsed.currentKeyId)!;return {keyId:parsed.currentKeyId,key:new Uint8Array(row.key)};},
      resolve(keyId){const row=entries.get(keyId);return row&&(row.notAfter===undefined||clock()<row.notAfter)?new Uint8Array(row.key):undefined;}};
  }catch{throw new Error('assistant_text_keys_invalid');}
}

/** Detached JSON without invoking caller getters, iterators, toJSON or proxies. */
function detached<T>(input:T):T {
  let nodes=0;const seen=new Set<object>();
  const copy=(v:unknown,depth:number):unknown=>{
    if(++nodes>2048||depth>32)throw new AssistantControlError('shape');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){if(v.length>65536)throw new AssistantControlError('capacity');return v;}
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(typeof v!=='object'||types.isProxy(v)||seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))throw new AssistantControlError('shape');
    seen.add(v);const out:Record<string,unknown>|unknown[]=Array.isArray(v)?[]:{};
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))){
      if(Array.isArray(v)&&key==='length')continue;
      if(!('value' in descriptor)||!descriptor.enumerable)throw new AssistantControlError('shape');
      Object.defineProperty(out,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
    }
    if(Object.getOwnPropertySymbols(v).length)throw new AssistantControlError('shape');
    seen.delete(v);return out;
  };
  return copy(input,0) as T;
}
interface PollerRecord {agentId:string;botId:number;token:string;active:()=>boolean}
interface IngressRecord {poller:PollerRecord;source:AssistantDeliveryIngress;text:string}
/** Opaque capabilities; ordinary matching objects never authenticate ingress. */
export type AssistantTextPoller = Readonly<Record<never,never>>;
export interface AssistantTextIntegrationOptions {
  enabled:()=>boolean;
  keys?:AssistantDeliveryControlOptions['keys'];
  fetchFn?:typeof fetch;
  now?:()=>number;
}
export interface AssistantTextEnrollmentInput {ownerId:number;agentId:string;botId:number;requestId:string;expectedEnrollmentRevision:number|null}
export interface AssistantTextCompactScope {agentId:string;ownerId:number;botId:number;messageId:number;occurredAt:number}
export class StudioAssistantTextIntegration implements AssistantTextGatewayHook {
  readonly control:AssistantDeliveryControlAdapter;
  private readonly pollers=new WeakMap<object,PollerRecord>();
  private readonly sources=new WeakMap<object,IngressRecord>();
  private readonly compactScopes=new WeakMap<object,IngressRecord>();
  private readonly recovery=new Map<number,Promise<void>>();
  private readonly transport:AssistantTextTransport;
  private stopped=false;
  constructor(readonly studio:Studio,readonly options:AssistantTextIntegrationOptions){
    if(studio.deps.store.constructor!==StudioStore||!studio.deps.adaptive)throw new AssistantControlError('unsupported');
    this.control=new AssistantDeliveryControlAdapter(studio.deps.adaptive,{now:()=>this.now(),bindingFor:(bot,owner,enrollment)=>this.bindingFor(bot,owner,enrollment,true),
      keys:options.keys??{current(){throw new AssistantControlError('key_unavailable');},resolve(){return undefined;}}});
    this.transport=new AssistantTextTransport(options.fetchFn,()=>this.now());
  }
  private now():number {const n=this.options.now?.()??this.studio.deps.now?.().getTime()??Date.now();if(!Number.isSafeInteger(n)||n<0||Object.is(n,-0))throw new AssistantControlError('clock');return n;}
  private enabled():boolean {try{this.studio.deps.fileRuntimeOwner?.assertActive();return !this.stopped&&this.options.enabled()===true;}catch{return false;}}
  private keyAvailable():boolean {
    try{const key=this.options.keys?.current();return !!key&&id.safeParse(key.keyId).success&&types.isUint8Array(key.key)&&!types.isProxy(key.key)&&intrinsicByteLength.call(key.key)===32;}catch{return false;}
  }
  private noControls(owner:number):boolean {
    try{const r=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(owner),()=>this.now());return r.status==='ready'&&!r.document?.assistantDeliveryControl;}catch{return false;}
  }
  stop():void {this.stopped=true;}
  snapshotUpdate(update:TelegramUpdate):TelegramUpdate {
    const copy=detached(update);
    if(!copy||typeof copy!=='object'||['message','edited_message','callback_query','my_chat_member','chat_member','managed_bot'].filter(k=>Object.hasOwn(copy,k)).length>1)throw new AssistantControlError('shape');
    return copy;
  }
  poller(agentId:string,botId:number,token:string,active:()=>boolean):AssistantTextPoller {
    const capability=Object.freeze({});this.pollers.set(capability,{agentId,botId,token,active});return capability;
  }
  private route(agentId:string,botId:number,owner:number,send:boolean){
    const state=this.studio.deps.store.readCommittedForEffect!(),routes=state.agents.filter(a=>a.bot?.id===botId),members=state.members.filter(m=>m.telegramId===owner);
    if(routes.length!==1||routes[0].id!==agentId||send&&members.length!==1||!Number.isSafeInteger(owner)||owner<=0)throw new AssistantControlError('authority');
    const agent=routes[0],member=members[0],token=this.studio.botToken(agent),match=token&&/^([1-9]\d*):[A-Za-z0-9_-]{20,}(?![\s\S])/.exec(token);
    if(!token||!match||Number(match[1])!==botId||send&&(!canUseAgent(member,agent)||agent.blocked?.includes(owner)))throw new AssistantControlError('authority');
    return {agent,member,token};
  }
  private botId(agentId:string):number {
    const rows=this.studio.deps.store.readCommittedForEffect!().agents.filter(a=>a.id===agentId);
    if(rows.length!==1||!Number.isSafeInteger(rows[0].bot?.id)||rows[0].bot!.id<=0)throw new AssistantControlError('authority');return rows[0].bot!.id;
  }
  private bindingFor(botId:number,owner:number,projectedEnrollment?:AssistantDeliveryEnrollment,projected=false):AssistantDeliveryBinding|null {
    try {
      const state=this.studio.deps.store.readCommittedForEffect!(),agents=state.agents.filter(a=>a.bot?.id===botId);if(agents.length!==1)return null;
      const {agent,member,token}=this.route(agents[0].id,botId,owner,true),enrollment=projected?projectedEnrollment:this.control?.getEnrollment(owner,botId);
      if(!member)return null;
      this.studio.replyAuthorityNow(agent.id,owner);
      const mac=(domain:string,value:unknown)=>createHmac('sha256',this.studio.deps.secret).update(JSON.stringify([domain,value])).digest('hex');
      const endpointBindingId=mac('ati1-endpoint',['https://api.telegram.org',botId]),credentialBindingId=mac('ati1-credential',token);
      const relevant=[agent.id,agent.bot,agent.status,agent.createdBy,agent.visibility,agent.access,agent.blocked,agent.learningAuthorityRevision??0,
        member.telegramId,member.role,member.joinedAt,member.learningAuthorityRevision??0,endpointBindingId,credentialBindingId,enrollment??null];
      return {scope:{agentId:agent.id,space:'work'},binding:{botId,destinationChatId:owner,endpointBindingId,credentialBindingId,bindingRevision:digest(['ati1-binding',relevant])},stamp:digest(['ati1-studio',relevant])};
    }catch{return null;}
  }
  private authentic(agentId:string,message:TelegramMessage,capability:unknown,send:boolean):PollerRecord|undefined {
    if(!capability||typeof capability!=='object')return;
    const p=this.pollers.get(capability);if(!p||p.agentId!==agentId||!p.active()||this.stopped||!message.from||message.from.is_bot||message.chat.type!=='private'||message.chat.id!==message.from.id)return;
    try {if(this.route(agentId,p.botId,message.from.id,send).token===p.token)return p;}catch{/* Refuse stale/ambiguous route. */}
  }
  ingress(agentId:string,update:TelegramUpdate,poller?:AssistantTextPoller):unknown {
    const message=update.message;if(!message||!this.plain(message))return;
    const p=this.authentic(agentId,message,poller,true);if(!p)return;
    const source:AssistantDeliveryIngress={botId:p.botId,chatId:message.chat.id,fromId:message.from!.id,isBot:false,chatType:'private',kind:'initial-text',messageId:message.message_id,updateId:update.update_id,dateSeconds:message.date};
    const capability=Object.freeze({});this.sources.set(capability,{poller:p,source:detached(source),text:message.text!});return capability;
  }
  private plain(message:TelegramMessage):boolean {return message.chat.type==='private'&&!!message.from&&!message.from.is_bot&&message.chat.id===message.from.id&&typeof message.text==='string'&&!!message.text.trim()&&!message.text.startsWith('/')&&!parseExplicitControl(message.text)&&!message.voice&&!message.photo?.length&&!message.document;}
  private source(agentId:string,message:TelegramMessage,ingress:unknown):IngressRecord|undefined {
    if(!ingress||typeof ingress!=='object')return;
    const r=this.sources.get(ingress);if(!r||r.poller.agentId!==agentId||!r.poller.active()||this.stopped||r.text!==message.text||r.source.messageId!==message.message_id||r.source.dateSeconds!==message.date||r.source.chatId!==message.chat.id||r.source.fromId!==message.from?.id)return;
    try {if(this.route(agentId,r.source.botId,r.source.fromId,true).token===r.poller.token)return r;}catch{/* Deny, no fallback. */}
  }
  compactScope(agentId:string,message:TelegramMessage,ingress:unknown):AssistantTextCompactScope {
    const source=this.source(agentId,message,ingress);
    if(!source||!this.enabled())throw new AssistantControlError('authority');
    const preflight=this.control.preflightSource(source.source.fromId,source.source);
    if(!preflight.enrollment?.enabled||preflight.enrollment.agentId!==agentId)throw new AssistantControlError('authority');
    const scope=Object.freeze({agentId,ownerId:source.source.fromId,botId:source.source.botId,messageId:source.source.messageId,occurredAt:source.source.dateSeconds*1000});
    this.compactScopes.set(scope,source);return scope;
  }
  isCompactScopeCurrent(scope:AssistantTextCompactScope):boolean {
    const source=this.compactScopes.get(scope);
    try{return !!source&&this.enabled()&&source.poller.active()&&this.route(scope.agentId,scope.botId,scope.ownerId,true).token===source.poller.token;}catch{return false;}
  }
  async invalidateEdit(agentId:string,update:TelegramUpdate,poller?:AssistantTextPoller):Promise<void>{
    const message=update.edited_message;if(!message)return;
    const p=this.authentic(agentId,message,poller,false);if(!p)return;
    try {
      const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(message.from!.id),()=>this.now());
      if(read.status!=='ready')throw new AssistantControlError('busy');
      if(!read.document?.assistantDeliveryControl)return;
      await this.control.invalidateSource(message.from!.id,p.botId,message.chat.id,message.message_id);
    }catch{throw new SourceFencePendingError();}
  }
  async preflight(agentId:string,message:TelegramMessage,ingress?:unknown):Promise<'legacy'|'qualified'|'refused'>{
    if(!this.plain(message))return 'legacy';
    try {
      const bot=this.botId(agentId),row=this.control.getEnrollment(message.from!.id,bot),r=this.source(agentId,message,ingress);
      if(!row){
        // No enrollment changes legacy behavior only when no surviving control
        // denies this source. Poller provenance is required to trust its date.
        const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(message.from!.id),()=>this.now());
        if(read.status!=='ready')return 'refused';
        if(read.document?.assistantDeliveryControl){if(!r)return 'refused';this.control.preflightSource(message.from!.id,r.source);}
        return 'legacy';
      }
      if(row.agentId!==agentId||!row.enabled||!this.enabled()||!r)return 'refused';
      if(!this.keyAvailable())return 'refused';
      let recovery=this.recovery.get(message.from!.id);
      if(!recovery){recovery=this.control.recover(message.from!.id);this.recovery.set(message.from!.id,recovery);recovery.catch(()=>this.recovery.delete(message.from!.id));}
      await recovery;
      await this.control.prune(message.from!.id);
      this.control.preflightSource(message.from!.id,r.source);
      const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(message.from!.id),()=>this.now());
      if(read.status!=='ready'||!read.document)return 'refused';
      const d=read.document,c=d.assistantDeliveryControl,now=this.now(),current=c?.version===2?c.enrollments.find(e=>e.botId===bot&&e.destinationChatId===message.from!.id):undefined;
      if(!c||!current?.enabled||current.agentId!==agentId||!this.studio.deps.adaptive!.isCoreAllowed(d,now)||
        !(['optional.personalization','optional.auto_memory'] as const).every(p=>this.studio.deps.adaptive!.isPurposeAllowed(d,'work',p,now,agentId))||
        c.effects.length>=32||!c.streams.some(s=>s.botId===bot&&s.destinationChatId===message.from!.id)&&c.streams.length>=4)return 'refused';
      if(!this.bindingFor(bot,message.from!.id))return 'refused';
      return 'qualified';
    }catch{return this.noControls(message.from!.id)?'legacy':'refused';}
  }
  legacyCurrent(agentId:string,message:TelegramMessage,ingress?:unknown):boolean {
    if(!this.plain(message))return true;
    try {
      const bot=this.botId(agentId);if(this.control.getEnrollment(message.from!.id,bot))return false;
      const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(message.from!.id),()=>this.now());
      if(read.status!=='ready')return false;
      if(read.document?.assistantDeliveryControl){const r=this.source(agentId,message,ingress);if(!r)return false;this.control.preflightSource(message.from!.id,r.source);}
      return true;
    }catch{return this.noControls(message.from!.id);}
  }
  async deliver(input:AssistantTextDeliveryInput):Promise<AssistantTextDeliveryResult>{
    const {agentId,message,ingress,generatedText,decoratedText,checkCurrent}=input;
    let sending:import('../tireh/delivery/assistant-text-protocol').DeliveryState|undefined;
    try {
      const r=this.source(agentId,message,ingress);if(!r||!this.enabled())return {kind:'refused',reason:'authority'};
      const prepared=this.control.prepare({ownerId:r.source.fromId,ingress:r.source,generatedText,decoratedText,generationId:randomUUID(),attemptId:randomUUID()});
      const claimed=await this.control.claim(prepared,r.source);if(claimed.status!=='claimed')return {kind:'refused',reason:'duplicate'};
      sending=await this.control.beginDispatch(claimed.state,prepared);
      const expected=sending;
      const transport=await this.transport.send({token:r.poller.token,prepared,ownerSignal:this.studio.deps.fileRuntimeOwner?.signal,ownerActive:()=>this.studio.deps.fileRuntimeOwner?.assertActive(),authorizeNow:()=>checkCurrent(()=>{this.studio.deps.fileRuntimeOwner?.assertCurrent();return this.enabled()&&!!this.source(agentId,message,ingress)&&this.control.isDispatchCurrent(expected,prepared);})});
      const recorded=transport.kind==='response'?await this.control.recordResponse(expected,prepared,transport.evidence,transport.response):await this.control.recordUncertainty(expected,transport.reason);
      if(recorded.phase!=='sent'||!recorded.outcome||!('receipt' in recorded.outcome))return {kind:'unknown',reason:'uncertain'};
      return {kind:'sent',effectKey:recorded.effectKey,messageId:recorded.outcome.receipt.messageId,contentEligible:recorded.contentEligible,
        ...(recorded.contentEligible?{submittedText:prepared.submittedText}:{})};
    }catch {
      if(sending){try{await this.control.recordUncertainty(sending);}catch{/* Durable sending/unknown never permits another attempt. */}return {kind:'unknown',reason:'uncertain'};}
      return {kind:'refused',reason:'authority'};
    }
  }
  private controlOwner(owner:number):void {
    const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(owner),()=>this.now());
    if(read.status!=='ready'||!read.document||!this.studio.deps.adaptive!.isProfileConfirmed(read.document,this.now()))throw new AssistantControlError('authority');
  }
  async enroll(input:AssistantTextEnrollmentInput){
    input=detached(input);this.controlOwner(input.ownerId);
    if(!this.enabled()||!this.keyAvailable()||!this.bindingFor(input.botId,input.ownerId)||this.botId(input.agentId)!==input.botId)throw new AssistantControlError('authority');
    return this.control.setEnrollment({...input,enabled:true});
  }
  status(input:{ownerId:number;agentId:string;botId:number}){
    input=detached(input);this.controlOwner(input.ownerId);
    const row=this.control.getEnrollment(input.ownerId,input.botId);
    if(!row)return {status:'unenrolled' as const,policy:'arc2-control-7d-v1' as const};
    if(row.agentId!==input.agentId)throw new AssistantControlError('scope');
    let authority=false;
    try{const read=this.studio.deps.adaptive!.repository.readCommittedForEffect(accountIdFor(input.ownerId),()=>this.now());
      authority=read.status==='ready'&&!!read.document&&this.studio.deps.adaptive!.isCoreAllowed(read.document,this.now())&&
        (['optional.personalization','optional.auto_memory'] as const).every(p=>this.studio.deps.adaptive!.isPurposeAllowed(read.document!,'work',p,this.now(),input.agentId))&&!!this.bindingFor(input.botId,input.ownerId);
    }catch{/* Metadata status reports unavailable, never implies no effect. */}
    const reason=!row.enabled?'disabled':!this.enabled()?'mode_off':!this.keyAvailable()?'key_unavailable':!authority?'authority':'current';
    return {status:!row.enabled?'disabled' as const:reason==='current'?'enabled' as const:'paused' as const,reason,enrollment:row,policy:'arc2-control-7d-v1' as const};
  }
  async disable(input:AssistantTextEnrollmentInput){input=detached(input);this.controlOwner(input.ownerId);return this.control.setEnrollment({...input,enabled:false});}
}
