import {createHash, createHmac} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {TelegramBotClient} from '../telegram/client';
import {
  DeliveryProtocolError,
  assertPreparedIntegrity,
  classifyAssistantTextResponse,
  decodeDeliveryState,
  encodeDeliveryState,
  initialEffectKey,
  prepareAssistantText,
  reduceDelivery,
} from '../delivery/assistant-text-protocol';

// Independent ADP1 oracles. All identities/content/provider responses are synthetic.
// These fixtures prove a pure protocol and injected HTTP parity, never FILE durability.
const NOW = 1_800_000_000_000;
const CANARY = 'ADP1_PRIVATE_SYNTHETIC_DO_NOT_RETAIN';
type PrepareInput = Parameters<typeof prepareAssistantText>[0];
type Prepared = ReturnType<typeof prepareAssistantText>;
type State = Prepared['initialState'];
type Event = Parameters<typeof reduceDelivery>[1];
// ADP1 explicitly rejects cross-realm JSON objects. Keep metadata fixtures in
// this realm; byte equality below remains independent of typed-array realms.
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function evidenceKey(): Uint8Array { return Uint8Array.from({length: 32}, (_, i) => i + 1); }

function input(overrides: Partial<PrepareInput> = {}): PrepareInput {
  return {
    scope: {accountId: 'account-A', personId: 'person-A', agentId: 'agent-A', space: 'work', containerId: 'private-A', kind: 'private'},
    binding: {botId: 5001, destinationChatId: 6001, endpointBindingId: 'endpoint-A', credentialBindingId: 'credential-A', bindingRevision: 'binding-1'},
    source: {messageId: 17, updateId: 29, revision: 0, occurredAt: NOW - 1000, acceptedAt: NOW - 100},
    authority: {authorityRevision: 'authority-1', grantRevision: 'grant-1', sourceFenceRevision: 'source-1', sourceFenceSequence: 3, historyEpoch: 4, deletionEpoch: 5, expiresAt: NOW + 60_000},
    generationId: '10000000-0000-4000-8000-000000000001',
    attemptId: '20000000-0000-4000-8000-000000000002',
    generatedText: `${CANARY} پاسخ`,
    decoratedText: `${CANARY} پاسخ\nhttps://synthetic.invalid/source`,
    keyId: 'key-1', evidenceKey: evidenceKey(), now: NOW, expiresAt: NOW + 30_000,
    ...overrides,
  };
}

function prepared(overrides: Partial<PrepareInput> = {}): Prepared { return prepareAssistantText(input(overrides)); }

function expected(state: State, now = NOW + 1): Parameters<typeof reduceDelivery>[2] {
  return {stateRevision: state.revision, effectKey: state.effectKey, attemptId: state.attemptId, scope: clone(state.scope), binding: clone(state.binding), source: clone(state.source), authority: clone(state.authority), now};
}

function transport(p: Prepared, observedAt = NOW + 2): Parameters<typeof classifyAssistantTextResponse>[1] {
  return {method: 'sendMessage', botId: p.initialState.binding.botId, credentialBindingId: p.initialState.binding.credentialBindingId, endpointBindingId: p.initialState.binding.endpointBindingId, attemptId: p.initialState.attemptId, effectKey: p.initialState.effectKey, dispatchedBodyHmac: p.initialState.evidence.bodyHmac, observedAt};
}

function response(p: Prepared): Parameters<typeof classifyAssistantTextResponse>[2] {
  return {httpStatus: 200, body: {ok: true, result: {message_id: 901, chat: {id: p.initialState.binding.destinationChatId, type: 'private'}, from: {id: p.initialState.binding.botId, is_bot: true}, date: Math.floor(NOW / 1000), text: p.submittedText}}};
}

function body(p: Prepared): {ok: boolean; result: Record<string, unknown>} {
  return response(p).body as {ok: boolean; result: Record<string, unknown>};
}

function begin(p: Prepared = prepared(), now = NOW + 1): State {
  return reduceDelivery(p.initialState, {type: 'begin_dispatch', prepared: p, evidenceKey: evidenceKey()}, expected(p.initialState, now));
}

function record(state: State, p: Prepared, now = NOW + 2, r = response(p)): State {
  return reduceDelivery(state, {type: 'record_response', prepared: p, evidenceKey: evidenceKey(), transportEvidence: transport(p, now), response: r}, expected(state, now));
}

function step(state: State, event: Event, now = NOW + 2): State { return reduceDelivery(state, event, expected(state, now)); }
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function bytesEqual(actual: Uint8Array, wanted: Uint8Array): void {
  // Do not rely on typed-array prototype identity across jsdom/Node realms.
  expect(actual.byteLength).toBe(wanted.byteLength);
  expect(Array.from(actual)).toEqual(Array.from(wanted));
  expect(hash(actual)).toBe(hash(wanted));
}
function protocolFailure(call: () => unknown): void {
  try { call(); throw new Error('fixture expected refusal'); }
  catch (error) {
    expect(error).toBeInstanceOf(DeliveryProtocolError);
    expect((error as Error).message).toMatch(/^(shape|capacity|identity|integrity|transition|clock|expiry|revision)$/);
    expect(String(error)).not.toContain(CANARY);
  }
}

describe('ADP1 exact wire and independent real-client seam', () => {
  const texts = [
    'x'.repeat(4095), 'x'.repeat(4096), 'x'.repeat(4097),
    `${'x'.repeat(4095)}😀suffix`, `${'x'.repeat(4094)}😀suffix`,
    '\ud800', '\udc00', 'فارسی English ۱۲۳\nخط دوم',
    'quote" slash\\ /\r\n\u0000\t', `${'x'.repeat(4080)}\nhttps://synthetic.invalid/citation`,
  ];
  it.each(texts.map((text, i) => ({name: `wire-${i}`, text})))('$name matches actual TelegramBotClient POST bytes', async ({text}) => {
    const p = prepared({generatedText: 'generation before decoration', decoratedText: text});
    const calls: Array<{url: string; options: RequestInit}> = [];
    const injectedFetch: typeof fetch = async (url, options) => {
      calls.push({url: String(url), options: options ?? {}});
      return new Response(JSON.stringify(response(p).body), {status: 200, headers: {'Content-Type': 'application/json'}});
    };
    await new TelegramBotClient('5001:synthetic-fixture-token', injectedFetch).sendMessage(6001, text);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.telegram.org/bot5001:synthetic-fixture-token/sendMessage');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers).toEqual({'Content-Type': 'application/json'});
    expect(typeof calls[0].options.body).toBe('string');
    const actual = new TextEncoder().encode(calls[0].options.body as string);
    bytesEqual(p.bodyBytes, actual);
    expect(p.bodyJson).toBe(calls[0].options.body);
    expect(p.submittedText).toBe(text.slice(0, 4096));
    expect(p.initialState.evidence.bodyBytes).toBe(actual.byteLength);
    expect([p.method, p.verb, p.contentType]).toEqual(['sendMessage', 'POST', 'application/json']);
  });

  it('uses independently calculated domain-separated HMACs, not normalized text', () => {
    const args = input({generatedText: 'é', decoratedText: 'e\u0301\ud800'});
    const p = prepareAssistantText(args);
    const mac = (domain: string, value: string) => createHmac('sha256', args.evidenceKey).update(new TextEncoder().encode(JSON.stringify([domain, value]))).digest('hex');
    expect(p.initialState.evidence).toMatchObject({generatedHmac: mac('adp1-generated', args.generatedText), submittedTextHmac: mac('adp1-submitted', args.decoratedText), bodyHmac: mac('adp1-body', p.bodyJson)});
    expect(p.bodyJson).toContain('\\ud800');
    expect(p.initialState.evidence.generatedHmac).not.toBe(p.initialState.evidence.submittedTextHmac);
  });

  it.each(['replyTo', 'keyboard', 'forceReply', 'parse_mode', 'silent', 'noPreview', 'protectContent'])('refuses unsupported %s instead of silently dropping it', (field) => {
    protocolFailure(() => prepareAssistantText({...input(), [field]: true} as never));
  });
});

describe('ADP1 identity and isolated claimed scopes', () => {
  it('keeps initial effect identity stable across asserted edits, epochs, rebinds, keys and attempt/generation IDs', () => {
    const a = input(), b = input();
    b.source.updateId++; b.source.revision++; b.source.acceptedAt++;
    b.authority.historyEpoch++; b.authority.deletionEpoch++; b.authority.sourceFenceSequence++;
    b.binding.endpointBindingId = 'new-endpoint'; b.binding.credentialBindingId = 'new-credential'; b.binding.bindingRevision = 'binding-2';
    b.scope.space = 'personal'; b.scope.agentId = 'agent-B'; b.keyId = 'key-2'; b.evidenceKey.fill(99);
    b.generationId = '30000000-0000-4000-8000-000000000003'; b.attemptId = '40000000-0000-4000-8000-000000000004';
    expect(initialEffectKey(a.binding, a.source)).toBe(initialEffectKey(b.binding, b.source));
    expect(prepareAssistantText(a).initialState.effectKey).toBe(prepareAssistantText(b).initialState.effectKey);
    // Equal logical keys do not authorize cross-scope reuse; global uniqueness needs a future adapter.
    const p = prepareAssistantText(a), alternate = prepareAssistantText(b);
    protocolFailure(() => reduceDelivery(p.initialState, {type: 'begin_dispatch', prepared: alternate, evidenceKey: b.evidenceKey}, expected(p.initialState)));
  });

  it.each(['bot', 'chat', 'message'])('distinguishes another %s provider source', (field) => {
    const a = input(), b = input();
    if (field === 'bot') b.binding.botId++;
    if (field === 'chat') b.binding.destinationChatId++;
    if (field === 'message') b.source.messageId++;
    expect(initialEffectKey(a.binding, a.source)).not.toBe(initialEffectKey(b.binding, b.source));
  });

  it.each(['accountId', 'personId', 'agentId', 'space', 'containerId'])('rejects expected-scope mismatch %s', (field) => {
    const p = prepared(), e = expected(p.initialState);
    const scope = {...e.scope, [field]: field === 'space' ? 'personal' : 'other'};
    protocolFailure(() => reduceDelivery(p.initialState, {type: 'pre_dispatch_denied'}, {...e, scope} as never));
  });

  it.each(['binding', 'source', 'authority', 'attempt', 'effect', 'revision'])('rejects stale or different expected %s', (field) => {
    const p = prepared(), e = expected(p.initialState);
    if (field === 'binding') e.binding.bindingRevision = 'other';
    if (field === 'source') e.source.revision++;
    if (field === 'authority') e.authority.deletionEpoch++;
    if (field === 'attempt') e.attemptId = '40000000-0000-4000-8000-000000000004';
    if (field === 'effect') e.effectKey += '-other';
    if (field === 'revision') e.stateRevision++;
    protocolFailure(() => reduceDelivery(p.initialState, {type: 'pre_dispatch_denied'}, e));
  });
});

describe('ADP1 conservative receipt classification', () => {
  it('retains actual outbound receipt distinct from inbound, excludes provider extension content', () => {
    const p = prepared(), r = response(p);
    (r.body as Record<string, unknown>).provider_extra = CANARY;
    const c = classifyAssistantTextResponse(p, transport(p), r, evidenceKey());
    expect(c).toEqual({kind: 'accepted', receipt: {messageId: 901, botId: 5001, destinationChatId: 6001, providerDateSeconds: Math.floor(NOW / 1000), textEvidence: 'matches-submitted'}});
    expect(JSON.stringify(c)).not.toContain(CANARY);
    expect(p.initialState.source.messageId).toBe(17);
  });

  it.each(['matches-submitted', 'different', 'unavailable'] as const)('separates provider echo %s from human delivery', (variant) => {
    const p = prepared(), b = body(p);
    if (variant === 'different') b.result.text = 'different echo';
    if (variant === 'unavailable') delete b.result.text;
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: b}, evidenceKey())).toMatchObject({kind: 'accepted', receipt: {textEvidence: variant}});
  });

  it.each([undefined, null, 0, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, '901'])('does not invent a message ID for %s', (messageId) => {
    const p = prepared(), b = body(p); b.result.message_id = messageId;
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: b}, evidenceKey()).kind).toBe('unknown');
  });

  it.each(['wrong-chat', 'not-private', 'wrong-bot', 'not-bot', 'bad-date', 'unsafe-date', 'bad-text', 'missing-chat', 'missing-result'])('refuses malformed acceptance: %s', (variant) => {
    const p = prepared(), b = body(p);
    if (variant === 'wrong-chat') b.result.chat = {id: 6002, type: 'private'};
    if (variant === 'not-private') b.result.chat = {id: 6001, type: 'group'};
    if (variant === 'wrong-bot') b.result.from = {id: 5002, is_bot: true};
    if (variant === 'not-bot') b.result.from = {id: 5001, is_bot: false};
    if (variant === 'bad-date') b.result.date = -1;
    if (variant === 'unsafe-date') b.result.date = Number.MAX_SAFE_INTEGER;
    if (variant === 'bad-text') b.result.text = 12;
    if (variant === 'missing-chat') delete b.result.chat;
    if (variant === 'missing-result') delete (b as Partial<typeof b>).result;
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: b}, evidenceKey())).toEqual({kind: 'unknown', reason: 'invalid_receipt'});
  });

  it('does not infer transport bot binding from an optional provider from field', () => {
    const p = prepared(), b = body(p); delete b.result.from;
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: b}, evidenceKey()).kind).toBe('accepted');
    expect(classifyAssistantTextResponse(p, {...transport(p), botId: 5002}, {httpStatus: 200, body: b}, evidenceKey())).toEqual({kind: 'unknown', reason: 'invalid_receipt'});
  });

  it.each(['method', 'credential', 'endpoint', 'attempt', 'effect', 'body'])('requires exact transport %s evidence', (field) => {
    const p = prepared(), t = transport(p);
    const changed = {...t,
      ...(field === 'method' ? {method: 'sendVoice'} : {}),
      ...(field === 'credential' ? {credentialBindingId: 'different'} : {}),
      ...(field === 'endpoint' ? {endpointBindingId: 'different'} : {}),
      ...(field === 'attempt' ? {attemptId: '40000000-0000-4000-8000-000000000004'} : {}),
      ...(field === 'effect' ? {effectKey: `${t.effectKey}-other`} : {}),
      ...(field === 'body' ? {dispatchedBodyHmac: '0'.repeat(64)} : {}),
    };
    expect(classifyAssistantTextResponse(p, changed as never, response(p), evidenceKey())).toEqual({kind: 'unknown', reason: 'invalid_receipt'});
  });

  it.each([201, 400, 401, 403, 409, 429, 500, 503])('HTTP %i does not prove no effect', (httpStatus) => {
    const p = prepared();
    expect(classifyAssistantTextResponse(p, transport(p), {...response(p), httpStatus}, evidenceKey())).toEqual({kind: 'unknown', reason: 'http_or_provider_rejection'});
  });

  it.each([false, undefined, null, 1, 'true'])('classifies ok=%s without inventing a definite failure', (ok) => {
    const p = prepared();
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: {ok, description: CANARY}}, evidenceKey())).toEqual({kind: 'unknown', reason: ok === false ? 'http_or_provider_rejection' : 'invalid_response'});
  });

  it.each(['cycle', 'bigint', 'undefined', 'function', 'nan', 'symbol', 'date', 'getter', 'toJSON', 'proxy', 'depth', 'nodes', 'bytes'])('safely rejects response %s with no getter/toJSON/proxy execution', (variant) => {
    const p = prepared(), b = body(p), observed: string[] = [];
    let extra: unknown = null;
    if (variant === 'cycle') { const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; extra = cyclic; }
    if (variant === 'bigint') extra = BigInt(1);
    if (variant === 'undefined') extra = undefined;
    if (variant === 'function') extra = () => CANARY;
    if (variant === 'nan') extra = Number.NaN;
    if (variant === 'symbol') extra = Symbol(CANARY);
    if (variant === 'date') extra = new Date(NOW);
    if (variant === 'getter') { extra = {}; Object.defineProperty(extra, 'secret', {enumerable: true, get() { observed.push('getter'); throw new Error(CANARY); }}); }
    if (variant === 'toJSON') extra = {toJSON() { observed.push('toJSON'); throw new Error(CANARY); }};
    if (variant === 'proxy') extra = new Proxy({}, {ownKeys() { observed.push('proxy'); throw new Error(CANARY); }});
    if (variant === 'depth') { extra = null; for (let i = 0; i < 34; i++) extra = {child: extra}; }
    if (variant === 'nodes') extra = Array.from({length: 2050}, () => 1);
    if (variant === 'bytes') extra = 'x'.repeat(65_536);
    (b as unknown as Record<string, unknown>).extra = extra;
    expect(classifyAssistantTextResponse(p, transport(p), {httpStatus: 200, body: b}, evidenceKey())).toEqual({kind: 'unknown', reason: 'invalid_response'});
    expect(observed).toEqual([]);
  });
});

describe('ADP1 claim reducer, control truth and no retry', () => {
  it('models generated -> sending -> sent, and never claims dispatch capability or history payload', () => {
    const p = prepared(), original = clone(p.initialState), sending = begin(p), sent = record(sending, p);
    expect(p.initialState).toEqual(original);
    expect(sending).toMatchObject({phase: 'sending', revision: 1, lastTransitionAt: NOW + 1});
    expect(sent).toMatchObject({phase: 'sent', revision: 2, lastTransitionAt: NOW + 2, outcome: {reason: 'provider_accepted', observedAt: NOW + 2, receipt: {messageId: 901}}});
    const json = new TextDecoder().decode(encodeDeliveryState(sent));
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain('synthetic.invalid');
    expect(json).not.toContain('bodyJson');
    expect(json).not.toContain('evidenceKey');
  });

  it.each(['pre_dispatch_failure', 'pre_dispatch_denied'] as const)('%s stays terminal after expiry and cannot begin', (type) => {
    const p = prepared(), terminal = step(p.initialState, {type}, NOW + 90_000);
    expect(terminal.phase).toBe(type === 'pre_dispatch_failure' ? 'failed' : 'cancelled');
    protocolFailure(() => step(terminal, {type: 'begin_dispatch', prepared: p, evidenceKey: evidenceKey()}, NOW + 90_001));
    expect(step(terminal, {type}, NOW + 90_002)).toEqual(terminal);
  });

  it.each(['transport_error', 'invalid_response', 'receipt_commit_unconfirmed'] as const)('preserves %s uncertainty without re-dispatch', (reason) => {
    const p = prepared(), unknown = step(begin(p), {type: 'record_uncertainty', reason});
    expect(unknown).toMatchObject({phase: 'unknown', outcome: {reason}});
    protocolFailure(() => step(unknown, {type: 'begin_dispatch', prepared: p, evidenceKey: evidenceKey()}, NOW + 3));
    expect(step(unknown, {type: 'record_uncertainty', reason}, NOW + 4)).toEqual(unknown);
  });

  it('simulates interrupted sending as unknown and preserves a later actual acceptance for that same attempt', () => {
    const p = prepared(), unknown = step(begin(p), {type: 'recover_interrupted'}), sent = record(unknown, p, NOW + 90_000);
    expect(unknown).toMatchObject({phase: 'unknown', outcome: {reason: 'dispatch_interrupted'}});
    expect(sent.phase).toBe('sent');
    protocolFailure(() => step(sent, {type: 'recover_interrupted'}, NOW + 90_001));
  });

  it('records provider rejection as unknown, never failed', () => {
    const p = prepared(), s = record(begin(p), p, NOW + 2, {httpStatus: 429, body: {ok: false}});
    expect(s).toMatchObject({phase: 'unknown', outcome: {reason: 'http_or_provider_rejection'}});
  });

  it('does not replace original receipt/outcome time on an exact duplicate or accept conflicting evidence', () => {
    const p = prepared(), sent = record(begin(p), p), duplicate = record(sent, p, NOW + 10);
    expect(duplicate).toEqual(sent);
    const changed = body(p); changed.result.message_id = 902;
    protocolFailure(() => record(sent, p, NOW + 11, {httpStatus: 200, body: changed}));
    const differentDate = body(p); differentDate.result.date = Math.floor(NOW / 1000) + 1;
    protocolFailure(() => record(sent, p, NOW + 11, {httpStatus: 200, body: differentDate}));
    protocolFailure(() => step(sent, {type: 'record_uncertainty', reason: 'transport_error'}, NOW + 12));
  });

  it.each(['generated', 'sending', 'sent', 'unknown', 'failed', 'cancelled'] as const)('irreversibly invalidates content in phase %s while preserving known truth', (phase) => {
    const p = prepared(); let state = p.initialState;
    if (phase === 'sending') state = begin(p);
    if (phase === 'sent') state = record(begin(p), p);
    if (phase === 'unknown') state = step(begin(p), {type: 'recover_interrupted'});
    if (phase === 'failed') state = step(state, {type: 'pre_dispatch_failure'});
    if (phase === 'cancelled') state = step(state, {type: 'pre_dispatch_denied'});
    const invalidated = step(state, {type: 'invalidate_content', sourceFenceSequence: 4}, NOW + 100);
    expect(invalidated).toMatchObject({contentEligible: false, invalidatedAtFenceSequence: 4, lastTransitionAt: NOW + 100});
    expect(invalidated.authority).toEqual(state.authority);
    expect(invalidated.source).toEqual(state.source);
    expect(invalidated.phase).toBe(phase === 'generated' ? 'cancelled' : phase === 'sending' ? 'unknown' : phase);
    if (phase === 'sent') expect(invalidated.outcome).toEqual(state.outcome);
    if (phase === 'sending') expect(invalidated.outcome).toEqual({reason: 'dispatch_interrupted', observedAt: NOW + 100});
    expect(step(invalidated, {type: 'invalidate_content', sourceFenceSequence: 4}, NOW + 101)).toEqual(invalidated);
    protocolFailure(() => step(invalidated, {type: 'invalidate_content', sourceFenceSequence: 3}, NOW + 101));
    protocolFailure(() => step(invalidated, {type: 'begin_dispatch', prepared: p, evidenceKey: evidenceKey()}, NOW + 102));
    if (phase === 'sending' || phase === 'unknown') expect(record(invalidated, p, NOW + 90_000)).toMatchObject({phase: 'sent', contentEligible: false, invalidatedAtFenceSequence: 4});
  });

  it('retains last-transition time even when an older sent outcome remains unchanged', () => {
    const p = prepared(), sent = record(begin(p), p), invalidated = step(sent, {type: 'invalidate_content', sourceFenceSequence: 4}, NOW + 50);
    expect(invalidated.outcome?.observedAt).toBe(NOW + 2);
    protocolFailure(() => step(invalidated, {type: 'invalidate_content', sourceFenceSequence: 5}, NOW + 49));
    const newer = step(invalidated, {type: 'invalidate_content', sourceFenceSequence: 5}, NOW + 51);
    expect(newer).toMatchObject({contentEligible: false, invalidatedAtFenceSequence: 5, lastTransitionAt: NOW + 51});
  });

  it('rejects dispatch at exact expiry and clock rollback, but records truth after expiry', () => {
    const p = prepared();
    protocolFailure(() => begin(p, p.initialState.expiresAt));
    protocolFailure(() => begin(p, NOW - 1));
    expect(record(begin(p), p, NOW + 90_000).phase).toBe('sent');
  });

  it.each(['prepared-text', 'generation', 'binding', 'source', 'authority', 'attempt', 'evidence-key-id', 'createdAt'])('rejects a replacement prepared claim: %s', (variant) => {
    const original = prepared(), args = input();
    if (variant === 'prepared-text') args.decoratedText = 'another response';
    if (variant === 'generation') args.generationId = '30000000-0000-4000-8000-000000000003';
    if (variant === 'binding') args.binding.bindingRevision = 'binding-2';
    if (variant === 'source') args.source.revision++;
    if (variant === 'authority') args.authority.historyEpoch++;
    if (variant === 'attempt') args.attemptId = '40000000-0000-4000-8000-000000000004';
    if (variant === 'evidence-key-id') args.keyId = 'other-key';
    if (variant === 'createdAt') args.now++;
    const replacement = prepareAssistantText(args), sending = begin(original);
    protocolFailure(() => reduceDelivery(sending, {type: 'record_response', prepared: replacement, evidenceKey: evidenceKey(), transportEvidence: transport(replacement), response: response(replacement)}, expected(sending, NOW + 2)));
  });

  it('rejects free normalized receipts and transport observation time disagreement', () => {
    const p = prepared(), sending = begin(p);
    protocolFailure(() => step(sending, {type: 'record_response', receipt: {messageId: 901}} as never));
    protocolFailure(() => reduceDelivery(sending, {type: 'record_response', prepared: p, evidenceKey: evidenceKey(), transportEvidence: transport(p, NOW + 3), response: response(p)}, expected(sending, NOW + 2)));
  });

  it.each(['event-extra', 'expected-extra', 'phase-inapplicable', 'event-getter', 'event-proxy'])('strictly refuses %s without executing injected accessors', (variant) => {
    const p = prepared(); let calls = 0;
    let event: unknown = {type: 'pre_dispatch_denied'};
    let e: unknown = expected(p.initialState);
    if (variant === 'event-extra') event = {type: 'pre_dispatch_denied', text: CANARY};
    if (variant === 'expected-extra') e = {...expected(p.initialState), privateText: CANARY};
    if (variant === 'phase-inapplicable') event = {type: 'pre_dispatch_denied', response: response(p)};
    if (variant === 'event-getter') Object.defineProperty(event, 'secret', {enumerable: true, get() {calls++; throw new Error(CANARY);}});
    if (variant === 'event-proxy') event = new Proxy({}, {getPrototypeOf() {calls++; throw new Error(CANARY);}});
    protocolFailure(() => reduceDelivery(p.initialState, event as never, e as never));
    expect(calls).toBe(0);
  });

  it.each(['response', 'transportEvidence'])('rejects an absent %s event field instead of classifying a fabricated wrapper', (field) => {
    const p = prepared(), state = begin(p);
    const event = {type: 'record_response', prepared: p, evidenceKey: evidenceKey(), transportEvidence: transport(p), response: response(p)} as Record<string, unknown>;
    delete event[field]; protocolFailure(() => step(state, event as never));
  });
});

describe('ADP1 strict metadata codecs, limits and mutation safety', () => {
  it('round-trips canonical detached metadata for all legitimate phases', () => {
    const p = prepared(), sending = begin(p), sent = record(sending, p);
    const states = [p.initialState, sending, sent, step(sending, {type: 'recover_interrupted'}), step(p.initialState, {type: 'pre_dispatch_failure'}), step(p.initialState, {type: 'pre_dispatch_denied'}), step(sent, {type: 'invalidate_content', sourceFenceSequence: 4}, NOW + 10)];
    for (const state of states) {
      const encoded = encodeDeliveryState(state), decoded = decodeDeliveryState(encoded);
      expect(decoded).toEqual(state); bytesEqual(encodeDeliveryState(decoded), encoded);
      expect(encoded.byteLength).toBeLessThanOrEqual(16_384);
      decoded.scope.personId = 'mutated-copy';
      expect(state.scope.personId).toBe('person-A');
    }
  });

  it.each(['root', 'scope', 'binding', 'source', 'authority', 'evidence'])('rejects extra keys at %s without exposing content', (field) => {
    const state = clone(prepared().initialState) as unknown as Record<string, unknown>;
    const target = field === 'root' ? state : state[field] as Record<string, unknown>;
    target.privateExtra = CANARY;
    protocolFailure(() => encodeDeliveryState(state as never));
  });

  it.each(['future', 'effect', 'phase-outcome', 'sent-without-receipt', 'sending-outcome', 'false-without-fence', 'fence-with-eligible', 'negative-epoch', 'transition-before-create', 'source-after-create', 'oversize-lifetime'])('refuses impossible metadata: %s', (variant) => {
    const p = prepared(); const state = clone(p.initialState) as unknown as Record<string, unknown>;
    if (variant === 'future') state.schemaVersion = 2;
    if (variant === 'effect') state.effectKey = 'made-up';
    if (variant === 'phase-outcome') state.outcome = {reason: 'provider_accepted', observedAt: NOW};
    if (variant === 'sent-without-receipt') {state.phase = 'sent'; state.outcome = {reason: 'provider_accepted', observedAt: NOW};}
    if (variant === 'sending-outcome') {state.phase = 'sending'; state.outcome = {reason: 'transport_error', observedAt: NOW};}
    if (variant === 'false-without-fence') state.contentEligible = false;
    if (variant === 'fence-with-eligible') state.invalidatedAtFenceSequence = 4;
    if (variant === 'negative-epoch') (state.authority as Record<string, unknown>).historyEpoch = -1;
    if (variant === 'transition-before-create') state.lastTransitionAt = NOW - 1;
    if (variant === 'source-after-create') (state.source as Record<string, unknown>).acceptedAt = NOW + 1;
    if (variant === 'oversize-lifetime') state.expiresAt = NOW + 60_001;
    protocolFailure(() => encodeDeliveryState(state as never));
  });

  it.each(['duplicate-key', 'whitespace', 'order', 'trailing', 'noncanonical-number', 'truncated', 'utf8', 'oversized'])('rejects noncanonical bytes: %s', (variant) => {
    const original = encodeDeliveryState(prepared().initialState), json = new TextDecoder().decode(original);
    let bytes = original;
    if (variant === 'duplicate-key') bytes = new TextEncoder().encode(json.replace('{', '{"schemaVersion":1,'));
    if (variant === 'whitespace') bytes = new TextEncoder().encode(` ${json}`);
    if (variant === 'order') bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(json)).reverse())));
    if (variant === 'trailing') bytes = new TextEncoder().encode(`${json}x`);
    if (variant === 'noncanonical-number') bytes = new TextEncoder().encode(json.replace('"schemaVersion":1', '"schemaVersion":1.0'));
    if (variant === 'truncated') bytes = original.slice(0, -1);
    if (variant === 'utf8') bytes = Uint8Array.from([0xc3, 0x28]);
    if (variant === 'oversized') bytes = new Uint8Array(16_385);
    protocolFailure(() => decodeDeliveryState(bytes));
  });

  it.each([0, -1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses unsafe identity %s', (id) => {
    const args = input(); args.binding.destinationChatId = id;
    protocolFailure(() => prepareAssistantText(args));
  });

  it.each(['../escape', 'slash/value', 'with space', 'فارسی', 'x'.repeat(129), '', 'line\nvalue', 'value\n'])('refuses bounded opaque identifier %s', (id) => {
    const args = input(); args.scope.accountId = id;
    protocolFailure(() => prepareAssistantText(args));
  });

  it.each(['uppercase', 'wrong-version', 'wrong-variant', 'suffix'])('rejects noncanonical attempt UUID %s', (variant) => {
    const args = input();
    if (variant === 'uppercase') args.attemptId = 'aaaaaaaa-AAAA-4aaa-8aaa-aaaaaaaaaaaa';
    if (variant === 'wrong-version') args.attemptId = '20000000-0000-5000-8000-000000000002';
    if (variant === 'wrong-variant') args.attemptId = '20000000-0000-4000-7000-000000000002';
    if (variant === 'suffix') args.attemptId += '\n';
    protocolFailure(() => prepareAssistantText(args));
  });

  it.each([0, 31, 33])('rejects %i-byte evidence key', (size) => { protocolFailure(() => prepared({evidenceKey: new Uint8Array(size)})); });

  it('enforces preparation text and time boundaries without overflow', () => {
    expect(prepared({generatedText: 'x'.repeat(65_536), decoratedText: '\u0000'.repeat(65_536)}).bodyBytes.byteLength).toBeLessThanOrEqual(32_768);
    for (const fields of [{generatedText: ''}, {decoratedText: ''}, {generatedText: 'x'.repeat(65_537)}, {decoratedText: 'x'.repeat(65_537)}, {expiresAt: NOW}, {expiresAt: NOW + 60_001}]) protocolFailure(() => prepared(fields));
    const args = input(); args.now = Number.MAX_SAFE_INTEGER - 1; args.authority.expiresAt = Number.MAX_SAFE_INTEGER; args.expiresAt = Number.MAX_SAFE_INTEGER;
    protocolFailure(() => prepareAssistantText(args));
  });

  it('admits maximum bounded metadata and text while preserving finite body/state output', () => {
    const args = input(), maximal = 'x'.repeat(128);
    args.scope = {accountId: maximal, personId: maximal, agentId: maximal, space: 'personal', containerId: maximal, kind: 'private'};
    args.binding = {...args.binding, botId: Number.MAX_SAFE_INTEGER, destinationChatId: Number.MAX_SAFE_INTEGER, endpointBindingId: maximal, credentialBindingId: maximal, bindingRevision: maximal};
    args.source = {...args.source, messageId: Number.MAX_SAFE_INTEGER, updateId: Number.MAX_SAFE_INTEGER, revision: Number.MAX_SAFE_INTEGER};
    args.authority = {...args.authority, authorityRevision: maximal, grantRevision: maximal, sourceFenceRevision: maximal, sourceFenceSequence: Number.MAX_SAFE_INTEGER, historyEpoch: Number.MAX_SAFE_INTEGER, deletionEpoch: Number.MAX_SAFE_INTEGER};
    args.keyId = maximal; args.generatedText = '\u0000'.repeat(65_536); args.decoratedText = '\u0000'.repeat(65_536);
    const p = prepareAssistantText(args);
    expect(p.bodyBytes.byteLength).toBeLessThanOrEqual(32_768);
    expect(encodeDeliveryState(p.initialState).byteLength).toBeLessThanOrEqual(16_384);
    assertPreparedIntegrity(p, evidenceKey());
    protocolFailure(() => step(p.initialState, {type: 'invalidate_content', sourceFenceSequence: Number.MAX_SAFE_INTEGER}));
  });

  it.each(['generatedText', 'decoratedText', 'submittedText', 'bodyJson', 'bodyBytes', 'hmac', 'hmac-newline', 'length', 'method', 'wrapper-extra', 'later-initial'])('detects tampered prepared %s', (field) => {
    const p = prepared();
    if (field === 'generatedText') p.generatedText += 'changed';
    if (field === 'decoratedText') p.decoratedText += 'changed';
    if (field === 'submittedText') p.submittedText += 'changed';
    if (field === 'bodyJson') p.bodyJson += ' ';
    if (field === 'bodyBytes') p.bodyBytes[0] ^= 1;
    if (field === 'hmac') p.initialState.evidence.bodyHmac = '0'.repeat(64);
    if (field === 'hmac-newline') p.initialState.evidence.bodyHmac += '\n';
    if (field === 'length') p.initialState.evidence.submittedUtf16Length++;
    if (field === 'method') (p as unknown as Record<string, unknown>).method = 'sendVoice';
    if (field === 'wrapper-extra') (p as unknown as Record<string, unknown>).extra = CANARY;
    if (field === 'later-initial') p.initialState = begin(p);
    protocolFailure(() => assertPreparedIntegrity(p, evidenceKey()));
  });

  it('does not alias caller metadata/key or mutate prepared/expected across reducers', () => {
    const args = input(), p = prepareAssistantText(args), original = {...p, initialState: clone(p.initialState), bodyBytes: Uint8Array.from(p.bodyBytes)}, e = expected(p.initialState), before = clone(e);
    args.scope.personId = 'mutated-input'; args.binding.botId = 9999; args.evidenceKey.fill(0);
    expect(p.initialState.scope.personId).toBe('person-A'); expect(p.initialState.binding.botId).toBe(5001);
    assertPreparedIntegrity(p, evidenceKey());
    const sending = reduceDelivery(p.initialState, {type: 'begin_dispatch', prepared: p, evidenceKey: evidenceKey()}, e);
    expect({...p, bodyBytes: undefined}).toEqual({...original, bodyBytes: undefined}); bytesEqual(p.bodyBytes, original.bodyBytes); expect(e).toEqual(before);
    sending.scope.personId = 'mutated-output';
    expect(p.initialState.scope.personId).toBe('person-A');
    p.bodyBytes.fill(0); expect(p.initialState).toEqual(original.initialState);
  });

  it('copies genuine typed-array bytes without invoking caller iterator or byteLength accessors', () => {
    let accessed = 0;
    const key = evidenceKey();
    Object.defineProperty(key, Symbol.iterator, {get() {accessed++; throw new Error(CANARY);}});
    Object.defineProperty(key, 'byteLength', {get() {accessed++; throw new Error(CANARY);}});
    const p = prepared({evidenceKey: key});
    assertPreparedIntegrity(p, evidenceKey());
    const wire = Uint8Array.from(p.bodyBytes);
    Object.defineProperty(wire, Symbol.iterator, {get() {accessed++; throw new Error(CANARY);}});
    Object.defineProperty(wire, 'byteLength', {get() {accessed++; throw new Error(CANARY);}});
    assertPreparedIntegrity({...p, bodyBytes: wire}, evidenceKey());
    expect(accessed).toBe(0);
  });

  it('refuses oversized genuine typed arrays using intrinsic lengths before copying/decoding', () => {
    let accessed = 0;
    const oversized = new Uint8Array(32_769);
    Object.defineProperty(oversized, 'byteLength', {get() {accessed++; return 1;}});
    Object.defineProperty(oversized, Symbol.iterator, {get() {accessed++; throw new Error(CANARY);}});
    protocolFailure(() => assertPreparedIntegrity({...prepared(), bodyBytes: oversized}, evidenceKey()));
    protocolFailure(() => prepared({evidenceKey: oversized}));
    const oversizedState = new Uint8Array(16_385);
    Object.defineProperty(oversizedState, 'byteLength', {get() {accessed++; return 1;}});
    Object.defineProperty(oversizedState, Symbol.iterator, {get() {accessed++; throw new Error(CANARY);}});
    protocolFailure(() => decodeDeliveryState(oversizedState));
    expect(accessed).toBe(0);
  });

  it('rejects revision overflow and invalidation sequence overflow without partial mutation', () => {
    const p = prepared(), state = record(begin(p), p); state.revision = Number.MAX_SAFE_INTEGER;
    const before = clone(state);
    protocolFailure(() => step(state, {type: 'invalidate_content', sourceFenceSequence: 4}, NOW + 3)); expect(state).toEqual(before);
    protocolFailure(() => step(p.initialState, {type: 'invalidate_content', sourceFenceSequence: Number.MAX_SAFE_INTEGER + 1}));
  });
});
