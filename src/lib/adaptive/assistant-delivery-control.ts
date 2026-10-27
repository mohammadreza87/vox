/** ARC1 canonical metadata only. Never imports a transport or retains reply text. */
import { createHash } from 'crypto';
import { z } from 'zod';
import { decodeDeliveryState, encodeDeliveryState, reduceDelivery, type DeliveryState } from '../tireh/delivery/assistant-text-protocol';
import type { AdaptiveDocument, SpaceKind } from './persistence/repository';
export const ASSISTANT_CONTROL_TTL_MS = 7 * 86400_000;
export const ASSISTANT_CONTROL_IDLE_MS = 90 * 86400_000;
export const ASSISTANT_CONTROL_RESERVED_BYTES = 163840;
export const ASSISTANT_CONTROL_STATE_BYTES = 4096;
const MAX = Number.MAX_SAFE_INTEGER;
const number = z.number().int().nonnegative().safe().refine(n => !Object.is(n, -0));
const positive = number.refine(n => n > 0);
const id = z.string().regex(/^[A-Za-z0-9:_-]{1,128}(?![\s\S])/);
const streamSchema = z.object({botId: positive, destinationChatId: positive, agentId: id, space: z.enum(['work','personal']),
  containerId: id, messageFloor: number, highMessageId: number, lastAcceptedAt: number}).strict();
const deliverySchema = z.unknown().transform((value, ctx): DeliveryState => {
  try { return decodeDeliveryState(encodeDeliveryState(value as DeliveryState)); }
  catch { ctx.addIssue({code:'custom',message:'Invalid assistant control state'}); return z.NEVER; }
});
const enrollmentSchema = z.object({botId:positive,destinationChatId:positive,agentId:id,space:z.literal('work'),containerId:id,
  enabled:z.boolean(),enrolledAt:number,changedAt:number,revision:positive,requestId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/)}).strict();
export type AssistantDeliveryEnrollment = z.infer<typeof enrollmentSchema>;
const controlFields = {revision: number,
  observedAt: number, noReplayBefore: number, sourceFenceSequence: number, historyEpoch: number, deletionEpoch: number,
  streams: z.array(streamSchema).max(4), effects: z.array(z.object({state:deliverySchema, retainUntil:number}).strict()).max(32)};
const controlSchema = z.discriminatedUnion('version',[
  z.object({version:z.literal(1),policyVersion:z.literal('arc1-control-7d-v1'),...controlFields}).strict(),
  z.object({version:z.literal(2),policyVersion:z.literal('arc2-control-7d-v1'),...controlFields,enrollments:z.array(enrollmentSchema).max(4)}).strict(),
]);
export type AssistantDeliveryControl = z.infer<typeof controlSchema>;
export type AssistantDeliveryStream = z.infer<typeof streamSchema>;
export type AssistantDeliveryRow = AssistantDeliveryControl['effects'][number];
export class AssistantControlError extends Error {
  constructor(readonly code: 'shape'|'capacity'|'revision'|'clock'|'scope'|'authority'|'unsupported'|'replay_fenced'|'route_conflict'|'conflict'|'metadata_expired'|'key_unavailable'|'busy') { super(code); this.name='AssistantControlError'; }
}
export const assistantControlDigest = (v:unknown):string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bytes = (v:unknown) => Buffer.byteLength(JSON.stringify(v));
/** A conservative future witness reserves all slots at maximum field/counter widths.
 * String stand-ins exceed each bounded encoded state by its JSON string wrapper. */
export function assistantControlReservedFutureBytes(version:1|2):number {
  const opaque='x'.repeat(128),stream={botId:MAX,destinationChatId:MAX,agentId:opaque,space:'personal',containerId:opaque,messageFloor:MAX,highMessageId:MAX,lastAcceptedAt:MAX};
  const enrollment={botId:MAX,destinationChatId:MAX,agentId:opaque,space:'work',containerId:opaque,enabled:false,enrolledAt:MAX,changedAt:MAX,revision:MAX,requestId:'ffffffff-ffff-4fff-bfff-ffffffffffff'};
  return bytes({assistantDeliveryControl:{version,policyVersion:version===2?'arc2-control-7d-v1':'arc1-control-7d-v1',revision:MAX,observedAt:MAX,noReplayBefore:MAX,sourceFenceSequence:MAX,historyEpoch:MAX,deletionEpoch:MAX,
    streams:Array(4).fill(stream),effects:Array(32).fill({state:'x'.repeat(ASSISTANT_CONTROL_STATE_BYTES),retainUntil:MAX}),...(version===2?{enrollments:Array(4).fill(enrollment)}:{})}});
}
const futureReservationBytes=assistantControlReservedFutureBytes(2);
export const assistantStreamKey = (s:Pick<AssistantDeliveryStream,'botId'|'destinationChatId'>) => `${s.botId}:${s.destinationChatId}`;
/** Fixed field order: optional mutable fields must not affect immutable identity. */
const immutable = (s:DeliveryState) => ({schemaVersion:s.schemaVersion, kind:s.kind, effectKey:s.effectKey,
  scope:s.scope, binding:s.binding, source:s.source, authority:s.authority, generationId:s.generationId,
  attemptId:s.attemptId, evidence:s.evidence, createdAt:s.createdAt, expiresAt:s.expiresAt});
export function assistantExpected(s:DeliveryState, now:number) { return {stateRevision:s.revision,effectKey:s.effectKey,attemptId:s.attemptId,scope:s.scope,binding:s.binding,source:s.source,authority:s.authority,now}; }
export function assistantFutureStateBytes(s:DeliveryState):number {
  const base={...s,revision:MAX,lastTransitionAt:MAX,contentEligible:false,invalidatedAtFenceSequence:MAX};
  const outcomes=[{reason:'provider_accepted',observedAt:MAX,receipt:{messageId:MAX,botId:MAX,destinationChatId:MAX,providerDateSeconds:Math.floor(MAX/1000),textEvidence:'matches-submitted'}},
    ...['dispatch_interrupted','transport_error','http_or_provider_rejection','invalid_response','invalid_receipt','receipt_commit_unconfirmed','pre_dispatch_failure','pre_dispatch_denied'].map(reason=>({reason,observedAt:MAX}))];
  return Math.max(...outcomes.map(outcome=>bytes({...base,phase:outcome.reason==='provider_accepted'?'sent':outcome.reason==='pre_dispatch_failure'?'failed':outcome.reason==='pre_dispatch_denied'?'cancelled':'unknown',outcome})));
}
export function parseAssistantDeliveryControl(value:unknown, accountId?:string, personId?:string, now?:number):AssistantDeliveryControl {
  try {
    const c=controlSchema.parse(value);
    if(c.noReplayBefore>c.observedAt || now!==undefined && c.observedAt>now || futureReservationBytes>ASSISTANT_CONTROL_RESERVED_BYTES || bytes({assistantDeliveryControl:c})>ASSISTANT_CONTROL_RESERVED_BYTES ||
      new Set(c.streams.map(assistantStreamKey)).size!==c.streams.length || new Set(c.effects.map(r=>r.state.effectKey)).size!==c.effects.length) throw Error();
    for(const stream of c.streams) {
      if(stream.messageFloor>stream.highMessageId || stream.lastAcceptedAt>c.observedAt)throw Error();
      if(accountId && (accountId!==`telegram-account:${stream.destinationChatId}` || stream.containerId!==`private-tenant:${assistantControlDigest(accountId).slice(0,24)}:${stream.space}:private`))throw Error();
    }
    if(c.version===2){
      if(new Set(c.enrollments.map(assistantStreamKey)).size!==c.enrollments.length)throw Error();
      for(const row of c.enrollments){
        if(row.enrolledAt>row.changedAt||row.changedAt>c.observedAt||accountId&&(accountId!==`telegram-account:${row.destinationChatId}`||row.containerId!==`private-tenant:${assistantControlDigest(accountId).slice(0,24)}:work:private`))throw Error();
        const stream=c.streams.find(s=>assistantStreamKey(s)===assistantStreamKey(row));
        if(stream&&(stream.agentId!==row.agentId||stream.space!==row.space||stream.containerId!==row.containerId))throw Error();
      }
    }
    for(const row of c.effects) {
      const s=row.state, stream=c.streams.find(t=>t.botId===s.binding.botId&&t.destinationChatId===s.binding.destinationChatId);
      const enrollment=c.version===2?c.enrollments.find(r=>assistantStreamKey(r)===assistantStreamKey(s.binding)):undefined;
      if(!stream || s.scope.agentId!==stream.agentId || s.scope.space!==stream.space || s.scope.containerId!==stream.containerId ||
        accountId && s.scope.accountId!==accountId || personId && s.scope.personId!==personId || s.source.revision!==0 ||
        s.createdAt>c.observedAt || s.lastTransitionAt>c.observedAt || !Number.isSafeInteger(s.createdAt+ASSISTANT_CONTROL_TTL_MS) || row.retainUntil!==s.createdAt+ASSISTANT_CONTROL_TTL_MS ||
        encodeDeliveryState(s).byteLength>ASSISTANT_CONTROL_STATE_BYTES || assistantFutureStateBytes(s)>ASSISTANT_CONTROL_STATE_BYTES ||
        s.contentEligible && (c.version===2&&(!enrollment?.enabled||enrollment.agentId!==s.scope.agentId||enrollment.space!==s.scope.space||enrollment.containerId!==s.scope.containerId)||s.source.messageId<=stream.messageFloor || s.source.occurredAt<=c.noReplayBefore || s.authority.sourceFenceSequence!==c.sourceFenceSequence || s.authority.historyEpoch!==c.historyEpoch || s.authority.deletionEpoch!==c.deletionEpoch))throw Error();
    }
    return c;
  } catch { throw new AssistantControlError('shape'); }
}
export function emptyAssistantDeliveryControl(now:number):AssistantDeliveryControl {
  return parseAssistantDeliveryControl({version:1,policyVersion:'arc1-control-7d-v1',revision:0,observedAt:now,noReplayBefore:now,sourceFenceSequence:0,historyEpoch:0,deletionEpoch:0,streams:[],effects:[]});
}
export function advanceAssistantControl(c:AssistantDeliveryControl,now:number):void {
  if(!Number.isSafeInteger(now)||now<c.observedAt)throw new AssistantControlError('clock');
  if(c.revision>=MAX-64 || c.sourceFenceSequence>=MAX-64 || c.historyEpoch>=MAX-64 || c.deletionEpoch>=MAX-64)throw new AssistantControlError('revision');
  c.revision++; c.observedAt=now;
}
function invalidateAll(c:AssistantDeliveryControl, now:number):void {
  if(c.sourceFenceSequence>=MAX-64)throw new AssistantControlError('revision');
  c.sourceFenceSequence++;
  for(const row of c.effects)row.state=reduceDelivery(row.state,{type:'invalidate_content',sourceFenceSequence:c.sourceFenceSequence},assistantExpected(row.state,now));
}
export function invalidateAssistantDeliveryScope(d:AdaptiveDocument,now:number,space?:SpaceKind,agentId?:string,erase=false,disableEnrollment=true):boolean {
  const c=d.assistantDeliveryControl;if(!c)return false;
  advanceAssistantControl(c,now); invalidateAll(c,now);
  if(c.historyEpoch>=MAX-64||c.deletionEpoch>=MAX-64)throw new AssistantControlError('revision');
  c.historyEpoch++;c.deletionEpoch++;
  if(c.version===2&&disableEnrollment)for(const row of c.enrollments)if(row.enabled&&(!space||row.space===space)&&(!agentId||row.agentId===agentId)){
    if(row.revision>=MAX-64)throw new AssistantControlError('revision');row.enabled=false;row.changedAt=now;row.revision++;
  }
  if(erase){
    c.noReplayBefore=Math.max(c.noReplayBefore,now);
    const removed=c.effects.filter(r=>(!space||r.state.scope.space===space)&&(!agentId||r.state.scope.agentId===agentId));
    for(const row of removed){const stream=c.streams.find(s=>s.botId===row.state.binding.botId&&s.destinationChatId===row.state.binding.destinationChatId)!;stream.messageFloor=Math.max(stream.messageFloor,row.state.source.messageId);stream.highMessageId=Math.max(stream.highMessageId,stream.messageFloor);}
    c.effects=c.effects.filter(r=>!removed.includes(r));
  }
  return true;
}
export function invalidateAssistantDeliverySource(d:AdaptiveDocument,now:number,botId:number,chatId:number,messageId:number):void {
  const c=d.assistantDeliveryControl;if(!c)throw new AssistantControlError('authority');
  if(![botId,chatId,messageId].every(v=>Number.isSafeInteger(v)&&v>0)||d.accountId!==`telegram-account:${chatId}`)throw new AssistantControlError('scope');
  const stream=c.streams.find(s=>s.botId===botId&&s.destinationChatId===chatId);
  if(stream && stream.messageFloor>=messageId)return;
  advanceAssistantControl(c,now);
  if(stream){stream.messageFloor=messageId;stream.highMessageId=Math.max(stream.highMessageId,messageId);}
  else c.noReplayBefore=Math.max(c.noReplayBefore,now);
  invalidateAll(c,now);
}
export function pruneAssistantDeliveryControl(d:AdaptiveDocument,now:number):boolean {
  const c=d.assistantDeliveryControl;if(!c)return false;
  if(now<c.observedAt)throw new AssistantControlError('clock');
  const expired=c.effects.filter(r=>r.retainUntil<=now);
  const idle=c.streams.filter(s=>now-s.lastAcceptedAt>=ASSISTANT_CONTROL_IDLE_MS&&!c.effects.some(r=>r.retainUntil>now&&assistantStreamKey(s)===assistantStreamKey(r.state.binding)));
  if(!expired.length&&!idle.length)return false;
  advanceAssistantControl(c,now);
  for(const row of expired){const s=c.streams.find(s=>assistantStreamKey(s)===assistantStreamKey(row.state.binding))!;s.messageFloor=Math.max(s.messageFloor,row.state.source.messageId);s.highMessageId=Math.max(s.highMessageId,s.messageFloor);}
  c.effects=c.effects.filter(r=>!expired.includes(r));
  if(idle.length){c.noReplayBefore=Math.max(c.noReplayBefore,now);c.streams=c.streams.filter(s=>!idle.includes(s));}
  invalidateAll(c,now);return true;
}
export function exportAssistantDeliveryControl(d:AdaptiveDocument,space:SpaceKind) {
  const c=d.assistantDeliveryControl;if(!c)return undefined;
  return structuredClone({...c,...(c.version===2?{enrollments:c.enrollments.filter(r=>r.space===space)}:{}),barriers:'account-wide' as const,streams:c.streams.filter(s=>s.space===space),effects:c.effects.filter(r=>r.state.scope.space===space)});
}
/** Capacity-only opaque replacement; never persisted or accepted as canonical state. */
export function assistantCapacityProjection(d:AdaptiveDocument):AdaptiveDocument {
  if(!d.assistantDeliveryControl)return d;
  const wrapper=bytes({assistantDeliveryControl:''});
  return {...d,revision:MAX,updatedAt:MAX,assistantDeliveryControl:'x'.repeat(ASSISTANT_CONTROL_RESERVED_BYTES-wrapper)} as unknown as AdaptiveDocument;
}
export function assertAssistantDeliveryTransition(beforeImage:unknown,afterImage:unknown,allowEffectMutation=false):void {
  // FILE is shared with non-account stores, whose empty/tombstone image is null.
  // Presence, including corrupt null/false values, is distinct from no ARC field.
  const ownsControl=(value:unknown):value is Record<string,unknown> => value!==null&&typeof value==='object'&&Object.hasOwn(value,'assistantDeliveryControl');
  const priorPresent=ownsControl(beforeImage),nextPresent=ownsControl(afterImage);
  if(!priorPresent&&!nextPresent)return;
  const prior=priorPresent?parseAssistantDeliveryControl(beforeImage.assistantDeliveryControl):undefined;
  const next=nextPresent?parseAssistantDeliveryControl(afterImage.assistantDeliveryControl):undefined;
  const before=beforeImage as AdaptiveDocument|undefined,after=afterImage as AdaptiveDocument|null;
  if(!prior){if(next&&!allowEffectMutation)throw new AssistantControlError('conflict');if(next&&(next.version!==1||next.effects.length||next.streams.length||next.noReplayBefore!==next.observedAt||next.revision!==0))throw new AssistantControlError('conflict');return;}
  if(!after||!next)throw new AssistantControlError('conflict');
  if(prior.version===2&&next.version!==2||prior.version!==next.version&&!allowEffectMutation)throw new AssistantControlError('conflict');
  if(next.version===2){
    const oldRows=prior.version===2?prior.enrollments:[];
    for(const row of oldRows){const n=next.enrollments.find(r=>assistantStreamKey(r)===assistantStreamKey(row));
      if(!n||n.agentId!==row.agentId||n.space!==row.space||n.containerId!==row.containerId||n.enrolledAt<row.enrolledAt||n.changedAt<row.changedAt)throw new AssistantControlError('route_conflict');
      if(assistantControlDigest(row)!==assistantControlDigest(n)){
        if(n.revision!==row.revision+1||!allowEffectMutation&&(n.enabled||n.enrolledAt!==row.enrolledAt||n.requestId!==row.requestId))throw new AssistantControlError('revision');
        if(next.sourceFenceSequence<=prior.sourceFenceSequence)throw new AssistantControlError('replay_fenced');
      }
    }
    for(const row of next.enrollments)if(!oldRows.some(r=>assistantStreamKey(r)===assistantStreamKey(row))&&(!allowEffectMutation||row.revision!==1||!row.enabled))throw new AssistantControlError('conflict');
    if(prior.version===1&&(next.noReplayBefore!==next.observedAt||next.sourceFenceSequence<=prior.sourceFenceSequence))throw new AssistantControlError('replay_fenced');
  }
  if(!allowEffectMutation && next.streams.some(s=>!prior.streams.some(p=>assistantStreamKey(p)===assistantStreamKey(s))))throw new AssistantControlError('conflict');
  if(assistantControlDigest(prior)===assistantControlDigest(next))return;
  if(after.revision<=before!.revision||next.revision<=prior.revision||next.observedAt<prior.observedAt||next.noReplayBefore<prior.noReplayBefore||next.sourceFenceSequence<prior.sourceFenceSequence||next.historyEpoch<prior.historyEpoch||next.deletionEpoch<prior.deletionEpoch)throw new AssistantControlError('revision');
  for(const stream of prior.streams){const n=next.streams.find(s=>assistantStreamKey(s)===assistantStreamKey(stream));
    if(!n){if(next.noReplayBefore<next.observedAt||next.observedAt-stream.lastAcceptedAt<ASSISTANT_CONTROL_IDLE_MS)throw new AssistantControlError('replay_fenced');}
    else if(n.agentId!==stream.agentId||n.space!==stream.space||n.containerId!==stream.containerId||n.messageFloor<stream.messageFloor||n.highMessageId<stream.highMessageId||n.lastAcceptedAt<stream.lastAcceptedAt)throw new AssistantControlError('route_conflict');
  }
  for(const row of prior.effects){const n=next.effects.find(r=>r.state.effectKey===row.state.effectKey), s=row.state;
    if(!n){const stream=next.streams.find(t=>assistantStreamKey(t)===assistantStreamKey(s.binding));if(next.noReplayBefore<s.source.occurredAt&&(!stream||stream.messageFloor<s.source.messageId))throw new AssistantControlError('replay_fenced');continue;}
    if(assistantControlDigest(immutable(s))!==assistantControlDigest(immutable(n.state))||n.retainUntil!==row.retainUntil||s.contentEligible&&!n.state.contentEligible&&n.state.invalidatedAtFenceSequence===undefined||!s.contentEligible&&n.state.contentEligible||n.state.revision<s.revision||n.state.lastTransitionAt<s.lastTransitionAt)throw new AssistantControlError('conflict');
    if(!allowEffectMutation && (s.phase!==n.state.phase||assistantControlDigest(s.outcome??null)!==assistantControlDigest(n.state.outcome??null)) && (n.state.contentEligible||n.state.invalidatedAtFenceSequence===undefined||n.state.invalidatedAtFenceSequence<=(s.invalidatedAtFenceSequence??s.authority.sourceFenceSequence)||!['cancelled','unknown'].includes(n.state.phase)))throw new AssistantControlError('conflict');
    const phases:Record<DeliveryState['phase'],DeliveryState['phase'][]>= {generated:['generated','sending','failed','cancelled'],sending:['sending','sent','unknown'],unknown:['unknown','sent'],sent:['sent'],failed:['failed'],cancelled:['cancelled']};
    if(!phases[s.phase].includes(n.state.phase))throw new AssistantControlError('conflict');
    if(s.phase==='sent'&&assistantControlDigest(s.outcome)!==assistantControlDigest(n.state.outcome))throw new AssistantControlError('conflict');
    if(assistantControlDigest(s)!==assistantControlDigest(n.state)&&n.state.revision<=s.revision)throw new AssistantControlError('revision');
  }
  for(const row of next.effects)if(!prior.effects.some(r=>r.state.effectKey===row.state.effectKey)){
    if(!allowEffectMutation)throw new AssistantControlError('conflict');
    const s=row.state,stream=prior.streams.find(t=>assistantStreamKey(t)===assistantStreamKey(s.binding));
    if(s.phase!=='generated'||s.revision!==0||!s.contentEligible||s.source.occurredAt<=prior.noReplayBefore||s.source.messageId<=(stream?.messageFloor??0))throw new AssistantControlError('replay_fenced');
  }
}
