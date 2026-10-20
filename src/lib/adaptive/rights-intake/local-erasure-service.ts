import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { validateRuntimeControlEvaluation } from '../persistence/authority';
import { accountIdFor } from '../persistence/repository';
import type { AccountLedger, RightsSpace } from './contracts';
import type { RightsOptions } from './service';
import { rightsPolicySchema, type RightsPolicy } from './policy';
import { fail, RightsReplay, type RightsRepository } from './repository';
import { erasureFingerprint, erasureReconcileFingerprint, localUseDigest } from './local-use-state';
import { localErasurePlanInputSchema, localErasureExecuteInputSchema, localErasureViewSchema, localErasureMutationSchema, localErasurePlanSchema, type LocalErasureOperation, type LocalErasureView, type LocalErasurePlanInput, type LocalErasureExecuteInput, type LocalErasureMutation, type ErasureRecordingAuthority } from './local-erasure-contracts';

type Policy=Extract<RightsPolicy,{version:3}>;
const n=z.number().int().nonnegative().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const tokenSchema=z.object({version:z.literal(1),accountRef:hash,requestId:z.uuidv4(),requestRevision:n.positive(),space:z.enum(['work','personal']),eventId:z.uuidv4(),memoryId:z.string().min(1).max(200),memoryRevision:n.positive(),expectedCanonicalRevision:n.positive(),expectedBindingDigest:hash,witnessDigest:hash,policyDigest:hash,noticeDigest:hash,createdAt:n,expiresAt:n,executionDeadline:n,metadataRetainUntil:n,replayRetainUntil:n,receiptRetainUntil:n}).strict();
type Token=z.infer<typeof tokenSchema>;
const add=(a:number,b:number)=>Number.isSafeInteger(a+b)&&a+b>a?a+b:fail(503,'reviewed_policy_unavailable');
const bump=(a:number)=>Number.isSafeInteger(a+1)?a+1:fail(409,'rights_capacity');
const fixedCoverage={queuedDerivedUse:'unknown',noncanonicalDerivativeCopies:'unverified',noncanonicalDerivativeUse:'unverified',sharedCopies:'not_implemented',otherPrivateData:'outside_selected_scope',storageFileRemnants:'unverified',providers:'not_implemented',backups:'not_implemented',requestFulfillment:'not_established'} as const;

/** Metadata-only request workflow. Only the qualified canonical coordinator deletes. */
export class RightsLocalErasureWorkflow {
  private inFinalFence=false;
  private observedTime=0;
  constructor(readonly repository:RightsRepository,readonly options:RightsOptions){}
  private sync(guard:()=>void){validateRuntimeControlEvaluation({value:guard()});}
  private observeTransient(observedAt?:number):void {if(observedAt===undefined)return;if(!Number.isSafeInteger(observedAt)||observedAt<0||observedAt<this.observedTime)return fail(503,'rights_clock_unavailable');if(this.options.assertErasureClockNow)this.sync(()=>this.options.assertErasureClockNow!(observedAt));this.observedTime=observedAt;}
  private auth(id:number,observedAt?:number){this.observeTransient(observedAt);if(this.options.assertRequestNow)this.sync(this.options.assertRequestNow);this.sync(()=>this.options.assertAccountNow(id));if(!this.options.assertPrivateMemoryNow)return fail(503,'rights_erasure_unsupported');this.sync(()=>this.options.assertPrivateMemoryNow!(id));if(this.options.assertRequestNow)this.sync(this.options.assertRequestNow);this.finalFence(()=>this.now());}
  private finalFence<T>(fn:()=>T):T {const prior=this.inFinalFence;this.inFinalFence=true;try{return fn();}finally{this.inFinalFence=prior;}}
  private now(d?:AccountLedger|null){this.options.assertRequestNow?.();const now=(this.options.clock??Date.now)();if(!Number.isSafeInteger(now)||now<0||now<this.observedTime||now<(d?.observedServerTime??0))return fail(503,'rights_clock_unavailable');this.observeTransient(now);if(this.inFinalFence)this.repository.assertTimeForEffect(now);else this.repository.observeTime(now);return now;}
  private read(id:number){this.auth(id);const d=this.repository.read(accountIdFor(id));this.now(d);return d;}
  private row(d:AccountLedger|null,requestId:string,space:RightsSpace){return d?.requests.find(r=>r.requestId===requestId&&r.space===space)??fail(404,'not_found');}
  private backend(){return this.options.localErasure??fail(503,'rights_erasure_unsupported');}
  private policy(action:'plan'|'execute'|'reconcile',expected?:string):Policy|undefined {
    const now=this.now(),parsed=rightsPolicySchema.safeParse(this.options.policy());
    if(!parsed.success||parsed.data.version!==3||this.options.key?.length!==32)return;
    const p=parsed.data;
    if(p.effectiveAt>now||p.expiresAt<=now||!p.supportedKinds.includes('erasure')||!p.localErasure.allowedActions.includes(action)||expected&&localUseDigest(p)!==expected||Object.entries(p.localErasure).some(([k,v])=>k.endsWith('Ms')&&typeof v==='number'&&!Number.isSafeInteger(now+v)))return;
    if(!p.privacyOperatorIds.some(id=>{try{this.sync(()=>this.options.assertOperatorNow(id));return true;}catch{return false;}}))return;
    return p;
  }
  private requirePolicy(action:'plan'|'execute'|'reconcile',expected?:string){return this.policy(action,expected)??fail(503,'reviewed_policy_unavailable');}
  private key(){if(this.options.key?.length!==32)return fail(503,'reviewed_policy_unavailable');return createHmac('sha256',this.options.key).update('vox.rights.private-note-erasure.plan.v1').digest();}
  private ref(value:string){return createHmac('sha256',this.key()).update(value).digest('hex');}
  private seal(t:Token){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key(),iv);c.setAAD(Buffer.from('vox.rights.private-note-erasure.plan.v1'));const body=Buffer.concat([c.update(JSON.stringify(t)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64url');}
  private open(raw:string,id:number,requestId:string,space:RightsSpace):Token {
    try{const b=Buffer.from(raw,'base64url');if(b.toString('base64url')!==raw)return fail(403,'operation_handle_invalid');const c=createDecipheriv('aes-256-gcm',this.key(),b.subarray(0,12));c.setAAD(Buffer.from('vox.rights.private-note-erasure.plan.v1'));c.setAuthTag(b.subarray(12,28));const t=tokenSchema.parse(JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8')));if(t.accountRef!==this.ref(accountIdFor(id))||t.requestId!==requestId||t.space!==space||t.expiresAt<=t.createdAt||t.executionDeadline<t.expiresAt)return fail(403,'operation_handle_invalid');return t;}catch{return fail(403,'operation_handle_invalid');}
  }
  private guard(id:number,o:LocalErasureOperation,action:'execute'|'reconcile'='execute',operatorGuard?:()=>void){
    this.auth(id);operatorGuard?.();this.requirePolicy(action,o.policyDigest);
    const d=this.read(id),r=this.row(d,o.requestId,o.space),stored=d?.version===4?d.localErasure.operations.find(i=>i.eventId===o.eventId):undefined;
    if(!stored||stored.fingerprint!==o.fingerprint||stored.fingerprint!==erasureFingerprint(accountIdFor(id),stored)||r.kind!=='erasure'||r.state==='closed_unfulfilled'||r.revision!==o.requestRevision||r.retention.reviewOrExpiryAt<=this.now(d)||action==='execute'&&(this.now(d)>=o.expiresAt||this.now(d)>=o.executionDeadline))return fail(409,'rights_conflict');
    this.auth(id);operatorGuard?.();
  }
  status(id:number,requestId:string,space:RightsSpace):LocalErasureView {
    return this.finalFence(()=>this.readOnlyStatus(id,requestId,space));
  }
  private readOnlyStatus(id:number,requestId:string,space:RightsSpace):LocalErasureView {
    z.uuidv4().parse(requestId);const d=this.read(id),r=this.row(d,requestId,space),p=this.policy('plan');
    const operations=(d?.version===4?d.localErasure.operations:[]).filter(o=>o.requestId===requestId&&o.space===space).map(o=>{
      const proof=this.backend().privateNoteErasureProofNow(id,o,(observedAt?:number)=>this.auth(id,observedAt));
      const recording=o.acknowledgement?'recorded' as const:proof.technical==='note_content_removed'?'acknowledgement_pending' as const:'intent_recorded' as const;
      return {operationRef:this.ref(o.eventId),...proof,recording,coverage:{...fixedCoverage,canonicalSelectedNote:proof.technical==='note_content_removed'?'removed' as const:proof.technical==='not_applied'?'not_started' as const:'unknown' as const,canonicalDependentNotes:proof.technical==='note_content_removed'?'no_active_payloads' as const:proof.technical==='not_applied'?'not_started' as const:'unknown' as const}};
    });
    const available=!!p&&d?.version===4&&r.kind==='erasure'&&r.state!=='closed_unfulfilled'&&r.retention.reviewOrExpiryAt>this.now(d)&&!!this.options.localErasure?.privateNoteErasureQualified()&&this.repository.storage.supportsCommittedWriteFence===true&&!!this.repository.storage.readRightsTimeForEffect;
    this.auth(id);return localErasureViewSchema.parse({version:1,requestId,requestRevision:r.revision,space,available,operations});
  }
  plan(id:number,requestId:string,space:RightsSpace,raw:LocalErasurePlanInput){
    return this.finalFence(()=>this.readOnlyPlan(id,requestId,space,raw));
  }
  private readOnlyPlan(id:number,requestId:string,space:RightsSpace,raw:LocalErasurePlanInput){
    const input=localErasurePlanInputSchema.parse(raw),d=this.read(id),r=this.row(d,requestId,space),p=this.requirePolicy('plan'),now=this.now(d);
    if(d?.version!==4||input.space!==space||r.kind!=='erasure'||r.state==='closed_unfulfilled'||r.revision!==input.expectedRequestRevision||r.retention.reviewOrExpiryAt<=now||d.localErasure.operations.some(o=>o.memoryId===input.memoryId)||!this.repository.storage.supportsCommittedWriteFence||!this.repository.storage.readRightsTimeForEffect)return fail(409,'rights_conflict');
    const prepared=this.backend().preparePrivateNoteErasureNow(id,space,input.memoryId,input.expectedMemoryRevision,(observedAt?:number)=>this.auth(id,observedAt));
    const executionDeadline=Math.min(add(now,p.localErasure.executionWindowMs),p.expiresAt,prepared.bindingExpiresAt,r.retention.reviewOrExpiryAt),expiresAt=Math.min(add(now,p.localErasure.planLifetimeMs),executionDeadline);
    const token:Token={version:1,accountRef:this.ref(accountIdFor(id)),requestId,requestRevision:r.revision,space,eventId:input.eventId,memoryId:input.memoryId,memoryRevision:input.expectedMemoryRevision,expectedCanonicalRevision:prepared.expectedCanonicalRevision,expectedBindingDigest:prepared.expectedBindingDigest,witnessDigest:localUseDigest(prepared.witness),policyDigest:localUseDigest(p),noticeDigest:p.localErasure.noticeHashes[input.locale],createdAt:now,expiresAt,executionDeadline,metadataRetainUntil:add(now,p.localErasure.metadataRetentionMs),replayRetainUntil:add(now,p.localErasure.replayRetentionMs),receiptRetainUntil:add(now,p.localErasure.receiptRetentionMs)};
    this.auth(id);this.requirePolicy('plan',token.policyDigest);if(this.row(this.read(id),requestId,space).revision!==r.revision)return fail(409,'rights_conflict');
    return localErasurePlanSchema.parse({version:1,requestId,space,eventId:input.eventId,memoryId:input.memoryId,memoryRevision:input.expectedMemoryRevision,planHandle:this.seal(token),expiresAt});
  }
  assertPlanPublication(id:number,requestId:string,space:RightsSpace,raw:unknown):void {
    this.finalFence(()=>{
      const p=localErasurePlanSchema.parse(raw),t=this.open(p.planHandle,id,requestId,space);this.auth(id);this.requirePolicy('plan',t.policyDigest);
      const d=this.read(id),r=this.row(d,requestId,space);
      if(d?.version!==4||r.revision!==t.requestRevision||r.state==='closed_unfulfilled'||r.kind!=='erasure'||p.eventId!==t.eventId||p.memoryId!==t.memoryId||p.memoryRevision!==t.memoryRevision)return fail(409,'rights_conflict');
      const current=this.backend().preparePrivateNoteErasureNow(id,space,t.memoryId,t.memoryRevision,(observedAt?:number)=>this.auth(id,observedAt));
      if(current.expectedCanonicalRevision!==t.expectedCanonicalRevision||current.expectedBindingDigest!==t.expectedBindingDigest||localUseDigest(current.witness)!==t.witnessDigest||this.now(d)>=t.expiresAt)return fail(409,'rights_conflict');
      this.auth(id);this.requirePolicy('plan',t.policyDigest);
    });
  }
  private async acknowledge(id:number,o:LocalErasureOperation,action:'execute'|'reconcile',operatorGuard?:()=>void,recording?:ErasureRecordingAuthority){
    if((action==='reconcile')!==!!recording)return fail(409,'rights_conflict');
    const policyDigest=recording?.policy.digest??o.policyDigest,requestRevision=recording?.requestRevision??o.requestRevision;
    const inspectDraft=(d:AccountLedger|null)=>{
      const r=this.row(d,o.requestId,o.space),stored=d?.version===4?d.localErasure.operations.find(i=>i.eventId===o.eventId):undefined;
      if(!stored||stored.fingerprint!==o.fingerprint||stored.fingerprint!==erasureFingerprint(accountIdFor(id),stored)||r.kind!=='erasure'||r.state==='closed_unfulfilled'||r.revision!==requestRevision||r.retention.reviewOrExpiryAt<=this.now(d)||action==='execute'&&(this.now(d)>=o.expiresAt||this.now(d)>=o.executionDeadline))return fail(409,'rights_conflict');
      return stored;
    };
    const authority=()=>{this.auth(id);operatorGuard?.();this.requirePolicy(action,policyDigest);};
    const guard=(observedAt?:number)=>{this.observeTransient(observedAt);authority();inspectDraft(this.read(id));authority();};
    guard();const proof=this.backend().privateNoteErasureProofNow(id,o,guard);
    if(proof.technical!=='note_content_removed')return fail(409,'rights_conflict');
    let draft:AccountLedger|undefined;
    try{await this.repository.transaction(accountIdFor(id),()=>this.now(),d=>{
      draft=d;authority();const stored=inspectDraft(d);if(stored.acknowledgement)throw new RightsReplay();
      const p=this.requirePolicy(action,policyDigest),now=this.now(d),retainUntil=Math.max(o.receiptRetainUntil,add(now,p.localErasure.receiptRetentionMs));
      if(recording){
        if(d.version!==4||d.commandReceipts.some(r=>r.eventId===recording.commandEventId)||d.localUse.intents.some(i=>i.eventId===recording.commandEventId)||d.localErasure.operations.some(i=>i.eventId===recording.commandEventId))return fail(409,'rights_conflict');
        d.commandReceipts.push({eventId:recording.commandEventId,fingerprint:erasureReconcileFingerprint(accountIdFor(id),o,recording),requestId:o.requestId,resultingRequestRevision:recording.requestRevision,action:'private_note_erasure_reconcile',recordedAt:now,retainUntil});
      }
      stored.acknowledgement={effectRevision:proof.effectRevision!,observedAt:proof.observedAt!,recordedAt:now,retainUntil,...(recording?{recordingAuthority:recording}:{})};d.revision=bump(d.revision);
    },()=>this.finalFence(()=>{
      // The storage writer pins the committed input. Check the locked draft,
      // never recursively read this rights lock; canonical proof stays current.
      authority();if(!draft)return fail(409,'rights_conflict');inspectDraft(draft);
      const current=this.backend().privateNoteErasureProofNow(id,o,(observedAt?:number)=>{this.auth(id,observedAt);operatorGuard?.();});
      if(current.technical!=='note_content_removed'||current.effectRevision!==proof.effectRevision)return fail(409,'rights_conflict');
      authority();inspectDraft(draft);
    }));}catch(e){if(!(e instanceof RightsReplay))throw e;}
  }
  async execute(id:number,requestId:string,space:RightsSpace,raw:LocalErasureExecuteInput):Promise<LocalErasureMutation>{
    const input=localErasureExecuteInputSchema.parse(raw);this.auth(id);const token=this.open(input.planHandle,id,requestId,space);if(token.eventId!==input.eventId)return fail(403,'operation_handle_invalid');
    // Do not publish a clock observation before knowing whether this is a pure
    // expired replay. Authentication, ledger lookup and expiry checks are reads.
    const initial=this.finalFence(()=>this.read(id)),r=this.row(initial,requestId,space);if(initial?.version!==4)return fail(503,'rights_erasure_unsupported');
    const known=initial.localErasure.operations.find(o=>o.eventId===input.eventId);
    const result=(replayed:boolean)=>localErasureMutationSchema.parse({...this.status(id,requestId,space),replayed,operationRef:this.ref(input.eventId)});
    if(known){
      if(known.requestId!==requestId||known.memoryId!==token.memoryId||known.witnessDigest!==token.witnessDigest||known.policyDigest!==token.policyDigest||known.createdAt!==token.createdAt||known.expectedCanonicalRevision!==token.expectedCanonicalRevision||known.expectedBindingDigest!==token.expectedBindingDigest||known.noticeDigest!==token.noticeDigest||known.expiresAt!==token.expiresAt||known.executionDeadline!==token.executionDeadline)return fail(409,'rights_conflict');
      // Expired exact replay is a pure current read, including an unapplied intent.
      if(this.finalFence(()=>this.now(initial)>=known.expiresAt||this.now(initial)>=known.executionDeadline))return result(true);
      const proof=this.backend().privateNoteErasureProofNow(id,known,(observedAt?:number)=>this.auth(id,observedAt));
      if(proof.technical==='note_content_removed'){if(!known.acknowledgement)await this.acknowledge(id,known,'execute');return result(true);}
      this.guard(id,known);await this.backend().eraseSelectedPrivateNote(id,known,()=>this.finalFence(()=>this.guard(id,known)));await this.acknowledge(id,known,'execute');return result(true);
    }
    this.requirePolicy('execute',token.policyDigest);const now=this.now(initial);
    if(now<token.createdAt||now>=token.expiresAt||now>=token.executionDeadline||r.kind!=='erasure'||r.state==='closed_unfulfilled'||r.revision!==token.requestRevision)return fail(409,'rights_conflict');
    const prepared=this.backend().preparePrivateNoteErasureNow(id,space,token.memoryId,token.memoryRevision,(observedAt?:number)=>this.auth(id,observedAt));
    if(prepared.expectedCanonicalRevision!==token.expectedCanonicalRevision||prepared.expectedBindingDigest!==token.expectedBindingDigest||localUseDigest(prepared.witness)!==token.witnessDigest)return fail(409,'rights_conflict');
    const {accountRef:_accountRef,memoryRevision:_memoryRevision,...fields}=token;void _accountRef;void _memoryRevision;
    const o:LocalErasureOperation={...fields,witness:prepared.witness,fingerprint:'0'.repeat(64)};o.fingerprint=erasureFingerprint(accountIdFor(id),o);
    try{await this.repository.transaction(accountIdFor(id),()=>this.now(),d=>{
      this.auth(id);this.requirePolicy('execute',o.policyDigest);const current=this.row(d,requestId,space);if(d.version!==4)return fail(503,'rights_erasure_unsupported');
      const existing=d.localErasure.operations.find(i=>i.eventId===o.eventId);if(existing){if(existing.fingerprint!==o.fingerprint)return fail(409,'rights_conflict');throw new RightsReplay();}
      if(current.revision!==o.requestRevision||current.state==='closed_unfulfilled'||d.localErasure.operations.length>=32||d.localErasure.operations.some(i=>i.memoryId===o.memoryId))return fail(409,'rights_conflict');
      d.localErasure.operations.push(o);d.revision=bump(d.revision);
    },()=>{this.auth(id);this.requirePolicy('execute',o.policyDigest);if(this.now()>=o.expiresAt)return fail(409,'rights_conflict');});}catch(e){if(e instanceof RightsReplay)return this.execute(id,requestId,space,input);throw e;}
    await this.backend().eraseSelectedPrivateNote(id,o,()=>this.finalFence(()=>this.guard(id,o)));
    try{await this.acknowledge(id,o,'execute');}catch{this.auth(id);/* Effect remains durable; current proof truthfully exposes pending acknowledgement. */}
    return result(false);
  }
  async reconcile(id:number,requestId:string,space:RightsSpace,commandEventId:string,operatorGuard:()=>void,reconcileEventId:string,operatorRef:string,expectedRequestRevision:number){
    operatorGuard();const d=this.read(id),r=this.row(d,requestId,space),p=this.requirePolicy('reconcile');
    const o=d?.version===4?d.localErasure.operations.find(o=>o.requestId===requestId&&o.space===space&&o.eventId===commandEventId):undefined;
    if(!o||r.kind!=='erasure'||r.state==='closed_unfulfilled')return fail(404,'not_found');
    if(r.revision!==expectedRequestRevision)return fail(409,'rights_conflict');
    const recording:ErasureRecordingAuthority={version:1,commandEventId:reconcileEventId,requestRevision:r.revision,policy:{id:p.id,revision:p.revision,digest:localUseDigest(p)},operatorRef};
    await this.acknowledge(id,o,'reconcile',operatorGuard,recording);operatorGuard();return this.status(id,requestId,space);
  }
}
