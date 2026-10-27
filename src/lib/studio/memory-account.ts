/** ER1 manager intent and original-work admission. No marker activation or wall-clock fallback. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {accountIdFor,digest} from '../adaptive/persistence/repository';
import {runWithMemoryAccountWork,memoryAccountWorkDetails,type MemoryAccountWork} from '../adaptive/memory-account-lifecycle';
import type {Studio} from './service';
import {canUseAgent,visibilityOf} from './permissions';
import {parseExplicitControl} from '../relationships/policy';
import type {TelegramUpdate} from '../tireh/telegram/client';
import {SourceFencePendingError,type AssistantTextPoller} from './assistant-text-integration';

export class MemoryAccountUnavailable extends Error {constructor(){super('memory_account_unavailable');}}
export interface MemoryAccountSession {ownerId:number;session:string;deadline:number;authenticate:(now:number)=>boolean;cancelled:()=>boolean}
export interface MemoryAccountOptions {/** Independently qualified UTC source; deliberately absent at production composition until qualified. */ clock?:()=>number}
export interface MemoryAccountPreview {version:1;action:'fresh-bootstrap';scope:'original-file-canonical-memory-account';spaces:readonly ['work','personal'];agents:'all-canonical-agent-rows';expected:{kind:'missing'};previewDigest:string}
export interface MemoryAccountStatusResponse {state:'unavailable'|'setup-required'|'legacy-current'|'fresh-confirmed'|'erasing';ready:false;reason:'source-time-and-core-eligibility-not-qualified';pending?:{expiresAt:number}}
interface Challenge {ownerId:number;session:string;ownerGeneration:string;preview:MemoryAccountPreview;nonceHash:string;issuedAt:number;expiresAt:number}
export type MemoryAccountQueuedUpdate=Readonly<Record<never,never>>;
export type MemoryAccountCurrentTurnScope=Readonly<Record<never,never>>;
interface AcceptedUpdate {agentId:string;update:TelegramUpdate;snapshot:TelegramUpdate;poller:AssistantTextPoller|undefined;token?:MemoryAccountWork;current:()=>boolean;marked:boolean;denied:boolean;stateless?:boolean;protectiveEdit?:boolean;noApplicableCanonical?:boolean;protectiveRouteCurrent?:()=>boolean;audienceStamp?:()=>string}
interface Work {integration:StudioMemoryAccount;agentId:string;token?:MemoryAccountWork;stateless?:boolean;protectiveEdit?:boolean;protectiveRouteCurrent?:()=>boolean;audienceStamp?:()=>string;current:()=>boolean}
const ambient=globalThis as typeof globalThis&{__voxMemoryAccountWork?:AsyncLocalStorage<Work>;__voxMemoryAccountChallenges?:Map<string,Map<number,Challenge>>;__voxCurrentTurnScopes?:WeakMap<object,{work:Work;audience:string}>};
const work=ambient.__voxMemoryAccountWork??=new AsyncLocalStorage<Work>();
const maps=ambient.__voxMemoryAccountChallenges??=new Map<string,Map<number,Challenge>>();
const currentTurnScopes=ambient.__voxCurrentTurnScopes??=new WeakMap<object,{work:Work;audience:string}>();
/** Opaque scope is valid only in its original authenticated stateless work and captured public audience. */
export function isMemoryAccountCurrentTurnScope(scope:unknown):boolean {
  if(!scope||typeof scope!=='object')return false;
  const captured=currentTurnScopes.get(scope),row=work.getStore();
  try{return !!captured&&!!row&&captured.work===row&&row.stateless===true&&!row.token&&row.current()&&row.audienceStamp?.()===captured.audience;}catch{return false;}
}
export function assertMemoryAccountEffect():void {const row=work.getStore();if(row&&(row.protectiveEdit||!row.current()))throw new MemoryAccountUnavailable();}
export function memoryAccountTurnCurrent():boolean {try{assertMemoryAccountEffect();return true;}catch{return false;}}
export class StudioMemoryAccount {
  private readonly challenges:Map<number,Challenge>;
  private readonly accepted=new WeakMap<MemoryAccountQueuedUpdate,AcceptedUpdate>();
  constructor(readonly studio:Studio,readonly options:MemoryAccountOptions={}) {
    const root=studio.deps.fileRuntimeOwner?.root??`unqualified:${randomBytes(16).toString('hex')}`;
    this.challenges=maps.get(root)??new Map();maps.set(root,this.challenges);
    studio.deps.fileRuntimeOwner?.onDrain(()=>{this.challenges.clear();});
  }
  private repository(){const r=this.studio.deps.adaptive?.repository;if(!r)throw new MemoryAccountUnavailable();return r;}
  marked():boolean{return this.repository().memoryAccountMarked();}
  now():number {this.studio.deps.fileRuntimeOwner?.assertCurrent();const n=this.options.clock?.();if(n===undefined||!Number.isSafeInteger(n)||n<0)throw new MemoryAccountUnavailable();return n;}
  private generation():string {const owner=this.studio.deps.fileRuntimeOwner;if(!owner)throw new MemoryAccountUnavailable();owner.assertCurrent();owner.assertActive();return digest(owner.snapshot());}
  session(initData:string):string{return createHmac('sha256',this.studio.deps.secret).update('er1-manager-session\0').update(initData).digest('hex');}
  private live(s:MemoryAccountSession,now:number):void {if(s.cancelled()||now>=s.deadline||!s.authenticate(now))throw new MemoryAccountUnavailable();}
  private expire(now:number):void {for(const [id,c]of this.challenges)if(now>=c.expiresAt)this.challenges.delete(id);}
  status(s:MemoryAccountSession):MemoryAccountStatusResponse {
    const now=this.now();this.live(s,now);this.generation();this.expire(now);
    const state=this.repository().memoryAccountStatus(accountIdFor(s.ownerId),()=>this.now()).state;
    const pending=this.challenges.get(s.ownerId);
    return {state:state==='unmarked'?'unavailable':state==='missing'?'setup-required':state==='active'?'fresh-confirmed':state,ready:false,reason:'source-time-and-core-eligibility-not-qualified',...(pending?{pending:{expiresAt:pending.expiresAt}}:{})};
  }
  preview(s:MemoryAccountSession):MemoryAccountPreview {
    const now=this.now();this.live(s,now);this.generation();
    if(this.repository().memoryAccountStatus(accountIdFor(s.ownerId),()=>this.now()).state!=='missing')throw new MemoryAccountUnavailable();
    const body={version:1 as const,action:'fresh-bootstrap' as const,scope:'original-file-canonical-memory-account' as const,spaces:['work','personal'] as const,agents:'all-canonical-agent-rows' as const,expected:{kind:'missing' as const}};
    return {...body,previewDigest:digest(body)};
  }
  challenge(s:MemoryAccountSession,previewDigest:string):{nonce:string;expiresAt:number;preview:MemoryAccountPreview} {
    const preview=this.preview(s);if(preview.previewDigest!==previewDigest)throw new MemoryAccountUnavailable();
    const now=this.now();this.live(s,now);this.expire(now);
    if(!this.challenges.has(s.ownerId)&&[...maps.values()].reduce((n,m)=>n+m.size,0)>=128)throw new MemoryAccountUnavailable();
    const nonce=randomBytes(32).toString('hex'),expiresAt=Math.min(now+120_000,s.deadline);
    const row:Challenge={ownerId:s.ownerId,session:s.session,ownerGeneration:this.generation(),preview,nonceHash:createHash('sha256').update(nonce).digest('hex'),issuedAt:now,expiresAt};
    this.challenges.set(s.ownerId,row);
    const expiry=setTimeout(()=>{if(this.challenges.get(s.ownerId)===row)this.challenges.delete(s.ownerId);},Math.max(1,expiresAt-now));expiry.unref?.();
    return {nonce,expiresAt,preview};
  }
  cancel(s:MemoryAccountSession):{cancelled:true} {this.live(s,this.now());this.generation();this.challenges.delete(s.ownerId);return {cancelled:true};}
  async confirm(s:MemoryAccountSession,nonce:string,previewDigest:string):Promise<{state:'fresh-confirmed';ready:false;sourceCutoffMs:number}> {
    const c=this.challenges.get(s.ownerId);
    const check=(now:number)=>{
      const ownerGeneration=this.generation();now=this.now();this.live(s,now);
      const finalNow=this.options.clock?.();if(finalNow===undefined||!Number.isSafeInteger(finalNow)||finalNow<now||finalNow>=s.deadline||c&&finalNow>=c.expiresAt)throw new MemoryAccountUnavailable();
      if(!c||this.challenges.get(s.ownerId)!==c||now<c.issuedAt||now>=c.expiresAt||c.session!==s.session||c.ownerGeneration!==ownerGeneration||c.preview.previewDigest!==previewDigest||c.nonceHash!==createHash('sha256').update(nonce).digest('hex'))throw new MemoryAccountUnavailable();
    };
    check(this.now());
    const lifecycle=await this.repository().bootstrapMemoryAccount(accountIdFor(s.ownerId),{clock:()=>this.now(),authorizeAtAcceptance:check,authorizeCommit:(_acceptedAt:number,currentNow:number)=>{check(currentNow);this.challenges.delete(s.ownerId);}});
    return {state:'fresh-confirmed',ready:false,sourceCutoffMs:lifecycle.mode==='fresh-confirmed'?lifecycle.sourceCutoffMs:0};
  }
  /** Batch acceptance captures every source before an earlier update can await. */
  captureUpdate(agentId:string,update:TelegramUpdate,poller?:AssistantTextPoller):MemoryAccountQueuedUpdate {
    const capability=Object.freeze({});
    const snapshot=this.studio.deps.assistantText?.snapshotUpdate(update)??structuredClone(update);
    let marked=true;try{marked=this.marked();}catch{/* Corrupt/unknown controls refuse. */}
    const row:AcceptedUpdate={agentId,update,snapshot,poller,marked,denied:marked,current:()=>!marked};
    const message=snapshot.message??snapshot.edited_message,assistant=this.studio.deps.assistantText;
    if(marked&&snapshot.edited_message&&message?.chat.type==='private'){
      row.protectiveEdit=true;
      try {
        if(!message.from||!assistant?.memoryAccountEditSourceCurrent(agentId,message,poller))throw new SourceFencePendingError();
        row.protectiveRouteCurrent=()=>assistant.memoryAccountEditSourceCurrent(agentId,message,poller);
        const accountId=accountIdFor(message.from.id);
        // Retained by the core token: every actual read/write fence rechecks the ORIGINAL route/credential.
        const clock=()=>{if(!assistant.memoryAccountEditSourceCurrent(agentId,message,poller))throw new SourceFencePendingError();return this.now();};
        const status=this.repository().memoryAccountStatus(accountId,clock);
        if(status.state==='missing'||status.state==='erasing'){
          row.noApplicableCanonical=true;row.denied=false;
          row.current=()=>{try{const current=this.repository().memoryAccountStatus(accountId,clock);return current.state==='missing'||current.state==='erasing';}catch{return false;}};
        }else {
          const token=this.repository().captureMemoryAccountWork(accountId,clock);
          row.token=token;row.denied=false;
          row.current=()=>{try{return assistant.memoryAccountEditSourceCurrent(agentId,message,poller)&&this.repository().isMemoryAccountWorkCurrent(token,clock);}catch{return false;}};
        }
      }catch{/* Never ACK uncertain suppression or lazily capture a replacement incarnation on execution. */}
      this.accepted.set(capability,row);return capability;
    }
    if(marked&&message&&message.chat.type==='private'&&message.from&&!message.from.is_bot&&message.chat.id===message.from.id&&
      typeof message.text==='string'&&!message.voice&&!message.photo?.length&&!message.document&&assistant?.memoryAccountSourceCurrent(agentId,message,poller)&&Number.isSafeInteger(message.date)){
      try {
        const token=this.repository().captureMemoryAccountWork(accountIdFor(message.from.id),()=>this.now(),message.date);
        row.token=token;row.denied=false;
        row.current=()=>{try{return assistant.memoryAccountSourceCurrent(agentId,message,poller)&&this.repository().isMemoryAccountWorkCurrent(token,()=>this.now());}catch{return false;}};
      }catch{/* Missing/closed/unknown source is not queued for retry. */}
    }
    if(marked&&row.denied&&snapshot.message&&message?.from&&typeof message.text==='string'&&!message.text.startsWith('/')&&!parseExplicitControl(message.text)&&!message.voice&&!message.photo?.length&&!message.document&&assistant?.memoryAccountStatelessSourceCurrent(agentId,message,poller)){
      try {
        const state=this.studio.deps.store.readCommittedForEffect!(),agent=state.agents.find(a=>a.id===agentId),member=state.members.find(m=>m.telegramId===message.from!.id);
        const publicDm=message.chat.type==='private'&&message.chat.id===message.from.id&&agent&&visibilityOf(agent)==='public'&&(!member||!canUseAgent(member,agent));
        const group=(message.chat.type==='group'||message.chat.type==='supergroup')&&state.groups.some(g=>g.chatId===message.chat.id&&g.agentIds.includes(agentId)&&g.memberIds.includes(message.from!.id));
        if(agent?.status==='active'&&(publicDm||group)&&!agent.blocked?.includes(message.from.id)){
          row.stateless=true;row.denied=false;
          row.audienceStamp=()=>{const state=this.studio.deps.store.readCommittedForEffect!();return digest(publicDm?['private-public',agentId,message.from!.id]:state.groups.filter(g=>g.chatId===message.chat.id).map(g=>[g.chatId,g.memberIds,g.agentIds,g.hasGuests,g.audienceEpoch??0]));};
          row.current=()=>{try{const now=this.studio.deps.store.readCommittedForEffect!(),a=now.agents.find(a=>a.id===agentId),m=now.members.find(m=>m.telegramId===message.from!.id);return !!a&&a.status==='active'&&!a.blocked?.includes(message.from!.id)&&assistant.memoryAccountStatelessSourceCurrent(agentId,message,poller)&&
            (publicDm?visibilityOf(a)==='public'&&(!m||!canUseAgent(m,a)):now.groups.some(g=>g.chatId===message.chat.id&&g.agentIds.includes(agentId)&&g.memberIds.includes(message.from!.id)));}catch{return false;}};
        }
      }catch{/* Missing committed route authority refuses. */}
    }
    this.accepted.set(capability,row);return capability;
  }
  runUpdate<T>(agentId:string,update:TelegramUpdate,poller:AssistantTextPoller|undefined,body:(snapshot:TelegramUpdate)=>Promise<T>,captured?:MemoryAccountQueuedUpdate):Promise<T|undefined> {
    const capability=captured??this.captureUpdate(agentId,update,poller),row=this.accepted.get(capability);
    if(!row||row.agentId!==agentId||row.update!==update||row.poller!==poller){if(update.edited_message&&this.marked())return Promise.reject(new SourceFencePendingError());return Promise.resolve(undefined);}
    this.accepted.delete(capability);
    if(row.denied){if(row.protectiveEdit)return Promise.reject(new SourceFencePendingError());return Promise.resolve(undefined);}
    if(!row.marked){if(this.marked()){if(row.snapshot.edited_message)return Promise.reject(new SourceFencePendingError());return Promise.resolve(undefined);}return body(row.snapshot);}
    const execute=()=>work.run({integration:this,agentId,token:row.token,stateless:row.stateless,protectiveEdit:row.protectiveEdit,protectiveRouteCurrent:row.protectiveRouteCurrent,audienceStamp:row.audienceStamp,current:row.current},async()=>{
      if(!row.current()){if(row.protectiveEdit)throw new SourceFencePendingError();return;}
      if(row.noApplicableCanonical)return;
      try{
        const result=await body(row.snapshot);
        if(row.protectiveEdit&&!row.current())throw new SourceFencePendingError();
        return result;
      }catch(error){if(row.protectiveEdit)throw new SourceFencePendingError();throw error;}
    });
    return row.token?runWithMemoryAccountWork(row.token,execute):execute();
  }
  protectiveEdit():boolean {const row=work.getStore();return !!row&&row.integration===this&&row.protectiveEdit===true;}
  assertProtectiveEditCurrent():void {const row=work.getStore();if(!row||row.integration!==this||!row.protectiveEdit||!row.token||!row.current())throw new SourceFencePendingError();}
  /** Only inside the actual canonical account lock; storage performs the captured-incarnation final check. */
  assertProtectiveEditCommitCurrent():void {
    const row=work.getStore();
    if(!row||row.integration!==this||!row.protectiveEdit||!row.token||!row.protectiveRouteCurrent?.())throw new SourceFencePendingError();
    this.now();
  }
  currentTurnOnlyScope():MemoryAccountCurrentTurnScope|undefined {
    const row=work.getStore();if(!row||row.integration!==this||!row.stateless||row.token||!row.current()||!row.audienceStamp)return;
    const scope=Object.freeze({});currentTurnScopes.set(scope,{work:row,audience:row.audienceStamp()});return scope;
  }
  stateless():boolean {const row=work.getStore();return !!row&&row.integration===this&&row.stateless===true;}
  current():boolean {try{if(!this.marked())return true;const row=work.getStore();return !!row&&row.integration===this&&!row.protectiveEdit&&row.current();}catch{return false;}}
  /** Current lineage is required; old legacy/shared/relationship/archive adapters are deliberately not imported. */
  contextState(){
    assertMemoryAccountEffect();const row=work.getStore();if(!row||row.integration!==this)throw new MemoryAccountUnavailable();
    let revision='er1:stateless-current-source',validUntil=Number.MAX_SAFE_INTEGER;
    if(!row.stateless){
      if(!row.token)throw new MemoryAccountUnavailable();
      const details=memoryAccountWorkDetails(row.token),read=this.repository().readCommittedForEffect(details.accountId,()=>this.now());
      if(read.status!=='ready'||!read.document)throw new MemoryAccountUnavailable();
      const d=read.document,owner=Number(details.accountId.slice(17));
      const studio=this.studio.replyAuthorityNow(row.agentId,owner);
      // Time/eligibility follow every actual authority read; sourceCurrent itself rereads FILE.
      if(!row.current())throw new MemoryAccountUnavailable();
      const now=this.now(),adaptive=this.studio.deps.adaptive!,core=adaptive.capabilityStatus(d,'core_text',now);
      validUntil=Math.min(d.binding?.expiresAt??now,core.validUntil??now);
      if(!Number.isSafeInteger(validUntil)||!adaptive.isCoreAllowed(d,now)||!core.eligible||now>=validUntil)throw new MemoryAccountUnavailable();
      const finalNow=this.options.clock?.();if(finalNow===undefined||!Number.isSafeInteger(finalNow)||finalNow<now||finalNow>=validUntil)throw new MemoryAccountUnavailable();
      revision=digest(['er1-current-source',d.memoryLifecycle,d.binding,d.declaration,d.permissions,core,studio]);
    }
    return {revision,validUntil,memoryEnabled:false,historyEnabled:false,storedContextAllowed:false,context:[],priorityContext:[],reviewedContext:[]};
  }
}
