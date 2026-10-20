import { validateRuntimeControlEvaluation } from '../persistence/authority';
import { brandError, publicDomainError } from '../../error-contract';
import type { AdaptiveService } from '../persistence/service';
import type { AdaptiveDocument } from '../persistence/repository';
import { applyRightsUseHoldCommandSchema, releaseRightsUseHoldCommandSchema, rightsUseScopeSchema,
  type ApplyRightsUseHoldCommand, type ReleaseRightsUseHoldCommand, type RightsUseScope,
  type CanonicalRightsUseSnapshot, type CanonicalRightsUseReceipt, type CanonicalRightsUseRead } from './contracts';
import { parseRightsUseControls, requireRightsUseHoldCapacity, rightsUseEffectDescriptor, rightsUseDigest, sameRightsUseScope } from './state';

export class RightsUseHoldError extends Error {
  readonly name='RightsUseHoldError';
  readonly status:number;
  constructor(readonly code:'unsupported'|'unavailable'|'busy'|'conflict'|'capacity'|'authority_changed') {
    super(code);this.status=['conflict','capacity','authority_changed'].includes(code)?409:503;brandError(this,this.name);
  }
  static is(e:unknown):e is RightsUseHoldError{return publicDomainError(e,'RightsUseHoldError');}
}
/** Server-only canonical authority. Request/policy guards are synchronous and
 * complementary: they cannot supply a document, namespace or store capability. */
const assertSynchronous=(guard:()=>void):void=>{validateRuntimeControlEvaluation({value:guard()});};
export class RightsUseHoldService {
  constructor(private readonly adaptive:AdaptiveService){}
  private qualified():boolean {
    const s=this.adaptive.repository.storage;
    return s.canonicalSchemaVersion===3 && s.supportsCommittedWriteFence===true &&
      (!!s.indexed || s.fileAuthorityProjectionVersion===2 && typeof s.readDirectAuthorityForEffect==='function');
  }
  inspectNow(id:number,raw:RightsUseScope,assertCurrent:()=>void):CanonicalRightsUseRead {
    const scope=rightsUseScopeSchema.parse(raw);assertSynchronous(assertCurrent);
    if(!this.qualified())return {status:'unsupported'};
    try {
      const result=this.adaptive.readDirectAuthorityForEffect(id,scope.space,(d,now)=>{
        assertSynchronous(assertCurrent);if(d.schemaVersion!==3)throw new RightsUseHoldError('unavailable');
        const c=parseRightsUseControls(d.rightsUseControls),s=c.scopes.find(s=>sameRightsUseScope(s,scope))!;
        const value:CanonicalRightsUseSnapshot={version:1,scope:{...scope},accountRevision:d.revision,useEpoch:s.useEpoch,
          effectiveBlocked:s.effectiveBlocked,activeEffectsDigest:s.activeEffectsDigest,effects:c.effects.filter(e=>sameRightsUseScope(e,scope)),observedAt:now};
        return {value};
      });
      assertSynchronous(assertCurrent);return result;
    } catch(e) {if(RightsUseHoldError.is(e))return {status:'unavailable'};throw e;}
  }
  receiptNow(id:number,scope:RightsUseScope,effectId:string,assertCurrent:()=>void):CanonicalRightsUseRead<CanonicalRightsUseSnapshot & {effect:CanonicalRightsUseSnapshot['effects'][number]|null}> {
    const result=this.inspectNow(id,scope,assertCurrent);
    return result.status==='ready'?{status:'ready',value:{...result.value,effect:result.value.effects.find(e=>e.effectId===effectId)??null}}:result;
  }
  apply(id:number,raw:ApplyRightsUseHoldCommand,assertCurrent:()=>void):Promise<CanonicalRightsUseReceipt> {
    const c=applyRightsUseHoldCommandSchema.parse(raw);
    return this.change(id,c,assertCurrent,false);
  }
  release(id:number,raw:ReleaseRightsUseHoldCommand,assertCurrent:()=>void):Promise<CanonicalRightsUseReceipt> {
    const c=releaseRightsUseHoldCommandSchema.parse(raw);
    return this.change(id,c,assertCurrent,true);
  }
  private async change(id:number,c:ApplyRightsUseHoldCommand|ReleaseRightsUseHoldCommand,guard:()=>void,releasing:boolean):Promise<CanonicalRightsUseReceipt> {
    assertSynchronous(guard);if(!this.qualified())throw new RightsUseHoldError('unsupported');
    let draft:AdaptiveDocument|undefined;
    const result=await this.adaptive.rightsUseHoldTransaction(id,(d,now)=>{
      draft=d;assertSynchronous(guard);if(d.schemaVersion!==3||!this.adaptive.isProfileConfirmed(d,now))throw new RightsUseHoldError('authority_changed');
      const h=d.rightsUseHolds!,scope=h.scopes.find(s=>sameRightsUseScope(s,c.scope))!;
      let e=h.effects.find(e=>e.effectId===c.effectId),replayed=false;
      if(e && (!sameRightsUseScope(e,c.scope)||e.requestId!==c.requestId))throw new RightsUseHoldError('conflict');
      if(!releasing && e) {
        const apply=c as ApplyRightsUseHoldCommand;
        if(e.applyIntentDigest!==apply.applyIntentDigest || rightsUseDigest([e.policy,e.notice,e.reviewAt])!==rightsUseDigest([c.policy,c.notice,c.reviewAt]) ||
          e.metadataRetainUntil<c.metadataRetainUntil || e.replayRetainUntil<c.replayRetainUntil)throw new RightsUseHoldError('conflict');
        replayed=true;
      } else if(releasing && e?.state==='released') {
        if(e.release!.releaseIntentDigest!==(c as ReleaseRightsUseHoldCommand).releaseIntentDigest)throw new RightsUseHoldError('conflict');
        replayed=true;
      }
      if(!replayed) {
        if(d.revision!==c.expectedCanonicalRevision||scope.useEpoch!==c.expectedUseEpoch)throw new RightsUseHoldError('conflict');
        if(d.revision===Number.MAX_SAFE_INTEGER||scope.useEpoch===Number.MAX_SAFE_INTEGER)throw new RightsUseHoldError('capacity');
        if(c.reviewAt<now||c.metadataRetainUntil<now||c.replayRetainUntil<now)throw new RightsUseHoldError('authority_changed');
        if(releasing) {
          const release=c as ReleaseRightsUseHoldCommand;
          if(!e||e.revision!==release.expectedEffectRevision||rightsUseEffectDescriptor(e).effectDigest!==release.expectedEffectDigest)throw new RightsUseHoldError('conflict');
          if(e.revision===Number.MAX_SAFE_INTEGER)throw new RightsUseHoldError('capacity');
          e.state='released';e.revision++;e.release={releasedAt:now,releaseIntentDigest:release.releaseIntentDigest,policy:c.policy,notice:c.notice};
          e.metadataRetainUntil=Math.max(e.metadataRetainUntil,c.metadataRetainUntil);e.replayRetainUntil=Math.max(e.replayRetainUntil,c.replayRetainUntil);
        } else {
          if(h.effects.length===128)throw new RightsUseHoldError('capacity');
          e={version:1,effectId:c.effectId,requestId:c.requestId,...c.scope,revision:1,state:'active',appliedAt:now,applyIntentDigest:(c as ApplyRightsUseHoldCommand).applyIntentDigest,
            policy:c.policy,notice:c.notice,reviewAt:c.reviewAt,metadataRetainUntil:c.metadataRetainUntil,replayRetainUntil:c.replayRetainUntil};h.effects.push(e);
        }
        scope.useEpoch++;d.revision++;d.updatedAt=now;
      }
      try{requireRightsUseHoldCapacity(d);}catch{throw new RightsUseHoldError('capacity');}
      return {replayed,effect: rightsUseEffectDescriptor(e!)};
    },()=>{assertSynchronous(guard);if(!draft||draft.schemaVersion!==3||!this.adaptive.isProfileConfirmed(draft,this.adaptive.sampleServiceClock()))throw new RightsUseHoldError('authority_changed');});
    // Return current authority, never a historical active receipt after release.
    const latest=this.receiptNow(id,c.scope,c.effectId,guard);
    if(latest.status!=='ready'||!latest.value.effect)throw new RightsUseHoldError(latest.status==='busy'?'busy':'unavailable');
    const {effects: _effects,activeEffectsDigest:_digest,...snapshot}=latest.value;
    void _effects;void _digest;return {...snapshot,effect:latest.value.effect,replayed:result.replayed};
  }
}
