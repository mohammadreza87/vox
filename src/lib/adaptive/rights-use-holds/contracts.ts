import { z } from 'zod';
export const RIGHTS_USE_HOLD_ENFORCEMENT_VERSION = 1 as const;
export const RIGHTS_USE_EFFECT_LIMIT = 128;
export const rightsUseTime = z.number().int().nonnegative().safe();
export const rightsUseRevision = rightsUseTime.positive();
export const rightsUseHash = z.string().regex(/^[a-f0-9]{64}$/);
export const rightsUseId = z.uuid();
export const RIGHTS_USE_PURPOSES = ['optional.personalization','optional.product_analytics'] as const;
export const rightsUseScopeSchema = z.object({space:z.enum(['work','personal']),purpose:z.enum(RIGHTS_USE_PURPOSES)}).strict();
export type RightsUseScope = z.infer<typeof rightsUseScopeSchema>;
export const rightsUsePolicyBindingSchema = z.object({id:z.string().min(1).max(100),revision:rightsUseRevision,digest:rightsUseHash,
  approvalReference:z.string().min(1).max(200),decisionReference:z.string().min(1).max(200)}).strict();
export const rightsUseNoticeSchema = z.object({version:z.string().min(1).max(100),digest:rightsUseHash}).strict();
const release = z.object({releasedAt:rightsUseTime,releaseIntentDigest:rightsUseHash,policy:rightsUsePolicyBindingSchema,notice:rightsUseNoticeSchema}).strict();
export const rightsUseEffectSchema = z.object({version:z.literal(1),effectId:rightsUseId,requestId:rightsUseId,...rightsUseScopeSchema.shape,
  revision:rightsUseRevision,state:z.enum(['active','released']),appliedAt:rightsUseTime,applyIntentDigest:rightsUseHash,
  policy:rightsUsePolicyBindingSchema,notice:rightsUseNoticeSchema,reviewAt:rightsUseTime,metadataRetainUntil:rightsUseTime,replayRetainUntil:rightsUseTime,
  release:release.optional()}).strict().refine(e=>(e.state==='released')===!!e.release && (!e.release || e.release.releasedAt>=e.appliedAt && e.revision>=2) &&
    e.reviewAt>=e.appliedAt && e.metadataRetainUntil>=e.appliedAt && e.replayRetainUntil>=e.appliedAt);
export type RightsUseEffect = z.infer<typeof rightsUseEffectSchema>;
export const RIGHTS_USE_SCOPES:readonly RightsUseScope[]=(['work','personal'] as const).flatMap(space=>RIGHTS_USE_PURPOSES.map(purpose=>({space,purpose})));
const fixedScopes = (rows:RightsUseScope[])=>rows.length===4 && rows.every((r,i)=>r.space===RIGHTS_USE_SCOPES[i].space && r.purpose===RIGHTS_USE_SCOPES[i].purpose);
export const rightsUseHoldsSchema = z.object({version:z.literal(1),scopes:z.array(rightsUseScopeSchema.extend({useEpoch:rightsUseTime}).strict()).length(4),
  effects:z.array(rightsUseEffectSchema).max(RIGHTS_USE_EFFECT_LIMIT)}).strict().refine(d=>fixedScopes(d.scopes) && new Set(d.effects.map(e=>e.effectId)).size===d.effects.length &&
    d.scopes.every(s=>s.useEpoch>=d.effects.filter(e=>e.space===s.space&&e.purpose===s.purpose).reduce((n,e)=>n+(e.state==='released'?2:1),0)));
export type RightsUseHolds = z.infer<typeof rightsUseHoldsSchema>;
export const rightsUseEffectDescriptorSchema=z.object({effectId:rightsUseId,requestId:rightsUseId,...rightsUseScopeSchema.shape,state:z.enum(['active','released']),
  revision:rightsUseRevision,appliedAt:rightsUseTime,applyIntentDigest:rightsUseHash,effectDigest:rightsUseHash,releasedAt:rightsUseTime.optional(),releaseIntentDigest:rightsUseHash.optional()}).strict()
  .refine(e=>e.state==='released' ? e.releasedAt!==undefined && !!e.releaseIntentDigest && e.releasedAt>=e.appliedAt : e.releasedAt===undefined && e.releaseIntentDigest===undefined);
export type RightsUseEffectDescriptor=z.infer<typeof rightsUseEffectDescriptorSchema>;
export const rightsUseControlsSchema=z.object({version:z.literal(1),scopes:z.array(rightsUseScopeSchema.extend({useEpoch:rightsUseTime,effectiveBlocked:z.boolean(),activeEffectsDigest:rightsUseHash}).strict()).length(4),
  effects:z.array(rightsUseEffectDescriptorSchema).max(RIGHTS_USE_EFFECT_LIMIT)}).strict().refine(d=>fixedScopes(d.scopes)&&new Set(d.effects.map(e=>e.effectId)).size===d.effects.length);
export type RightsUseControls=z.infer<typeof rightsUseControlsSchema>;
const command={version:z.literal(1),scope:rightsUseScopeSchema,effectId:rightsUseId,requestId:rightsUseId,expectedCanonicalRevision:rightsUseRevision,
  expectedUseEpoch:rightsUseTime,policy:rightsUsePolicyBindingSchema,notice:rightsUseNoticeSchema,reviewAt:rightsUseTime,metadataRetainUntil:rightsUseTime,replayRetainUntil:rightsUseTime};
export const applyRightsUseHoldCommandSchema=z.object({...command,applyIntentDigest:rightsUseHash}).strict();
export const releaseRightsUseHoldCommandSchema=z.object({...command,expectedEffectRevision:rightsUseRevision,expectedEffectDigest:rightsUseHash,releaseIntentDigest:rightsUseHash}).strict();
export type ApplyRightsUseHoldCommand=z.infer<typeof applyRightsUseHoldCommandSchema>;
export type ReleaseRightsUseHoldCommand=z.infer<typeof releaseRightsUseHoldCommandSchema>;
export interface CanonicalRightsUseSnapshot {version:1;scope:RightsUseScope;accountRevision:number;useEpoch:number;effectiveBlocked:boolean;activeEffectsDigest:string;effects:RightsUseEffectDescriptor[];observedAt:number}
export interface CanonicalRightsUseReceipt extends Omit<CanonicalRightsUseSnapshot,'effects'|'activeEffectsDigest'> {replayed:boolean;effect:RightsUseEffectDescriptor}
export type CanonicalRightsUseRead<T=CanonicalRightsUseSnapshot>={status:'ready';value:T}|{status:'unsupported'|'busy'|'missing'|'unavailable'};
