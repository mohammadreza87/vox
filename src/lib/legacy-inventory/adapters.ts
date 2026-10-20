/** Native-shaped synthetic adapters. No source store, mapper, or runtime imports. */
import { parseBoundedJson } from './codec';
import { InventoryError, LIMITS, orderedReasons, type AdapterV1, type ItemKindV1, type PlanRowV1, type ReasonV1 } from './contracts';

type Obj = Record<string, unknown>;
type Rule = 'string' | 'number' | 'integer' | 'boolean' | 'timestamp' | 'json' | { array: Rule } | { map: Rule } | { object: Shape } | { values: readonly (string | number)[] } | { nullable: Rule };
type Shape = { fields: Record<string, Rule>; required?: readonly string[] };
type Candidate = { row: PlanRowV1; key?: string[] };
export interface AdaptedUnit { candidates: Candidate[]; unresolvedFragments: number }
const strings: Rule = { array: 'string' }, integers: Rule = { array: 'integer' };
const shape = (fields: Record<string, Rule>, required: readonly string[] = []): Shape => ({ fields, required });
const object = (s: Shape): Rule => ({ object: s });
const values = (...v: string[]): Rule => ({ values: v });
const source = shape({ eventIds: strings, derivedFromEventIds: strings, personId: 'string', chatKind: values('private', 'group'), groupId: 'string', telegramMessageId: 'integer', at: 'timestamp' }, ['personId', 'chatKind', 'at']);
const scope = shape({ kind: values('private', 'people', 'group', 'project', 'company', 'org'), personId: 'string', personIds: strings, groupId: 'string', projectId: 'string', companyId: 'string' }, ['kind']);
const memory = shape({ id: 'string', personaId: 'string', authorizedPersonIds: strings, content: 'string', type: values('fact', 'decision', 'preference', 'event', 'relationship'), scope: object(scope), shareVersion: 'integer', sensitivity: values('normal', 'personal', 'confidential'), source: object(source), aboutPersonIds: strings, topic: 'string', supersedes: 'string', supersededBy: 'string', confidence: 'number', createdAt: 'timestamp', updatedAt: 'timestamp', active: 'boolean', scopeKey: 'string' }, ['id', 'personaId', 'content', 'type', 'scope', 'sensitivity', 'source', 'aboutPersonIds', 'confidence', 'createdAt', 'updatedAt']);
const offer = shape({ id: 'string', personaId: 'string', memoryId: 'string', ownerPersonId: 'string', proposedScope: object(scope), proposedAudiencePersonIds: strings, memoryShareVersion: 'integer', status: values('pending', 'approved', 'declined'), createdAt: 'timestamp' }, ['id', 'personaId', 'memoryId', 'ownerPersonId', 'proposedScope', 'status', 'createdAt']);
const history = shape({ role: values('user', 'assistant'), personId: 'string', text: 'string', at: 'timestamp', telegramMessageId: 'integer', groupPolicyVersion: { values: [1] }, relationshipIntentionId: 'string', audiencePersonIds: strings, privacyEpoch: 'integer', groupOtherTarget: 'boolean', privacy: object(shape({ policyKey: 'string', memoryRevision: 'integer', sourceEventIds: strings, memoryIds: strings }, ['policyKey', 'memoryRevision', 'sourceEventIds', 'memoryIds'])) }, ['role', 'text', 'at']);
const fact = shape({ key: 'string', value: 'string', source: values('chat', 'call'), confidence: 'number', extractedAt: 'timestamp' }, ['key', 'value', 'source', 'confidence', 'extractedAt']);
const summary = shape({ id: 'string', date: 'timestamp', type: values('chat', 'call'), duration: 'number', messageCount: 'integer', summary: 'string', keyTopics: strings, userMood: 'string' }, ['id', 'date', 'type', 'summary', 'keyTopics']);
const continuity = shape({ date: 'timestamp', type: values('chat', 'call'), lastTopic: 'string', nextSteps: { nullable: 'string' } }, ['date', 'type', 'lastTopic']);
const appMessage = shape({ id: 'string', contactId: 'string', role: values('user', 'assistant'), content: 'string', audioUrl: { nullable: 'string' }, createdAt: 'timestamp' }, ['role', 'content', 'createdAt']);
const person = shape({ id: 'string', name: 'string', role: 'string', telegramUserId: 'integer', managerId: 'string', companyIds: strings, projectIds: strings, notes: 'string', guest: 'boolean' }, ['id', 'name', 'role', 'companyIds', 'projectIds']);
const member = shape({ learningAuthorityRevision: 'integer', telegramId: 'integer', name: 'string', username: 'string', role: values('owner', 'superadmin', 'admin', 'member', 'pending'), joinedAt: 'timestamp', approvedBy: 'integer' }, ['telegramId', 'name', 'role', 'joinedAt']);
const guest = shape({ telegramId: 'integer', name: 'string', username: 'string', firstSeen: 'timestamp' }, ['telegramId', 'name', 'firstSeen']);
const groupBehavior = shape({ participation: values('mentions', 'balanced', 'active'), remember: 'boolean' }, ['participation', 'remember']);
const personaSpec = shape(Object.fromEntries(['name', 'role', 'tagline', 'backstory', 'personality', 'communicationStyle', 'wontDo', 'culture', 'presentation', 'age', 'accent', 'voiceBrief', 'avatarHint', 'withStrangers'].map(k => [k, 'string' as Rule])) as Record<string, Rule>, ['name', 'role', 'personality']);
Object.assign(personaSpec.fields, { values: strings, expertise: strings, languages: strings, openness: 'number' });
const agent = shape({ learningAuthorityRevision: 'integer', id: 'string', status: values('draft', 'awaiting_bot', 'active', 'fired'), persona: object(personaSpec), look: object(shape({ hue: 'string', family: 'string', features: object(shape({ cheeks: 'boolean', lashes: 'boolean', brows: 'boolean' })), avatar: 'string', avatarSource: 'string', avatarVariants: strings })), voice: object(shape({ provider: 'string', voiceId: 'string', label: 'string', source: 'string' })), voicePreviews: { array: object(shape({ generatedVoiceId: 'string', file: 'string' })) }, createdBy: 'integer', createdAt: 'timestamp', hiredAt: 'timestamp', lockAt: 'timestamp', bot: object(shape({ id: 'integer', username: 'string' })), profileSync: object(shape({ fingerprint: 'string', status: 'string', failed: strings, attempts: 'integer', updatedAt: 'timestamp', retryAt: 'timestamp' })), tokenEnc: 'string', suggestedUsername: 'string', isAdmin: 'boolean', visibility: values('private', 'org', 'public'), access: 'json', blocked: integers, identityVersion: 'integer', liveWeb: 'boolean', groupBehavior: object(groupBehavior), successorOf: 'string', firedAt: 'timestamp', firedBy: 'integer', firedReason: 'string', memoryPolicy: values('transfer', 'archive', 'delete') }, ['id', 'status', 'persona', 'look', 'createdBy', 'createdAt', 'isAdmin', 'access', 'identityVersion']);
const studioGroup = shape({ chatId: 'integer', title: 'string', memberIds: integers, hasGuests: 'boolean', audienceEpoch: 'integer', agentIds: strings, addedBy: 'integer', addedAt: 'timestamp', proactive: object(shape({ lastAt: 'timestamp', messageId: 'integer', windowAt: 'timestamp', count: 'integer' })), memoryWatermarks: { map: 'integer' }, memoryClaims: { map: integers } }, ['chatId', 'title', 'memberIds', 'hasGuests', 'agentIds', 'addedAt']);
const tirehGroup = shape({ audienceEpoch: 'integer', id: 'string', name: 'string', telegramChatId: 'integer', memberIds: strings, projectId: 'string', companyId: 'string', hasGuests: 'boolean', agentIds: strings }, ['id', 'name', 'telegramChatId', 'memberIds']);
const persona = shape({ id: 'string', name: 'string', role: 'string', personality: 'string', communicationStyle: 'string', values: strings, voice: object(shape({ elevenLabsVoiceId: 'string', description: 'string' })), ownerId: 'string', telegramUsername: 'string', telegramId: 'integer', groupParticipation: values('mentions', 'balanced', 'active'), groupRemember: 'boolean', groupObservation: 'boolean', identityVersion: 'integer', replyWithVoice: values('never', 'mirror', 'always'), strangerPolicy: 'string', webSearch: 'boolean' }, ['id', 'name', 'role', 'personality', 'communicationStyle', 'values', 'voice', 'ownerId', 'identityVersion', 'replyWithVoice']);
const user = shape({ id: 'string', email: 'string', displayName: { nullable: 'string' }, photoURL: { nullable: 'string' }, createdAt: 'timestamp', updatedAt: 'timestamp', settings: object(shape({ theme: values('light', 'dark'), language: 'string', notifications: 'boolean' })), tier: 'string', subscription: 'json', usage: 'json', defaultTranslatorVoiceId: { nullable: 'string' } });
const chatMetadata = shape({ id: 'string', userId: 'string', contactId: 'string', contactName: 'string', contactEmoji: { nullable: 'string' }, contactImage: { nullable: 'string' }, contactPurpose: { nullable: 'string' }, lastMessage: { nullable: 'string' }, lastMessageAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp', messages: 'json' }, ['contactId']);
const own = (o: Obj, k: string) => Object.hasOwn(o, k);
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
function timestamp(v: unknown): boolean {
  if (obj(v)) return Object.keys(v).every(k => k === 'seconds' || k === 'nanoseconds') && Number.isSafeInteger(v.seconds) && Number.isInteger(v.nanoseconds) && Number(v.seconds) >= -62135596800 && Number(v.seconds) <= 253402300799 && Number(v.nanoseconds) >= 0 && Number(v.nanoseconds) < 1e9;
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return false;
  const [y, month, day, h, min, s] = m.slice(1, 7).map(Number);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && h <= 23 && min <= 59 && s <= 59 && Number.isFinite(Date.parse(v));
}

/** Called only with parsed JSON; no caller instance/getters enter this seam. */
export function adaptFixture(adapter: AdapterV1, payload: unknown, sourceId: number, unit: number, budget: { tokens: number; depth: number }, signal?: AbortSignal): AdaptedUnit {
  const candidates: Candidate[] = [];
  let unresolvedFragments = 0;
  const check = () => { if (signal?.aborted) throw new InventoryError('cancelled'); };
  function add(kind: ItemKindV1): Candidate {
    check();
    if (candidates.length > LIMITS.children) throw new InventoryError('capacity_exceeded');
    const content = ['memory', 'memory_fact', 'summary', 'continuity', 'history', 'history_metadata'].includes(kind);
    const reasons: ReasonV1[] = ['dry_run_only', 'current_authority_unverified'];
    if (content) reasons.push('identity_unverified', 'space_unresolved', 'audience_unresolved', 'purpose_unresolved', 'consent_not_established', 'lineage_or_lifecycle_unverified');
    if (['history', 'history_metadata', 'summary', 'continuity'].includes(kind)) reasons.push('history_policy_unresolved');
    if (['identity', 'relationship_assertion'].includes(kind)) reasons.push('identity_unverified');
    if (['share_offer', 'agent_configuration', 'group_configuration', 'scope_configuration', 'relationship_assertion', 'legacy_audit'].includes(kind)) reasons.push('historical_configuration_not_grant');
    const preserve = kind === 'source_envelope' || kind === 'control';
    if (preserve) reasons.push('source_control_preserved');
    const proposedClass: PlanRowV1['proposedClass'] = ['memory', 'memory_fact'].includes(kind) ? 'memory_review' : ['history', 'history_metadata', 'summary', 'continuity'].includes(kind) ? 'history_review' : ['identity', 'relationship_assertion'].includes(kind) ? 'identity_review' : kind === 'notification_setting' ? 'preference_review' : preserve ? 'source_controls' : kind === 'opaque_fragment' ? 'unknown' : 'configuration_review';
    const c: Candidate = { row: { source: sourceId, unit, item: candidates.length, kind, disposition: preserve ? 'preserve_source_only' : 'quarantine', reasons: orderedReasons(reasons), hasUnsupportedFields: false, notificationObservation: 'not_applicable', proposedClass, target: null, currentAuthority: 'unverified', use: 'denied' } };
    candidates.push(c); return c;
  }
  function reason(c: Candidate, ...reasons: ReasonV1[]) { c.row.reasons = orderedReasons([...c.row.reasons, ...reasons]); if (reasons.some(r => ['malformed_record', 'unsupported_fields', 'unsupported_fragment', 'conflicting_source_metadata'].includes(r))) c.row.disposition = 'quarantine'; }
  function invalid(c: Candidate) { reason(c, 'malformed_record'); }
  function inspect(v: unknown, spec: Shape, c: Candidate) {
    if (!obj(v)) { invalid(c); return; }
    if (Object.keys(v).some(k => !own(spec.fields, k))) { c.row.hasUnsupportedFields = true; unresolvedFragments++; reason(c, 'unsupported_fields'); }
    for (const key of spec.required ?? []) if (!own(v, key)) invalid(c);
    for (const [key, rule] of Object.entries(spec.fields)) if (own(v, key)) validate(v[key], rule, c);
  }
  function validate(v: unknown, r: Rule, c: Candidate): void {
    check();
    if (typeof r === 'string') {
      if (r === 'json') return;
      if (r === 'timestamp') { if (obj(v)) inspect(v, shape({ seconds: 'integer', nanoseconds: 'integer' }, ['seconds', 'nanoseconds']), c); if (!timestamp(v)) invalid(c); return; }
      if (r === 'integer') { if (!Number.isSafeInteger(v)) invalid(c); return; }
      if (typeof v !== r || r === 'number' && !Number.isFinite(v)) invalid(c);
    } else if ('nullable' in r) { if (v !== null) validate(v, r.nullable, c); }
    else if ('values' in r) { if (!r.values.some(x => x === v)) invalid(c); }
    else if ('object' in r) inspect(v, r.object, c);
    else if ('array' in r) { if (!Array.isArray(v)) invalid(c); else for (const item of v) validate(item, r.array, c); }
    else if ('map' in r) { if (!obj(v)) invalid(c); else for (const item of Object.values(v)) validate(item, r.map, c); }
  }
  function key(c: Candidate, family: string, ...parts: unknown[]) {
    if (parts.some(p => p === undefined || p === null)) return;
    if (parts.some(p => !(typeof p === 'string' && p.length > 0 || typeof p === 'number' && Number.isSafeInteger(p)) || Buffer.byteLength(String(p)) > LIMITS.keyBytes)) { invalid(c); return; }
    c.key = [family, c.row.kind, ...parts.map(String)];
  }
  function row(kind: ItemKindV1, v: unknown, spec: Shape, identity?: [string, ...unknown[]]) {
    const c = add(kind); inspect(v, spec, c);
    if (identity) key(c, ...identity);
    if (obj(v)) {
      if (Array.isArray(v.aboutPersonIds) && v.aboutPersonIds.length) reason(c, 'subject_authority_unresolved');
      if (obj(v.scope)) {
        const scopeKind = typeof v.scope.kind === 'string' ? v.scope.kind : '';
        if (['project', 'company', 'org'].includes(scopeKind)) reason(c, 'legacy_scope_not_transferable');
        const required = ({ private: 'personId', people: 'personIds', group: 'groupId', project: 'projectId', company: 'companyId' } as Record<string, string>)[scopeKind];
        if (required && !own(v.scope, required)) invalid(c);
      }
      if (own(v, 'confidence') && (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1)) invalid(c);
      if (kind === 'agent_configuration' && own(v, 'access') && v.access !== 'everyone' && !(Array.isArray(v.access) && v.access.every(Number.isSafeInteger))) invalid(c);
      if (v.supersededBy || v.supersedes || v.active === false) reason(c, 'superseded_or_expired_marker');
      if (['epoch', 'epochs', 'revision', 'revisions', 'tombstones', 'privacyEpoch', 'memoryWatermarks', 'memoryClaims', 'audienceEpoch', 'learningAuthorityRevision'].some(k => own(v, k))) reason(c, 'source_suppression_observed');
    }
    return c;
  }
  function opaque() { const c = add('opaque_fragment'); reason(c, 'unsupported_fragment'); unresolvedFragments++; }
  function array(v: unknown, callback: (item: unknown) => void) { if (!Array.isArray(v)) opaque(); else for (const x of v) { check(); callback(x); } }
  const envelope = add('source_envelope');
  const wrapper = (v: unknown, fields: Record<string, Rule>, required: string[]) => inspect(v, shape(fields, required), envelope);
  const get = (v: unknown, k: string) => obj(v) ? v[k] : undefined;
  const controlSpec = shape({ revision: 'integer', revisions: { map: 'integer' }, tombstones: strings, epoch: 'integer' });
  if (adapter === 'tireh-file-state/1') {
    wrapper(payload, { memories: 'json', offers: 'json', chats: 'json', revisions: { map: 'integer' }, tombstones: { map: strings }, epochs: { map: 'integer' } }, ['memories', 'offers', 'chats']);
    array(get(payload, 'memories'), v => row('memory', v, memory, ['tireh', get(v, 'personaId'), get(v, 'id')]));
    array(get(payload, 'offers'), v => row('share_offer', v, offer, ['tireh', get(v, 'personaId'), get(v, 'id')]));
    const chats = get(payload, 'chats');
    if (!obj(chats)) opaque(); else for (const chatKey of Object.keys(chats).sort()) array(chats[chatKey], v => row('history', v, history));
  } else if (adapter === 'tireh-document/1') {
    wrapper(payload, { collection: 'string', id: 'string', parent: object(shape({ personaId: 'string', chatKey: 'string' }, ['personaId', 'chatKey'])), data: 'json' }, ['collection', 'id', 'data']);
    const collection = get(payload, 'collection'), data = get(payload, 'data'), id = get(payload, 'id');
    if (collection === 'tireh_memories' || collection === 'tireh_share_offers') {
      const c = row(collection === 'tireh_memories' ? 'memory' : 'share_offer', data, collection === 'tireh_memories' ? { ...memory, required: memory.required?.filter(k => k !== 'id') } : { ...offer, required: offer.required?.filter(k => k !== 'id') }, ['tireh', get(data, 'personaId'), id]);
      if (obj(data) && own(data, 'id') && data.id !== id) reason(c, 'conflicting_source_metadata');
    } else if (collection === 'tireh_messages') {
      const parent = get(payload, 'parent');
      const c = row('history', data, history, ['tireh', get(parent, 'personaId'), get(parent, 'chatKey'), id]);
      if (!obj(parent)) invalid(c);
    } else if (collection === 'tireh_memory_state' || collection === 'tireh_privacy_epochs') row('control', data, controlSpec);
    else opaque();
  } else if (adapter === 'tireh-org-config/1') {
    wrapper(payload, { organization: object(shape({ id: 'string', name: 'string' }, ['id', 'name'])), people: 'json', relationships: 'json', companies: 'json', projects: 'json', groups: 'json', personas: 'json' }, ['organization', 'people', 'relationships', 'companies', 'projects', 'groups', 'personas']);
    array(get(payload, 'people'), v => row('identity', v, person, ['tireh-config', get(v, 'id')]));
    array(get(payload, 'relationships'), v => row('relationship_assertion', v, shape({ a: 'string', b: 'string', label: 'string' }, ['a', 'b', 'label'])));
    array(get(payload, 'groups'), v => row('group_configuration', v, tirehGroup, ['tireh-config', get(v, 'id')]));
    array(get(payload, 'personas'), v => row('agent_configuration', v, persona, ['tireh-config', get(v, 'id')]));
    array(get(payload, 'projects'), v => row('scope_configuration', v, shape({ id: 'string', name: 'string', companyId: 'string', memberIds: strings, description: 'string' }, ['id', 'name', 'companyId', 'memberIds']), ['tireh-config-project', get(v, 'id')]));
    array(get(payload, 'companies'), v => row('scope_configuration', v, shape({ id: 'string', name: 'string' }, ['id', 'name']), ['tireh-config-company', get(v, 'id')]));
  } else if (adapter === 'app-contact-memory/1') {
    wrapper(payload, { userId: 'string', contactId: 'string', data: 'json' }, ['userId', 'contactId', 'data']);
    const data = get(payload, 'data');
    inspect(data, shape({ userId: 'string', contactId: 'string', facts: 'json', sessions: 'json', lastInteraction: 'json', createdAt: 'timestamp', updatedAt: 'timestamp' }, ['facts', 'sessions', 'lastInteraction']), envelope);
    const conflict = obj(data) && ['userId', 'contactId'].some(k => own(data, k) && data[k] !== get(payload, k));
    const mark = (c: Candidate) => { if (conflict) reason(c, 'conflicting_source_metadata'); };
    if (conflict) reason(envelope, 'conflicting_source_metadata');
    array(get(data, 'facts'), v => mark(row('memory_fact', v, fact, ['app-memory', get(payload, 'userId'), get(payload, 'contactId'), get(v, 'key')])));
    array(get(data, 'sessions'), v => mark(row('summary', v, summary, ['app-memory', get(payload, 'userId'), get(payload, 'contactId'), get(v, 'id')])));
    if (obj(data) && own(data, 'lastInteraction')) { if (data.lastInteraction !== null) mark(row('continuity', data.lastInteraction, continuity)); } else opaque();
  } else if (adapter === 'app-user/1') {
    wrapper(payload, { userId: 'string', data: 'json' }, ['userId', 'data']);
    const data = get(payload, 'data');
    const identity = row('identity', data, user, ['app-user', get(payload, 'userId')]);
    if (obj(data) && own(data, 'id') && data.id !== get(payload, 'userId')) reason(identity, 'conflicting_source_metadata');
    const c = add('notification_setting'); reason(c, 'consent_not_established', 'historical_flag_not_consent');
    const settings = get(data, 'settings');
    const n = get(settings, 'notifications');
    if (!obj(data) || settings !== undefined && !obj(settings) || obj(settings) && own(settings, 'notifications') && typeof n !== 'boolean') { c.row.notificationObservation = 'invalid'; reason(c, 'invalid_notification_setting'); }
    else if (!obj(settings) || !own(settings, 'notifications')) { c.row.notificationObservation = 'missing'; reason(c, 'missing_notification_setting'); }
    else { c.row.notificationObservation = n === true ? 'true' : 'false'; if (n === false) reason(c, 'restrictive_flag_observed'); }
  } else if (adapter === 'app-chat/1') {
    wrapper(payload, { chatId: 'string', data: 'json', messages: 'json' }, ['chatId', 'data', 'messages']);
    const data = get(payload, 'data'), chatId = get(payload, 'chatId');
    const c = row('history_metadata', data, chatMetadata, ['app-chat', get(data, 'userId'), chatId]);
    if (obj(data) && own(data, 'id') && data.id !== chatId) reason(c, 'conflicting_source_metadata');
    array(get(payload, 'messages'), v => {
      const message = get(v, 'data');
      const c = row('history', message, appMessage, ['app-chat', get(data, 'userId'), chatId, get(v, 'id')]);
      inspect(v, shape({ id: 'string', data: 'json' }, ['id', 'data']), c);
      if (obj(message) && own(message, 'id') && message.id !== get(v, 'id')) reason(c, 'conflicting_source_metadata');
    });
  } else if (adapter === 'app-local-chats/1') {
    array(payload, v => {
      row('history_metadata', v, chatMetadata, ['app-local', sourceId, get(v, 'id')]);
      array(get(v, 'messages'), m => row('history', m, appMessage, ['app-local', sourceId, get(v, 'id'), get(m, 'id')]));
    });
  } else if (adapter === 'studio-state/1') {
    let state = payload;
    if (obj(payload) && own(payload, 'json')) {
      wrapper(payload, { json: 'string' }, ['json']);
      if (typeof payload.json !== 'string') { opaque(); return { candidates, unresolvedFragments }; }
      try {
        // The value of json is inside the unit object and payload wrapper (depth 2).
        const nestedBudget = { tokens: budget.tokens, depth: 2 };
        state = parseBoundedJson(payload.json, nestedBudget);
        budget.tokens = nestedBudget.tokens; budget.depth = Math.max(budget.depth, nestedBudget.depth);
      }
      catch (e) { if (e instanceof InventoryError && e.code === 'capacity_exceeded') throw e; opaque(); return { candidates, unresolvedFragments }; }
    }
    inspect(state, shape({ members: 'json', agents: 'json', groups: 'json', audit: 'json', guests: 'json', guestUsage: { map: object(shape({ day: 'string', count: 'integer' }, ['day', 'count'])) }, voiceAgent: object(shape({ id: 'string', llmUrl: 'string', secretId: 'string', keyId: 'string', version: 'integer' })) }, ['members', 'agents', 'groups', 'audit']), envelope);
    array(get(state, 'members'), v => row('identity', v, member, ['studio', get(v, 'telegramId')]));
    if (obj(state) && own(state, 'guests')) array(state.guests, v => row('identity', v, guest, ['studio', get(v, 'telegramId')]));
    array(get(state, 'agents'), v => row('agent_configuration', v, agent, ['studio', get(v, 'id')]));
    array(get(state, 'groups'), v => row('group_configuration', v, studioGroup, ['studio', get(v, 'chatId')]));
    array(get(state, 'audit'), v => row('legacy_audit', v, shape({ at: 'timestamp', actor: 'json', action: 'string', target: 'string', detail: 'string' }, ['at', 'actor', 'action'])));
  }
  if (obj(payload) && ['epoch', 'epochs', 'revision', 'revisions', 'tombstones'].some(k => own(payload, k))) reason(envelope, 'source_suppression_observed');
  return { candidates, unresolvedFragments };
}
