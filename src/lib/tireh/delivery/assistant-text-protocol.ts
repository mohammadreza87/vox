import {createHmac} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';

/** ADP1 is an unused, pure protocol prerequisite. Inputs assert trust; this
 * module cannot authenticate ingress, establish current committed authority,
 * persist claims, dispatch HTTP, deduplicate after restart or approve retention.
 * Prepared text/key material is transient; only DeliveryState is content-free
 * metadata (still personal/control data). No runtime consumer is installed. */
export const MAX_DELIVERY_STATE_BYTES = 16_384;
export const MAX_DELIVERY_BODY_BYTES = 32_768;
export const MAX_DELIVERY_RESPONSE_BYTES = 65_536;
export const MAX_DELIVERY_TEXT_UNITS = 65_536;
export const MAX_DELIVERY_PREPARATION_MS = 60_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_JSON_NODES = 2_048;
const MAX_JSON_DEPTH = 32;
// A prepared event contains one bounded body plus its 32-byte evidence key.
const MAX_COPIED_BYTE_ARRAY_BYTES = MAX_DELIVERY_BODY_BYTES + 32;

export type DeliveryProtocolErrorCode = 'shape' | 'capacity' | 'identity' | 'integrity'
  | 'transition' | 'clock' | 'expiry' | 'revision';
export class DeliveryProtocolError extends Error {
  constructor(readonly code: DeliveryProtocolErrorCode) {super(code); this.name = 'DeliveryProtocolError';}
}
const fail = (code: DeliveryProtocolErrorCode): never => {throw new DeliveryProtocolError(code);};
const protect = <T>(work: () => T): T => {
  try {return work();} catch (error) {
    if (error instanceof DeliveryProtocolError) throw error;
    return fail('shape');
  }
};
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const byteLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const byteLengthOf = (value: Uint8Array): number => byteLengthGetter.call(value) as number;
function copyBytes(value: Uint8Array, length: number): Uint8Array {
  const copy = new Uint8Array(length);
  Uint8Array.prototype.set.call(copy, value);
  return copy;
}
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);
const integer = z.number().int().min(0).max(MAX_SAFE).refine(value => !Object.is(value, -0));
const positive = integer.refine(value => value > 0);
const id = z.string().regex(/^[A-Za-z0-9:_-]{1,128}(?![\s\S])/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/);
const hmac = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const byteArray = z.custom<Uint8Array>(value => typeof value === 'object' && value !== null
  && !types.isProxy(value) && types.isUint8Array(value));
const keySchema = byteArray.refine(value => value.byteLength === 32);
const textSchema = z.string().min(1).max(MAX_DELIVERY_TEXT_UNITS);

const scopeSchema = z.object({accountId: id, personId: id, agentId: id,
  space: z.enum(['work', 'personal']), containerId: id, kind: z.literal('private')}).strict();
const bindingSchema = z.object({botId: positive, destinationChatId: positive,
  endpointBindingId: id, credentialBindingId: id, bindingRevision: id}).strict();
const sourceSchema = z.object({messageId: positive, updateId: integer, revision: integer,
  occurredAt: integer, acceptedAt: integer}).strict().refine(value => value.occurredAt <= value.acceptedAt);
const authoritySchema = z.object({authorityRevision: id, grantRevision: id,
  sourceFenceRevision: id, sourceFenceSequence: integer, historyEpoch: integer,
  deletionEpoch: integer, expiresAt: integer}).strict();
const evidenceSchema = z.object({keyId: id, generatedHmac: hmac, generatedUtf16Length: positive.refine(value => value <= MAX_DELIVERY_TEXT_UNITS),
  submittedTextHmac: hmac, submittedUtf16Length: positive.refine(value => value <= 4096),
  bodyHmac: hmac, bodyBytes: positive.refine(value => value <= MAX_DELIVERY_BODY_BYTES)}).strict();
const receiptSchema = z.object({messageId: positive, botId: positive, destinationChatId: positive,
  providerDateSeconds: integer.refine(value => Number.isSafeInteger(value * 1000)),
  textEvidence: z.enum(['matches-submitted', 'different', 'unavailable'])}).strict();
const unknownReasonSchema = z.enum(['dispatch_interrupted', 'transport_error', 'http_or_provider_rejection',
  'invalid_response', 'invalid_receipt', 'receipt_commit_unconfirmed']);
const outcomeSchema = z.union([
  z.object({reason: z.literal('provider_accepted'), observedAt: integer, receipt: receiptSchema}).strict(),
  z.object({reason: z.literal('pre_dispatch_failure'), observedAt: integer}).strict(),
  z.object({reason: z.literal('pre_dispatch_denied'), observedAt: integer}).strict(),
  z.object({reason: unknownReasonSchema, observedAt: integer}).strict(),
]);
const stateSchema = z.object({schemaVersion: z.literal(1), kind: z.literal('assistant-text-delivery'),
  effectKey: z.string().min(1).max(256), scope: scopeSchema, binding: bindingSchema, source: sourceSchema,
  authority: authoritySchema, generationId: uuid, attemptId: uuid, evidence: evidenceSchema,
  createdAt: integer, lastTransitionAt: integer, expiresAt: integer, revision: integer,
  phase: z.enum(['generated', 'sending', 'sent', 'failed', 'cancelled', 'unknown']),
  contentEligible: z.boolean(), invalidatedAtFenceSequence: integer.optional(), outcome: outcomeSchema.optional(),
}).strict();

export type DeliveryScope = z.infer<typeof scopeSchema>;
export type DeliveryBinding = z.infer<typeof bindingSchema>;
export type DeliverySource = z.infer<typeof sourceSchema>;
export type DeliveryAuthority = z.infer<typeof authoritySchema>;
export type DeliveryReceipt = z.infer<typeof receiptSchema>;
export type DeliveryState = z.infer<typeof stateSchema>;
export type DeliveryUnknownReason = z.infer<typeof unknownReasonSchema>;

/** Copies only ordinary JSON data, without calling getters or toJSON. Limits
 * bound provider projection traversal; proxies/cross-realm prototypes are not
 * accepted. This is input validation, not an isolation boundary for JS code. */
function copyJson(value: unknown, allowBytes = false): unknown {
  const seen = new Set<object>();
  let nodes = 0, copiedBytes = 0;
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return fail('capacity');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : fail('shape');
    if (typeof input !== 'object' || types.isProxy(input)) return fail('shape');
    if (allowBytes && types.isUint8Array(input)) {
      const length = byteLengthOf(input);
      if (length > MAX_DELIVERY_BODY_BYTES
        || length > MAX_COPIED_BYTE_ARRAY_BYTES - copiedBytes) fail('capacity');
      copiedBytes += length;
      return copyBytes(input, length);
    }
    if (seen.has(input)) return fail('shape');
    const array = Array.isArray(input), prototype: unknown = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail('shape');
    seen.add(input);
    const output: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(input);
    if (keys.length > MAX_JSON_NODES + 1) return fail('capacity');
    for (const property of keys) {
      if (array && property === 'length') continue;
      if (typeof property !== 'string' || property === 'toJSON') return fail('shape');
      const descriptor = Object.getOwnPropertyDescriptor(input, property);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('shape');
      if (array && (!/^(0|[1-9]\d*)(?![\s\S])/.test(property) || Number(property) >= (input as unknown[]).length)) return fail('shape');
      Object.defineProperty(output, property, {value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true});
    }
    if (array && (output as unknown[]).length !== (input as unknown[]).length) return fail('shape');
    // Sparse arrays are not parsed JSON arrays; do not normalize holes to null.
    if (array && keys.length - 1 !== (input as unknown[]).length) return fail('shape');
    seen.delete(input);
    return output;
  };
  return copy(value, 0);
}
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => schema.parse(copyJson(input, true));
function effectKey(binding: DeliveryBinding, source: DeliverySource): string {
  return JSON.stringify(['adp1', 'telegram', binding.botId, binding.destinationChatId, source.messageId, 'initial', 'primary-text']);
}
/** Stable across policy/source revisions, key rotation and attempt replacement.
 * A future global transactional adapter must enforce uniqueness across scopes. */
export function initialEffectKey(binding: DeliveryBinding, source: DeliverySource): string {
  return protect(() => effectKey(parse(bindingSchema, binding), parse(sourceSchema, source)));
}
function state(input: unknown): DeliveryState {
  const value = parse(stateSchema, input);
  if (effectKey(value.binding, value.source) !== value.effectKey) fail('identity');
  if (value.createdAt > MAX_SAFE - MAX_DELIVERY_PREPARATION_MS || value.source.acceptedAt > value.createdAt
    || value.lastTransitionAt < value.createdAt) fail('clock');
  if (value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > MAX_DELIVERY_PREPARATION_MS
    || value.expiresAt > value.authority.expiresAt) fail('expiry');
  if (value.invalidatedAtFenceSequence !== undefined) {
    if (value.contentEligible || value.invalidatedAtFenceSequence <= value.authority.sourceFenceSequence) fail('identity');
  } else if (!value.contentEligible) fail('identity');
  if (value.phase === 'generated' ? value.revision !== 0 || value.lastTransitionAt !== value.createdAt
    : value.phase === 'sending' ? value.revision !== 1 : value.revision < (value.phase === 'sent' || value.phase === 'unknown' ? 2 : 1)) fail('revision');
  const outcome = value.outcome;
  if (outcome && (outcome.observedAt < value.createdAt || outcome.observedAt > value.lastTransitionAt)) fail('clock');
  if (value.phase === 'generated' || value.phase === 'sending') {
    if (outcome || !value.contentEligible || value.invalidatedAtFenceSequence !== undefined) fail('transition');
  } else if (!outcome) fail('transition');
  else if (value.phase === 'sent') {
    if (outcome.reason !== 'provider_accepted' || outcome.receipt.botId !== value.binding.botId
      || outcome.receipt.destinationChatId !== value.binding.destinationChatId) fail('identity');
  } else if (value.phase === 'failed') {
    if (outcome.reason !== 'pre_dispatch_failure') fail('transition');
  } else if (value.phase === 'cancelled') {
    if (outcome.reason !== 'pre_dispatch_denied') fail('transition');
  } else if (!unknownReasonSchema.safeParse(outcome.reason).success) fail('transition');
  if (utf8(JSON.stringify(value)).byteLength > MAX_DELIVERY_STATE_BYTES) fail('capacity');
  return value;
}
function digest(key: Uint8Array, domain: string, value: string): string {
  return createHmac('sha256', key).update(utf8(JSON.stringify([domain, value]))).digest('hex');
}
const preparedSchema = z.object({initialState: stateSchema, generatedText: textSchema, decoratedText: textSchema,
  submittedText: z.string().min(1).max(4096), bodyJson: z.string().min(1).max(MAX_DELIVERY_BODY_BYTES),
  bodyBytes: byteArray.refine(value => value.byteLength <= MAX_DELIVERY_BODY_BYTES), method: z.literal('sendMessage'),
  verb: z.literal('POST'), contentType: z.literal('application/json')}).strict();
export type PreparedAssistantText = z.infer<typeof preparedSchema>;
const preparationSchema = z.object({scope: scopeSchema, binding: bindingSchema, source: sourceSchema, authority: authoritySchema,
  generationId: uuid, attemptId: uuid, generatedText: textSchema, decoratedText: textSchema,
  keyId: id, evidenceKey: keySchema, now: integer, expiresAt: integer}).strict();
export type PrepareAssistantTextInput = z.infer<typeof preparationSchema>;

export function prepareAssistantText(input: PrepareAssistantTextInput): PreparedAssistantText {
  return protect(() => {
    const value = parse(preparationSchema, input);
    if (value.now > MAX_SAFE - MAX_DELIVERY_PREPARATION_MS || value.now < value.source.acceptedAt) fail('clock');
    if (value.authority.expiresAt <= value.now || value.expiresAt <= value.now
      || value.expiresAt > Math.min(value.authority.expiresAt, value.now + MAX_DELIVERY_PREPARATION_MS)) fail('expiry');
    const submittedText = value.decoratedText.slice(0, 4096);
    const bodyJson = JSON.stringify({chat_id: value.binding.destinationChatId, text: submittedText});
    const bodyBytes = utf8(bodyJson);
    if (bodyBytes.byteLength > MAX_DELIVERY_BODY_BYTES) fail('capacity');
    const initialState = state({schemaVersion: 1, kind: 'assistant-text-delivery',
      effectKey: effectKey(value.binding, value.source), scope: value.scope, binding: value.binding,
      source: value.source, authority: value.authority, generationId: value.generationId, attemptId: value.attemptId,
      evidence: {keyId: value.keyId, generatedHmac: digest(value.evidenceKey, 'adp1-generated', value.generatedText),
        generatedUtf16Length: value.generatedText.length, submittedTextHmac: digest(value.evidenceKey, 'adp1-submitted', submittedText),
        submittedUtf16Length: submittedText.length, bodyHmac: digest(value.evidenceKey, 'adp1-body', bodyJson), bodyBytes: bodyBytes.byteLength},
      createdAt: value.now, lastTransitionAt: value.now, expiresAt: value.expiresAt, revision: 0,
      phase: 'generated', contentEligible: true});
    return {initialState, generatedText: value.generatedText, decoratedText: value.decoratedText, submittedText,
      bodyJson, bodyBytes, method: 'sendMessage', verb: 'POST', contentType: 'application/json'};
  });
}
function prepared(input: PreparedAssistantText, inputKey: Uint8Array): PreparedAssistantText {
  const value = parse(preparedSchema, input), key = parse(keySchema, inputKey), initial = state(value.initialState);
  if (initial.phase !== 'generated' || initial.revision !== 0 || !initial.contentEligible || initial.outcome
    || initial.invalidatedAtFenceSequence !== undefined || initial.lastTransitionAt !== initial.createdAt) fail('integrity');
  const submitted = value.decoratedText.slice(0, 4096);
  const body = JSON.stringify({chat_id: initial.binding.destinationChatId, text: submitted});
  if (value.submittedText !== submitted || value.bodyJson !== body || !bytesEqual(value.bodyBytes, utf8(body))
    || initial.evidence.generatedUtf16Length !== value.generatedText.length || initial.evidence.submittedUtf16Length !== submitted.length
    || initial.evidence.bodyBytes !== value.bodyBytes.byteLength
    || initial.evidence.generatedHmac !== digest(key, 'adp1-generated', value.generatedText)
    || initial.evidence.submittedTextHmac !== digest(key, 'adp1-submitted', submitted)
    || initial.evidence.bodyHmac !== digest(key, 'adp1-body', body)) fail('integrity');
  return {...value, initialState: initial};
}
/** Checks supplied preparation consistency, not authenticated source/authority. */
export function assertPreparedIntegrity(input: PreparedAssistantText, evidenceKey: Uint8Array): void {
  protect(() => {prepared(input, evidenceKey);});
}
export function encodeDeliveryState(input: DeliveryState): Uint8Array {
  return protect(() => utf8(JSON.stringify(state(input))));
}
export function decodeDeliveryState(input: Uint8Array): DeliveryState {
  return protect(() => {
    if (!input || typeof input !== 'object' || types.isProxy(input) || !types.isUint8Array(input)) fail('shape');
    const length = byteLengthOf(input);
    if (length > MAX_DELIVERY_STATE_BYTES) fail('capacity');
    const bytes = copyBytes(input, length);
    const result = state(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
    if (!bytesEqual(bytes, utf8(JSON.stringify(result)))) fail('integrity');
    return result;
  });
}

const transportSchema = z.object({method: z.literal('sendMessage'), botId: positive, credentialBindingId: id,
  endpointBindingId: id, attemptId: uuid, effectKey: z.string().min(1).max(256), dispatchedBodyHmac: hmac,
  observedAt: integer}).strict();
const responseSchema = z.object({httpStatus: z.number().int().min(100).max(599), body: z.unknown()}).strict();
export type TransportEvidence = z.infer<typeof transportSchema>;
export type ResponseProjection = {httpStatus: number; body: unknown};
export type AssistantTextResponse = {kind: 'accepted'; receipt: DeliveryReceipt}
  | {kind: 'unknown'; reason: 'http_or_provider_rejection' | 'invalid_response' | 'invalid_receipt'};
const unknown = (reason: Extract<AssistantTextResponse, {kind: 'unknown'}>['reason']): AssistantTextResponse => ({kind: 'unknown', reason});
function classify(value: PreparedAssistantText, transport: unknown, input: unknown): AssistantTextResponse {
  let response: ResponseProjection;
  try {
    response = responseSchema.parse(copyJson(input)) as ResponseProjection;
    if (utf8(JSON.stringify(response)).byteLength > MAX_DELIVERY_RESPONSE_BYTES) return unknown('invalid_response');
    if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)
      || !('ok' in response.body) || typeof response.body.ok !== 'boolean') return unknown('invalid_response');
  } catch {return unknown('invalid_response');}
  let evidence: TransportEvidence;
  try {evidence = parse(transportSchema, transport);} catch {return unknown('invalid_receipt');}
  const claim = value.initialState, binding = claim.binding;
  if (evidence.method !== value.method || evidence.botId !== binding.botId
    || evidence.credentialBindingId !== binding.credentialBindingId || evidence.endpointBindingId !== binding.endpointBindingId
    || evidence.attemptId !== claim.attemptId || evidence.effectKey !== claim.effectKey
    || evidence.dispatchedBodyHmac !== claim.evidence.bodyHmac || evidence.observedAt < claim.createdAt) return unknown('invalid_receipt');
  const body = response.body as Record<string, unknown>;
  if (response.httpStatus !== 200 || body.ok === false) return unknown('http_or_provider_rejection');
  if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) return unknown('invalid_receipt');
  const result = body.result as Record<string, unknown>;
  if (!result.chat || typeof result.chat !== 'object' || Array.isArray(result.chat)) return unknown('invalid_receipt');
  const chat = result.chat as Record<string, unknown>;
  if (chat.type !== 'private' || chat.id !== binding.destinationChatId) return unknown('invalid_receipt');
  if (result.from !== undefined) {
    if (!result.from || typeof result.from !== 'object' || Array.isArray(result.from)) return unknown('invalid_receipt');
    const sender = result.from as Record<string, unknown>;
    if (sender.id !== binding.botId || sender.is_bot !== true) return unknown('invalid_receipt');
  }
  if (result.text !== undefined && typeof result.text !== 'string') return unknown('invalid_receipt');
  const receipt = receiptSchema.safeParse({messageId: result.message_id, botId: binding.botId,
    destinationChatId: chat.id, providerDateSeconds: result.date,
    textEvidence: result.text === undefined ? 'unavailable' : result.text === value.submittedText ? 'matches-submitted' : 'different'});
  return receipt.success ? {kind: 'accepted', receipt: receipt.data} : unknown('invalid_receipt');
}
/** Validates an injected transport assertion. Acceptance means provider receipt,
 * never human display/read/heard. Every post-dispatch rejection stays unknown. */
export function classifyAssistantTextResponse(input: PreparedAssistantText, transport: TransportEvidence,
  response: ResponseProjection, evidenceKey: Uint8Array): AssistantTextResponse {
  return protect(() => classify(prepared(input, evidenceKey), transport, response));
}

const expectedSchema = z.object({stateRevision: integer, effectKey: z.string().min(1).max(256), attemptId: uuid,
  scope: scopeSchema, binding: bindingSchema, source: sourceSchema, authority: authoritySchema, now: integer}).strict();
export type DeliveryExpected = z.infer<typeof expectedSchema>;
export type DeliveryEvent =
  | {type: 'begin_dispatch'; prepared: PreparedAssistantText; evidenceKey: Uint8Array}
  | {type: 'pre_dispatch_failure'}
  | {type: 'pre_dispatch_denied'}
  | {type: 'record_response'; prepared: PreparedAssistantText; evidenceKey: Uint8Array;
      transportEvidence: TransportEvidence; response: ResponseProjection}
  | {type: 'record_uncertainty'; reason: 'transport_error' | 'invalid_response' | 'receipt_commit_unconfirmed'}
  | {type: 'recover_interrupted'}
  | {type: 'invalidate_content'; sourceFenceSequence: number};
const eventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('begin_dispatch'), prepared: preparedSchema, evidenceKey: keySchema}).strict(),
  z.object({type: z.literal('pre_dispatch_failure')}).strict(),
  z.object({type: z.literal('pre_dispatch_denied')}).strict(),
  // Receipt projection is validated by classify: malformed provider data yields
  // uncertainty instead of a free normalized acceptance event.
  z.object({type: z.literal('record_response'), prepared: preparedSchema, evidenceKey: keySchema,
    transportEvidence: z.unknown(), response: z.unknown()}).strict(),
  z.object({type: z.literal('record_uncertainty'), reason: z.enum(['transport_error', 'invalid_response', 'receipt_commit_unconfirmed'])}).strict(),
  z.object({type: z.literal('recover_interrupted')}).strict(),
  z.object({type: z.literal('invalidate_content'), sourceFenceSequence: integer}).strict(),
]);
const immutable = (value: DeliveryState) => ({effectKey: value.effectKey, scope: value.scope, binding: value.binding,
  source: value.source, authority: value.authority, generationId: value.generationId, attemptId: value.attemptId,
  evidence: value.evidence, createdAt: value.createdAt, expiresAt: value.expiresAt});
function bindPrepared(value: DeliveryState, input: PreparedAssistantText, key: Uint8Array): PreparedAssistantText {
  const proof = prepared(input, key);
  if (!equal(immutable(value), immutable(proof.initialState))) fail('identity');
  return proof;
}
function change(value: DeliveryState, now: number, patch: Partial<DeliveryState>): DeliveryState {
  if (value.revision === MAX_SAFE) fail('revision');
  return state({...value, ...patch, revision: value.revision + 1, lastTransitionAt: now});
}
function uncertain(value: DeliveryState, now: number, reason: DeliveryUnknownReason): DeliveryState {
  if (value.phase === 'unknown' && value.outcome?.reason === reason) return value;
  if (value.phase !== 'sending') fail('transition');
  return change(value, now, {phase: 'unknown', outcome: {reason, observedAt: now}});
}
/** Proposes metadata transitions only. A future adapter must commit sending and
 * synchronously recheck that exact committed attempt at its actual POST. */
export function reduceDelivery(input: DeliveryState, inputEvent: DeliveryEvent, inputExpected: DeliveryExpected): DeliveryState {
  return protect(() => {
    const value = state(input), expected = parse(expectedSchema, inputExpected);
    if (expected.stateRevision !== value.revision) fail('revision');
    if (expected.effectKey !== value.effectKey || expected.attemptId !== value.attemptId
      || !equal(expected.scope, value.scope) || !equal(expected.binding, value.binding)
      || !equal(expected.source, value.source) || !equal(expected.authority, value.authority)) fail('identity');
    if (expected.now < value.lastTransitionAt) fail('clock');
    // Parse event wrapper separately so invalid/non-JSON response evidence can
    // be conservatively classified without invoking its getters or toJSON.
    if (!inputEvent || typeof inputEvent !== 'object' || types.isProxy(inputEvent)
      || Object.getPrototypeOf(inputEvent) !== Object.prototype && Object.getPrototypeOf(inputEvent) !== null) fail('shape');
    const descriptors = Object.getOwnPropertyDescriptors(inputEvent);
    for (const property of Reflect.ownKeys(descriptors)) {
      if (typeof property !== 'string' || !('value' in descriptors[property]) || !descriptors[property].enumerable) fail('shape');
    }
    const wrapper = {...inputEvent} as Record<string, unknown>;
    const rawResponse = wrapper.response, rawTransport = wrapper.transportEvidence;
    if (wrapper.type === 'record_response') {
      if (!Object.hasOwn(wrapper, 'response') || !Object.hasOwn(wrapper, 'transportEvidence')) fail('shape');
      wrapper.response = null; wrapper.transportEvidence = null;
    }
    const event = parse(eventSchema, wrapper);
    const now = expected.now;
    switch (event.type) {
      case 'begin_dispatch': {
        bindPrepared(value, event.prepared, event.evidenceKey);
        if (value.phase !== 'generated' || !value.contentEligible) fail('transition');
        if (now >= value.expiresAt || now >= value.authority.expiresAt) fail('expiry');
        return change(value, now, {phase: 'sending'});
      }
      case 'pre_dispatch_failure':
      case 'pre_dispatch_denied': {
        const phase = event.type === 'pre_dispatch_failure' ? 'failed' : 'cancelled';
        const reason = event.type;
        if (value.phase === phase && value.outcome?.reason === reason) return value;
        if (value.phase !== 'generated') fail('transition');
        return change(value, now, {phase, outcome: {reason, observedAt: now}});
      }
      case 'record_response': {
        const proof = bindPrepared(value, event.prepared, event.evidenceKey);
        const transport = (() => {try {return parse(transportSchema, rawTransport);} catch {return undefined;}})();
        if (transport && transport.observedAt !== now) fail('clock');
        if (!['sending', 'unknown', 'sent'].includes(value.phase)) fail('transition');
        const result = classify(proof, rawTransport, rawResponse);
        if (result.kind === 'unknown') return uncertain(value, now, result.reason);
        if (value.phase === 'sent') {
          if (value.outcome?.reason === 'provider_accepted' && equal(value.outcome.receipt, result.receipt)) return value;
          return fail('transition');
        }
        return change(value, now, {phase: 'sent', outcome: {reason: 'provider_accepted', observedAt: now, receipt: result.receipt}});
      }
      case 'record_uncertainty': return uncertain(value, now, event.reason);
      case 'recover_interrupted': return uncertain(value, now, 'dispatch_interrupted');
      case 'invalidate_content': {
        const current = value.invalidatedAtFenceSequence ?? value.authority.sourceFenceSequence;
        if (!value.contentEligible && event.sourceFenceSequence === current) return value;
        if (event.sourceFenceSequence <= current) fail('revision');
        const patch: Partial<DeliveryState> = {contentEligible: false, invalidatedAtFenceSequence: event.sourceFenceSequence};
        if (value.phase === 'generated') {patch.phase = 'cancelled'; patch.outcome = {reason: 'pre_dispatch_denied', observedAt: now};}
        if (value.phase === 'sending') {patch.phase = 'unknown'; patch.outcome = {reason: 'dispatch_interrupted', observedAt: now};}
        return change(value, now, patch);
      }
    }
  });
}
